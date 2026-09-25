/**
 * Smart Care — view router (blueprint §3.1 / S11).
 *
 * The app has exactly four views, whose IDs are PRESERVED from the original
 * single-file app: viewHome, viewTemp, viewAlert, viewWound. The router does
 * NOT rename or restructure them.
 *
 * Responsibilities
 *   - showView(id): toggle the `.is-active` class so the CSS reveals exactly
 *     one `.fancy-card.view` at a time (layout.css contract).
 *   - Update the SINGLE shared header badge from the shown view's
 *     `data-badge` / `data-badge-variant` hooks
 *     (SMART MEDICAL STATION / BLE MONITORING / ALERT / WOUND CARE).
 *   - Emit `view:changed` ({ viewId }) so other UI modules (lazy maps, …) can
 *     react without the router knowing about them.
 *   - Expose `registerActivation(viewId, fn)`: a lazy activation hook that runs
 *     every time a given view is shown (used by the maps module to defer the
 *     iframe src until the map's view actually appears).
 *
 * Only the foundation DOM helpers are used; nothing is leaked globally.
 */

import { bus as defaultBus, EVENT_NAMES } from '../core/bus.js';
import { delegate } from '../core/dom.js';

/** PRESERVED view IDs (blueprint §7 — do not rename). */
export const VIEW_IDS = Object.freeze(['viewHome', 'viewTemp', 'viewAlert', 'viewWound']);

/** Badge modifier applied when a view declares `data-badge-variant="alert"`. */
export const BADGE_ALERT_CLASS = 'badge-tag--alert';

/**
 * @param {{ bus?: object, container?: ParentNode|null }} [options]
 */
export function createRouter({ bus = defaultBus, container = null } = {}) {
  const root = container || (typeof document !== 'undefined' ? document : null);

  /** @type {Object<string, HTMLElement>} */
  let viewEls = {};
  let currentView = null;
  /** @type {Map<string, Set<Function>>} */
  const activationHooks = new Map();

  function refreshRefs() {
    viewEls = {};
    VIEW_IDS.forEach((id) => {
      const node = document.getElementById(id);
      if (node) viewEls[id] = node;
    });
    return viewEls;
  }

  function resolveInitialView() {
    const active = VIEW_IDS.find((id) => viewEls[id]?.classList.contains('is-active'));
    return active || VIEW_IDS[0];
  }

  /** Apply the badge label + variant declared by the shown view section. */
  function updateBadge(section) {
    const badge = document.getElementById('appBadge');
    if (!badge || !section) return;
    const label = section.dataset ? section.dataset.badge : null;
    if (label) badge.textContent = label;
    const variant = section.dataset ? section.dataset.badgeVariant : null;
    badge.classList.toggle(BADGE_ALERT_CLASS, variant === 'alert');
  }

  function runActivationHooks(viewId) {
    const hooks = activationHooks.get(viewId);
    if (!hooks || hooks.size === 0) return;
    hooks.forEach((fn) => {
      try {
        fn(viewId);
      } catch (error) {
        console.error(`[router] activation hook for "${viewId}" threw:`, error);
      }
    });
  }

  /**
   * Show one of the four preserved views.
   * @param {string} id viewHome | viewTemp | viewAlert | viewWound
   * @returns {string|null} the now-current view id
   */
  function showView(id) {
    if (!VIEW_IDS.includes(id) || !viewEls[id]) {
      console.warn(`[router] unknown view "${id}" — ignoring.`);
      return currentView;
    }

    VIEW_IDS.forEach((viewId) => {
      const node = viewEls[viewId];
      if (node) node.classList.toggle('is-active', viewId === id);
    });

    currentView = id;
    updateBadge(viewEls[id]);
    runActivationHooks(id);
    bus.emit(EVENT_NAMES.VIEW_CHANGED, { viewId: id });
    return currentView;
  }

  /**
   * Register a lazy activation hook for a view.
   * @param {string} viewId
   * @param {(viewId: string) => void} fn
   * @returns {() => void} unsubscribe
   */
  function registerActivation(viewId, fn) {
    if (!VIEW_IDS.includes(viewId) || typeof fn !== 'function') return () => {};
    if (!activationHooks.has(viewId)) activationHooks.set(viewId, new Set());
    const set = activationHooks.get(viewId);
    set.add(fn);
    return () => set.delete(fn);
  }

  function init() {
    refreshRefs();
    if (Object.keys(viewEls).length === 0) {
      console.warn('[router] no view elements found — check the shell markup.');
      return currentView;
    }

    if (root) {
      // Event delegation: any element carrying `data-view="viewX"` navigates.
      delegate(root, 'click', '[data-view]', (event, target) => {
        const next = target.dataset ? target.dataset.view : null;
        if (next) showView(next);
      });
    }

    return showView(resolveInitialView());
  }

  return {
    init,
    showView,
    getCurrentView: () => currentView,
    registerActivation,
    refreshRefs,
    VIEW_IDS
  };
}

export default createRouter;
