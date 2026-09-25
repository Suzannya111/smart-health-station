/**
 * Smart Care — DOM helpers.
 * Framework-free conveniences so UI code stays declarative and short.
 * No global side effects; nothing runs on import.
 */

/**
 * querySelector shorthand.
 * @param {string} selector
 * @param {ParentNode} [root=document]
 * @returns {Element|null}
 */
export function $(selector, root = document) {
  return root ? root.querySelector(selector) : null;
}

/**
 * querySelectorAll shorthand, always returning a real Array.
 * @param {string} selector
 * @param {ParentNode} [root=document]
 * @returns {Element[]}
 */
export function $$(selector, root = document) {
  return root ? Array.from(root.querySelectorAll(selector)) : [];
}

/**
 * Create an element.
 * @param {string} tag
 * @param {Object<string, any>} [attrs]  `class`, `dataset`, `on`, then plain attributes.
 *   - `class: 'a b'`      → className
 *   - `dataset: { x: 1 }` → data-x="1"
 *   - `on: { click: fn }` → addEventListener
 *   - `text: '…'`         → textContent (children are ignored when set)
 *   - `html` is intentionally NOT supported (no innerHTML usage in this app)
 * @param {Array<Node|string>} [children]
 * @returns {HTMLElement}
 */
export function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);

  for (const [key, value] of Object.entries(attrs || {})) {
    if (value === null || value === undefined || value === false) continue;

    if (key === 'class' || key === 'className') {
      node.className = Array.isArray(value) ? value.filter(Boolean).join(' ') : String(value);
    } else if (key === 'dataset' && typeof value === 'object') {
      for (const [dataKey, dataValue] of Object.entries(value)) {
        if (dataValue !== null && dataValue !== undefined) node.dataset[dataKey] = String(dataValue);
      }
    } else if (key === 'on' && typeof value === 'object') {
      for (const [type, handler] of Object.entries(value)) {
        if (typeof handler === 'function') node.addEventListener(type, handler);
      }
    } else if (key === 'text') {
      node.textContent = String(value);
    } else if (key === 'style' && typeof value === 'object') {
      Object.assign(node.style, value);
    } else if (value === true) {
      node.setAttribute(key, '');
    } else {
      node.setAttribute(key, String(value));
    }
  }

  for (const child of children) {
    if (child === null || child === undefined) continue;
    node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }

  return node;
}

/**
 * Set (or remove, when value is null/undefined) a single attribute.
 */
export function setAttr(node, name, value) {
  if (!node) return null;
  if (value === null || value === undefined || value === false) node.removeAttribute(name);
  else node.setAttribute(name, value === true ? '' : String(value));
  return node;
}

/**
 * Set multiple attributes at once.
 */
export function setAttrs(node, attrs = {}) {
  for (const [name, value] of Object.entries(attrs)) setAttr(node, name, value);
  return node;
}

/**
 * Add/remove/toggle a class. `force` mirrors DOMTokenList semantics.
 */
export function toggleClass(node, className, force) {
  if (!node || !className) return null;
  if (force === undefined) node.classList.toggle(className);
  else node.classList.toggle(className, Boolean(force));
  return node;
}

/** Add a class (no-op if node is null). */
export function addClass(node, className) {
  if (node && className) node.classList.add(className);
  return node;
}

/** Remove a class (no-op if node is null). */
export function removeClass(node, className) {
  if (node && className) node.classList.remove(className);
  return node;
}

/** True when the node has the class. */
export function hasClass(node, className) {
  return Boolean(node && node.classList && node.classList.contains(className));
}

/**
 * addEventListener that tolerates a missing node.
 * @returns {() => void} unsubscribe function
 */
export function on(node, type, handler, options) {
  if (!node || typeof handler !== 'function') return () => {};
  node.addEventListener(type, handler, options);
  return () => node.removeEventListener(type, handler, options);
}

/**
 * Delegated listener: fires when the event target matches `selector`
 * (or is inside a matching element).
 */
export function delegate(root, type, selector, handler) {
  return on(root, type, (event) => {
    const target = event.target instanceof Element ? event.target.closest(selector) : null;
    if (target && root.contains(target)) handler(event, target);
  });
}

/**
 * Show / hide through the `.is-hidden` utility class
 * (visual hiding that also removes the element from layout & a11y tree).
 */
export function show(node) {
  if (node) node.classList.remove('is-hidden');
  return node;
}

export function hide(node) {
  if (node) node.classList.add('is-hidden');
  return node;
}

export function setHidden(node, hidden) {
  return hidden ? hide(node) : show(node);
}

export function isHidden(node) {
  return Boolean(node && node.classList.contains('is-hidden'));
}

/** Set textContent safely (no-op if node is null). */
export function setText(node, text) {
  if (node) node.textContent = text === null || text === undefined ? '' : String(text);
  return node;
}

/** Disable/enable a control, keeping aria-disabled in sync. */
export function setDisabled(node, disabled) {
  if (!node) return null;
  node.disabled = Boolean(disabled);
  setAttr(node, 'aria-disabled', disabled ? 'true' : null);
  return node;
}

/** Numeric clamp helper (used by thresholds and the command lock). */
export function clamp(value, min, max) {
  const number = Number(value);
  if (!Number.isFinite(number)) return min;
  return Math.min(Math.max(number, min), max);
}

/** Run `callback` once the DOM is parsed (or immediately if it already is). */
export function ready(callback) {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', callback, { once: true });
  } else {
    callback();
  }
}

/** Move focus to the first focusable descendant of `root`. */
export function focusFirst(root) {
  const target = root?.querySelector(
    'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
  );
  if (target && typeof target.focus === 'function') target.focus();
  return target || null;
}
