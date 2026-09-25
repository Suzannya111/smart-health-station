/**
 * Smart Care — ESP32 dispenser (HTTP actuator) client.
 * Blueprint §4.3 / §4.5. The UI layer NEVER calls fetch() directly.
 *
 * PRESERVED (blueprint §7 — do not change):
 *   MOTOR_ENDPOINTS = { M1: 'm1/fwd', M2: 'm2/fwd', M3: 'm3/fwd' }
 *   fetch(baseUrl + '/' + endpoint, { mode: 'no-cors' })
 *   motor command lock: 2200 ms by default
 *
 * HONEST FEEDBACK: `mode: 'no-cors'` is fire-and-forget. A resolved fetch means
 * "the request was dispatched", NOT "the motor moved". Therefore this module
 * returns `delivered`, never `success`, and `ok` mirrors `delivered`
 * (see blueprint §4.5).
 *
 * Emits on the bus:
 *   esp32:status  → { state, endpoint?, at?, error? }
 *   esp32:command → { endpoint, delivered, at, error? }
 */

import { bus as defaultBus, EVENT_NAMES } from '../core/bus.js';
import {
  getConfig,
  saveConfig,
  buildBaseUrl,
  normalizeBaseUrl,
  DEFAULT_COMMAND_LOCK_MS,
  LOCK_MIN_MS,
  LOCK_MAX_MS
} from '../config.js';

/**
 * PRESERVED endpoint constants — byte-exact, no leading slash.
 * The single '/' is inserted by send(): `baseUrl + '/' + endpoint`.
 */
export const MOTOR_ENDPOINTS = Object.freeze({
  M1: 'm1/fwd',
  M2: 'm2/fwd',
  M3: 'm3/fwd'
});

/** Status vocabulary (blueprint §4.3). */
export const ESP32_STATES = Object.freeze({
  NOT_CONFIGURED: 'not-configured',
  UNKNOWN: 'unknown',
  SENT_UNVERIFIED: 'sent-unverified',
  ERROR: 'error'
});

/**
 * Accept a motor key ('M1'|'M2'|'M3') or a raw endpoint path and return the
 * literal endpoint string. Keeps the endpoint vocabulary in ONE place while the
 * markup can carry `data-motor="M1"` (or the original `m1/fwd` literal).
 * @param {string} motorOrEndpoint
 * @returns {string}
 */
export function resolveMotorEndpoint(motorOrEndpoint) {
  if (!motorOrEndpoint) return '';
  const key = String(motorOrEndpoint).trim();
  const upper = key.toUpperCase();
  if (Object.prototype.hasOwnProperty.call(MOTOR_ENDPOINTS, upper)) return MOTOR_ENDPOINTS[upper];
  return key.replace(/^\/+/, ''); // tolerate a leading slash from markup
}

/** Trim slashes at both ends. */
function trimSlashes(value) {
  return String(value ?? '').replace(/^\/+/, '').replace(/\/+$/, '');
}

/** Accept either the config module namespace or a plain config object. */
function resolveConfigSource(config) {
  if (config && typeof config.getConfig === 'function') {
    return {
      get: () => config.getConfig(),
      save: typeof config.saveConfig === 'function' ? (partial) => config.saveConfig(partial) : null
    };
  }
  if (config && typeof config === 'object' && typeof config.getConfig !== 'function') {
    return { get: () => config, save: null };
  }
  return { get: getConfig, save: saveConfig };
}

/**
 * @param {{ config?: object, bus?: object }} [options]
 */
export function createEsp32Client({ config = null, bus = defaultBus } = {}) {
  const source = resolveConfigSource(config);

  /** Timestamp (ms) until which motor commands are refused. */
  let lockUntil = 0;
  /** @type {'not-configured'|'unknown'|'sent-unverified'|'error'} */
  let status = ESP32_STATES.UNKNOWN;
  let lastError = null;

  function getSnapshot() {
    const snapshot = source.get();
    const esp32 = snapshot?.esp32 || {};
    return {
      baseUrl: esp32.baseUrl || buildBaseUrl(esp32.protocol, esp32.host) || '',
      protocol: esp32.protocol || 'http',
      host: esp32.host || '',
      commandLockMs: Number.isFinite(Number(esp32.commandLockMs))
        ? Number(esp32.commandLockMs)
        : DEFAULT_COMMAND_LOCK_MS
    };
  }

  function clampLock(ms) {
    const value = Number(ms);
    if (!Number.isFinite(value)) return DEFAULT_COMMAND_LOCK_MS;
    return Math.min(Math.max(Math.round(value), LOCK_MIN_MS), LOCK_MAX_MS);
  }

  /** Canonical base URL of the dispenser ('' when unconfigured). */
  function getBaseUrl() {
    return getSnapshot().baseUrl;
  }

  function getStatus() {
    if (!getBaseUrl()) return ESP32_STATES.NOT_CONFIGURED;
    return status;
  }

  function setStatus(next, extra = {}) {
    status = next;
    if (next === ESP32_STATES.ERROR) lastError = extra.error || null;
    bus.emit(EVENT_NAMES.ESP32_STATUS, { state: next, ...extra });
    return status;
  }

  /**
   * Update protocol + host and persist them (baseUrl is always derived).
   * @param {string} baseUrl   e.g. '192.168.1.100' or 'http://192.168.1.100:80'
   * @param {string} [protocol] 'http' | 'https'; when omitted the scheme found
   *                            in `baseUrl` is used (default 'http')
   * @returns {string} the effective base URL
   */
  function setBaseUrl(baseUrl, protocol) {
    const requestedScheme = /^([a-zA-Z][a-zA-Z0-9+.-]*):\/\//.exec(String(baseUrl || ''))?.[1]?.toLowerCase();
    const trimmed = String(baseUrl ?? '').trim();

    let host = trimmed;
    if (trimmed.includes('://')) {
      host = normalizedHostOf(trimmed);
    } else {
      host = trimSlashes(trimmed.split(/[/?#]/)[0]);
    }

    const nextProtocol = ['http', 'https'].includes(String(protocol).toLowerCase())
      ? String(protocol).toLowerCase()
      : ['http', 'https'].includes(requestedScheme)
        ? requestedScheme
        : undefined;

    if (source.save) {
      const partial = { esp32: { host } };
      if (nextProtocol) partial.esp32.protocol = nextProtocol;
      source.save(partial);
    }

    status = ESP32_STATES.UNKNOWN; // awaiting an explicit Test
    setStatus(ESP32_STATES.UNKNOWN, { endpoint: undefined });
    return getBaseUrl();
  }

  /** Extract `host[:port]` from a full URL string. */
  function normalizedHostOf(value) {
    const normalized = normalizeBaseUrl(value); // 'http://host[:port]'
    return trimSlashes(normalized.replace(/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//, ''));
  }

  /** Remaining motor-lock time in ms (0 when unlocked). */
  function getRemainingLockMs() {
    return Math.max(0, lockUntil - Date.now());
  }

  /** True while motor commands are still locked. */
  function isLocked() {
    return getRemainingLockMs() > 0;
  }

  /**
   * Send a motor command.
   *
   * PRESERVED REQUEST SHAPE:
   *   fetch(baseUrl + '/' + endpoint, { mode: 'no-cors' })
   *
   * `delivered` is false only when the fetch throws (DNS failure, connection
   * refused, blocked) or when the command lock is still active.
   *
   * @param {string} endpoint motor key ('M1') or literal path ('m1/fwd')
   * @param {{ lockMs?: number, force?: boolean }} [options]
   * @returns {Promise<{ endpoint: string, ok: boolean, delivered: boolean,
   *                     error?: string, remainingLockMs?: number }>}
   */
  async function send(endpoint, { lockMs, force = false } = {}) {
    const path = resolveMotorEndpoint(endpoint);
    const snapshot = getSnapshot();
    const at = new Date().toISOString();

    if (!path) {
      const result = { endpoint: '', ok: false, delivered: false, error: 'invalid-endpoint' };
      bus.emit(EVENT_NAMES.ESP32_COMMAND, { ...result, at });
      return result;
    }

    const baseUrl = snapshot.baseUrl;
    if (!baseUrl) {
      setStatus(ESP32_STATES.NOT_CONFIGURED, { endpoint: path, at, error: 'not-configured' });
      const result = { endpoint: path, ok: false, delivered: false, error: 'not-configured' };
      bus.emit(EVENT_NAMES.ESP32_COMMAND, { ...result, at });
      return result;
    }

    const remaining = getRemainingLockMs();
    if (remaining > 0 && !force) {
      // A shared lock for all three motor entry points (home, wound, fever).
      const result = {
        endpoint: path,
        ok: false,
        delivered: false,
        error: 'locked',
        remainingLockMs: remaining
      };
      bus.emit(EVENT_NAMES.ESP32_COMMAND, { ...result, at });
      return result;
    }

    // Acquire the lock BEFORE dispatching so rapid double-taps cannot queue.
    const effectiveLockMs = clampLock(lockMs ?? snapshot.commandLockMs);
    lockUntil = Date.now() + effectiveLockMs;

    let delivered = false;
    let errorMessage;

    try {
      // PRESERVED SHAPE — do not "improve" this to cors mode.
      await fetch(`${baseUrl}/${path}`, { mode: 'no-cors' });
      delivered = true;
      setStatus(ESP32_STATES.SENT_UNVERIFIED, { endpoint: path, at });
    } catch (error) {
      errorMessage = String(error?.message || error || 'unknown');
      setStatus(ESP32_STATES.ERROR, { endpoint: path, at, error: errorMessage });
      console.warn('[esp32] command failed:', error);
    }

    const result = {
      endpoint: path,
      ok: delivered, // `ok` mirrors `delivered`; it never means "motor moved"
      delivered,
      ...(errorMessage ? { error: errorMessage } : {}),
      remainingLockMs: getRemainingLockMs()
    };

    bus.emit(EVENT_NAMES.ESP32_COMMAND, { ...result, at });
    return result;
  }

  /**
   * Liveness probe: a single `no-cors` request to the base URL root.
   * Reports `delivered` honestly — reachability CANNOT be verified.
   * @returns {Promise<{ ok: boolean, delivered: boolean, error?: string, state: string }>}
   */
  async function probe() {
    const at = new Date().toISOString();
    const baseUrl = getSnapshot().baseUrl;

    if (!baseUrl) {
      setStatus(ESP32_STATES.NOT_CONFIGURED, { at, error: 'not-configured' });
      return { ok: false, delivered: false, error: 'not-configured', state: getStatus() };
    }

    try {
      // Same no-cors shape as send(), aimed at the root path.
      await fetch(`${baseUrl}/`, { mode: 'no-cors' });
      setStatus(ESP32_STATES.SENT_UNVERIFIED, { at });
      return { ok: true, delivered: true, state: getStatus() };
    } catch (error) {
      const errorMessage = String(error?.message || error || 'unknown');
      setStatus(ESP32_STATES.ERROR, { at, error: errorMessage });
      return { ok: false, delivered: false, error: errorMessage, state: getStatus() };
    }
  }

  /** True when the page is HTTPS while the dispenser is plain HTTP. */
  function isMixedContentRiskLocal() {
    const { protocol } = getSnapshot();
    try {
      return typeof location !== 'undefined' && location.protocol === 'https:' && protocol === 'http';
    } catch {
      return false;
    }
  }

  // Reflect the stored configuration immediately.
  status = getBaseUrl() ? ESP32_STATES.UNKNOWN : ESP32_STATES.NOT_CONFIGURED;

  return {
    /* spec */
    getBaseUrl,
    setBaseUrl,
    getStatus,
    send,
    probe,
    getRemainingLockMs,
    /* small, additive conveniences for the UI layer */
    isLocked,
    isMixedContentRisk: isMixedContentRiskLocal,
    getLastError: () => lastError,
    endpoints: MOTOR_ENDPOINTS
  };
}

export default createEsp32Client;
