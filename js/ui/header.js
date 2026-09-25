/**
 * Smart Care — shared header controller (blueprint §3.1 / S11).
 *
 * Binds the ONE language <select> (#langSelect) and the ⚙️ Settings button
 * (#btnOpenSettings), and drives the aggregate `#healthKitPill` from the
 * `ble:status` + `esp32:status` bus events.
 *
 * The pill is owned by this module: its `data-i18n` attribute is removed at
 * runtime so the generic i18n DOM renderer cannot overwrite the live status on
 * every `config:changed`; the text is re-rendered here on `i18n:changed`.
 */

import { EVENT_NAMES } from '../core/bus.js';
import { on } from '../core/dom.js';
import { showToast } from '../core/toast.js';

/** States that count as "hardware ready" for the aggregate indicator. */
const READY = Object.freeze({ ble: 'connected', esp32: 'sent-unverified' });

/**
 * @param {{ bus: object, i18n: object, onOpenSettings: Function }} deps
 */
export function createHeader({ bus, i18n, onOpenSettings }) {
  let bleState = 'disconnected';
  let esp32State = 'unknown';

  const pill = () => document.getElementById('healthKitPill');
  const langSelect = () => document.getElementById('langSelect');
  const settingsButton = () => document.getElementById('btnOpenSettings');

  function isConnected() {
    return bleState === READY.ble && esp32State === READY.esp32;
  }

  function renderPill() {
    const node = pill();
    if (!node) return;
    const connected = isConnected();
    node.textContent = connected
      ? i18n.t('healthkit.indicator.connected')
      : i18n.t('healthkit.indicator.partial');
    node.classList.toggle('status-pill--ok', connected);
    node.classList.toggle('status-pill--muted', !connected);
  }

  function syncSelect() {
    const node = langSelect();
    if (node) node.value = i18n.getLanguage();
  }

  function init() {
    const pillNode = pill();
    if (pillNode) {
      // We own this node's text/variant now.
      pillNode.removeAttribute('data-i18n');
      pillNode.removeAttribute('data-i18n-attr');
    }

    syncSelect();

    const select = langSelect();
    if (select) {
      on(select, 'change', () => {
        i18n.setLanguage(select.value);
        showToast('toast.lang.changed', { type: 'info' });
      });
    }

    const button = settingsButton();
    if (button) {
      on(button, 'click', (event) => {
        event.preventDefault();
        if (typeof onOpenSettings === 'function') onOpenSettings();
      });
    }

    bus.on(EVENT_NAMES.BLE_STATUS, (payload) => {
      bleState = payload?.state || 'disconnected';
      renderPill();
    });
    bus.on(EVENT_NAMES.ESP32_STATUS, (payload) => {
      esp32State = payload?.state || 'unknown';
      renderPill();
    });
    bus.on(EVENT_NAMES.I18N_CHANGED, () => {
      syncSelect();
      renderPill();
    });

    renderPill();
  }

  return {
    init,
    renderPill,
    getAggregate: () => ({ bleState, esp32State, connected: isConnected() })
  };
}

export default createHeader;
