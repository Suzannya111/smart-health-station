/**
 * Smart Care — Leaflet + OpenStreetMap combined-map controller.
 *
 * Replaces the old keyless Google Maps `<iframe>` embeds. Each map view renders
 * ONE Leaflet map that shows, simultaneously:
 *   1. the user's recent location (blue circleMarker + accuracy circle), and
 *   2. nearby medical institutions fetched (keyless) from the Overpass API.
 *
 * Design notes:
 *   - Leaflet is loaded as a classic <script> in index.html, so `window.L`
 *     exists before the deferred ES modules run. We still guard defensively.
 *   - Views never unmount (the router only toggles `.is-active`), so maps are
 *     created once per view (`ensureMap`) and never torn down.
 *   - Home and Alert share the Overpass cache + in-flight request, so a common
 *     centre results in a SINGLE network request.
 *   - All popup content is built with DOM nodes + `textContent` (OSM names are
 *     untrusted — never interpolate them into `innerHTML`).
 *
 * Geolocation + last-known persistence live in `js/ui/location.js`; this module
 * only renders and owns the locate control.
 */

import { EVENT_NAMES } from '../core/bus.js';
import { delegate, setDisabled } from '../core/dom.js';
import { showToast } from '../core/toast.js';

/** Leaflet UMD global — guarded so a missing CDN degrades gracefully. */
const L = (typeof window !== 'undefined' && window.L) || null;

/** Which preserved views contain a map, and the container id inside each. */
export const MAP_IDS = Object.freeze({
  viewHome: 'homeMap',
  viewAlert: 'alertMap'
});

/** The only view that participates in the recent-location feature. */
const LOCATION_VIEW = 'viewHome';

/**
 * 澳門科學館座標 [經度, 緯度] — Macau Science Center as [longitude, latitude].
 * NOTE: Leaflet consumes [latitude, longitude], so this array must NEVER be
 * handed to L.map/setView/latLng directly; go through DEFAULT_CENTER below.
 */
const SCIENCE_CENTER_COORDS = Object.freeze([113.55745, 22.18658]);

/**
 * Default/recent-location centre when no stored or live fix exists — the Macau
 * Science Center, converted from SCIENCE_CENTER_COORDS' [lng, lat] into
 * Leaflet's [lat, lng] order.
 */
const DEFAULT_CENTER = Object.freeze([SCIENCE_CENTER_COORDS[1], SCIENCE_CENTER_COORDS[0]]);

/** Nearby-facility search radius (metres). */
const FACILITY_RADIUS = 3000;

/**
 * Overpass endpoints — primary first, then official load-balanced mirrors.
 * Every entry below was empirically verified from this machine to return
 * HTTP 200, a JSON body containing `elements`, and
 * `Access-Control-Allow-Origin: *` for the exact Macau query (POST). Dead or
 * region-limited hosts were removed:
 *   - overpass.kumi.systems   → hung >30 s (AbortError)
 *   - overpass.private.coffee → hung >30 s (AbortError)
 *   - overpass.osm.ch         → Switzerland-only extract (0 elements for Macau)
 */
const OVERPASS_ENDPOINTS = Object.freeze([
  'https://overpass-api.de/api/interpreter',
  'https://lz4.overpass-api.de/api/interpreter',
  'https://z.overpass-api.de/api/interpreter'
]);

/** Amenities queried from OpenStreetMap. */
const FACILITY_AMENITIES = Object.freeze(['hospital', 'clinic', 'doctors', 'pharmacy', 'dentist']);

/** Facility cache TTL (10 minutes). */
const CACHE_TTL_MS = 10 * 60 * 1000;

/**
 * Per-attempt client timeout for the primary endpoint. The server timeout is
 * 25 s and slow-but-successful replies were measured at 7–18 s, so the old
 * 12 s value aborted valid responses before the server answered.
 */
const OVERPASS_TIMEOUT_MS = 30000;

/** Shorter per-attempt timeout for alternate mirrors (caps the total wait). */
const OVERPASS_MIRROR_TIMEOUT_MS = 15000;

/** Hard global budget across every endpoint and retry round; once exceeded, no
 * further attempts are made so the map never waits indefinitely. */
const OVERPASS_TOTAL_BUDGET_MS = 60000;

/** Re-fetch only when the centre moved more than this (metres). */
const MOVE_THRESHOLD_M = 250;

/** Back-off window after a failed Overpass attempt (timeout / 429 / 504). */
const BACKOFF_MS = 60000;

/** Clamp the accuracy circle so a huge fix never covers the whole city. */
const ACCURACY_CLAMP_M = 5000;

/** Emoji per amenity (static constants — safe in a divIcon `html` string). */
const FACILITY_ICONS = Object.freeze({
  hospital: '🏥',
  clinic: '🩺',
  doctors: '👨‍⚕️',
  pharmacy: '💊',
  dentist: '🦷'
});

/** Great-circle distance between two {lat,lng} points, in metres. */
function distanceMeters(a, b) {
  const R = 6371000;
  const toRad = (deg) => (deg * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * @param {{ bus: object, i18n: object, router: object, location?: object }} deps
 */
export function createMaps({ bus, i18n, router, location }) {
  /** @type {{ latitude: number, longitude: number } | null} */
  let coords = null;
  /** Last reported accuracy in metres (or null). */
  let accuracy = null;
  /** Ensure the automatic fix is requested at most once per session. */
  let geolocationRequested = false;
  /** True while a fix (auto or manual) is in flight. */
  let locating = false;

  /** viewId -> { map, tileLayer, facilityLayer, userLayer, node } */
  const mapsByView = new Map();
  /** cacheKey -> { at, elements } */
  const facilityCache = new Map();
  /** cacheKey -> Promise (shared in-flight request) */
  const inflightRequests = new Map();

  /** '' | 'loading' | 'error' | 'empty' — drives the toolbar status. */
  let facilityStatus = '';
  /** Latest parsed facility list (re-rendered on locale change). */
  let lastElements = [];
  /** Centre of the last successful/vain query (movement detection). */
  let lastQueryCenter = null;
  /** Timestamp of the last 429/504 (back-off window). */
  let lastFailedAt = 0;
  /** Surface the facility-error toast at most once per failure sequence. */
  let facilityErrorToasted = false;

  const t = (key) => i18n.t(key);

  /* ----------------------------------------------------------------------- */
  /* Map lifecycle                                                           */
  /* ----------------------------------------------------------------------- */

  /** Create-once Leaflet map (+ OSM tiles + layer groups) for a view. */
  function ensureMap(viewId) {
    if (!L) return null;
    if (mapsByView.has(viewId)) return mapsByView.get(viewId);

    const id = MAP_IDS[viewId];
    const node = id ? document.getElementById(id) : null;
    if (!node) return null;

    const center = coords ? [coords.latitude, coords.longitude] : DEFAULT_CENTER;
    const map = L.map(node, { zoomControl: true }).setView(center, 13);
    const tileLayer = addTileLayer(map);
    const facilityLayer = L.layerGroup().addTo(map);
    const userLayer = L.layerGroup().addTo(map);

    const entry = { map, tileLayer, facilityLayer, userLayer, node };
    mapsByView.set(viewId, entry);
    return entry;
  }

  /** OSM tile layer (attribution control kept per the OSM usage policy). */
  function addTileLayer(map) {
    return L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution:
        '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
    }).addTo(map);
  }

  /** Leaflet-unavailable fallback: a link into openstreetmap.org. */
  function renderFallback() {
    Object.values(MAP_IDS).forEach((id) => {
      const node = document.getElementById(id);
      if (!node || node.dataset.fallbackReady === '1') return;
      const link = document.createElement('a');
      link.className = 'map-fallback';
      link.href = 'https://www.openstreetmap.org/';
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      link.textContent = 'OpenStreetMap';
      node.appendChild(link);
      node.dataset.fallbackReady = '1';
    });
  }

  /* ----------------------------------------------------------------------- */
  /* Overpass: query / cache / dedup                                         */
  /* ----------------------------------------------------------------------- */

  /** Overpass QL for a centre + radius. */
  function buildOverpassQuery(lat, lng, radius) {
    const amenities = FACILITY_AMENITIES.join('|');
    return (
      `[out:json][timeout:25];\n` +
      `nwr(around:${radius},${lat},${lng})["amenity"~"^(${amenities})$"];\n` +
      `out center tags 50;`
    );
  }

  /** Normalise raw Overpass elements → [{ lat, lng, name, amenity }]. */
  function parseElements(elements) {
    if (!Array.isArray(elements)) return [];
    const out = [];
    for (const item of elements) {
      if (!item) continue;
      const nodeLat = Number(item.lat);
      const nodeLng = Number(item.lon);
      const centreLat = Number(item.center?.lat);
      const centreLng = Number(item.center?.lon);
      const lat = Number.isFinite(nodeLat) ? nodeLat : centreLat;
      const lng = Number.isFinite(nodeLng) ? nodeLng : centreLng;
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue; // unresolved way/relation
      const tags = item.tags && typeof item.tags === 'object' ? item.tags : {};
      out.push({
        lat,
        lng,
        name: typeof tags.name === 'string' ? tags.name : '',
        amenity: typeof tags.amenity === 'string' ? tags.amenity : ''
      });
    }
    return out;
  }

  /**
   * Fetch Overpass with a bounded retry + mirror strategy.
   *
   * - Endpoints are tried in order with a per-attempt abort timeout (30 s for
   *   the primary, 15 s for alternates) so one slow host can't hang forever.
   * - A global budget aborts any remaining attempt once exceeded.
   * - If a full round exhausts every endpoint, ONE retry round runs with the
   *   starting endpoint rotated, so a different host leads the second pass.
   *
   * Rejects only after every attempt of both rounds has failed (or the budget
   * is exhausted); the caller treats that as the single terminal failure.
   * @returns {Promise<Array>} raw Overpass elements
   */
  async function fetchElements(lat, lng) {
    const body = `data=${encodeURIComponent(buildOverpassQuery(lat, lng, FACILITY_RADIUS))}`;
    const total = OVERPASS_ENDPOINTS.length;
    const deadline = Date.now() + OVERPASS_TOTAL_BUDGET_MS;
    let lastError = null;

    for (let round = 0; round < 2; round += 1) {
      for (let i = 0; i < total; i += 1) {
        // Round 0 starts at the primary; round 1 rotates the start by one.
        const index = (i + round) % total;
        const endpoint = OVERPASS_ENDPOINTS[index];

        const remaining = deadline - Date.now();
        if (remaining <= 0) {
          throw lastError || new Error('Overpass total budget exhausted');
        }

        const attemptTimeout = Math.min(
          index === 0 ? OVERPASS_TIMEOUT_MS : OVERPASS_MIRROR_TIMEOUT_MS,
          remaining
        );

        const controller = typeof AbortController === 'function' ? new AbortController() : null;
        const timer = controller ? setTimeout(() => controller.abort(), attemptTimeout) : null;
        try {
          const response = await fetch(endpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body,
            signal: controller ? controller.signal : undefined
          });
          if (!response.ok) {
            const error = new Error(`Overpass HTTP ${response.status}`);
            error.status = response.status;
            throw error;
          }
          const data = await response.json();
          return Array.isArray(data?.elements) ? data.elements : [];
        } catch (error) {
          lastError = error; // try the next endpoint / retry round
        } finally {
          if (timer) clearTimeout(timer);
        }
      }
    }

    throw lastError || new Error('Overpass request failed');
  }

  /** Cache key ≈ 111 m resolution. */
  function cacheKey(lat, lng) {
    return `${lat.toFixed(3)},${lng.toFixed(3)},${FACILITY_RADIUS}`;
  }

  /**
   * Load nearby facilities for the current (or default) centre.
   * Cache → in-flight dedup → network, then render + fit all maps.
   * @returns {Promise<Array>} the parsed facility list
   */
  function loadFacilities({ force = false } = {}) {
    if (!L) return Promise.resolve([]);

    const centre = coords || { latitude: DEFAULT_CENTER[0], longitude: DEFAULT_CENTER[1] };
    const lat = centre.latitude;
    const lng = centre.longitude;
    const key = cacheKey(lat, lng);
    const now = Date.now();

    // Recently rate-limited: wait out the back-off and keep current markers.
    if (!force && lastFailedAt && now - lastFailedAt < BACKOFF_MS) {
      setFacilityStatus('error');
      return Promise.resolve(lastElements);
    }

    const cached = facilityCache.get(key);
    if (!force && cached && now - cached.at < CACHE_TTL_MS) {
      lastQueryCenter = { lat, lng };
      lastElements = cached.elements;
      renderFacilityMarkers(lastElements);
      fitAll();
      setFacilityStatus(lastElements.length ? '' : 'empty');
      return Promise.resolve(lastElements);
    }

    const moved = !lastQueryCenter || distanceMeters(lastQueryCenter, { lat, lng }) > MOVE_THRESHOLD_M;
    if (!force && !moved && lastElements.length) {
      renderFacilityMarkers(lastElements); // same neighbourhood within TTL — reuse
      fitAll();
      return Promise.resolve(lastElements);
    }

    if (inflightRequests.has(key)) return inflightRequests.get(key);

    setFacilityStatus('loading');

    const promise = fetchElements(lat, lng)
      .then((elements) => {
        const parsed = parseElements(elements);
        facilityCache.set(key, { at: Date.now(), elements: parsed });
        lastQueryCenter = { lat, lng };
        lastElements = parsed;
        lastFailedAt = 0;
        facilityErrorToasted = false;
        renderFacilityMarkers(parsed);
        fitAll();
        setFacilityStatus(parsed.length ? '' : 'empty');
        return parsed;
      })
      .catch((error) => {
        // Terminal failure — every endpoint across both retry rounds failed (or
        // the global budget was exhausted). Back off on timeouts (AbortError)
        // as well as rate-limit/server errors so the next automatic attempt
        // doesn't immediately hammer a struggling API.
        const status = Number(error?.status);
        const timedOut = error?.name === 'AbortError';
        if (timedOut || status === 429 || status === 504) lastFailedAt = Date.now();
        // Deliberately do NOT clear markers or the cache: a transient blip
        // must never blank an already-rendered map. Only the status pill and a
        // single one-shot toast reflect the failure.
        setFacilityStatus('error');
        if (!facilityErrorToasted) {
          facilityErrorToasted = true;
          showToast('map.facilities.error', { type: 'warning' });
        }
        return lastElements;
      })
      .finally(() => {
        inflightRequests.delete(key);
      });

    inflightRequests.set(key, promise);
    return promise;
  }

  /* ----------------------------------------------------------------------- */
  /* Markers + popups (XSS-safe)                                             */
  /* ----------------------------------------------------------------------- */

  /** Facility popup built entirely with DOM nodes + textContent. */
  function buildFacilityPopup(facility) {
    const wrapper = document.createElement('div');
    wrapper.className = 'map-facility-popup';

    const title = document.createElement('div');
    title.className = 'map-facility-popup__title';
    title.textContent = facility.name || t('map.facility.medical');
    wrapper.appendChild(title);

    const typeKey =
      facility.amenity && FACILITY_AMENITIES.includes(facility.amenity)
        ? `map.facility.type.${facility.amenity}`
        : '';
    const type = document.createElement('div');
    type.className = 'map-facility-popup__type';
    type.textContent = typeKey ? t(typeKey) : t('map.facility.medical');
    wrapper.appendChild(type);

    const directions = document.createElement('a');
    directions.className = 'map-facility-popup__directions';
    directions.href = `https://www.google.com/maps/dir/?api=1&destination=${facility.lat},${facility.lng}`;
    directions.target = '_blank';
    directions.rel = 'noopener noreferrer';
    directions.textContent = t('map.popup.directions');
    wrapper.appendChild(directions);

    return wrapper;
  }

  /** User popup built with a DOM node + textContent. */
  function buildUserPopup() {
    const wrapper = document.createElement('div');
    wrapper.textContent = t('map.popup.you');
    return wrapper;
  }

  /** Rebuild facility markers on EVERY created map. */
  function renderFacilityMarkers(elements) {
    if (!L) return;
    const list = Array.isArray(elements) ? elements : [];
    mapsByView.forEach((entry) => {
      entry.facilityLayer.clearLayers();
      list.forEach((facility) => {
        const marker = L.marker([facility.lat, facility.lng], {
          icon: L.divIcon({
            className: 'map-facility-icon',
            html: FACILITY_ICONS[facility.amenity] || '🏥',
            iconSize: [24, 24],
            iconAnchor: [12, 12]
          })
        });
        marker.bindPopup(buildFacilityPopup(facility));
        marker.addTo(entry.facilityLayer);
      });
    });
  }

  /** Rebuild the user marker + accuracy circle on EVERY created map. */
  function renderUserMarkers() {
    if (!L) return;
    mapsByView.forEach((entry) => {
      entry.userLayer.clearLayers();
      if (!coords) return;

      const latlng = [coords.latitude, coords.longitude];
      const marker = L.circleMarker(latlng, {
        radius: 8,
        color: '#fff',
        weight: 2,
        fillColor: '#2563eb',
        fillOpacity: 1
      }).bindPopup(buildUserPopup());
      marker.addTo(entry.userLayer);

      if (Number.isFinite(accuracy) && accuracy > 0) {
        L.circle(latlng, {
          radius: Math.min(accuracy, ACCURACY_CLAMP_M),
          color: '#2563eb',
          weight: 1,
          fillColor: '#2563eb',
          fillOpacity: 0.12
        }).addTo(entry.userLayer);
      }
    });
  }

  /** Fit all maps to the union of user + facility markers. */
  function fitAll() {
    if (!L) return;
    mapsByView.forEach((entry) => {
      const facilityMarkers = entry.facilityLayer.getLayers();
      const userMarkers = entry.userLayer.getLayers();
      const all = [...facilityMarkers, ...userMarkers];

      if (all.length > 1) {
        try {
          entry.map.fitBounds(L.featureGroup(all).getBounds().pad(0.15), { maxZoom: 17 });
        } catch {
          /* non-finite bounds — leave the current view */
        }
        return;
      }
      if (userMarkers.length) {
        entry.map.setView(coords ? [coords.latitude, coords.longitude] : DEFAULT_CENTER, 15);
        return;
      }
      if (facilityMarkers.length) {
        entry.map.fitBounds(L.featureGroup(facilityMarkers).getBounds().pad(0.15), { maxZoom: 17 });
        return;
      }
      entry.map.setView(DEFAULT_CENTER, 13);
    });
  }

  /** Re-render markers + fit (used on locale change / external refresh). */
  function refreshMaps() {
    renderUserMarkers();
    renderFacilityMarkers(lastElements);
    fitAll();
  }

  /* ----------------------------------------------------------------------- */
  /* Location seeding + control                                              */
  /* ----------------------------------------------------------------------- */

  /** Seed the marker from the persisted location (before any live fix). */
  function seedFromStored() {
    if (coords) return;
    const last =
      location && typeof location.getLastKnown === 'function' ? location.getLastKnown() : null;
    if (last && Number.isFinite(last.lat) && Number.isFinite(last.lng)) {
      coords = { latitude: last.lat, longitude: last.lng };
      accuracy = Number.isFinite(last.accuracy) ? last.accuracy : null;
    }
  }

  function hasStored() {
    const last =
      location && typeof location.getLastKnown === 'function' ? location.getLastKnown() : null;
    return Boolean(last && Number.isFinite(last.lat) && Number.isFinite(last.lng));
  }

  function locateButton() {
    return document.getElementById('btnLocateMe');
  }

  function statusNode() {
    return document.getElementById('mapLocationStatus');
  }

  /** Status text for the facility/location state (or null → empty). */
  function computeStatus() {
    if (!L) return null;
    if (facilityStatus === 'loading') return { key: 'map.facilities.loading', variant: 'info' };
    if (facilityStatus === 'error') return { key: 'map.facilities.error', variant: 'error' };
    if (facilityStatus === 'empty') return { key: 'map.facilities.empty', variant: 'muted' };
    if (coords) {
      const live = typeof location?.getState === 'function' && location.getState() === 'granted';
      return { key: live ? 'map.location.updated' : 'map.location.stored', variant: live ? 'ok' : 'info' };
    }
    if (hasStored()) return { key: 'map.location.stored', variant: 'info' };
    return null;
  }

  /** Set the facility status and repaint the control. */
  function setFacilityStatus(next) {
    facilityStatus = next;
    renderControl();
  }

  /** Render the Home locate button label/action + status pill. */
  function renderControl() {
    const button = locateButton();
    const status = statusNode();
    const reason =
      location && typeof location.getSupportReason === 'function'
        ? location.getSupportReason()
        : 'unsupported';

    if (button) {
      // This module owns the label from now on (dynamic states) — same pattern
      // as js/ui/header.js — so drop the declarative i18n hooks.
      button.removeAttribute('data-i18n');
      button.removeAttribute('data-i18n-attr');
      button.dataset.action = 'locate-me';

      if (reason !== 'ok') {
        setDisabled(button, true);
        button.textContent = t('map.locate');
        button.title = t(
          reason === 'insecure-context' ? 'error.geolocation.insecure' : 'error.geolocation.unsupported'
        );
      } else if (!L) {
        setDisabled(button, true);
        button.textContent = t('map.locate');
        button.removeAttribute('title');
      } else if (locating) {
        setDisabled(button, true);
        button.textContent = t('map.locate.locating');
        button.removeAttribute('title');
      } else {
        setDisabled(button, false);
        button.removeAttribute('title');
        button.textContent = t('map.locate');
      }
    }

    if (status) {
      const info = computeStatus();
      if (!info) {
        status.textContent = '';
        status.className = 'map-toolbar__status';
      } else {
        status.textContent = t(info.key);
        status.className = `map-toolbar__status status-pill status-pill--${info.variant}`;
      }
    }
  }

  /* ----------------------------------------------------------------------- */
  /* Activation + geolocation                                                */
  /* ----------------------------------------------------------------------- */

  /** Lazy entry point — called every time a view containing a map is shown. */
  function activate(viewId) {
    if (!MAP_IDS[viewId]) return;

    const entry = ensureMap(viewId);
    if (entry) {
      try {
        entry.map.invalidateSize(); // container was hidden → visible
      } catch {
        /* not visible yet — safe to ignore */
      }
    }

    if (viewId === LOCATION_VIEW) seedFromStored();

    renderUserMarkers();
    loadFacilities();
    fitAll();
    if (viewId === LOCATION_VIEW) ensureGeolocation();
    renderControl();
  }

  /** Fire the automatic fix once; degrade gracefully when unsupported. */
  function ensureGeolocation() {
    if (geolocationRequested) return;
    geolocationRequested = true;

    const supported =
      location && typeof location.isSupported === 'function' ? location.isSupported() : false;
    if (!supported) {
      renderControl(); // disables the button with an explanatory title
      return;
    }
    requestFix();
  }

  /** Request a single fresh fix (auto or manual) and drive the control state. */
  function requestFix() {
    if (!location || typeof location.requestCurrent !== 'function') return;
    if (locating) return;

    locating = true;
    renderControl();

    Promise.resolve(location.requestCurrent())
      .catch(() => {}) // errors surface via location:error
      .then(() => {
        locating = false;
        renderControl();
      });
  }

  /* ----------------------------------------------------------------------- */
  /* Wiring                                                                  */
  /* ----------------------------------------------------------------------- */

  function init() {
    if (!L) {
      if (typeof console !== 'undefined') {
        console.warn('[maps] Leaflet (window.L) unavailable — map disabled; showing fallback link.');
      }
      renderFallback();
    }

    if (router && typeof router.registerActivation === 'function') {
      Object.keys(MAP_IDS).forEach((viewId) => router.registerActivation(viewId, activate));
    } else {
      bus.on(EVENT_NAMES.VIEW_CHANGED, (payload) => activate(payload?.viewId));
    }

    // Locale change: rebuild popups (markers re-bind) + re-translate the control.
    bus.on(EVENT_NAMES.I18N_CHANGED, () => {
      renderFacilityMarkers(lastElements);
      renderUserMarkers();
      renderControl();
    });

    // A new (stored or live) position: update coords/accuracy, markers, refetch.
    bus.on(EVENT_NAMES.LOCATION_CHANGED, (payload) => {
      const position = payload?.position;
      if (!position || !Number.isFinite(position.lat) || !Number.isFinite(position.lng)) return;
      coords = { latitude: position.lat, longitude: position.lng };
      accuracy = Number.isFinite(position.accuracy) ? position.accuracy : null;
      locating = false;
      renderUserMarkers();
      loadFacilities(); // refetches only when the centre moved > ~250 m
      fitAll();
      renderControl();
    });

    // Errors keep the last-known marker; only warn + restore the control.
    bus.on(EVENT_NAMES.LOCATION_ERROR, (payload) => {
      locating = false;
      if (payload && payload.key) showToast(payload.key, { type: 'warning' });
      renderControl();
    });

    // Wire the Home locate control through the shared delegation pattern.
    const container = document.getElementById('viewContainer') || document;
    delegate(container, 'click', '[data-action="locate-me"]', (event) => {
      event.preventDefault();
      requestFix();
      // Retry affordance: a click also force-re-attempts facility loading,
      // bypassing the cache and the back-off window, so a user can recover
      // from a failed Overpass load without reloading the page.
      loadFacilities({ force: true });
    });

    seedFromStored();
    renderControl();
  }

  return { init, activate, refreshMaps, renderControl, MAP_IDS };
}

export default createMaps;
