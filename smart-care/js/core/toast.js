/**
 * Smart Care — toast + inline field-error helpers.
 * Replaces the original blocking `alert()` call sites (original-index.html line 570).
 *
 * Two feedback channels:
 *   1. showToast(...)      — transient, non-blocking, bottom-right stack
 *   2. showFieldError(...) — persistent, inline, attached to a form control
 *
 * Messages may be a literal string OR an i18n key: when a translator has been
 * registered via setTranslator() (js/i18n/index.js does this), unknown-looking
 * keys are resolved with `t(key, params)`.
 */

import { bus, EVENT_NAMES } from './bus.js';
import { el, removeClass, addClass, $ } from './dom.js';

/** @typedef {'info'|'success'|'warning'|'error'} ToastType */

export const TOAST_TYPES = Object.freeze(['info', 'success', 'warning', 'error']);

const DEFAULT_DURATION = 3200;
const ICONS = Object.freeze({
  info: 'ℹ️',
  success: '✅',
  warning: '⚠️',
  error: '⛔'
});

/** Injected i18n translator: (key, params) => string|undefined */
let translator = null;
/** Optional explicit container override. */
let containerOverride = null;

/**
 * Register the i18n translator used to resolve message keys.
 * Safe to call more than once (idempotent).
 * @param {(key: string, params?: Object) => string} t
 */
export function setTranslator(t) {
  translator = typeof t === 'function' ? t : null;
  return translator;
}

/** Override the container element (defaults to #toastContainer, then <body>). */
export function setContainer(node) {
  containerOverride = node || null;
  return containerOverride;
}

/**
 * Resolve a message that may be an i18n key.
 * @param {string} messageOrKey
 * @param {Object|null} [params]
 * @returns {string}
 */
export function resolveMessage(messageOrKey, params = null) {
  const raw = messageOrKey === null || messageOrKey === undefined ? '' : String(messageOrKey);
  if (!translator) return raw;
  // Only treat dotted lowerCamel strings as keys ('ble.status.connected').
  if (!/^[a-zA-Z][\w-]*(\.[\w-]+)+$/.test(raw)) return raw;
  const translated = translator(raw, params || undefined);
  return translated === undefined || translated === null ? raw : translated;
}

/** The toast stack element (created lazily if the shell does not provide one). */
export function getToastContainer() {
  if (containerOverride && containerOverride.isConnected) return containerOverride;

  let container = $('.toast-container') || $('#toastContainer');
  if (!container) {
    container = el('div', {
      class: 'toast-container',
      id: 'toastContainer',
      role: 'region',
      'aria-live': 'polite',
      'aria-label': 'Notifications'
    });
    (document.body || document.documentElement).appendChild(container);
  }
  return container;
}

/**
 * Show a transient toast.
 * @param {string} messageOrKey
 * @param {{ type?: ToastType, duration?: number, params?: Object|null,
 *           dismissible?: boolean, icon?: string|null }} [options]
 * @returns {HTMLElement|null} the toast element
 */
export function showToast(messageOrKey, options = {}) {
  const {
    type = 'info',
    duration = DEFAULT_DURATION,
    params = null,
    dismissible = true,
    icon = null
  } = options;

  const safeType = TOAST_TYPES.includes(type) ? type : 'info';
  const text = resolveMessage(messageOrKey, params);
  const container = getToastContainer();
  if (!container) return null;

  const toast = el('div', {
    class: `toast toast--${safeType}`,
    role: safeType === 'error' ? 'alert' : 'status',
    'data-toast-type': safeType
  });

  if (icon !== null) {
    toast.appendChild(el('span', { class: 'toast__icon', 'aria-hidden': 'true', text: icon || ICONS[safeType] }));
  }

  toast.appendChild(el('span', { class: 'toast__message', text }));

  let timer = null;
  const dismiss = () => {
    if (timer) clearTimeout(timer);
    timer = null;
    if (toast.isConnected) toast.remove();
  };

  if (dismissible) {
    toast.appendChild(
      el('button', {
        type: 'button',
        class: 'toast__close',
        'aria-label': 'Close',
        text: '✕',
        on: { click: dismiss }
      })
    );
  }

  container.appendChild(toast);

  if (Number.isFinite(duration) && duration > 0) timer = setTimeout(dismiss, duration);

  bus.emit(EVENT_NAMES.TOAST, { type: safeType, message: text });
  return toast;
}

/** Remove every toast currently displayed. */
export function clearToasts() {
  const container = getToastContainer();
  if (container) container.replaceChildren();
}

/* =========================================================================
   Inline field errors
   ========================================================================= */

/** Find (or create) the `.field-error` element that belongs to a control. */
function ensureMessageNode(field, className) {
  const wrapper = field.closest('.field') || field.parentElement;
  if (!wrapper) return null;
  let node = wrapper.querySelector(`.${className}`);
  if (!node) {
    node = el('span', { class: className, 'aria-live': 'polite' });
    wrapper.appendChild(node);
  }
  return node;
}

/**
 * Attach a persistent inline error to a form control.
 * @param {HTMLElement} field  input / select / textarea (or its wrapper)
 * @param {string} messageOrKey
 * @param {{ params?: Object|null, warning?: boolean }} [options]
 * @returns {HTMLElement|null} the message node
 */
export function showFieldError(field, messageOrKey, options = {}) {
  if (!field) return null;
  const { params = null, warning = false } = options;
  const text = resolveMessage(messageOrKey, params);
  const control = field.matches?.('input, select, textarea') ? field : field.querySelector('input, select, textarea');
  const wrapper = (control || field).closest('.field') || (control || field).parentElement;

  // Warnings are advisory only: use the amber warning style and do NOT flag the
  // control as invalid (aria-invalid / the red error border are for hard errors).
  if (wrapper) addClass(wrapper, warning ? 'field--warning' : 'field--invalid');
  if (control && !warning) control.setAttribute('aria-invalid', 'true');

  const node = ensureMessageNode(control || field, warning ? 'field-warning' : 'field-error');
  if (node) node.textContent = text;
  return node;
}

/**
 * Remove the inline error/warning attached to a control.
 * @param {HTMLElement} field
 */
export function clearFieldError(field) {
  if (!field) return null;
  const control = field.matches?.('input, select, textarea') ? field : field.querySelector('input, select, textarea');
  const wrapper = (control || field).closest('.field') || (control || field).parentElement;

  if (wrapper) {
    removeClass(wrapper, 'field--invalid');
    removeClass(wrapper, 'field--warning');
    wrapper.querySelectorAll('.field-error, .field-warning').forEach((node) => node.remove());
  }
  if (control) control.removeAttribute('aria-invalid');
  return field;
}

/**
 * Clear every inline error inside a root element (used before a re-validate).
 */
export function clearAllFieldErrors(root = document) {
  if (!root) return;
  root.querySelectorAll('.field--invalid').forEach((node) => removeClass(node, 'field--invalid'));
  root.querySelectorAll('.field-error, .field-warning').forEach((node) => node.remove());
  root.querySelectorAll('[aria-invalid]').forEach((node) => node.removeAttribute('aria-invalid'));
}

/**
 * Convenience factory that binds the translator/container once.
 * @param {{ translator?: Function, container?: HTMLElement }} [options]
 */
export function createToastManager({ translator: t, container } = {}) {
  if (typeof t === 'function') setTranslator(t);
  if (container) setContainer(container);
  return { showToast, clearToasts, showFieldError, clearFieldError, clearAllFieldErrors, getToastContainer };
}

export default showToast;
