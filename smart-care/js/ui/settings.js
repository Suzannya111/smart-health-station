/**
 * Smart Care — Settings dialog controller (blueprint §3.2/§3.3 / S13).
 *
 * Drives the native `<dialog id="settingsDialog">`:
 *   - Language & Display            (one shared <select>)
 *   - Health Kit Hardware           (guided wizard, thermometer, dispenser, threshold, advanced)
 *   - live status pills (`role="status"`) fed by `ble:status` / `esp32:status`
 *   - Connect / Disconnect / Forget / Reconnect (Web Bluetooth client)
 *   - Test / Apply / Test Motor 1   (ESP32 client; honest "sent (unverified)")
 *   - Save / Reset / Close          (config.saveConfig / resetConfig)
 *   - inline validation via showFieldError + toasts (enables zero blocking alert())
 *   - native showModal() + a Tab focus-trap fallback + focus restore
 *
 * The module never touches navigator.bluetooth or fetch directly: it calls the
 * thermometer / esp32 device clients it is given.
 */

import { EVENT_NAMES } from '../core/bus.js';
import {
  getConfig,
  saveConfig,
  resetConfig,
  getLastValidation,
  isValidHost,
  FEVER_DEFAULT_C
} from '../config.js';
import { delegate, on, focusFirst, setDisabled } from '../core/dom.js';
import {
  showToast,
  showFieldError,
  clearFieldError,
  clearAllFieldErrors
} from '../core/toast.js';

/** config field path → form control for inline validation messages. */
const FIELD_SELECTORS = Object.freeze({
  'esp32.host': '#esp32Host',
  'esp32.protocol': '#esp32Proto',
  'ble.serviceUuid': '#svcUuid',
  'ble.characteristicUuid': '#chrUuid',
  'thresholds.feverCelsius': '#feverThreshold',
  'esp32.commandLockMs': '#lockMs',
  'woundAi.baseUrl': '#woundApiBaseUrl',
  'woundAi.confidenceThreshold': '#woundConfidence',
  'woundAi.apiKey': '#woundApiKey'
});

/** BLE status vocabulary → { i18n key, pill variant } (blueprint §3.3(c)). */
const BLE_PILL = Object.freeze({
  unsupported: { key: 'ble.status.unsupported', variant: 'error' },
  'insecure-context': { key: 'ble.status.insecure', variant: 'error' },
  connecting: { key: 'ble.status.connecting', variant: 'pending' },
  connected: { key: 'ble.status.connected', variant: 'ok' },
  error: { key: 'ble.status.error', variant: 'error' },
  disconnected: { key: 'ble.status.disconnected', variant: 'muted' }
});

/** ESP32 status vocabulary → { i18n key, pill variant }. */
const ESP32_PILL = Object.freeze({
  'not-configured': { key: 'esp32.status.notConfigured', variant: 'muted' },
  unknown: { key: 'esp32.status.unknown', variant: 'muted' },
  'sent-unverified': { key: 'esp32.status.sent', variant: 'info' },
  error: { key: 'esp32.status.error', variant: 'error' }
});

const STATUS_PILL_CLASSES = Object.freeze([
  'status-pill--ok',
  'status-pill--pending',
  'status-pill--error',
  'status-pill--info',
  'status-pill--muted'
]);

const WIZARD_ICON_CLASSES = Object.freeze([
  'wizard__step-icon--ok',
  'wizard__step-icon--error',
  'wizard__step-icon--pending'
]);

/** Nodes whose text/variant this module owns (so i18n must not overwrite them). */
const OWNED_PILL_IDS = Object.freeze([
  'bleStatusPill',
  'esp32StatusPill',
  'wizStep1Pill',
  'wizStep2Pill',
  'wizStep3Pill',
  'wizStep4Pill'
]);

/**
 * @param {{ bus: object, i18n: object, thermo: object, esp32: object }} deps
 */
export function createSettings({ bus, i18n, thermo, esp32 }) {
  const t = (key, params) => i18n.t(key, params);
  const el = (id) => document.getElementById(id);
  const dialog = () => el('settingsDialog');

  let lastFocused = null;
  /** Transient session flags used by wizard step 4 (live verification). */
  const stateFlags = { readingSeen: false, motorTested: false };

  /* ------------------------------------------------------------------ */
  /* Small render helpers                                                */
  /* ------------------------------------------------------------------ */

  function setPill(id, variant, key) {
    const node = el(id);
    if (!node) return;
    node.classList.remove(...STATUS_PILL_CLASSES);
    node.classList.add(`status-pill--${variant}`);
    node.textContent = t(key);
  }

  function setHint(id, text) {
    const node = el(id);
    if (node) node.textContent = text || '';
  }

  function setStep(index, variant, key) {
    const icon = el(`wizStep${index}Icon`);
    if (icon) {
      icon.classList.remove(...WIZARD_ICON_CLASSES);
      if (variant === 'ok' || variant === 'error' || variant === 'pending') {
        icon.classList.add(`wizard__step-icon--${variant}`);
      }
      icon.textContent = variant === 'ok' ? '✓' : variant === 'error' ? '✕' : String(index);
    }
    setPill(`wizStep${index}Pill`, variant, key);
  }

  /* ------------------------------------------------------------------ */
  /* Population + rendering                                              */
  /* ------------------------------------------------------------------ */

  function populateFromConfig() {
    const cfg = getConfig();

    const lang = el('settingsLang');
    if (lang) lang.value = i18n.getLanguage();

    const host = el('esp32Host');
    if (host) host.value = cfg.esp32.host || '';

    const proto = el('esp32Proto');
    if (proto) proto.value = cfg.esp32.protocol || 'http';

    const threshold = el('feverThreshold');
    if (threshold) threshold.value = String(cfg.thresholds.feverCelsius);

    const svc = el('svcUuid');
    if (svc) svc.value = cfg.ble.serviceUuid || '';

    const chr = el('chrUuid');
    if (chr) chr.value = cfg.ble.characteristicUuid || '';

    const acceptAll = el('acceptAll');
    if (acceptAll) acceptAll.checked = Boolean(cfg.ble.acceptAllDevices);

    const lock = el('lockMs');
    if (lock) lock.value = String(cfg.esp32.commandLockMs);

    const woundBase = el('woundApiBaseUrl');
    if (woundBase) woundBase.value = cfg.woundAi?.baseUrl || '';

    const woundModel = el('woundModelId');
    if (woundModel) woundModel.value = cfg.woundAi?.modelId || '';

    const woundVersion = el('woundModelVersion');
    if (woundVersion) woundVersion.value = cfg.woundAi?.version || '';

    const woundKey = el('woundApiKey');
    if (woundKey) woundKey.value = cfg.woundAi?.apiKey || '';

    const woundConfidence = el('woundConfidence');
    if (woundConfidence) {
      woundConfidence.value = String(cfg.woundAi?.confidenceThreshold ?? 0.5);
    }

    renderDeviceMeta();
    setHint('esp32Hint', t('settings.esp32.hint'));
  }

  function renderDeviceMeta() {
    const node = el('bleDeviceName');
    if (!node) return;
    const cfg = getConfig();
    const name = cfg?.device?.thermometerName;
    const last = cfg?.device?.lastConnectedAt;
    if (name) {
      const when = last ? new Date(last).toLocaleString() : '';
      node.textContent = `${t('settings.thermometer.name')}: ${name}${when ? ` • ${t('settings.thermometer.lastConnected')}: ${when}` : ''}`;
    } else {
      node.textContent = '';
    }
  }

  function renderBlePill() {
    const state = (typeof thermo.getStatus === 'function' ? thermo.getStatus() : 'disconnected') || 'disconnected';
    const mapping = BLE_PILL[state] || BLE_PILL.disconnected;
    setPill('bleStatusPill', mapping.variant, mapping.key);
  }

  function renderEsp32Pill() {
    const state = (typeof esp32.getStatus === 'function' ? esp32.getStatus() : 'unknown') || 'unknown';
    const mapping = ESP32_PILL[state] || ESP32_PILL.unknown;
    setPill('esp32StatusPill', mapping.variant, mapping.key);
  }

  function renderSupportHints() {
    const reason = typeof thermo.getSupportReason === 'function' ? thermo.getSupportReason() : 'ok';
    const connectBtn = dialog()?.querySelector('[data-action="ble-connect"]');
    const reconnectBtn = dialog()?.querySelector('[data-action="ble-reconnect"]');

    if (reason === 'ok') {
      setHint('bleHint', '');
      setDisabled(connectBtn, false);
      setDisabled(reconnectBtn, false);
    } else if (reason === 'insecure-context') {
      setHint('bleHint', t('healthkit.guide.secure'));
      setDisabled(connectBtn, true);
      setDisabled(reconnectBtn, true);
    } else {
      setHint('bleHint', t('healthkit.guide.browser'));
      setDisabled(connectBtn, true);
      setDisabled(reconnectBtn, true);
    }
  }

  function runPreflight() {
    const reason = typeof thermo.getSupportReason === 'function' ? thermo.getSupportReason() : 'ok';
    if (reason === 'ok') {
      setStep(1, 'ok', 'ble.status.connected');
      setHint('wizardHint', '');
    } else if (reason === 'insecure-context') {
      setStep(1, 'error', 'ble.status.insecure');
      setHint('wizardHint', t('healthkit.guide.secure'));
    } else {
      setStep(1, 'error', 'ble.status.unsupported');
      setHint('wizardHint', t('healthkit.guide.browser'));
    }
  }

  function renderWizard() {
    const reason = typeof thermo.getSupportReason === 'function' ? thermo.getSupportReason() : 'ok';
    if (reason === 'ok') setStep(1, 'ok', 'ble.status.connected');
    else if (reason === 'insecure-context') setStep(1, 'error', 'ble.status.insecure');
    else setStep(1, 'error', 'ble.status.unsupported');

    // Step 2 — thermometer
    const bleState = (typeof thermo.getStatus === 'function' ? thermo.getStatus() : 'disconnected') || 'disconnected';
    if (bleState === 'connected') setStep(2, 'ok', 'ble.status.connected');
    else if (bleState === 'connecting') setStep(2, 'pending', 'ble.status.connecting');
    else if (bleState === 'error') setStep(2, 'error', 'ble.status.error');
    else setStep(2, 'muted', 'ble.status.disconnected');

    // Step 3 — dispenser
    const espState = (typeof esp32.getStatus === 'function' ? esp32.getStatus() : 'unknown') || 'unknown';
    if (espState === 'sent-unverified') setStep(3, 'ok', 'esp32.status.sent');
    else if (espState === 'error') setStep(3, 'error', 'esp32.status.error');
    else if (espState === 'not-configured') setStep(3, 'muted', 'esp32.status.notConfigured');
    else setStep(3, 'muted', 'esp32.status.unknown');

    // Step 4 — live verification is rendered by renderWizardStep4().
  }

  function renderWizardStep4(readingSeen, motorTested) {
    if (readingSeen && motorTested) setStep(4, 'ok', 'esp32.status.sent');
    else if (readingSeen || motorTested) setStep(4, 'pending', 'common.working');
    else setStep(4, 'muted', 'esp32.status.unknown');
  }

  function renderAll() {
    renderBlePill();
    renderEsp32Pill();
    renderSupportHints();
    renderWizard();
    renderWizardStep4(stateFlags.readingSeen, stateFlags.motorTested);
  }

  /* ------------------------------------------------------------------ */
  /* Actions                                                             */
  /* ------------------------------------------------------------------ */

  function open({ wizard = false } = {}) {
    const dlg = dialog();
    if (!dlg) return;
    lastFocused = document.activeElement;

    populateFromConfig();
    clearAllFieldErrors(dlg);
    renderAll();

    if (!dlg.open) {
      if (typeof dlg.showModal === 'function') dlg.showModal();
      else dlg.setAttribute('open', '');
    }

    focusFirst(dlg.querySelector('.dialog__body') || dlg);

    // Always (re)run the browser/secure-context preflight; `wizard` is kept as
    // an explicit intent flag for future step focusing.
    void wizard;
    runPreflight();
  }

  function close() {
    const dlg = dialog();
    if (!dlg || !dlg.open) return;
    if (typeof dlg.close === 'function') dlg.close();
    else dlg.removeAttribute('open');
  }

  async function doBleConnect() {
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
    renderAll();
  }

  async function doBleDisconnect() {
    await thermo.disconnect();
    showToast('toast.ble.disconnected', { type: 'info' });
    renderAll();
  }

  async function doBleReconnect() {
    const ok = typeof thermo.reconnect === 'function' ? await thermo.reconnect() : false;
    if (!ok) showToast('toast.ble.reconnectFailed', { type: 'warning' });
    renderAll();
  }

  async function doBleForget() {
    await thermo.forget();
    showToast('toast.ble.disconnected', { type: 'info' });
    renderDeviceMeta();
    renderAll();
  }

  function readEsp32Inputs() {
    const hostInput = el('esp32Host');
    const protoInput = el('esp32Proto');
    return {
      host: hostInput ? hostInput.value.trim() : '',
      protocol: protoInput ? protoInput.value : 'http',
      hostInput
    };
  }

  function applyEsp32({ silent = false } = {}) {
    const { host, protocol, hostInput } = readEsp32Inputs();
    clearFieldError(hostInput);

    if (!isValidHost(host)) {
      showFieldError(hostInput, 'Enter an IPv4 address or hostname (optionally with :port).');
      showToast('toast.config.invalid', { type: 'error' });
      return false;
    }

    esp32.setBaseUrl(host, protocol); // persists host + protocol via config.saveConfig
    if (!silent) showToast('toast.config.saved', { type: 'success' });
    renderEsp32Pill();
    renderWizard();
    renderWizardStep4(stateFlags.readingSeen, stateFlags.motorTested);
    return true;
  }

  async function doEsp32Test() {
    if (!applyEsp32({ silent: true })) return;
    const result = await esp32.probe();
    if (result?.delivered) showToast('esp32.status.sent', { type: 'info' });
    else showToast('error.esp32.send', { type: 'error' });
    renderAll();
  }

  async function doMotorTest(event, target) {
    const button = target;
    const label = button.lastElementChild;
    const previous = label ? label.textContent : null;
    setDisabled(button, true);
    if (label) label.textContent = t('common.sending');

    const result = await esp32.send('M1').catch(() => ({ delivered: false, error: 'unknown' }));

    const remaining = typeof esp32.getRemainingLockMs === 'function' ? esp32.getRemainingLockMs() : 0;
    const configured = Number(getConfig()?.esp32?.commandLockMs);
    const wait = remaining > 0 ? remaining : Number.isFinite(configured) ? configured : 0;
    const restore = () => {
      setDisabled(button, false);
      if (label && previous !== null) label.textContent = previous;
    };
    if (wait > 0) setTimeout(restore, wait);
    else restore();

    if (result?.delivered) {
      stateFlags.motorTested = true;
      showToast('toast.esp32.sent', { type: 'info' });
    } else {
      showToast('error.esp32.send', { type: 'error' });
    }
    renderAll();
  }

  function doThresholdReset() {
    const threshold = el('feverThreshold');
    if (threshold) threshold.value = String(FEVER_DEFAULT_C);
    clearFieldError(threshold);
  }

  function collectPartial() {
    const host = el('esp32Host');
    const proto = el('esp32Proto');
    const lock = el('lockMs');
    const svc = el('svcUuid');
    const chr = el('chrUuid');
    const acceptAll = el('acceptAll');
    const threshold = el('feverThreshold');
    const woundBase = el('woundApiBaseUrl');
    const woundModel = el('woundModelId');
    const woundVersion = el('woundModelVersion');
    const woundKey = el('woundApiKey');
    const woundConfidence = el('woundConfidence');

    return {
      esp32: {
        host: host ? host.value.trim() : undefined,
        protocol: proto ? proto.value : undefined,
        commandLockMs: lock ? Number(lock.value) : undefined
      },
      ble: {
        serviceUuid: svc ? svc.value.trim() : undefined,
        characteristicUuid: chr ? chr.value.trim() : undefined,
        acceptAllDevices: acceptAll ? acceptAll.checked : undefined
      },
      thresholds: {
        feverCelsius: threshold ? Number(threshold.value) : undefined
      },
      woundAi: {
        baseUrl: woundBase ? woundBase.value.trim() : undefined,
        modelId: woundModel ? woundModel.value.trim() : undefined,
        version: woundVersion ? woundVersion.value.trim() : undefined,
        apiKey: woundKey ? woundKey.value.trim() : undefined,
        confidenceThreshold:
          woundConfidence && woundConfidence.value !== '' ? Number(woundConfidence.value) : undefined
      }
    };
  }

  function showValidation(validation, dlg) {
    clearAllFieldErrors(dlg);
    const { errors = [], warnings = [] } = validation || {};
    errors.forEach((item) => {
      const field = FIELD_SELECTORS[item.field] ? el(FIELD_SELECTORS[item.field].slice(1)) : null;
      if (field) showFieldError(field, item.message);
    });
    warnings.forEach((item) => {
      const field = FIELD_SELECTORS[item.field] ? el(FIELD_SELECTORS[item.field].slice(1)) : null;
      if (field) showFieldError(field, item.message, { warning: true });
    });
  }

  function doSave() {
    const dlg = dialog();
    saveConfig(collectPartial());
    const validation = getLastValidation();

    if (validation && validation.ok) {
      clearAllFieldErrors(dlg);
      renderAll();
      showToast('toast.config.saved', { type: 'success' });
    } else {
      showValidation(validation, dlg);
      showToast('toast.config.invalid', { type: 'error' });
    }
  }

  function doResetAll() {
    resetConfig();
    populateFromConfig();
    clearAllFieldErrors(dialog());
    renderAll();
    showToast('toast.config.reset', { type: 'info' });
  }

  function onDialogAction(event, target) {
    const action = target.dataset.action;
    switch (action) {
      case 'close':
        event.preventDefault();
        close();
        break;
      case 'save':
        doSave();
        break;
      case 'reset-all':
        doResetAll();
        break;
      case 'ble-connect':
        doBleConnect();
        break;
      case 'ble-disconnect':
        doBleDisconnect();
        break;
      case 'ble-reconnect':
        doBleReconnect();
        break;
      case 'ble-forget':
        doBleForget();
        break;
      case 'esp32-test':
        doEsp32Test();
        break;
      case 'esp32-save':
        applyEsp32();
        break;
      case 'esp32-motor-test':
        doMotorTest(event, target);
        break;
      case 'threshold-reset':
        event.preventDefault();
        doThresholdReset();
        break;
      case 'healthkit-connect':
        runPreflight();
        doBleConnect();
        break;
      default:
        break;
    }
  }

  /* ------------------------------------------------------------------ */
  /* Focus management (native modal + Tab trap fallback)                 */
  /* ------------------------------------------------------------------ */

  function trapFocus(event) {
    const dlg = dialog();
    if (!dlg || !dlg.open || event.key !== 'Tab') return;
    const focusables = Array.from(
      dlg.querySelectorAll(
        'button, [href], input, select, textarea, summary, [tabindex]:not([tabindex="-1"])'
      )
    ).filter((node) => !node.disabled && node.offsetParent !== null);
    if (focusables.length === 0) return;

    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  /* ------------------------------------------------------------------ */
  /* Wiring                                                              */
  /* ------------------------------------------------------------------ */

  function init() {
    const dlg = dialog();
    if (!dlg) {
      console.warn('[settings] #settingsDialog not found — Settings UI disabled.');
      return;
    }

    // We own these pills' text/variants (see renderXxxPill); stop the generic
    // i18n renderer from overwriting live hardware state on config:changed.
    OWNED_PILL_IDS.forEach((id) => {
      const node = el(id);
      if (node) {
        node.removeAttribute('data-i18n');
        node.removeAttribute('data-i18n-attr');
      }
    });

    // Dialog-scoped delegated click handler for every data-action control.
    delegate(dlg, 'click', '[data-action]', onDialogAction);

    // Clicking the backdrop (target === dialog) closes it.
    on(dlg, 'click', (event) => {
      if (event.target === dlg) close();
    });

    on(dlg, 'keydown', trapFocus);
    on(dlg, 'close', () => {
      if (lastFocused && typeof lastFocused.focus === 'function') lastFocused.focus();
    });

    // The Home "Connect Health Kit" button opens the dialog + runs the wizard.
    delegate(
      document,
      'click',
      '[data-action="open-healthkit"]',
      (event) => {
        event.preventDefault();
        open({ wizard: true });
      }
    );

    // Language select inside the dialog (shared state with the header).
    const langSelect = el('settingsLang');
    if (langSelect) on(langSelect, 'change', () => i18n.setLanguage(langSelect.value));

    // Live status subscriptions.
    bus.on(EVENT_NAMES.BLE_STATUS, () => {
      renderBlePill();
      renderWizard();
      renderWizardStep4(stateFlags.readingSeen, stateFlags.motorTested);
      renderDeviceMeta();
    });
    bus.on(EVENT_NAMES.ESP32_STATUS, (payload) => {
      if (payload?.state === 'sent-unverified') stateFlags.motorTested = true;
      renderEsp32Pill();
      renderWizard();
      renderWizardStep4(stateFlags.readingSeen, stateFlags.motorTested);
    });
    bus.on(EVENT_NAMES.BLE_READING, () => {
      stateFlags.readingSeen = true;
      renderWizardStep4(stateFlags.readingSeen, stateFlags.motorTested);
    });
    bus.on(EVENT_NAMES.CONFIG_CHANGED, () => {
      renderDeviceMeta();
      renderAll();
    });
    bus.on(EVENT_NAMES.I18N_CHANGED, () => {
      const lang = el('settingsLang');
      if (lang) lang.value = i18n.getLanguage();
      setHint('esp32Hint', t('settings.esp32.hint'));
      renderDeviceMeta();
      renderAll();
    });

    // Initial paint so the dialog is correct even before it is first opened.
    populateFromConfig();
    renderAll();
  }

  return { init, open, close, isOpen: () => Boolean(dialog()?.open) };
}

export default createSettings;
