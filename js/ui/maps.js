/**
 * Smart Care — lazy Google Maps controller (blueprint §5 item 5 / S11).
 *
 * The two iframes (`#homeMapFrame`, `#alertMapFrame`) ship with an EMPTY src in
 * index.html. This module fills them in ONLY when a view containing a map is
 * first shown (lazy), preserving:
 *   - the exact URL template:
 *       https://maps.google.com/maps?q=<encoded q>&ll=<lat>,<lng>&z=14&output=embed
 *   - the no-coordinates fallback (omit `ll`):
 *       https://maps.google.com/maps?q=<encoded q>&output=embed
 *   - the per-locale `mapQuery` values (from i18n, unchanged)
 *   - both frames receiving the SAME URL
 *   - a graceful no-geolocation path (maps still render, default area)
 *
 * Geolocation is requested lazily, the first time a map view appears.
 */

import { EVENT_NAMES } from '../core/bus.js';
import { showToast } from '../core/toast.js';

/** Which preserved views contain a map, and the iframe id inside each. */
export const MAP_FRAMES = Object.freeze({
  viewHome: 'homeMapFrame',
  viewAlert: 'alertMapFrame'
});

/**
 * Build the Google Maps embed URL.
 * @param {string} query the locale-specific `mapQuery` value (verbatim)
 * @param {{ latitude: number, longitude: number } | null} position
 * @returns {string}
 */
export function buildMapUrl(query, position) {
  const base = `https://maps.google.com/maps?q=${encodeURIComponent(query || '')}`;
  if (position && Number.isFinite(position.latitude) && Number.isFinite(position.longitude)) {
    return `${base}&ll=${position.latitude},${position.longitude}&z=14&output=embed`;
  }
  return `${base}&output=embed`;
}

/**
 * @param {{ bus: object, i18n: object, router: object }} deps
 */
export function createMaps({ bus, i18n, router }) {
  /** @type {{ latitude: number, longitude: number } | null} */
  let coords = null;
  let geolocationRequested = false;
  /** View ids whose iframe has already been given a src. */
  const loadedViews = new Set();

  function frameFor(viewId) {
    const id = MAP_FRAMES[viewId];
    return id ? document.getElementById(id) : null;
  }

  function currentUrl() {
    return buildMapUrl(i18n.getMapQuery(), coords);
  }

  /** Give a view's iframe its (current) URL — used on first show and refresh. */
  function load(viewId) {
    const frame = frameFor(viewId);
    if (!frame) return;
    const url = currentUrl();
    if (frame.getAttribute('src') !== url) frame.setAttribute('src', url);
    loadedViews.add(viewId);
  }

  function refreshLoaded() {
    loadedViews.forEach(load);
  }

  /** Lazy entry point — called every time a view becomes visible. */
  function activate(viewId) {
    if (!MAP_FRAMES[viewId]) return;
    load(viewId); // fallback URL if coordinates are not known yet
    ensureGeolocation();
  }

  function ensureGeolocation() {
    if (geolocationRequested) return;
    geolocationRequested = true;

    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      return; // graceful fallback is already rendered by load()
    }

    try {
      navigator.geolocation.getCurrentPosition(
        (position) => {
          coords = {
            latitude: position.coords.latitude,
            longitude: position.coords.longitude
          };
          // Rebuild every already-loaded frame with the ll= variant.
          refreshLoaded();
        },
        () => {
          coords = null;
          showToast('error.geolocation.denied', { type: 'warning' });
          refreshLoaded(); // keep the default-area maps visible
        },
        { enableHighAccuracy: false, timeout: 10000, maximumAge: 300000 }
      );
    } catch {
      /* some engines throw synchronously when blocked — fallback already shown */
    }
  }

  function init() {
    if (router && typeof router.registerActivation === 'function') {
      Object.keys(MAP_FRAMES).forEach((viewId) => router.registerActivation(viewId, activate));
    } else {
      bus.on(EVENT_NAMES.VIEW_CHANGED, (payload) => activate(payload?.viewId));
    }

    // A locale change changes mapQuery — rebuild the URL of loaded frames.
    bus.on(EVENT_NAMES.I18N_CHANGED, () => refreshLoaded());
  }

  return { init, activate, refreshLoaded, buildMapUrl, MAP_FRAMES };
}

export default createMaps;
