/**
 * Smart Care — Web Bluetooth thermometer client (AOJ-20A).
 * Blueprint §4.2. The UI layer NEVER touches `navigator.bluetooth` directly.
 *
 * PRESERVED (blueprint §7 — do not change):
 *   SERVICE_UUID        = '0000ffe0-0000-1000-8000-00805f9b34fb'
 *   CHARACTERISTIC_UUID = '0000ffe1-0000-1000-8000-00805f9b34fb'
 *   requestDevice({ acceptAllDevices: true, optionalServices: [serviceUuid] })
 *     ↑ BOTH options are required for the AOJ-20A to be selectable
 *   gatt.connect() → getPrimaryService() → getCharacteristic() →
 *   startNotifications() (awaited BEFORE status becomes `connected`)
 *
 * FIXED vs the original (blueprint §5 item 11):
 *   - exactly ONE `characteristicvaluechanged` listener per connection
 *     (the original re-added one on every connect click, original line 547)
 *   - `gattserverdisconnected` is now handled (net-new)
 *
 * Emits on the bus:
 *   ble:status  → { state, reason?, deviceName? }
 *   ble:reading → { celsius, raw, at }
 *   ble:error   → { code: 'gatt'|'service'|'characteristic'|'notify'|'cancelled'|'unknown', message }
 */

import { bus as defaultBus, EVENT_NAMES } from '../core/bus.js';
import {
  getConfig,
  saveConfig,
  DEFAULT_SERVICE_UUID,
  DEFAULT_CHARACTERISTIC_UUID,
  TEMP_MIN_C,
  TEMP_MAX_C
} from '../config.js';
import { parseThermometerFrame } from './frames.js';

/** Status vocabulary (blueprint §3.3(c)). */
export const BLE_STATES = Object.freeze({
  UNSUPPORTED: 'unsupported',
  INSECURE: 'insecure-context',
  DISCONNECTED: 'disconnected',
  CONNECTING: 'connecting',
  CONNECTED: 'connected',
  ERROR: 'error'
});

/** Support reasons. */
export const SUPPORT_REASONS = Object.freeze({
  OK: 'ok',
  UNSUPPORTED_BROWSER: 'unsupported-browser',
  INSECURE_CONTEXT: 'insecure-context'
});

/**
 * Accept either the config module namespace ({ getConfig, saveConfig }) or a
 * plain config object, defaulting to the real config module.
 */
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

/** Accept either an i18n instance ({ t }) or a bare `t` function. */
function resolveTranslator(i18n) {
  if (!i18n) return null;
  if (typeof i18n === 'function') return i18n;
  if (typeof i18n.t === 'function') return i18n.t.bind(i18n);
  return null;
}

/**
 * @param {{ config?: object, bus?: object, i18n?: object|Function }} [options]
 */
export function createThermometerClient({ config = null, bus = defaultBus, i18n = null } = {}) {
  const source = resolveConfigSource(config);
  const t = resolveTranslator(i18n);
  const tr = (key, fallback) => {
    if (!t) return fallback ?? key;
    const value = t(key);
    return value === undefined || value === null ? fallback ?? key : value;
  };

  /** @type {'unsupported'|'insecure-context'|'disconnected'|'connecting'|'connected'|'error'} */
  let status = 'disconnected';
  let lastReason = SUPPORT_REASONS.OK;
  let lastError = null;

  /** Live Bluetooth objects (kept private — the UI never sees them). */
  let device = null;
  let server = null;
  let characteristic = null;
  /** The single notification handler currently attached. */
  let notifyHandler = null;
  /** Bound `gattserverdisconnected` handler. */
  let disconnectHandler = null;
  /** `device.id` of the last granted device (for silent reconnect). */
  let lastGrantedId = null;

  /* ------------------------------------------------------------------ */
  /* Support detection                                                   */
  /* ------------------------------------------------------------------ */

  function detectSupportReason() {
    if (typeof navigator === 'undefined' || typeof window === 'undefined') {
      return SUPPORT_REASONS.UNSUPPORTED_BROWSER;
    }
    if (!('bluetooth' in navigator)) return SUPPORT_REASONS.UNSUPPORTED_BROWSER;
    const secure = typeof window.isSecureContext === 'boolean' ? window.isSecureContext : true;
    if (!secure) return SUPPORT_REASONS.INSECURE_CONTEXT;
    return SUPPORT_REASONS.OK;
  }

  /** `isSecureContext && 'bluetooth' in navigator` */
  function isSupported() {
    return detectSupportReason() === SUPPORT_REASONS.OK;
  }

  /** 'ok' | 'unsupported-browser' | 'insecure-context' */
  function getSupportReason() {
    return detectSupportReason();
  }

  /** The existing `navigator.bluetooth` object, or null. */
  function bluetoothApi() {
    if (typeof navigator === 'undefined') return null;
    return navigator.bluetooth || null;
  }

  function getConfigSnapshot() {
    const snapshot = source.get();
    return snapshot && snapshot.ble
      ? snapshot
      : {
          ble: {
            serviceUuid: DEFAULT_SERVICE_UUID,
            characteristicUuid: DEFAULT_CHARACTERISTIC_UUID,
            acceptAllDevices: true,
            minValidTempC: TEMP_MIN_C,
            maxValidTempC: TEMP_MAX_C
          },
          device: { thermometerName: '', lastConnectedAt: null }
        };
  }

  /* ------------------------------------------------------------------ */
  /* Status plumbing                                                     */
  /* ------------------------------------------------------------------ */

  function setStatus(next, extra = {}) {
    status = next;
    bus.emit(EVENT_NAMES.BLE_STATUS, {
      state: next,
      reason: next === BLE_STATES.UNSUPPORTED || next === BLE_STATES.INSECURE
        ? getSupportReason()
        : undefined,
      deviceName: getDeviceName() || undefined,
      ...extra
    });
    return status;
  }

  function reportError(code, error, overrideMessage) {
    const message = overrideMessage || tr(`ble.error.${code}`, `ble.error.${code}`);
    lastError = { code, message, cause: error ? String(error.message || error) : undefined };
    bus.emit(EVENT_NAMES.BLE_ERROR, { code, message, cause: lastError.cause });
    if (error) console.warn(`[ble] ${code}:`, error);
    return lastError;
  }

  /** Map a thrown DOMException to one of the documented error codes. */
  function classify(error, fallback = 'unknown') {
    if (!error) return fallback;
    if (error.name === 'NotFoundError') return 'cancelled'; // user dismissed the chooser
    if (error.name === 'NotAllowedError') return 'cancelled';
    return fallback;
  }

  /* ------------------------------------------------------------------ */
  /* Listener lifecycle (exactly ONE per connection)                     */
  /* ------------------------------------------------------------------ */

  function detachNotifyHandler() {
    if (characteristic && notifyHandler) {
      try {
        characteristic.removeEventListener('characteristicvaluechanged', notifyHandler);
      } catch (error) {
        console.warn('[ble] could not remove notification listener:', error);
      }
    }
    notifyHandler = null;
  }

  function attachNotifyHandler() {
    detachNotifyHandler(); // guarantees a single listener, even on reconnect

    const snapshot = getConfigSnapshot();
    notifyHandler = (event) => {
      const value = event?.target?.value;
      if (!value) return;

      const parsed = parseThermometerFrame(value, {
        minC: snapshot.ble.minValidTempC,
        maxC: snapshot.ble.maxValidTempC
      });
      if (!parsed) return; // not a valid AOJ-20A frame / out of plausible range

      bus.emit(EVENT_NAMES.BLE_READING, {
        celsius: parsed.celsius,
        raw: parsed.raw,
        at: new Date().toISOString()
      });
    };

    characteristic.addEventListener('characteristicvaluechanged', notifyHandler);
  }

  function detachDisconnectHandler() {
    if (device && disconnectHandler) {
      try {
        device.removeEventListener('gattserverdisconnected', disconnectHandler);
      } catch (error) {
        console.warn('[ble] could not remove disconnect listener:', error);
      }
    }
    disconnectHandler = null;
  }

  function attachDisconnectHandler() {
    detachDisconnectHandler();
    disconnectHandler = () => {
      detachNotifyHandler();
      characteristic = null;
      server = null;
      setStatus(BLE_STATES.DISCONNECTED, { reason: 'gattserverdisconnected' });
    };
    device.addEventListener('gattserverdisconnected', disconnectHandler);
  }

  /* ------------------------------------------------------------------ */
  /* Persistence of display-only device metadata                         */
  /* ------------------------------------------------------------------ */

  function persistDeviceMetadata(name) {
    if (!source.save) return;
    try {
      source.save({
        device: {
          thermometerName: name || '',
          lastConnectedAt: new Date().toISOString()
        }
      });
    } catch (error) {
      console.warn('[ble] could not persist device metadata:', error);
    }
  }

  function clearDeviceMetadata() {
    if (!source.save) return;
    try {
      source.save({ device: { thermometerName: '', lastConnectedAt: null } });
    } catch (error) {
      console.warn('[ble] could not clear device metadata:', error);
    }
  }

  /* ------------------------------------------------------------------ */
  /* Connection                                                          */
  /* ------------------------------------------------------------------ */

  /**
   * Wire up an already-granted BluetoothDevice.
   * @param {BluetoothDevice} granted
   * @returns {Promise<{name: string}>}
   */
  async function activate(granted) {
    const snapshot = getConfigSnapshot();
    const { serviceUuid, characteristicUuid } = snapshot.ble;

    device = granted;
    lastGrantedId = granted.id || lastGrantedId;

    try {
      server = await device.gatt.connect();
    } catch (error) {
      setStatus(BLE_STATES.ERROR);
      reportError('gatt', error);
      throw error;
    }

    try {
      const service = await server.getPrimaryService(serviceUuid);
      characteristic = await service.getCharacteristic(characteristicUuid);
    } catch (error) {
      setStatus(BLE_STATES.ERROR);
      // Distinguish "service missing" from "characteristic missing" honestly.
      const message = String(error?.message || '');
      reportError(/characteristic/i.test(message) ? 'characteristic' : 'service', error);
      throw error;
    }

    attachNotifyHandler();
    attachDisconnectHandler();

    try {
      await characteristic.startNotifications(); // awaited BEFORE `connected`
    } catch (error) {
      setStatus(BLE_STATES.ERROR);
      reportError('notify', error);
      throw error;
    }

    const name = device.name || '';
    persistDeviceMetadata(name);
    setStatus(BLE_STATES.CONNECTED, { deviceName: name || undefined });

    return { name };
  }

  /**
   * Request a device (requires a user gesture) and connect.
   * @returns {Promise<{ name: string }>}
   */
  async function connect() {
    const reason = getSupportReason();
    if (reason !== SUPPORT_REASONS.OK) {
      const state = reason === SUPPORT_REASONS.INSECURE_CONTEXT ? BLE_STATES.INSECURE : BLE_STATES.UNSUPPORTED;
      setStatus(state);
      const error = new Error(tr(`ble.status.${state === BLE_STATES.INSECURE ? 'insecure' : 'unsupported'}`));
      error.code = state;
      reportError('unknown', error);
      throw error;
    }

    const api = bluetoothApi();
    const snapshot = getConfigSnapshot();

    setStatus(BLE_STATES.CONNECTING);

    let granted;
    try {
      // PRESERVED REQUEST SHAPE — both options are required for the AOJ-20A.
      granted = await api.requestDevice({
        acceptAllDevices: snapshot.ble.acceptAllDevices,
        optionalServices: [snapshot.ble.serviceUuid]
      });
    } catch (error) {
      const code = classify(error, 'unknown');
      if (code === 'cancelled') {
        setStatus(BLE_STATES.DISCONNECTED, { reason: 'cancelled' });
        reportError('cancelled', error, tr('toast.ble.cancelled', 'ble.error.cancelled'));
      } else {
        setStatus(BLE_STATES.ERROR);
        reportError('unknown', error);
      }
      throw error;
    }

    return activate(granted);
  }

  /** Disconnect and detach listeners (no metadata is cleared). */
  async function disconnect() {
    detachNotifyHandler();
    detachDisconnectHandler();

    const current = device;
    try {
      if (characteristic && characteristic.stopNotifications) {
        // Best effort: some stacks throw when the link is already gone.
        await characteristic.stopNotifications().catch(() => {});
      }
    } catch {
      /* ignore */
    }

    try {
      if (current?.gatt?.connected) current.gatt.disconnect();
    } catch (error) {
      console.warn('[ble] disconnect failed:', error);
    }

    characteristic = null;
    server = null;
    setStatus(BLE_STATES.DISCONNECTED);
    return undefined;
  }

  /** Disconnect AND clear the persisted device metadata. */
  async function forget() {
    await disconnect();
    device = null;
    lastGrantedId = null;
    clearDeviceMetadata();
    setStatus(BLE_STATES.DISCONNECTED, { reason: 'forgotten' });
    return undefined;
  }

  /**
   * Best-effort silent reconnect using `navigator.bluetooth.getDevices()`
   * (Chrome, experimental). Always resolves — returns false when unavailable
   * or unsuccessful, so the UI can fall back to a manual Reconnect button.
   * @returns {Promise<boolean>}
   */
  async function trySilentReconnect() {
    const api = bluetoothApi();
    if (!api || typeof api.getDevices !== 'function') return false;
    if (!isSupported()) return false;

    let devices = [];
    try {
      devices = await api.getDevices();
    } catch (error) {
      console.warn('[ble] getDevices() failed:', error);
      return false;
    }
    if (!devices || devices.length === 0) return false;

    const known = devices.find((candidate) => candidate.id === lastGrantedId) || devices[0];
    if (!known) return false;

    setStatus(BLE_STATES.CONNECTING, { reason: 'silent-reconnect' });
    try {
      await activate(known);
      return true;
    } catch (error) {
      setStatus(BLE_STATES.DISCONNECTED, { reason: 'silent-reconnect-failed' });
      return false;
    }
  }

  /**
   * Reconnect a previously granted device that is still remembered in this
   * session (used by the "Reconnect" CTA after gattserverdisconnected).
   */
  async function reconnect() {
    if (device && device.gatt) {
      setStatus(BLE_STATES.CONNECTING, { reason: 'manual-reconnect' });
      try {
        if (device.gatt.connected) {
          // Already connected — just re-arm the notification listener.
          attachNotifyHandler();
          setStatus(BLE_STATES.CONNECTED);
          return true;
        }
        await activate(device);
        return true;
      } catch {
        return false;
      }
    }
    return trySilentReconnect();
  }

  /* ------------------------------------------------------------------ */
  /* Public API (blueprint §4.2)                                         */
  /* ------------------------------------------------------------------ */

  function getStatus() {
    return status;
  }

  function getDeviceName() {
    return device?.name || null;
  }

  function getLastError() {
    return lastError;
  }

  // Reflect the environment immediately so the first render is already correct.
  const initialReason = getSupportReason();
  if (initialReason !== SUPPORT_REASONS.OK) {
    lastReason = initialReason;
    status = initialReason === SUPPORT_REASONS.INSECURE_CONTEXT ? BLE_STATES.INSECURE : BLE_STATES.UNSUPPORTED;
  }

  return {
    /* spec */
    isSupported,
    getSupportReason,
    getStatus,
    getDeviceName,
    connect,
    disconnect,
    forget,
    trySilentReconnect,
    /* small, additive conveniences for the UI layer */
    reconnect,
    getLastError,
    getSupportState: () => status,
    supportReason: () => lastReason,
    constants: { BLE_STATES, SUPPORT_REASONS }
  };
}

export default createThermometerClient;
