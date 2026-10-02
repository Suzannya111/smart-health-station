/**
 * Smart Care — geolocation service + last-known-location persistence.
 *
 * DOM-free: this module only talks to `navigator.geolocation` and
 * `localStorage`, and publishes the outcome on the shared bus. The map UI
 * (`js/ui/maps.js`) owns every piece of rendering / the locate control.
 *
 * Persistence uses its OWN localStorage key (`smart_care.lastLocation`),
 * deliberately OUTSIDE `smart_care.config`, so Settings Save/Reset never clears
 * it — mirroring the `smart_care.weatherOverride` precedent in js/weather.js.
 */

import { EVENT_NAMES } from '../core/bus.js';

/** localStorage key for the last known position (NOT in the config schema). */
export const LAST_LOCATION_KEY = 'smart_care.lastLocation';

/** One-shot request options (matches the previous inline behaviour). */
const POSITION_OPTIONS = Object.freeze({
  enableHighAccuracy: false,
  timeout: 10000,
  maximumAge: 300000
});

/** GeolocationPositionError.code → i18n key. */
const ERROR_KEYS = Object.freeze({
  1: 'error.geolocation.denied',
  2: 'error.geolocation.unavailable',
  3: 'error.geolocation.timeout'
});

/** True only for real finite numbers (not numeric strings). */
function isFiniteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

/**
 * True when the page runs in a secure context (HTTPS or a localhost origin);
 * browsers gate the Geolocation API behind secure contexts.
 */
function isSecureOrigin() {
  if (typeof window === 'undefined' || !window.location) return true;
  const { protocol, hostname } = window.location;
  if (protocol === 'https:') return true;
  const isLocal =
    hostname === 'localhost' ||
    hostname === '127.0.0.1' ||
    hostname === '::1' ||
    hostname === '[::1]';
  return protocol === 'http:' && isLocal;
}

/**
 * Validate + normalise a raw stored record.
 * @returns {{lat:number,lng:number,accuracy:number|null,timestamp:number|null}|null}
 */
function normalizePosition(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const lat = Number(raw.lat);
  const lng = Number(raw.lng);
  if (!Number.isFinite(lat) || lat < -90 || lat > 90) return null;
  if (!Number.isFinite(lng) || lng < -180 || lng > 180) return null;
  const accuracy = Number(raw.accuracy);
  const timestamp = Number(raw.timestamp);
  return {
    lat,
    lng,
    accuracy: Number.isFinite(accuracy) ? accuracy : null,
    timestamp: Number.isFinite(timestamp) ? timestamp : null
  };
}

/**
 * @param {{ bus?: object }} deps
 * @returns {{
 *   init: () => object|null,
 *   getLastKnown: () => object|null,
 *   getState: () => string,
 *   requestCurrent: () => Promise<object>,
 *   isSupported: () => boolean,
 *   getSupportReason: () => 'ok'|'unsupported'|'insecure-context',
 *   clearStored: () => void,
 *   readStored: () => object|null
 * }}
 */
export function createLocation({ bus } = {}) {
  /** @type {{lat:number,lng:number,accuracy:number|null,timestamp:number|null}|null} */
  let lastKnown = null;
  /** 'idle' | 'locating' | 'granted' | 'denied' | 'unavailable' | 'timeout' | 'unsupported' */
  let state = 'idle';
  /** In-flight request promise (guards against double-fetch). */
  let inflight = null;

  function emit(event, payload) {
    if (bus && typeof bus.emit === 'function') bus.emit(event, payload);
  }

  /** Read + validate the persisted record; corrupt/absent storage → null. */
  function readStored() {
    try {
      const raw = localStorage.getItem(LAST_LOCATION_KEY);
      if (!raw) return null;
      return normalizePosition(JSON.parse(raw));
    } catch {
      return null; // storage unavailable or corrupt JSON — ignore silently
    }
  }

  /** Persist the record; never throws (storage may be unavailable). */
  function writeStored(position) {
    try {
      localStorage.setItem(LAST_LOCATION_KEY, JSON.stringify(position));
    } catch {
      /* storage unavailable — value stays session-only */
    }
  }

  /** Forget the persisted record (not used by the UI yet). */
  function clearStored() {
    try {
      localStorage.removeItem(LAST_LOCATION_KEY);
    } catch {
      /* ignore */
    }
  }

  /** 'ok' | 'unsupported' | 'insecure-context'. */
  function getSupportReason() {
    if (
      typeof navigator === 'undefined' ||
      !navigator.geolocation ||
      typeof navigator.geolocation.getCurrentPosition !== 'function'
    ) {
      return 'unsupported';
    }
    if (!isSecureOrigin()) return 'insecure-context';
    return 'ok';
  }

  function isSupported() {
    return getSupportReason() === 'ok';
  }

  /** @returns {{lat:number,lng:number,accuracy:number|null,timestamp:number|null}|null} */
  function getLastKnown() {
    return lastKnown ? { ...lastKnown } : null;
  }

  function getState() {
    return state;
  }

  /**
   * Load the stored location (if valid) and announce it as `source: 'stored'`.
   * Safe to call before any UI subscribes: consumers can also pull via
   * `getLastKnown()`.
   */
  function init() {
    const stored = readStored();
    if (stored) {
      lastKnown = stored;
      emit(EVENT_NAMES.LOCATION_CHANGED, { position: { ...stored }, source: 'stored' });
    }
    return getLastKnown();
  }

  /** Shared success path: persist + announce as `source: 'live'`. */
  function success(position) {
    const coords = position?.coords || {};
    const record = {
      lat: Number(coords.latitude),
      lng: Number(coords.longitude),
      accuracy: Number.isFinite(Number(coords.accuracy)) ? Number(coords.accuracy) : null,
      timestamp: Number.isFinite(Number(position?.timestamp)) ? Number(position.timestamp) : Date.now()
    };
    lastKnown = record;
    state = 'granted';
    writeStored(record);
    emit(EVENT_NAMES.LOCATION_CHANGED, { position: { ...record }, source: 'live' });
    return { ok: true, position: { ...record } };
  }

  /** Shared failure path: map the browser code to a state + i18n key. */
  function failure(code) {
    const normalized = ERROR_KEYS[code] ? code : 2;
    const key = ERROR_KEYS[normalized];
    state = normalized === 1 ? 'denied' : normalized === 3 ? 'timeout' : 'unavailable';
    emit(EVENT_NAMES.LOCATION_ERROR, { code: normalized, key });
    return { ok: false, code: normalized, key };
  }

  /**
   * Request a single fresh fix.
   * Resolves with `{ ok, position }` on success or `{ ok, code, key }` on
   * failure (errors are also published on `location:error`). Never rejects.
   */
  function requestCurrent() {
    const reason = getSupportReason();
    if (reason !== 'ok') {
      state = 'unsupported';
      const key =
        reason === 'insecure-context'
          ? 'error.geolocation.insecure'
          : 'error.geolocation.unsupported';
      emit(EVENT_NAMES.LOCATION_ERROR, { code: 0, key });
      return Promise.resolve({ ok: false, code: 0, key });
    }

    if (inflight) return inflight;

    state = 'locating';
    let settle = () => {};
    inflight = new Promise((resolve) => {
      settle = resolve;
    });
    const promise = inflight;

    const finish = (result) => {
      inflight = null;
      settle(result);
    };

    try {
      navigator.geolocation.getCurrentPosition(
        (position) => finish(success(position)),
        (error) => finish(failure(Number(error?.code))),
        POSITION_OPTIONS
      );
    } catch {
      finish(failure(2)); // some engines throw synchronously when blocked
    }

    return promise;
  }

  return {
    init,
    getLastKnown,
    getState,
    requestCurrent,
    isSupported,
    getSupportReason,
    clearStored,
    readStored
  };
}

export default createLocation;
