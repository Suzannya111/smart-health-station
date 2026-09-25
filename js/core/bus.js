/**
 * Smart Care — tiny pub/sub event bus.
 *
 * The whole app communicates through one shared bus so that UI modules never
 * call device modules' internal methods to learn about state. A single shared
 * instance (`bus`) is exported; `createBus()` exists for isolated tests.
 *
 * Known event names are listed in EVENT_NAMES for documentation purposes.
 * A listener throwing never breaks the emitter (errors are logged).
 */

/**
 * @typedef {(payload: any, eventName: string) => void} BusListener
 */

/** Every event used by the foundation layer. */
export const EVENT_NAMES = Object.freeze({
  /* BLE thermometer (js/devices/ble-thermometer.js) */
  BLE_STATUS: 'ble:status',           // { state, reason?, deviceName? }
  BLE_READING: 'ble:reading',         // { celsius, raw, at }
  BLE_ERROR: 'ble:error',             // { code, message }
  /* ESP32 dispenser (js/devices/esp32-client.js) */
  ESP32_STATUS: 'esp32:status',       // { state, endpoint?, at?, error? }
  ESP32_COMMAND: 'esp32:command',     // { endpoint, delivered, at, error? }
  /* config + i18n (js/config.js, js/i18n/index.js) */
  CONFIG_CHANGED: 'config:changed',   // { config }
  CONFIG_INVALID: 'config:invalid',   // { errors, warnings }
  I18N_CHANGED: 'i18n:changed',       // { lang }
  /* UI-owned events (documented for the UI subtask) */
  VIEW_CHANGED: 'view:changed',       // { viewId }
  TOAST: 'toast:shown'                // { type, message }
});

const WILDCARD = '*';

/**
 * Create an isolated event bus.
 * @param {{ name?: string }} [options]
 */
export function createBus({ name = 'bus' } = {}) {
  /** @type {Map<string, Set<BusListener>>} */
  const listeners = new Map();

  /**
   * Subscribe to an event. Use '*' to receive every event.
   * @returns {() => void} unsubscribe function
   */
  function on(event, handler) {
    if (typeof event !== 'string' || typeof handler !== 'function') return () => {};
    if (!listeners.has(event)) listeners.set(event, new Set());
    listeners.get(event).add(handler);
    return () => off(event, handler);
  }

  /** Subscribe once; auto-unsubscribes before the handler runs. */
  function once(event, handler) {
    let unsubscribe = () => {};
    unsubscribe = on(event, (payload, evtName) => {
      unsubscribe();
      handler(payload, evtName);
    });
    return unsubscribe;
  }

  /** Unsubscribe a previously registered handler. */
  function off(event, handler) {
    const set = listeners.get(event);
    if (!set) return false;
    const removed = set.delete(handler);
    if (set.size === 0) listeners.delete(event);
    return removed;
  }

  /** Emit an event synchronously to all subscribers. Never throws. */
  function emit(event, payload) {
    const direct = listeners.get(event);
    if (direct && direct.size > 0) {
      for (const handler of [...direct]) {
        try {
          handler(payload, event);
        } catch (error) {
          console.error(`[${name}] listener for "${event}" threw:`, error);
        }
      }
    }
    const wild = listeners.get(WILDCARD);
    if (wild && wild.size > 0 && event !== WILDCARD) {
      for (const handler of [...wild]) {
        try {
          handler(payload, event);
        } catch (error) {
          console.error(`[${name}] wildcard listener for "${event}" threw:`, error);
        }
      }
    }
    return listeners.has(event) || listeners.has(WILDCARD);
  }

  /** Remove listeners: a specific event, or all when called with no argument. */
  function clear(event) {
    if (typeof event === 'string') listeners.delete(event);
    else listeners.clear();
  }

  /** Number of listeners for an event ('*' counts wildcards). */
  function listenerCount(event) {
    return listeners.get(event)?.size ?? 0;
  }

  /** Names of every event that currently has listeners. */
  function events() {
    return [...listeners.keys()];
  }

  return { name, on, once, off, emit, clear, listenerCount, events };
}

/**
 * The application-wide shared bus.
 * config.js, i18n and (by default) the device clients all publish here, so a
 * single subscription is enough for the UI layer.
 */
export const bus = createBus({ name: 'smart-care' });

export default createBus;
