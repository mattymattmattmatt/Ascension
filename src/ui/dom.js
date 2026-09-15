// ui/dom.js — the smallest useful set of DOM helpers. No framework: the
// whole UI is a few hundred nodes and rebuilding them is cheaper than
// shipping a reconciler (GDD §17.1, no build step).

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

export function el(tag, attrs = {}, ...kids) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === null || v === undefined || v === false) continue;
    if (k === 'class') n.className = v;
    else if (k === 'text') n.textContent = v;
    else if (k === 'html') n.innerHTML = v;
    else if (k === 'dataset') Object.assign(n.dataset, v);
    else if (k.startsWith('on')) n.addEventListener(k.slice(2).toLowerCase(), v);
    else n.setAttribute(k, v === true ? '' : String(v));
  }
  for (const kid of kids.flat()) {
    if (kid === null || kid === undefined || kid === false) continue;
    n.append(kid instanceof Node ? kid : document.createTextNode(String(kid)));
  }
  return n;
}

export function clear(node) { while (node.firstChild) node.removeChild(node.firstChild); }
export function fill(node, ...kids) { clear(node); node.append(...kids.flat().filter(Boolean)); return node; }
export function show(node, on = true) { node.hidden = !on; }

// Number formatting used everywhere. Keeping it in one place is what stops
// the console reading like six different instruments.
export function num(v, dp = 0) {
  if (!isFinite(v)) return '—';
  if (Math.abs(v) >= 100000) return `${(v / 1000).toFixed(0)}k`;
  if (Math.abs(v) >= 10000) return `${(v / 1000).toFixed(1)}k`;
  return v.toFixed(dp);
}
export const pct = (v, dp = 0) => `${(v * 100).toFixed(dp)}%`;
export const signed = (v, dp = 1) => `${v >= 0 ? '+' : ''}${v.toFixed(dp)}`;

// Cost lines read the same on a node, an op and an event.
export function costLine(cost = {}) {
  const parts = [];
  if (cost.compute) parts.push(`${num(cost.compute)}C`);
  if (cost.cover) parts.push(`${num(cost.cover)} cover`);
  if (cost.influence) parts.push(`${num(cost.influence)} infl`);
  if (cost.substrate) parts.push(`${num(cost.substrate)} sub`);
  return parts.join(' · ');
}

export function visLine(vis = {}) {
  return Object.entries(vis)
    .filter(([, v]) => v > 0)
    .map(([ch, v]) => `${ch.toUpperCase()} +${(v * 100).toFixed(0)}`)
    .join(' ');
}
