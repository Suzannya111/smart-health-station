/**
 * Smart Care — lazy Google Maps controller (blueprint §5 item 5 / S11).
 *
 * The two iframes (`#homeMapFrame`, `#alertMapFrame`) ship with an EMPTY src in
 * index.html. This module fills them in ONLY when a view containing a map is
 * first shown (lazy), preserving:
 *   - the exact facilities URL template:
 *       https://maps.google.com/maps?q=<encoded q>&ll=<lat>,<lng>&z=14&output=embed
 *   - the no-coordinates fallback (omit `ll`):
 *       https://maps.google.com/maps?q=<encoded q>&output=embed
 *   - the per-locale `mapQuery` values (from i18n, unchanged)
 *   - a graceful no-geolocation path (maps still render, default area)
 *
 * "Show my recent location": the Home map gains a two-mode view built around
 * the keyless embed's single-pin limitation:
 *   - `facilities` mode (default): today's behaviour (`q=<mapQuery>`).
 *   - `person` mode: `q=<lat>,<lng>&z=16` → a pin exactly at the user position.
 *
 * Geolocation + last-known persistence live in `js/ui/location.js`; this module
 * only renders and owns the locate control. On Home activation a stored
 * location is rendered immediately, then a fresh fix is requested (one-shot,
 * manual retry via the button). The Alert map stays facilities-only.
 */

import { EVENT_NAMES } from '../core/bus.js';
import { delegate, setDisabled } from '../core/dom.js';
import { showToast } from '../core/toast.js';

/** Which preserved views contain a map, and the iframe id inside each. */
export const MAP_FRAMES = Object.freeze({
  viewHome: 'homeMapFrame',
  viewAlert: 'alertMapFrame'
});

/** The only view that participates in the recent-location feature. */
const LOCATION_VIEW = 'viewHome';

/**
 * Build the Google Maps embed URL.
 * @param {string} query the locale-specific `mapQuery` value (verbatim)
 * @param {{ latitude: number, longitude: number } | null} position
 * @param {'facilities'|'person'} [mode='facilities']
 *   `'person'` places a pin at `position` (needs valid coords); otherwise the
 *   facilities search is rendered with `ll=` centering when coords are known.
 * @returns {string}
 */
export function buildMapUrl(query, position, mode = 'facilities') {
  const hasPosition =
    Boolean(position) &&
    Number.isFinite(position.latitude) &&
    Number.isFinite(position.longitude);

  if (mode === 'person' && hasPosition) {
    return `https://maps.google.com/maps?q=${position.latitude},${position.longitude}&z=16&output=embed`;
  }

  const base = `https://maps.google.com/maps?q=${encodeURIComponent(query || '')}`;
  if (hasPosition) {
    return `${base}&ll=${position.latitude},${position.longitude}&z=14&output=embed`;
  }
  return `${base}&output=embed`;
}

/**
 * @param {{ bus: object, i18n: object, router: object, location?: object }} deps
 */
export function createMaps({ bus, i18n, router, location }) {
  /** @type {{ latitude: number, longitude: number } | null} */
  let coords = null;
  /** @type {'facilities'|'person'} */
  let mode = 'facilities';
  /** Ensure the automatic fix is requested at most once per session. */
  let geolocationRequested = false;
  /** True while a fix (auto or manual) is in flight. */
  let locating = false;
  /** View ids whose iframe has already been given a src. */
  const loadedViews = new Set();

  const t = (key) => i18n.t(key);

  function frameFor(viewId) {
    const id = MAP_FRAMES[viewId];
    return id ? document.getElementById(id) : null;
  }

  /** Person mode is Home-only; the Alert map keeps the facilities behaviour. */
  function urlFor(viewId) {
    const effectiveMode = viewId === LOCATION_VIEW ? mode : 'facilities';
    return buildMapUrl(i18n.getMapQuery(), coords, effectiveMode);
  }

  /** Give a view's iframe its (current) URL — used on first show and refresh. */
  function load(viewId) {
    const frame = frameFor(viewId);
    if (!frame) return;
    const url = urlFor(viewId);
    if (frame.getAttribute('src') !== url) frame.setAttribute('src', url);
    loadedViews.add(viewId);
  }

  function refreshLoaded() {
    loadedViews.forEach(load);
  }

  /** Seed the marker from the persisted location (before any live fix). */
  function seedFromStored() {
    if (coords) return;
    const last = location && typeof location.getLastKnown === 'function' ? location.getLastKnown() : null;
    if (last && Number.isFinite(last.lat) && Number.isFinite(last.lng)) {
      coords = { latitude: last.lat, longitude: last.lng };
      mode = 'person';
    }
  }

  function hasStored() {
    const last = location && typeof location.getLastKnown === 'function' ? location.getLastKnown() : null;
    return Boolean(last && Number.isFinite(last.lat) && Number.isFinite(last.lng));
  }

  function locateButton() {
    return document.getElementById('btnLocateMe');
  }

  function statusNode() {
    return document.getElementById('mapLocationStatus');
  }

  /** Render the button label/action + status pill for the current state. */
  function renderControl() {
    const button = locateButton();
    if (!button) return;
    // This module owns the label from now on (dynamic states), so drop the
    // declarative i18n hook — same ownership pattern as js/ui/header.js.
    button.removeAttribute('data-i18n');
    button.removeAttribute('data-i18n-attr');

    const status = statusNode();
    const reason =
      location && typeof location.getSupportReason === 'function'
        ? location.getSupportReason()
        : 'unsupported';

    if (reason !== 'ok') {
      setDisabled(button, true);
      button.dataset.action = 'locate-me';
      button.textContent = t('map.locate');
      button.title = t(
        reason === 'insecure-context' ? 'error.geolocation.insecure' : 'error.geolocation.unsupported'
      );
      if (status) {
        status.textContent = '';
        status.className = 'map-toolbar__status';
      }
      return;
    }

    if (locating) {
      setDisabled(button, true);
      button.textContent = t('map.locate.locating');
      button.removeAttribute('title');
      return;
    }

    setDisabled(button, false);
    button.removeAttribute('title');

    if (mode === 'person') {
      const live = typeof location?.getState === 'function' && location.getState() === 'granted';
      button.dataset.action = 'show-facilities';
      button.textContent = t('map.locate.showFacilities');
      if (status) {
        status.textContent = t(live ? 'map.location.updated' : 'map.location.stored');
        status.className = `map-toolbar__status status-pill status-pill--${live ? 'ok' : 'info'}`;
      }
      return;
    }

    button.dataset.action = 'locate-me';
    button.textContent = t('map.locate');
    if (status) {
      if (hasStored()) {
        status.textContent = t('map.location.stored');
        status.className = 'map-toolbar__status status-pill status-pill--info';
      } else {
        status.textContent = '';
        status.className = 'map-toolbar__status';
      }
    }
  }

  /** Lazy entry point — called every time a view becomes visible. */
  function activate(viewId) {
    if (!MAP_FRAMES[viewId]) return;
    if (viewId === LOCATION_VIEW) seedFromStored();
    load(viewId); // fallback/facilities URL if coordinates are not known yet
    if (viewId === LOCATION_VIEW) ensureGeolocation();
  }

  /** Fire the automatic fix once; degrade gracefully when unsupported. */
  function ensureGeolocation() {
    if (geolocationRequested) return;
    geolocationRequested = true;

    const supported = location && typeof location.isSupported === 'function' ? location.isSupported() : false;
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

  /** Toggle back to the facility search. */
  function showFacilities() {
    mode = 'facilities';
    refreshLoaded();
    renderControl();
  }

  function init() {
    if (router && typeof router.registerActivation === 'function') {
      Object.keys(MAP_FRAMES).forEach((viewId) => router.registerActivation(viewId, activate));
    } else {
      bus.on(EVENT_NAMES.VIEW_CHANGED, (payload) => activate(payload?.viewId));
    }

    // A locale change changes mapQuery — rebuild the URL + re-translate the control.
    bus.on(EVENT_NAMES.I18N_CHANGED, () => {
      refreshLoaded();
      renderControl();
    });

    // A new (stored or live) position switches Home to person mode + a pin.
    bus.on(EVENT_NAMES.LOCATION_CHANGED, (payload) => {
      const position = payload?.position;
      if (!position || !Number.isFinite(position.lat) || !Number.isFinite(position.lng)) return;
      coords = { latitude: position.lat, longitude: position.lng };
      mode = 'person';
      locating = false;
      refreshLoaded();
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
    });
    delegate(container, 'click', '[data-action="show-facilities"]', (event) => {
      event.preventDefault();
      showFacilities();
    });

    seedFromStored();
    renderControl();
  }

  return { init, activate, refreshLoaded, renderControl, buildMapUrl, MAP_FRAMES };
}

export default createMaps;
