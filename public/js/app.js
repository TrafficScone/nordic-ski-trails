// ---------------------------------------------------------------------------
// Nordic Ski Trails — app entry point.
//
// Map + layers, the trail list, the details editor, and the glue between the
// drawing tool and the store.
// ---------------------------------------------------------------------------

import { DEFAULT_UNITS, DEFAULT_VIEW, MAP_STYLE, PREFS_KEY, TERRAIN, VIEW_KEY } from './config.js';
import { DrawTool } from './draw.js';
import { bboxOf, featureLength, formatDistance, formatTotal, lineLength } from './geo.js';
import { downloadJSON, readFeatureFile } from './io.js';
import { HANDLE_LAYERS, HIT_LAYERS, trailFilters, trailLayers } from './layers.js';
import {
  DIFFICULTY, DIFFICULTY_BY, PLACE_TYPE, PLACE_TYPE_BY, STATUS_BY, TECHNIQUE_BY, fieldsFor,
} from './schema.js';
import { Store, normalize } from './store.js';

const SRC = 'trails';
const SNAP_PX = 14;

const $ = (sel) => document.querySelector(sel);

const state = {
  units: DEFAULT_UNITS,
  selectedId: null,
  hiddenDifficulties: new Set(),
  showPlaces: true,
  search: '',
  editingGeometry: false,
  swallowNextClick: false,
  terrain: false,
};

const store = new Store();
let map;
let draw;
let hoverPopup;

// ===========================================================================
// Boot
// ===========================================================================

loadPrefs();
await store.init();

map = new maplibregl.Map({
  container: 'map',
  style: MAP_STYLE,
  ...savedView(),
  hash: false,
  maxPitch: 75,
  attributionControl: { compact: true },
});

map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), 'top-right');
map.addControl(new maplibregl.GeolocateControl({ trackUserLocation: true, showAccuracyCircle: true }), 'top-right');
map.addControl(new maplibregl.ScaleControl({ unit: state.units === 'mi' ? 'imperial' : 'metric' }), 'bottom-right');
map.addControl(new maplibregl.FullscreenControl(), 'top-right');

hoverPopup = new maplibregl.Popup({ closeButton: false, closeOnClick: false, offset: 12 });

map.on('load', async () => {
  await addPlaceIcons();
  addDataLayers();

  draw = new DrawTool(map, {
    onFinishLine: (coords) => {
      const f = store.addFeature({ type: 'LineString', coordinates: coords });
      setMode('idle');
      state.swallowNextClick = true;
      select(f.properties.id, { fly: false });
      focusNameField();
    },
    onFinishPoint: (coord) => {
      // Stay in place mode so several places can be dropped in a row.
      const f = store.addFeature({ type: 'Point', coordinates: coord });
      state.swallowNextClick = true;
      select(f.properties.id, { fly: false });
      focusNameField();
    },
    onEditPreview: (geometry) => {
      const f = store.get(state.selectedId);
      if (!f) return;
      f.geometry = geometry; // preview only — no undo checkpoint mid-drag
      pushData();
      renderReadout();
    },
    onEditCommit: (geometry) => {
      if (!state.selectedId) return;
      store.setGeometry(state.selectedId, geometry);
    },
    onProgress: renderHint,
    onModeChange: () => renderHint(),
    snap: snapTo,
  });
  draw.addLayers();

  pushData();
  fitToDataIfNeeded();
  wireMapInteractions();
  selectFromHash();
});

map.on('moveend', saveView);

store.on((_fc, detail) => {
  pushData();
  renderList();
  renderStats();
  // Undo and import can change the selected feature underneath the form.
  const selected = state.selectedId ? store.get(state.selectedId) : null;
  if (detail.type === 'undo' || detail.type === 'merge') {
    selected ? renderDetails(selected) : clearSelection();
  } else {
    renderReadout();
  }
  $('#btn-undo').disabled = !store.canUndo;
  flashSaved();
});

renderFilters();
renderList();
renderStats();
wireChrome();

// ===========================================================================
// Map layers
// ===========================================================================

/** Render each place emoji to a canvas so symbol layers can use it as an icon. */
async function addPlaceIcons() {
  const size = 48;
  for (const type of PLACE_TYPE) {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = size;
    const ctx = canvas.getContext('2d');

    ctx.beginPath();
    ctx.arc(size / 2, size / 2, size / 2 - 3, 0, Math.PI * 2);
    ctx.fillStyle = '#ffffff';
    ctx.fill();
    ctx.lineWidth = 3;
    ctx.strokeStyle = type.color;
    ctx.stroke();

    ctx.font = `${Math.round(size * 0.5)}px system-ui, "Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(type.emoji, size / 2, size / 2 + 1);

    const data = ctx.getImageData(0, 0, size, size);
    if (!map.hasImage(`place-${type.value}`)) {
      map.addImage(`place-${type.value}`, data, { pixelRatio: 2 });
    }
  }
}

function addDataLayers() {
  map.addSource(SRC, { type: 'geojson', data: store.fc });
  for (const layer of trailLayers(SRC)) map.addLayer(layer);
}

function pushData() {
  map?.getSource(SRC)?.setData(store.fc);
  applyFilters();
}

/** Difficulty chips, the places toggle, and selection all drive layer filters. */
function applyFilters() {
  if (!map?.getLayer('trail-line')) return;
  const filters = trailFilters({
    hiddenDifficulties: state.hiddenDifficulties,
    showPlaces: state.showPlaces,
    selectedId: state.selectedId ?? '',
  });
  for (const [id, filter] of Object.entries(filters)) map.setFilter(id, filter);
}

// ===========================================================================
// Map interactions
// ===========================================================================

function wireMapInteractions() {
  map.on('click', (e) => {
    if (state.swallowNextClick) { state.swallowNextClick = false; return; }
    if (draw.mode === 'line' || draw.mode === 'point') return;
    // A click that landed on an edit handle belongs to the draw tool.
    if (map.queryRenderedFeatures(e.point, { layers: HANDLE_LAYERS.filter((l) => map.getLayer(l)) }).length) return;

    const hit = map.queryRenderedFeatures(e.point, { layers: HIT_LAYERS })[0];
    if (hit) select(hit.properties.id, { fly: false });
    else clearSelection();
  });

  for (const layer of HIT_LAYERS) {
    map.on('mouseenter', layer, (e) => {
      if (draw.mode !== 'idle') return;
      map.getCanvas().style.cursor = 'pointer';
      showHoverPopup(e);
    });
    map.on('mousemove', layer, (e) => { if (draw.mode === 'idle') showHoverPopup(e); });
    map.on('mouseleave', layer, () => {
      map.getCanvas().style.cursor = '';
      hoverPopup.remove();
    });
  }
}

function showHoverPopup(e) {
  const f = e.features?.[0];
  if (!f) return;
  const props = store.get(f.properties.id)?.properties ?? f.properties;
  if (props.id === state.selectedId) { hoverPopup.remove(); return; }
  const name = props.name || (props.kind === 'place' ? 'Untitled place' : 'Untitled trail');
  const sub = props.kind === 'place'
    ? PLACE_TYPE_BY[props.placeType]?.label ?? 'Place'
    : `${DIFFICULTY_BY[props.difficulty]?.label ?? 'Unrated'} · ${formatDistance(featureLength(store.get(props.id)), state.units)}`;
  hoverPopup
    .setLngLat(e.lngLat)
    .setHTML(`<h3>${escapeHtml(name)}</h3><p>${escapeHtml(sub)}</p>`)
    .addTo(map);
}

/**
 * Snap a pointer position to a nearby existing vertex so trail networks
 * actually connect. Hold Alt to place a point freely.
 */
function snapTo(lngLat, opts = {}) {
  if (opts.altKey) return null;
  const zoom = map.getZoom();
  const mPerPx = (40075016.686 * Math.cos((lngLat.lat * Math.PI) / 180)) / (512 * 2 ** zoom);
  const tolM = SNAP_PX * mPerPx;
  const dLat = tolM / 111320;
  const dLng = dLat / Math.max(Math.cos((lngLat.lat * Math.PI) / 180), 1e-6);

  let best = null;
  let bestD = Infinity;
  for (const f of store.features) {
    if (opts.exclude && f.properties.id === opts.exclude) continue;
    const coords = f.geometry.type === 'Point' ? [f.geometry.coordinates] : f.geometry.coordinates;
    for (const c of coords) {
      if (Math.abs(c[0] - lngLat.lng) > dLng || Math.abs(c[1] - lngLat.lat) > dLat) continue;
      const d = (c[0] - lngLat.lng) ** 2 + (c[1] - lngLat.lat) ** 2;
      if (d < bestD) { bestD = d; best = [c[0], c[1]]; }
    }
  }
  return best;
}

// ===========================================================================
// Modes & selection
// ===========================================================================

function setMode(mode, opts) {
  if (!draw) return;
  draw.setMode(mode, opts);
  state.editingGeometry = mode === 'edit';
  for (const btn of document.querySelectorAll('.tool[data-mode]')) {
    btn.classList.toggle('is-active', btn.dataset.mode === (mode === 'edit' ? 'idle' : mode));
  }
  $('#map').className = `mode-${mode}`;
  $('#det-editgeom')?.classList.toggle('is-active', mode === 'edit');
  hoverPopup.remove();
  renderHint();
}

function select(id, { fly = true } = {}) {
  const f = store.get(id);
  if (!f) return clearSelection();
  state.selectedId = id;
  if (state.editingGeometry) setMode('idle');
  applyFilters();
  renderDetails(f);
  renderList();
  hoverPopup.remove();
  history.replaceState(null, '', `#${id}`);
  if (fly) flyToFeature(f);
}

function clearSelection() {
  state.selectedId = null;
  if (state.editingGeometry) setMode('idle');
  applyFilters();
  $('#details').hidden = true;
  renderList();
  history.replaceState(null, '', location.pathname + location.search);
}

function flyToFeature(f) {
  if (f.geometry.type === 'Point') {
    map.easeTo({ center: f.geometry.coordinates, zoom: Math.max(map.getZoom(), 15), duration: 600 });
    return;
  }
  const bb = bboxOf({ features: [f] });
  if (bb) map.fitBounds(bb, { padding: { top: 80, bottom: 80, left: 60, right: 380 }, maxZoom: 16.5, duration: 600 });
}

function selectFromHash() {
  const id = location.hash.slice(1);
  if (id && store.get(id)) select(id);
}

// ===========================================================================
// Sidebar
// ===========================================================================

function renderFilters() {
  const box = $('#filters');
  box.innerHTML = '';
  for (const d of DIFFICULTY) {
    const chip = document.createElement('button');
    chip.className = 'chip';
    chip.dataset.difficulty = d.value;
    chip.innerHTML = `<span class="dot" style="background:${d.color}"></span>${escapeHtml(d.label)}`;
    chip.onclick = () => {
      state.hiddenDifficulties.has(d.value)
        ? state.hiddenDifficulties.delete(d.value)
        : state.hiddenDifficulties.add(d.value);
      chip.classList.toggle('off');
      applyFilters();
      renderList();
      savePrefs();
    };
    chip.classList.toggle('off', state.hiddenDifficulties.has(d.value));
    box.append(chip);
  }
  const places = document.createElement('button');
  places.className = 'chip';
  places.innerHTML = '<span class="dot" style="background:#dc2626"></span>Places';
  places.classList.toggle('off', !state.showPlaces);
  places.onclick = () => {
    state.showPlaces = !state.showPlaces;
    places.classList.toggle('off', !state.showPlaces);
    applyFilters();
    renderList();
    savePrefs();
  };
  box.append(places);
}

function visibleFeatures() {
  const q = state.search.trim().toLowerCase();
  return store.features.filter((f) => {
    const p = f.properties;
    if (p.kind === 'place' && !state.showPlaces) return false;
    if (p.kind !== 'place' && state.hiddenDifficulties.has(p.difficulty ?? 'unrated')) return false;
    if (!q) return true;
    return `${p.name ?? ''} ${p.description ?? ''}`.toLowerCase().includes(q);
  });
}

function renderList() {
  const list = $('#list');
  const items = visibleFeatures();
  list.innerHTML = '';

  if (!store.features.length) {
    list.innerHTML = `<div class="empty">Nothing on the map yet.<br><br>
      Pick <b>Trail</b> in the toolbar and click along a route — <kbd>Enter</kbd> finishes it.</div>`;
    return;
  }
  if (!items.length) {
    list.innerHTML = '<div class="empty">Nothing matches those filters.</div>';
    return;
  }

  const trails = items.filter((f) => f.properties.kind !== 'place')
    .sort((a, b) => (a.properties.name || '~').localeCompare(b.properties.name || '~'));
  const places = items.filter((f) => f.properties.kind === 'place')
    .sort((a, b) => (a.properties.name || '~').localeCompare(b.properties.name || '~'));

  if (trails.length) {
    list.append(groupLabel(`Trails · ${trails.length}`));
    trails.forEach((f) => list.append(trailRow(f)));
  }
  if (places.length) {
    list.append(groupLabel(`Places · ${places.length}`));
    places.forEach((f) => list.append(placeRow(f)));
  }
}

const groupLabel = (text) => {
  const el = document.createElement('div');
  el.className = 'group-label';
  el.textContent = text;
  return el;
};

function trailRow(f) {
  const p = f.properties;
  const d = DIFFICULTY_BY[p.difficulty] ?? DIFFICULTY_BY.unrated;
  const row = document.createElement('div');
  row.className = 'row' + (p.id === state.selectedId ? ' is-selected' : '');
  const bits = [d.label, TECHNIQUE_BY[p.technique]?.label].filter(Boolean);
  if (p.status && p.status !== 'open') bits.push(STATUS_BY[p.status]?.label ?? p.status);
  row.innerHTML = `
    <span class="swatch" style="background:${d.color}"></span>
    <span class="meta">
      <span class="nm">${escapeHtml(p.name || 'Untitled trail')}</span>
      <span class="sub">${escapeHtml(bits.join(' · '))}</span>
    </span>
    <span class="len">${formatDistance(featureLength(f), state.units)}</span>`;
  row.onclick = () => select(p.id);
  return row;
}

function placeRow(f) {
  const p = f.properties;
  const t = PLACE_TYPE_BY[p.placeType] ?? PLACE_TYPE_BY.other;
  const row = document.createElement('div');
  row.className = 'row' + (p.id === state.selectedId ? ' is-selected' : '');
  row.innerHTML = `
    <span class="glyph">${t.emoji}</span>
    <span class="meta">
      <span class="nm">${escapeHtml(p.name || 'Untitled place')}</span>
      <span class="sub">${escapeHtml(t.label)}</span>
    </span>`;
  row.onclick = () => select(p.id);
  return row;
}

function renderStats() {
  const trails = store.features.filter((f) => f.properties.kind !== 'place');
  const total = trails.reduce((m, f) => m + featureLength(f), 0);
  const places = store.features.length - trails.length;
  $('#stats').innerHTML = `
    <div class="stat"><b>${trails.length}</b><span>Trails</span></div>
    <div class="stat"><b>${formatTotal(total, state.units)}</b><span>${state.units === 'mi' ? 'Miles' : 'Km'}</span></div>
    <div class="stat"><b>${places}</b><span>Places</span></div>`;
}

// ===========================================================================
// Details panel
// ===========================================================================

function renderDetails(f) {
  const panel = $('#details');
  const body = $('#det-body');
  const p = f.properties;
  panel.hidden = false;
  $('#det-title').textContent = p.kind === 'place' ? 'Place' : 'Trail';
  body.innerHTML = '';

  body.append(readoutEl(f));

  const toggles = document.createElement('div');
  toggles.className = 'toggles';

  for (const field of fieldsFor(p.kind)) {
    if (field.type === 'toggle') {
      toggles.append(toggleEl(field, p));
      continue;
    }
    const wrap = document.createElement('div');
    wrap.className = 'field';
    const label = document.createElement('label');
    label.textContent = field.label;
    label.htmlFor = `f-${field.key}`;
    wrap.append(label);

    let input;
    if (field.type === 'select') {
      input = document.createElement('select');
      for (const opt of field.options) {
        input.append(new Option(opt.label, opt.value, false, p[field.key] === opt.value));
      }
    } else if (field.type === 'textarea') {
      input = document.createElement('textarea');
      input.value = p[field.key] ?? '';
      input.placeholder = field.placeholder ?? '';
    } else {
      input = document.createElement('input');
      input.type = 'text';
      input.value = p[field.key] ?? '';
      input.placeholder = field.placeholder ?? '';
    }
    input.id = `f-${field.key}`;
    input.addEventListener('change', () => store.updateProps(p.id, { [field.key]: input.value }));
    if (field.type !== 'select') {
      input.addEventListener('input', debounce(() => store.updateProps(p.id, { [field.key]: input.value }), 400));
    }
    wrap.append(input);
    body.append(wrap);

    if (field.key === 'status' || (p.kind === 'place' && field.key === 'placeType')) body.append(toggles);
  }
  if (!toggles.isConnected) body.append(toggles);
}

function readoutEl(f) {
  const el = document.createElement('div');
  el.className = 'readout';
  el.id = 'det-readout';
  fillReadout(el, f);
  return el;
}

function fillReadout(el, f) {
  if (f.geometry.type === 'Point') {
    const [lng, lat] = f.geometry.coordinates;
    el.innerHTML = `
      <div><b>${lat.toFixed(5)}</b><span>Latitude</span></div>
      <div><b>${lng.toFixed(5)}</b><span>Longitude</span></div>`;
  } else {
    el.innerHTML = `
      <div><b>${formatDistance(lineLength(f.geometry.coordinates), state.units)}</b><span>Length</span></div>
      <div><b>${f.geometry.coordinates.length}</b><span>Points</span></div>`;
  }
}

function renderReadout() {
  const el = $('#det-readout');
  const f = store.get(state.selectedId);
  if (el && f) fillReadout(el, f);
}

function toggleEl(field, p) {
  const label = document.createElement('label');
  label.className = 'toggle';
  const box = document.createElement('input');
  box.type = 'checkbox';
  box.checked = !!p[field.key];
  box.addEventListener('change', () => store.updateProps(p.id, { [field.key]: box.checked }));
  label.append(box, document.createTextNode(field.label));
  return label;
}

function focusNameField() {
  requestAnimationFrame(() => $('#f-name')?.focus());
}

// ===========================================================================
// Hint bar
// ===========================================================================

function renderHint(progress) {
  const hint = $('#hint');
  const mode = draw?.mode ?? 'idle';

  if (mode === 'line') {
    const coords = progress?.coords ?? [];
    const placed = progress?.count ?? 0;
    const len = placed >= 2 ? formatDistance(lineLength(coords.slice(0, placed)), state.units) : null;
    hint.hidden = false;
    hint.innerHTML = placed === 0
      ? `<span>Click to start the trail. Hold <kbd>Alt</kbd> to ignore snapping.</span>`
      : `<span><b>${placed}</b> point${placed === 1 ? '' : 's'}${len ? ` · ${len}` : ''}</span>
         <span><kbd>Enter</kbd> finish · <kbd>⌫</kbd> undo point · <kbd>Esc</kbd> cancel</span>
         ${placed >= 2 ? '<button class="hint-btn" id="hint-finish">Finish</button>' : ''}`;
    $('#hint-finish')?.addEventListener('click', () => draw.finish());
    return;
  }

  if (mode === 'point') {
    hint.hidden = false;
    hint.innerHTML = '<span>Click the map to drop a place. <kbd>Esc</kbd> to stop.</span>';
    return;
  }

  if (mode === 'edit') {
    hint.hidden = false;
    hint.innerHTML = `<span>Drag points to reshape · click a small circle to add one · right-click a point to remove it</span>
      <button class="hint-btn" id="hint-done">Done</button>`;
    $('#hint-done')?.addEventListener('click', () => setMode('idle'));
    return;
  }

  hint.hidden = true;
}

// ===========================================================================
// Chrome (toolbar, keyboard, import/export, prefs)
// ===========================================================================

function wireChrome() {
  $('#tool-pan').onclick = () => setMode('idle');
  $('#tool-line').onclick = () => setMode('line');
  $('#tool-point').onclick = () => setMode('point');

  $('#btn-undo').onclick = () => { store.undo(); if (state.selectedId && !store.get(state.selectedId)) clearSelection(); };
  $('#btn-undo').disabled = true;

  $('#btn-units').onclick = () => {
    state.units = state.units === 'mi' ? 'km' : 'mi';
    $('#units-label').textContent = state.units;
    savePrefs();
    renderStats();
    renderList();
    renderReadout();
    toast(`Distances in ${state.units === 'mi' ? 'miles' : 'kilometres'}`);
  };
  $('#units-label').textContent = state.units;

  $('#btn-terrain').onclick = () => {
    state.terrain = !state.terrain;
    map.setTerrain(state.terrain ? TERRAIN : null);
    if (state.terrain && map.getPitch() < 30) map.easeTo({ pitch: 55, duration: 700 });
    if (!state.terrain) map.easeTo({ pitch: 0, duration: 500 });
    $('#btn-terrain').classList.toggle('is-active', state.terrain);
  };

  $('#btn-export').onclick = () => {
    downloadJSON('trails.geojson', store.toGeoJSON());
    toast('Exported trails.geojson — drop it into data/ and commit to publish');
  };

  $('#btn-import').onclick = () => $('#file-input').click();
  $('#file-input').onchange = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    try {
      const added = store.merge(normalize(await readFeatureFile(file)));
      toast(added ? `Imported ${added} feature${added === 1 ? '' : 's'}` : 'Nothing importable in that file');
      if (added) fitTo(store.fc);
    } catch (err) {
      console.error(err);
      toast(`Could not read that file: ${err.message}`);
    }
  };

  $('#btn-reload').onclick = async () => {
    if (!confirm('Discard local edits and reload the published data/trails.geojson?')) return;
    clearSelection();
    await store.loadPublished();
    toast('Reloaded published data');
  };

  $('#det-close').onclick = () => clearSelection();
  $('#det-delete').onclick = () => {
    const f = store.get(state.selectedId);
    if (!f) return;
    if (!confirm(`Delete “${f.properties.name || 'this feature'}”?`)) return;
    store.remove(state.selectedId);
    clearSelection();
  };
  $('#det-editgeom').onclick = () => {
    const f = store.get(state.selectedId);
    if (!f) return;
    setMode(state.editingGeometry ? 'idle' : 'edit', { id: f.properties.id, geometry: f.geometry });
  };

  $('#search').addEventListener('input', (e) => { state.search = e.target.value; renderList(); });

  $('#btn-collapse').onclick = () => toggleSidebar(true);
  $('#btn-expand').onclick = () => toggleSidebar(false);

  window.addEventListener('keydown', (e) => {
    if (/^(INPUT|TEXTAREA|SELECT)$/.test(e.target?.tagName ?? '')) return;
    const meta = e.ctrlKey || e.metaKey;
    if (meta && e.key.toLowerCase() === 'z') { e.preventDefault(); $('#btn-undo').click(); return; }
    if (e.key === 'Escape') { if (!draw?.cancel()) setMode('idle'); return; }
    if (!draw) return;
    if (e.key === 'l' || e.key === 'L') setMode(draw.mode === 'line' ? 'idle' : 'line');
    if (e.key === 'p' || e.key === 'P') setMode(draw.mode === 'point' ? 'idle' : 'point');
    if ((e.key === 'Delete' || e.key === 'Backspace') && state.selectedId && draw.mode !== 'line') {
      e.preventDefault();
      $('#det-delete').click();
    }
  });
}

function toggleSidebar(hide) {
  $('#app').classList.toggle('side-hidden', hide);
  $('#btn-expand').hidden = !hide;
  setTimeout(() => map?.resize(), 220);
}

function fitToDataIfNeeded() {
  if (localStorage.getItem(VIEW_KEY)) return;
  fitTo(store.fc);
}

function fitTo(fc) {
  const bb = bboxOf(fc);
  if (bb) map.fitBounds(bb, { padding: 80, maxZoom: 15, duration: 0 });
}

// ---------------------------------------------------------------------------

function savedView() {
  try {
    const v = JSON.parse(localStorage.getItem(VIEW_KEY) ?? 'null');
    if (v?.center) return { center: v.center, zoom: v.zoom, bearing: v.bearing ?? 0, pitch: v.pitch ?? 0 };
  } catch { /* fall through */ }
  return DEFAULT_VIEW;
}

function saveView() {
  const c = map.getCenter();
  localStorage.setItem(VIEW_KEY, JSON.stringify({
    center: [c.lng, c.lat], zoom: map.getZoom(), bearing: map.getBearing(), pitch: map.getPitch(),
  }));
}

function loadPrefs() {
  try {
    const p = JSON.parse(localStorage.getItem(PREFS_KEY) ?? 'null');
    if (p?.units) state.units = p.units;
    if (Array.isArray(p?.hiddenDifficulties)) state.hiddenDifficulties = new Set(p.hiddenDifficulties);
    if (typeof p?.showPlaces === 'boolean') state.showPlaces = p.showPlaces;
  } catch { /* defaults are fine */ }
}

function savePrefs() {
  localStorage.setItem(PREFS_KEY, JSON.stringify({
    units: state.units,
    hiddenDifficulties: [...state.hiddenDifficulties],
    showPlaces: state.showPlaces,
  }));
}

let savedTimer;
function flashSaved() {
  const el = $('#save-state');
  el.textContent = 'saving…';
  clearTimeout(savedTimer);
  savedTimer = setTimeout(() => { el.textContent = 'saved locally'; }, 400);
}

let toastTimer;
function toast(message) {
  const el = $('#toast');
  el.textContent = message;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, 3200);
}

function debounce(fn, ms) {
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
}

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
