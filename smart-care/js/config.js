/**
 * Smart Care — configuration & persistence layer (blueprint §2).
 *
 * localStorage schema
 *   smart_care_lang           string   LEGACY KEY — preserved byte-for-byte, still the
 *                                       write/read target for the UI language.
 *   smart_care.config         JSON     main config object
 *   smart_care.config.version number   schema version used for migrations
 *
 * Guarantees:
 *   - corrupt / absent JSON never throws: it falls back to defaults + console warning
 *   - strict schema whitelist: unknown keys are dropped on load and on save
 *   - save validates first and REJECTS the write on error (errors are published on
 *     the bus as `config:invalid` so the Settings UI can render inline messages)
 *   - reset removes smart_care.config (+ .version) ONLY — never smart_care_lang
 *
 * NOTE: `thresholds.feverCelsius` defaults to 37.5 — an APPROVED correction of the
 * original 36.0 *test* value (blueprint §7). Do not revert it to 36.0.
 */

import { bus, EVENT_NAMES } from './core/bus.js';

/* =========================================================================
   Constants
   ========================================================================= */

export const STORAGE_KEYS = Object.freeze({
  lang: 'smart_care_lang', // legacy key — kept verbatim
  config: 'smart_care.config',
  version: 'smart_care.config.version'
});

export const SUPPORTED_LOCALES = Object.freeze(['zh-Hant', 'zh-Hans', 'en', 'pt']);
export const DEFAULT_LOCALE = 'zh-Hant';
export const SCHEMA_VERSION = 1;

/** Original hard-coded constants, preserved. */
export const DEFAULT_ESP32_HOST = '192.168.1.100';
export const DEFAULT_ESP32_PROTOCOL = 'http';
export const DEFAULT_COMMAND_LOCK_MS = 2200; // identical to original line 526
export const DEFAULT_SERVICE_UUID = '0000ffe0-0000-1000-8000-00805f9b34fb';
export const DEFAULT_CHARACTERISTIC_UUID = '0000ffe1-0000-1000-8000-00805f9b34fb';
export const TEMP_MIN_C = 30.0;
export const TEMP_MAX_C = 45.0;
export const FEVER_DEFAULT_C = 37.5; // APPROVED change (was the 36.0 test value)
export const FEVER_SOFT_WARN_BELOW_C = 35.0;
export const LOCK_MIN_MS = 500;
export const LOCK_MAX_MS = 10000;

/**
 * Wound / AI detection (Roboflow serverless) defaults.
 * NOTE: `DEFAULT_WOUND_API_KEY` is the embedded default for this personal,
 * non-open-source prototype, so wound detection works without manual setup.
 * It is a browser-visible embedded credential — do NOT publish or commit it to
 * a public repository. Operators may override it at runtime via
 * Settings → Advanced (stored per-device).
 */
export const DEFAULT_WOUND_API_BASE_URL = 'https://serverless.roboflow.com';
export const DEFAULT_WOUND_MODEL_ID = 'wound-object-detection';
export const DEFAULT_WOUND_MODEL_VERSION = '1';
export const DEFAULT_WOUND_API_KEY = 'f1JanSsMXOqLmiXQDyTy';
export const DEFAULT_WOUND_CONFIDENCE = 0.5;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const HOSTNAME_RE = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)*$/i;
const PROTOCOLS = Object.freeze(['http', 'https']);

/** Base 128-bit suffix used to expand 4-hex / 8-hex short UUIDs (Bluetooth SIG). */
const UUID_SUFFIX = '-0000-1000-8000-00805f9b34fb';

/* =========================================================================
   Defaults
   ========================================================================= */

/** Frozen deep default configuration (single source of truth). */
export const DEFAULT_CONFIG = Object.freeze(
  deepFreeze({
    schemaVersion: SCHEMA_VERSION,
    esp32: {
      baseUrl: `${DEFAULT_ESP32_PROTOCOL}://${DEFAULT_ESP32_HOST}`, // normalized, no trailing slash
      protocol: DEFAULT_ESP32_PROTOCOL,
      host: DEFAULT_ESP32_HOST,
      commandLockMs: DEFAULT_COMMAND_LOCK_MS
    },
    ble: {
      serviceUuid: DEFAULT_SERVICE_UUID,
      characteristicUuid: DEFAULT_CHARACTERISTIC_UUID,
      acceptAllDevices: true,
      minValidTempC: TEMP_MIN_C,
      maxValidTempC: TEMP_MAX_C
    },
    thresholds: {
      feverCelsius: FEVER_DEFAULT_C
    },
    device: {
      thermometerName: '',
      lastConnectedAt: null
    },
    /* Wound / AI detection endpoint (Roboflow serverless). `apiKey` defaults to
       the embedded prototype key (see DEFAULT_WOUND_API_KEY above). */
    woundAi: {
      baseUrl: DEFAULT_WOUND_API_BASE_URL,
      modelId: DEFAULT_WOUND_MODEL_ID,
      version: DEFAULT_WOUND_MODEL_VERSION,
      apiKey: DEFAULT_WOUND_API_KEY,
      confidenceThreshold: DEFAULT_WOUND_CONFIDENCE
    }
  })
);

/** The shared bus also carries config events (`config:changed`, `config:invalid`). */
export const configBus = bus;

/* =========================================================================
   Internal state
   ========================================================================= */

/** @type {any} */
let currentConfig = cloneConfig(DEFAULT_CONFIG);
let loaded = false;
/** Last validation result — lets a caller read the errors after saveConfig(). */
let lastValidation = Object.freeze({ ok: true, errors: [], warnings: [] });

/* =========================================================================
   Small utilities
   ========================================================================= */

function deepFreeze(value) {
  if (value && typeof value === 'object') {
    Object.values(value).forEach(deepFreeze);
    Object.freeze(value);
  }
  return value;
}

/** Deep clone of plain JSON data (never throws). */
function cloneConfig(value) {
  if (value === null || value === undefined) return value;
  try {
    if (typeof structuredClone === 'function') return structuredClone(value);
  } catch {
    /* fall through to JSON cloning */
  }
  try {
    return JSON.parse(JSON.stringify(value));
  } catch {
    return value;
  }
}

/** localStorage handle, or null when unavailable (SSR / disabled storage / privacy mode). */
function getStorage() {
  try {
    if (typeof localStorage === 'undefined' || localStorage === null) return null;
    // Touch it once: some browsers throw on first access in restricted modes.
    const probe = '__smart_care_probe__';
    localStorage.setItem(probe, '1');
    localStorage.removeItem(probe);
    return localStorage;
  } catch {
    return null;
  }
}

function readRaw(storage, key) {
  try {
    return storage ? storage.getItem(key) : null;
  } catch (error) {
    console.warn(`[config] could not read "${key}":`, error);
    return null;
  }
}

function writeRaw(storage, key, value) {
  try {
    if (storage) storage.setItem(key, value);
    return true;
  } catch (error) {
    console.warn(`[config] could not write "${key}":`, error);
    return false;
  }
}

function removeRaw(storage, key) {
  try {
    if (storage) storage.removeItem(key);
    return true;
  } catch (error) {
    console.warn(`[config] could not remove "${key}":`, error);
    return false;
  }
}

/* =========================================================================
   Normalizers
   ========================================================================= */

/**
 * Expand a 4-hex / 8-hex short Bluetooth UUID to the full 128-bit form and
 * lowercase it. Already-full UUIDs (and anything unrecognised) pass through
 * normalized but unvalidated — validateConfig() reports format errors.
 * @param {string} input
 * @returns {string}
 */
export function normalizeUuid(input) {
  if (input === null || input === undefined) return '';
  let raw = String(input).trim().toLowerCase().replace(/^urn:uuid:/, '').replace(/[{}]/g, '');
  if (/^0x[0-9a-f]+$/.test(raw)) raw = raw.slice(2);
  if (/^[0-9a-f]{4}$/.test(raw)) return `0000${raw}${UUID_SUFFIX}`;
  if (/^[0-9a-f]{8}$/.test(raw)) return `${raw}${UUID_SUFFIX}`;
  return raw;
}

/** True when the value is a valid 128-bit UUID (after short-form expansion). */
export function isValidUuid(input) {
  return UUID_RE.test(normalizeUuid(input));
}

/** True for a syntactically valid IPv4 address. */
export function isValidIPv4(input) {
  const value = String(input || '').trim();
  const match = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(value);
  if (!match) return false;
  return match.slice(1).every((part) => {
    const octet = Number(part);
    return octet >= 0 && octet <= 255 && String(octet) === part;
  });
}

/**
 * Validate `host` or `host:port`: no scheme, no spaces, no path.
 * Accepts IPv4, `localhost`, hostnames and an optional port 1–65535.
 */
export function isValidHost(input) {
  const value = String(input ?? '').trim();
  if (!value) return false;
  if (/\s/.test(value)) return false;
  if (value.includes('://') || /[/\\?#@]/.test(value)) return false;

  let host = value;
  const lastColon = value.lastIndexOf(':');
  if (lastColon !== -1) {
    host = value.slice(0, lastColon);
    const port = value.slice(lastColon + 1);
    if (!/^\d{1,5}$/.test(port)) return false;
    const portNumber = Number(port);
    if (portNumber < 1 || portNumber > 65535) return false;
  }
  if (!host) return false;
  if (isValidIPv4(host)) return true;
  if (host.toLowerCase() === 'localhost') return true;
  return HOSTNAME_RE.test(host) && host.length <= 253;
}

/**
 * Normalize a user-entered base URL: strips any scheme, path, query, hash and
 * trailing slash, then re-attaches the scheme (default `http`).
 * Returns '' for empty input.
 * @param {string} input
 * @returns {string} e.g. 'http://192.168.1.100'
 */
export function normalizeBaseUrl(input) {
  if (input === null || input === undefined) return '';
  let raw = String(input).trim();
  if (!raw) return '';

  let protocol = '';
  const schemeMatch = /^([a-zA-Z][a-zA-Z0-9+.-]*):\/\//.exec(raw);
  if (schemeMatch) {
    protocol = schemeMatch[1].toLowerCase();
    raw = raw.slice(schemeMatch[0].length);
  }
  if (/^\/\//.test(raw)) raw = raw.replace(/^\/+/, ''); // protocol-relative '//host'
  raw = raw.split(/[/?#]/)[0].trim();
  if (!raw) return '';

  // Only http/https are allowed; anything else (or no scheme at all) → http.
  const scheme = PROTOCOLS.includes(protocol) ? protocol : DEFAULT_ESP32_PROTOCOL;
  return `${scheme}://${raw}`;
}

/**
 * Derive the canonical base URL from an explicit protocol + host pair.
 * @param {string} protocol 'http' | 'https'
 * @param {string} host     host or host:port
 * @returns {string}
 */
export function buildBaseUrl(protocol, host) {
  const safeProtocol = PROTOCOLS.includes(String(protocol).toLowerCase())
    ? String(protocol).toLowerCase()
    : DEFAULT_ESP32_PROTOCOL;
  const safeHost = String(host ?? '').trim().replace(/\/+$/, '');
  if (!safeHost) return '';
  return `${safeProtocol}://${safeHost}`;
}

/** True for the locales the app ships translations for. */
export function isSupportedLocale(locale) {
  return SUPPORTED_LOCALES.includes(locale);
}

/**
 * True when the current page is HTTPS while the ESP32 is configured as plain
 * HTTP — the browser will block those requests as mixed content.
 * @param {string} [protocol]
 */
export function isMixedContentRisk(protocol) {
  try {
    const pageIsHttps = typeof location !== 'undefined' && location.protocol === 'https:';
    const target = protocol || currentConfig?.esp32?.protocol || DEFAULT_ESP32_PROTOCOL;
    return pageIsHttps && target === 'http';
  } catch {
    return false;
  }
}

/* =========================================================================
   Merge / sanitize (strict schema whitelist)
   ========================================================================= */

/**
 * Merge `patch` over `base`, keeping ONLY keys present in `base` (the schema).
 * Unknown keys are dropped so the stored schema can never drift.
 */
function mergeWhitelisted(base, patch) {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) return cloneConfig(base);
  const result = cloneConfig(base);

  for (const [key, value] of Object.entries(patch)) {
    if (!Object.prototype.hasOwnProperty.call(base, key)) continue; // drop unknown key
    const baseValue = base[key];
    if (baseValue && typeof baseValue === 'object' && !Array.isArray(baseValue)) {
      result[key] = mergeWhitelisted(baseValue, value);
    } else if (value !== undefined) {
      result[key] = value;
    }
  }
  return result;
}

/** Coerce a value to a finite number, falling back to `fallback`. */
function toNumber(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function toBoolean(value, fallback) {
  if (typeof value === 'boolean') return value;
  if (value === 'true') return true;
  if (value === 'false') return false;
  return fallback;
}

/**
 * Field-level sanitize: forces types and derives `esp32.baseUrl` from
 * protocol + host. Never throws; invalid values fall back to defaults.
 */
function sanitizeConfig(input) {
  const config = mergeWhitelisted(DEFAULT_CONFIG, input);

  config.schemaVersion = SCHEMA_VERSION;

  config.esp32.host = String(config.esp32.host ?? DEFAULT_ESP32_HOST).trim();
  config.esp32.protocol = PROTOCOLS.includes(String(config.esp32.protocol).toLowerCase())
    ? String(config.esp32.protocol).toLowerCase()
    : DEFAULT_ESP32_PROTOCOL;
  config.esp32.commandLockMs = Math.round(
    toNumber(config.esp32.commandLockMs, DEFAULT_COMMAND_LOCK_MS)
  );
  // baseUrl is ALWAYS derived — never trusted from storage.
  config.esp32.baseUrl = buildBaseUrl(config.esp32.protocol, config.esp32.host);

  config.ble.serviceUuid = normalizeUuid(config.ble.serviceUuid) || DEFAULT_SERVICE_UUID;
  config.ble.characteristicUuid = normalizeUuid(config.ble.characteristicUuid) || DEFAULT_CHARACTERISTIC_UUID;
  config.ble.acceptAllDevices = toBoolean(config.ble.acceptAllDevices, true);
  config.ble.minValidTempC = toNumber(config.ble.minValidTempC, TEMP_MIN_C);
  config.ble.maxValidTempC = toNumber(config.ble.maxValidTempC, TEMP_MAX_C);

  config.thresholds.feverCelsius = toNumber(config.thresholds.feverCelsius, FEVER_DEFAULT_C);

  config.device.thermometerName = String(config.device.thermometerName ?? '');
  config.device.lastConnectedAt =
    config.device.lastConnectedAt === null || config.device.lastConnectedAt === undefined
      ? null
      : String(config.device.lastConnectedAt);

  // Wound / AI endpoint — baseUrl is normalized (scheme kept, no trailing slash);
  // empty fields fall back to defaults so a cleared form never breaks the flow.
  config.woundAi.baseUrl =
    String(config.woundAi.baseUrl ?? '').trim().replace(/\/+$/, '') || DEFAULT_WOUND_API_BASE_URL;
  config.woundAi.modelId = String(config.woundAi.modelId ?? '').trim() || DEFAULT_WOUND_MODEL_ID;
  config.woundAi.version = String(config.woundAi.version ?? '').trim() || DEFAULT_WOUND_MODEL_VERSION;
  config.woundAi.apiKey = String(config.woundAi.apiKey ?? '').trim(); // '' is valid (→ offline mock)
  config.woundAi.confidenceThreshold = toNumber(
    config.woundAi.confidenceThreshold,
    DEFAULT_WOUND_CONFIDENCE
  );

  return config;
}

/* =========================================================================
   Validation (§2.3)
   ========================================================================= */

/**
 * Validate a partial config against the schema.
 * @param {object} partial
 * @returns {{ ok: boolean, value: object, errors: Array<{field:string,code:string,message:string}>,
 *             warnings: Array<{field:string,code:string,message:string}> }}
 */
export function validateConfig(partial = {}) {
  const value = sanitizeConfig(partial);
  const errors = [];
  const warnings = [];

  /* --- ESP32 host ------------------------------------------------------- */
  if (!value.esp32.host) {
    errors.push({
      field: 'esp32.host',
      code: 'required',
      message: 'Host / IP address is required.'
    });
  } else if (!isValidHost(value.esp32.host)) {
    errors.push({
      field: 'esp32.host',
      code: 'format',
      message: 'Enter an IPv4 address, a hostname (optionally with :port), e.g. 192.168.1.100.'
    });
  }

  /* --- ESP32 protocol --------------------------------------------------- */
  if (!PROTOCOLS.includes(value.esp32.protocol)) {
    errors.push({
      field: 'esp32.protocol',
      code: 'enum',
      message: 'Protocol must be "http" or "https".'
    });
  }

  /* --- mixed content (warning, never blocking) -------------------------- */
  if (value.esp32.protocol === 'http' && isMixedContentRisk('http')) {
    warnings.push({
      field: 'esp32.protocol',
      code: 'mixed-content',
      message: 'ESP32 commands will be blocked as mixed content on an HTTPS page.'
    });
  }

  /* --- BLE UUIDs -------------------------------------------------------- */
  if (!UUID_RE.test(value.ble.serviceUuid)) {
    errors.push({
      field: 'ble.serviceUuid',
      code: 'uuid',
      message: 'Service UUID must be 4-hex short form or a full 128-bit UUID.'
    });
  }
  if (!UUID_RE.test(value.ble.characteristicUuid)) {
    errors.push({
      field: 'ble.characteristicUuid',
      code: 'uuid',
      message: 'Characteristic UUID must be 4-hex short form or a full 128-bit UUID.'
    });
  }

  /* --- temperature plausibility bounds --------------------------------- */
  if (value.ble.minValidTempC < 0 || value.ble.minValidTempC > 100) {
    errors.push({
      field: 'ble.minValidTempC',
      code: 'range',
      message: 'Minimum valid temperature must be between 0 and 100 °C.'
    });
  }
  if (value.ble.maxValidTempC < 0 || value.ble.maxValidTempC > 100) {
    errors.push({
      field: 'ble.maxValidTempC',
      code: 'range',
      message: 'Maximum valid temperature must be between 0 and 100 °C.'
    });
  }
  if (value.ble.minValidTempC >= value.ble.maxValidTempC) {
    errors.push({
      field: 'ble.maxValidTempC',
      code: 'order',
      message: 'Maximum valid temperature must be greater than the minimum.'
    });
  }

  /* --- fever threshold -------------------------------------------------- */
  if (value.thresholds.feverCelsius < TEMP_MIN_C || value.thresholds.feverCelsius > TEMP_MAX_C) {
    errors.push({
      field: 'thresholds.feverCelsius',
      code: 'range',
      message: `Fever threshold must be between ${TEMP_MIN_C.toFixed(1)} and ${TEMP_MAX_C.toFixed(1)} °C.`
    });
  } else if (value.thresholds.feverCelsius < FEVER_SOFT_WARN_BELOW_C) {
    warnings.push({
      field: 'thresholds.feverCelsius',
      code: 'low',
      message: 'This value is unusually low; the original test value was 36.0.'
    });
  }

  /* --- wound / AI endpoint --------------------------------------------- */
  if (!/^https?:\/\//i.test(value.woundAi.baseUrl)) {
    errors.push({
      field: 'woundAi.baseUrl',
      code: 'format',
      message: 'Wound API base URL must start with http:// or https://.'
    });
  }
  if (value.woundAi.confidenceThreshold < 0 || value.woundAi.confidenceThreshold > 1) {
    errors.push({
      field: 'woundAi.confidenceThreshold',
      code: 'range',
      message: 'Confidence threshold must be between 0 and 1.'
    });
  }
  if (!value.woundAi.apiKey) {
    warnings.push({
      field: 'woundAi.apiKey',
      code: 'empty',
      message: 'No wound-detection API key set — the wound flow will show a clearly-labelled simulated (offline) result.'
    });
  }

  /* --- command lock: clamp with notice (never an error) ------------------ */
  const requestedLock = value.esp32.commandLockMs;
  if (requestedLock < LOCK_MIN_MS || requestedLock > LOCK_MAX_MS) {
    value.esp32.commandLockMs = Math.min(Math.max(requestedLock, LOCK_MIN_MS), LOCK_MAX_MS);
    warnings.push({
      field: 'esp32.commandLockMs',
      code: 'clamped',
      message: `Motor button lock clamped to ${value.esp32.commandLockMs} ms (allowed ${LOCK_MIN_MS}–${LOCK_MAX_MS}).`
    });
  }

  return { ok: errors.length === 0, value, errors, warnings };
}

/* =========================================================================
   Migration
   ========================================================================= */

/**
 * v1 migration: mirrors the legacy `smart_care_lang` value into runtime state.
 * The legacy key stays the write target for the language (see
 * getStoredLanguage/setStoredLanguage), so existing kiosks keep their choice.
 * @returns {{ schemaVersion: number, migrated: boolean, locale: string }}
 */
export function migrateToV1() {
  const storage = getStorage();
  const legacyLocale = readRaw(storage, STORAGE_KEYS.lang);
  const locale = isSupportedLocale(legacyLocale) ? legacyLocale : DEFAULT_LOCALE;

  if (legacyLocale && !isSupportedLocale(legacyLocale)) {
    console.warn(`[config] unsupported stored locale "${legacyLocale}" — falling back to ${DEFAULT_LOCALE}.`);
  }
  // Mirror into runtime state; the legacy key remains the source of truth.
  writeRaw(storage, STORAGE_KEYS.lang, locale);
  writeRaw(storage, STORAGE_KEYS.version, String(SCHEMA_VERSION));

  return { schemaVersion: SCHEMA_VERSION, migrated: true, locale };
}

/* =========================================================================
   Language persistence (legacy key: smart_care_lang)
   ========================================================================= */

/**
 * Read the persisted UI language from `smart_care_lang`.
 * @returns {string} a guaranteed-supported locale code
 */
export function getStoredLanguage() {
  const storage = getStorage();
  const stored = readRaw(storage, STORAGE_KEYS.lang);
  return isSupportedLocale(stored) ? stored : DEFAULT_LOCALE;
}

/**
 * Persist the UI language to `smart_care_lang` (the legacy key, byte-for-byte).
 * @param {string} locale
 * @returns {string} the effective locale
 */
export function setStoredLanguage(locale) {
  const effective = isSupportedLocale(locale) ? locale : DEFAULT_LOCALE;
  writeRaw(getStorage(), STORAGE_KEYS.lang, effective);
  return effective;
}

/* =========================================================================
   Public API
   ========================================================================= */

/**
 * Load config: defaults ← stored (deep merge, sanitize, migrate).
 * Never throws; corrupt JSON logs a warning and falls back to defaults.
 * @returns {object} a mutable copy of the effective config
 */
export function loadConfig() {
  const storage = getStorage();
  const raw = readRaw(storage, STORAGE_KEYS.config);
  const storedVersion = Number(readRaw(storage, STORAGE_KEYS.version) ?? NaN);

  let parsed = null;
  let corrupt = false;

  if (raw) {
    try {
      parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        corrupt = true;
        parsed = null;
      }
    } catch (error) {
      corrupt = true;
      console.warn('[config] stored config is corrupt JSON — falling back to defaults.', error);
    }
  }

  const storedSchemaVersion = parsed ? Number(parsed.schemaVersion ?? storedVersion) : storedVersion;
  const needsMigration = !Number.isFinite(storedSchemaVersion) || storedSchemaVersion < SCHEMA_VERSION;

  if (needsMigration) {
    const migration = migrateToV1();
    if (parsed) parsed = { ...parsed, schemaVersion: migration.schemaVersion };
  }

  const { value, errors, warnings } = validateConfig(parsed || {});
  if (errors.length > 0) {
    console.warn('[config] stored values failed validation; invalid fields fall back to defaults:', errors);
  }

  currentConfig = cloneConfig(value);
  lastValidation = Object.freeze({ ok: errors.length === 0, errors, warnings });
  loaded = true;

  return cloneConfig(currentConfig);
}

/** In-memory snapshot (loads first if needed). Read-only by convention. */
export function getConfig() {
  if (!loaded) return loadConfig();
  return cloneConfig(currentConfig);
}

/** Last validation result from loadConfig()/saveConfig(). */
export function getLastValidation() {
  return lastValidation;
}

/**
 * Validate → merge → persist. On validation failure the write is REJECTED:
 * the current config is returned unchanged and `config:invalid` is emitted with
 * the field-level errors so the Settings UI can render inline messages.
 * @param {object} partial
 * @returns {object} the effective config after the (attempted) save
 */
export function saveConfig(partial = {}) {
  const base = getConfig();
  const candidate = mergeWhitelisted(base, partial);
  const { ok, value, errors, warnings } = validateConfig(candidate);

  lastValidation = Object.freeze({ ok, errors, warnings });

  if (!ok) {
    bus.emit(EVENT_NAMES.CONFIG_INVALID, { errors, warnings });
    console.warn('[config] save rejected — validation failed:', errors);
    return cloneConfig(base);
  }

  // Device metadata updates (`device.thermometerName`, `device.lastConnectedAt`)
  // arrive through this same path, so persistence stays in one place.
  const storage = getStorage();
  writeRaw(storage, STORAGE_KEYS.config, JSON.stringify(value));
  writeRaw(storage, STORAGE_KEYS.version, String(SCHEMA_VERSION));

  currentConfig = cloneConfig(value);
  const snapshot = cloneConfig(currentConfig);
  bus.emit(EVENT_NAMES.CONFIG_CHANGED, { config: snapshot, errors, warnings });
  return snapshot;
}

/**
 * Remove `smart_care.config` + `smart_care.config.version`, then reload defaults.
 * `smart_care_lang` is intentionally NOT cleared.
 * @returns {object} the defaults
 */
export function resetConfig() {
  const storage = getStorage();
  removeRaw(storage, STORAGE_KEYS.config);
  removeRaw(storage, STORAGE_KEYS.version);

  currentConfig = cloneConfig(DEFAULT_CONFIG);
  loaded = true;
  lastValidation = Object.freeze({ ok: true, errors: [], warnings: [] });

  const snapshot = cloneConfig(currentConfig);
  bus.emit(EVENT_NAMES.CONFIG_CHANGED, { config: snapshot, errors: [], warnings: [] });
  return snapshot;
}

export default {
  DEFAULT_CONFIG,
  SUPPORTED_LOCALES,
  loadConfig,
  saveConfig,
  resetConfig,
  getConfig,
  validateConfig,
  normalizeBaseUrl
};
