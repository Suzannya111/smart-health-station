/**
 * Smart Care — i18n runtime (blueprint §6).
 *
 * - `t(key, params)` substitutes placeholders; `{threshold}` is ALWAYS filled
 *   from `config.thresholds.feverCelsius` (default 37.5) so the number lives in
 *   exactly ONE place (blueprint §2.4). Caller-supplied params win.
 * - Fallback chain: `locale → zh-Hant → key name` (a missing string is visible,
 *   never silent).
 * - Both the original key names and the new namespaced aliases resolve
 *   (see LEGACY_KEY_MAP in ./strings.js).
 * - `setLanguage(locale)` persists to the legacy `smart_care_lang` key.
 * - Re-renders every `[data-i18n]` / `[data-i18n-attr]` node on `config:changed`
 *   and publishes `i18n:changed`.
 */

import { bus as defaultBus, EVENT_NAMES } from '../core/bus.js';
import { getConfig, getStoredLanguage, setStoredLanguage, configBus } from '../config.js';
import { setTranslator as setToastTranslator } from '../core/toast.js';
import { STRINGS, LOCALES, DEFAULT_LOCALE, LEGACY_KEY_MAP } from './strings.js';

/** New namespaced key → original key (built once from LEGACY_KEY_MAP). */
const REVERSE_KEY_MAP = Object.freeze(
  Object.fromEntries(Object.entries(LEGACY_KEY_MAP).map(([legacy, namespaced]) => [namespaced, legacy]))
);

export { STRINGS, LOCALES, DEFAULT_LOCALE, LEGACY_KEY_MAP };

/**
 * Format the fever threshold for display inside `{threshold}`.
 * 37.5 → "37.5"; 36 → "36.0" (keeps the original's one-decimal style).
 * @param {number|string} value
 * @returns {string}
 */
export function formatThreshold(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return String(value ?? '');
  return Number.isInteger(number) ? number.toFixed(1) : String(number);
}

/** Interpolate `{name}` placeholders in a template. */
export function interpolate(template, params) {
  if (typeof template !== 'string' || !template.includes('{')) return template;
  return template.replace(/\{(\w+)\}/g, (match, name) => {
    if (params && Object.prototype.hasOwnProperty.call(params, name)) {
      const value = params[name];
      return value === null || value === undefined ? '' : String(value);
    }
    return match;
  });
}

/** Look a key up in one locale table (with alias resolution). */
function lookupIn(table, key) {
  if (!table) return undefined;
  if (Object.prototype.hasOwnProperty.call(table, key)) return table[key];

  const alias = LEGACY_KEY_MAP[key] ?? REVERSE_KEY_MAP[key];
  if (alias && Object.prototype.hasOwnProperty.call(table, alias)) return table[alias];

  return undefined;
}

/**
 * Create an i18n instance.
 * @param {{ config?: object, bus?: object, autoApply?: boolean }} [options]
 *   - `config`    — overrides the config source used for `{threshold}`
 *   - `bus`       — event bus to publish `i18n:changed` on (defaults to the shared bus)
 *   - `autoApply` — render the DOM on DOMContentLoaded (default: false)
 */
export function createI18n({ config = null, bus = defaultBus, autoApply = false } = {}) {
  let configRef = config || getConfig();
  let lang = getStoredLanguage();
  const subscribers = new Set();

  /** Current threshold, resolved from config (never hard-coded). */
  function getThreshold() {
    const source = configRef || getConfig();
    const value = source?.thresholds?.feverCelsius;
    return Number.isFinite(Number(value)) ? Number(value) : getConfig().thresholds.feverCelsius;
  }

  /** Default interpolation params applied to every lookup. */
  function baseParams() {
    return { threshold: formatThreshold(getThreshold()) };
  }

  /**
   * Translate a key.
   * @param {string} key
   * @param {object} [params] placeholders (override `threshold`)
   * @returns {string}
   */
  function t(key, params) {
    if (key === null || key === undefined) return '';
    const name = String(key);
    const merged = { ...baseParams(), ...(params || {}) };

    const template =
      lookupIn(STRINGS[lang], name) ??
      lookupIn(STRINGS[DEFAULT_LOCALE], name);

    if (template === undefined) {
      // Visible, not silent: surface the key name so it is obvious what is missing.
      if (typeof console !== 'undefined') console.warn(`[i18n] missing key "${name}" (${lang})`);
      return name;
    }
    return interpolate(template, merged);
  }

  /** True when the key resolves in the current or default locale. */
  function has(key) {
    return (
      lookupIn(STRINGS[lang], String(key)) !== undefined ||
      lookupIn(STRINGS[DEFAULT_LOCALE], String(key)) !== undefined
    );
  }

  /** Current locale code. */
  function getLanguage() {
    return lang;
  }

  /**
   * Switch locale.
   * @param {string} next
   * @param {{ persist?: boolean, apply?: boolean }} [options]
   * @returns {string} the effective locale
   */
  function setLanguage(next, { persist = true, apply = true } = {}) {
    const effective = LOCALES.includes(next) ? next : DEFAULT_LOCALE;
    lang = effective;

    if (persist) setStoredLanguage(effective); // writes smart_care_lang (legacy key)

    if (apply) applyToDOM();

    bus.emit(EVENT_NAMES.I18N_CHANGED, { lang: effective });
    subscribers.forEach((handler) => {
      try {
        handler(effective);
      } catch (error) {
        console.error('[i18n] language subscriber threw:', error);
      }
    });
    return effective;
  }

  /** Subscribe to language changes. @returns {() => void} unsubscribe */
  function onLanguageChange(handler) {
    if (typeof handler !== 'function') return () => {};
    subscribers.add(handler);
    return () => subscribers.delete(handler);
  }

  /**
   * Render translations into the DOM.
   *  - `[data-i18n="key"]`        → textContent
   *  - `[data-i18n-attr="attr:key,attr2:key2"]` → attributes
   * @param {ParentNode} [root=document]
   */
  function applyToDOM(root = typeof document !== 'undefined' ? document : null) {
    if (!root) return;
    const merged = baseParams();

    root.querySelectorAll('[data-i18n]').forEach((node) => {
      const key = node.getAttribute('data-i18n');
      if (!key) return;
      const template = lookupIn(STRINGS[lang], key) ?? lookupIn(STRINGS[DEFAULT_LOCALE], key);
      node.textContent = template === undefined ? key : interpolate(template, merged);
    });

    root.querySelectorAll('[data-i18n-attr]').forEach((node) => {
      const spec = node.getAttribute('data-i18n-attr');
      if (!spec) return;
      spec.split(',').forEach((pair) => {
        const [attr, key] = pair.split(':').map((part) => part && part.trim());
        if (!attr || !key) return;
        const template = lookupIn(STRINGS[lang], key) ?? lookupIn(STRINGS[DEFAULT_LOCALE], key);
        if (template !== undefined) node.setAttribute(attr, interpolate(template, merged));
      });
    });

    // Keep assistive tech and hyphenation in sync with the visible language.
    if (root === document && document.documentElement) {
      document.documentElement.lang = lang;
    }
  }

  /** The locale-specific Google Maps query (values preserved verbatim). */
  function getMapQuery(locale = lang) {
    const table = STRINGS[locale] || STRINGS[DEFAULT_LOCALE];
    return table.mapQuery || STRINGS[DEFAULT_LOCALE].mapQuery;
  }

  /** Point the instance at a fresh config snapshot ({threshold} source). */
  function setConfig(next) {
    if (next) configRef = next;
    return configRef;
  }

  /** The i18n-aware translator bound to this instance (handy for toast.js). */
  function translator() {
    return t;
  }

  // Re-render everything when the operator changes the threshold or other config.
  configBus.on(EVENT_NAMES.CONFIG_CHANGED, ({ config: next }) => {
    if (next) configRef = next;
    applyToDOM();
  });

  if (autoApply && typeof document !== 'undefined') {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', () => applyToDOM(), { once: true });
    } else {
      applyToDOM();
    }
  }

  return {
    t,
    has,
    getLanguage,
    setLanguage,
    onLanguageChange,
    applyToDOM,
    getMapQuery,
    getThreshold,
    formatThreshold,
    setConfig,
    translator,
    locales: LOCALES,
    /* exposed for advanced/UI use */
    strings: STRINGS
  };
}

/**
 * Shared default instance.
 * Registering it as the toast translator means every toast can take an i18n key.
 * `autoApply` renders `[data-i18n]` nodes as soon as the DOM is ready, so the
 * shell is correct even before js/app.js finishes bootstrapping (idempotent).
 */
export const i18n = createI18n({ autoApply: true });

setToastTranslator(i18n.t);

export default i18n;
