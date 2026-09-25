/**
 * Smart Care — view logic (blueprint §3.3 / S12).
 *
 * Owns the behaviour of the four preserved views:
 *   - Home  : 3-motor manual control (Motor 1/2/3) with the shared command lock.
 *   - Temp  : live gauge fed by `ble:reading` (toFixed(1), green/red colour),
 *             connect-thermometer action.
 *   - Alert : shown when a reading reaches the configured fever threshold.
 *             PRESERVED ORDER — the alert view is shown FIRST, then `m1/fwd`
 *             is dispatched. `reset-home` restores the gauge and returns Home.
 *   - Wound : Motor 2 (`m2/fwd`) dressing dispense action.
 *
 * Hardware rules honoured here:
 *   - endpoints + lock live in the device client (esp32.send(motorKey)); the UI
 *     only forwards the button's `data-motor` value, never a hard-coded path.
 *   - a fired motor button is disabled + relabelled for exactly the remaining
 *     lock time reported by the client (fallback: config.esp32.commandLockMs).
 *   - no-cors is fire-and-forget → feedback says "sent (unverified)", never
 *     "success"/"motor moved".
 */

import { EVENT_NAMES } from '../core/bus.js';
import { getConfig, FEVER_DEFAULT_C } from '../config.js';
import { delegate, setDisabled } from '../core/dom.js';
import { showToast } from '../core/toast.js';

/**
 * @param {{ bus: object, i18n: object, router: object, thermo: object, esp32: object }} deps
 */
export function createViews({ bus, i18n, router, thermo, esp32 }) {
  const t = (key, params) => i18n.t(key, params);

  const tempDisplay = () => document.getElementById('tempDisplay');
  const statusTemp = () => document.getElementById('statusTemp');
  const motorStatus = () => document.getElementById('motorStatus');
  const connectButton = () => document.getElementById('btnConnectTemp');

  let bleState = 'disconnected';
  let everConnected = false;
  let motorStatusKey = 'motorDispensing';

  /** Fever threshold from config (single source of truth) with a safe default. */
  function feverThreshold() {
    const value = Number(getConfig()?.thresholds?.feverCelsius);
    return Number.isFinite(value) ? value : FEVER_DEFAULT_C;
  }

  /* ------------------------------------------------------------------ */
  /* Rendering                                                           */
  /* ------------------------------------------------------------------ */

  function renderStatusText() {
    const node = statusTemp();
    if (!node) return;
    let text;
    switch (bleState) {
      case 'connecting':
        text = t('ble.status.connecting');
        break;
      case 'connected':
        text = t('tempStatusConnected');
        break;
      case 'unsupported':
        text = t('healthkit.guide.browser');
        break;
      case 'insecure-context':
        text = t('healthkit.guide.secure');
        break;
      case 'error':
        text = t('ble.status.error');
        break;
      case 'disconnected':
      default:
        text = everConnected ? t('ble.status.disconnected') : t('tempStatusInit');
        break;
    }
    node.textContent = text;
  }

  function renderMotorStatus() {
    const node = motorStatus();
    if (node) node.textContent = t(motorStatusKey);
  }

  function setGauge(text, danger) {
    const node = tempDisplay();
    if (!node) return;
    node.textContent = text;
    node.classList.toggle('temp-display--danger', Boolean(danger));
    node.classList.toggle('temp-display--ok', !danger);
    node.classList.remove('temp-display--idle');
  }

  function resetGauge() {
    const node = tempDisplay();
    if (!node) return;
    node.textContent = '--.-';
    node.classList.remove('temp-display--danger', 'temp-display--ok');
    node.classList.add('temp-display--idle');
  }

  function updateConnectAvailability() {
    const button = connectButton();
    if (!button) return;
    const reason = typeof thermo.getSupportReason === 'function' ? thermo.getSupportReason() : 'ok';
    setDisabled(button, reason !== 'ok');
    if (reason === 'insecure-context') button.title = t('healthkit.guide.secure');
    else if (reason === 'unsupported-browser') button.title = t('healthkit.guide.browser');
    else button.removeAttribute('title');
  }

  /* ------------------------------------------------------------------ */
  /* Thermometer                                                         */
  /* ------------------------------------------------------------------ */

  async function connectThermometer() {
    try {
      await thermo.connect();
      showToast('toast.ble.connected', { type: 'success' });
    } catch (error) {
      const code = error?.code;
      if (code === 'cancelled') showToast('toast.ble.cancelled', { type: 'info' });
      else if (code === 'insecure-context') showToast('healthkit.guide.secure', { type: 'warning' });
      else if (code === 'unsupported') showToast('healthkit.guide.browser', { type: 'warning' });
      else showToast('ble.status.error', { type: 'error' });
    }
  }

  function onReading(payload) {
    const celsius = Number(payload?.celsius);
    if (!Number.isFinite(celsius)) return;

    const danger = celsius >= feverThreshold();
    setGauge(celsius.toFixed(1), danger);

    if (danger) triggerFever();
  }

  /* ------------------------------------------------------------------ */
  /* Motors                                                              */
  /* ------------------------------------------------------------------ */

  /** Disable + relabel a motor button; returns a restore function. */
  function markBusy(button) {
    const label = button.lastElementChild;
    const previous = label ? label.textContent : null;
    setDisabled(button, true);
    if (label) label.textContent = t('motorRotating');
    return () => {
      setDisabled(button, false);
      if (label && previous !== null) label.textContent = previous;
    };
  }

  /** Remaining lock (from the device client) or the config lock as fallback. */
  function lockDurationMs() {
    const remaining = typeof esp32.getRemainingLockMs === 'function' ? esp32.getRemainingLockMs() : 0;
    if (remaining > 0) return remaining;
    const configured = Number(getConfig()?.esp32?.commandLockMs);
    return Number.isFinite(configured) && configured > 0 ? configured : 0;
  }

  async function sendMotor(endpoint) {
    try {
      return await esp32.send(endpoint);
    } catch (error) {
      return { delivered: false, error: String(error?.message || error) };
    }
  }

  function reportMotorResult(result) {
    if (result && (result.delivered || result.error === 'locked')) {
      showToast('toast.esp32.sent', { type: result.delivered ? 'info' : 'warning' });
    } else {
      showToast('error.esp32.send', { type: 'error' });
    }
  }

  async function onMotorButton(button) {
    if (button.disabled) return;
    const endpoint = button.dataset.motor || button.dataset.endpoint;
    if (!endpoint) return;

    const restore = markBusy(button);
    const result = await sendMotor(endpoint);
    const wait = lockDurationMs();
    if (wait > 0) setTimeout(restore, wait);
    else restore();

    reportMotorResult(result);
  }

  /** PRESERVED fever flow: show the alert view FIRST, then drive Motor 1. */
  function triggerFever() {
    motorStatusKey = 'motorDispensing';
    renderMotorStatus();
    router.showView('viewAlert');

    sendMotor('M1').then((result) => {
      motorStatusKey = result?.delivered ? 'esp32.status.sent' : 'esp32.status.error';
      renderMotorStatus();
    });
  }

  /** PRESERVED resetAndGoHome(): reset the gauge to idle and return Home. */
  function resetAndGoHome() {
    resetGauge();
    motorStatusKey = 'motorDispensing';
    renderMotorStatus();
    router.showView('viewHome');
  }

  /* ------------------------------------------------------------------ */
  /* Wiring                                                              */
  /* ------------------------------------------------------------------ */

  function handleAction(event, target) {
    const action = target.dataset.action;
    switch (action) {
      case 'connect-thermometer':
        event.preventDefault();
        connectThermometer();
        break;
      case 'motor':
        onMotorButton(target);
        break;
      case 'reset-home':
        event.preventDefault();
        resetAndGoHome();
        break;
      default:
        break;
    }
  }

  function init() {
    // Take ownership of the dynamic status nodes so the generic i18n renderer
    // (which runs on every config:changed) cannot clobber the live state.
    const statusNode = statusTemp();
    if (statusNode) {
      statusNode.removeAttribute('data-i18n');
      statusNode.removeAttribute('data-i18n-attr');
    }
    const motorNode = motorStatus();
    if (motorNode) {
      motorNode.removeAttribute('data-i18n');
      motorNode.removeAttribute('data-i18n-attr');
    }

    bleState = (typeof thermo.getStatus === 'function' ? thermo.getStatus() : 'disconnected') || 'disconnected';
    everConnected = bleState === 'connected';

    const container = document.getElementById('viewContainer') || document;
    delegate(container, 'click', '[data-action]', handleAction);

    bus.on(EVENT_NAMES.BLE_STATUS, (payload) => {
      const state = payload?.state || 'disconnected';
      const reason = payload?.reason;
      bleState = state;
      if (state === 'connected') everConnected = true;
      if (state === 'disconnected' && reason === 'gattserverdisconnected' && everConnected) {
        showToast('toast.ble.disconnected', { type: 'warning' });
      }
      renderStatusText();
      updateConnectAvailability();
    });

    bus.on(EVENT_NAMES.BLE_READING, onReading);

    bus.on(EVENT_NAMES.I18N_CHANGED, () => {
      renderStatusText();
      renderMotorStatus();
      updateConnectAvailability();
    });

    renderStatusText();
    renderMotorStatus();
    updateConnectAvailability();
  }

  return { init, resetAndGoHome, triggerFever, renderStatusText, renderMotorStatus };
}

export default createViews;
