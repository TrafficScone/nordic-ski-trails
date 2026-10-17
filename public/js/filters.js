// ---------------------------------------------------------------------------
// Trail filters (difficulty, groomed-only) and the map legend.
//
// Every line feature carries `_difficulty`, `_grooming` and `_dashed` (derived
// in app.js). `lineFilter` turns the filter state into a MapLibre expression
// for the trail line layers; `matchesFilter` is the same rule in plain JS for
// list rows. They must agree — tools/test_filters.mjs checks that they do.
// Points and polygons are never filtered; callers apply this to lines only.
//
// Difficulty follows the North American trail-sign convention, read from the
// trail colour: green easier, blue more difficult, black most difficult.
// ---------------------------------------------------------------------------

/** Ordered as the legend and chips show them. */
export const DIFFICULTIES = [
  { value: 'easy', label: 'Easier', color: '#00cd00' },
  { value: 'intermediate', label: 'More difficult', color: '#0000ff' },
  { value: 'advanced', label: 'Most difficult', color: '#000000' },
  { value: 'other', label: 'Other', color: '#8a939c' },
];

/**
 * Classify a hex colour ('#rgb' or '#rrggbb') by HSL. Anything unparseable,
 * washed-out or off the green/blue ranges is 'other'.
 */
export function difficultyOf(hexColor) {
  const rgb = parseHex(hexColor);
  if (!rgb) return 'other';
  const [h, s, l] = rgbToHsl(rgb);
  if (l < 0.22) return 'advanced'; // black and charcoal (#333 sits right at 20%)
  if (s < 0.25) return 'other';
  if (h >= 70 && h <= 170) return 'easy';
  if (h >= 190 && h <= 260) return 'intermediate';
  return 'other';
}

/** Everything shown, nothing restricted. */
export function defaultFilterState() {
  return { difficulties: new Set(DIFFICULTIES.map((d) => d.value)), groomedOnly: false };
}

/** Boolean MapLibre expression: true for a line feature that should show. */
export function lineFilter(state) {
  const shown = DIFFICULTIES.map((d) => d.value).filter((v) => state.difficulties.has(v));
  if (!shown.length) return ['literal', false];
  const clauses = [['in', ['get', '_difficulty'], ['literal', shown]]];
  if (state.groomedOnly) clauses.push(['==', ['get', '_grooming'], 'groomed']);
  return ['all', ...clauses];
}

/** Plain-JS twin of `lineFilter`, for hiding list rows. */
export function matchesFilter(properties, state) {
  const p = properties || {};
  if (!state.difficulties.has(p._difficulty)) return false;
  if (state.groomedOnly && p._grooming !== 'groomed') return false;
  return true;
}

/**
 * Build the filter controls into `container`: one toggle chip per difficulty
 * and a "Groomed trails only" checkbox. Mutates `state`, then `onChange(state)`.
 */
export function renderFilters(container, state, onChange) {
  const doc = container.ownerDocument;
  container.replaceChildren();

  const chips = el(doc, 'div', 'flt-chips');
  chips.setAttribute('role', 'group');
  chips.setAttribute('aria-label', 'Trail difficulty');
  for (const d of DIFFICULTIES) {
    const chip = el(doc, 'button', 'flt-chip');
    chip.type = 'button';
    chip.dataset.difficulty = d.value;
    chip.setAttribute('aria-pressed', String(state.difficulties.has(d.value)));
    chip.append(lineSwatch(doc, d.color, false, 'flt-swatch'), text(doc, 'span', 'flt-label', d.label));
    chip.addEventListener('click', () => {
      if (state.difficulties.has(d.value)) state.difficulties.delete(d.value);
      else state.difficulties.add(d.value);
      chip.setAttribute('aria-pressed', String(state.difficulties.has(d.value)));
      onChange(state);
    });
    chips.append(chip);
  }

  const row = el(doc, 'label', 'flt-groomed');
  const box = el(doc, 'input', 'flt-groomed-input');
  box.type = 'checkbox';
  box.checked = !!state.groomedOnly;
  box.addEventListener('change', () => {
    state.groomedOnly = box.checked;
    onChange(state);
  });
  row.append(box, text(doc, 'span', 'flt-groomed-text', 'Groomed trails only'));

  container.append(chips, row);
}

/** Static legend matching the map: white-cased lines, parking disc, area box. */
export function renderLegend(container) {
  const doc = container.ownerDocument;
  container.replaceChildren();
  const list = el(doc, 'ul', 'lgd-list');

  const row = (swatch, label) => {
    const li = el(doc, 'li', 'lgd-row');
    li.append(swatch, text(doc, 'span', 'lgd-label', label));
    list.append(li);
  };

  for (const d of DIFFICULTIES.slice(0, 3)) row(lineSwatch(doc, d.color, false, 'lgd-swatch'), d.label);
  // Ungroomed: a white stripe down the middle. Dashed is kept for trails that
  // are only skiable after heavy recent snowfall.
  row(lineSwatch(doc, '#575760', false, 'lgd-swatch', true), 'Ungroomed');
  row(lineSwatch(doc, '#575760', true, 'lgd-swatch'), 'Needs fresh snow');

  const parking = el(doc, 'span', 'lgd-disc');
  parking.textContent = 'P';
  parking.setAttribute('aria-hidden', 'true');
  row(parking, 'Parking');

  const area = svg(doc, 22, 14, 'lgd-swatch');
  area.append(svgEl(doc, 'rect', {
    x: 1.5, y: 1.5, width: 19, height: 11, rx: 2, fill: 'rgba(0,93,170,0.1)',
    stroke: '#005daa', 'stroke-width': 1.5, 'stroke-dasharray': '3 2',
  }));
  row(area, 'Area');

  container.append(list);
}

// -- helpers -----------------------------------------------------------------

function parseHex(input) {
  if (typeof input !== 'string') return null;
  let hex = input.trim().replace(/^#/, '');
  if (/^[0-9a-f]{3}$/i.test(hex)) hex = [...hex].map((c) => c + c).join('');
  if (!/^[0-9a-f]{6}$/i.test(hex)) return null;
  return [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
}

/** [r,g,b] in 0–1 → [hue 0–360, saturation 0–1, lightness 0–1]. */
function rgbToHsl([r, g, b]) {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const d = max - min;
  if (d === 0) return [0, 0, l];
  const s = d / (1 - Math.abs(2 * l - 1));
  let h;
  if (max === r) h = ((g - b) / d) % 6;
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  return [(h * 60 + 360) % 360, s, l];
}

const SVG_NS = 'http://www.w3.org/2000/svg';

function el(doc, tag, className) {
  const node = doc.createElement(tag);
  node.className = className;
  return node;
}

function text(doc, tag, className, content) {
  const node = el(doc, tag, className);
  node.textContent = content;
  return node;
}

function svgEl(doc, tag, attrs) {
  const node = doc.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  return node;
}

function svg(doc, width, height, className) {
  const node = svgEl(doc, 'svg', { width, height, viewBox: `0 0 ${width} ${height}`, 'aria-hidden': 'true' });
  node.setAttribute('class', className);
  return node;
}

/** 22×6 line swatch: white casing under the coloured line, like the map. */
function lineSwatch(doc, color, dashed, className, striped = false) {
  const node = svg(doc, 22, 8, className);
  const line = (attrs) => svgEl(doc, 'line', { x1: 1.5, y1: 4, x2: 20.5, y2: 4, ...attrs });
  node.append(line({ stroke: '#ffffff', 'stroke-width': striped ? 7 : 6, 'stroke-linecap': 'round' }));
  node.append(line(dashed
    ? { stroke: color, 'stroke-width': 3, 'stroke-dasharray': '4 3' }
    : { stroke: color, 'stroke-width': striped ? 4.5 : 3, 'stroke-linecap': 'round' }));
  if (striped) node.append(line({ stroke: '#ffffff', 'stroke-width': 1.4, 'stroke-linecap': 'round' }));
  return node;
}
