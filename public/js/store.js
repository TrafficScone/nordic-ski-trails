// ---------------------------------------------------------------------------
// The one place feature data lives.
//
// Editing happens against localStorage so the site works offline and nothing
// is lost on refresh. `data/trails.geojson` is the *published* copy: it seeds
// an empty browser, and you overwrite it (via Export) when you're ready to
// deploy. See README.
// ---------------------------------------------------------------------------

import { DATA_URL, STORAGE_KEY } from './config.js';
import { NEW_PLACE, NEW_TRAIL } from './schema.js';

const HISTORY_LIMIT = 60;

export const newId = () =>
  crypto.randomUUID?.() ?? `f${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;

const emptyFC = () => ({ type: 'FeatureCollection', features: [] });

export class Store {
  constructor() {
    this.fc = emptyFC();
    this.past = [];
    this.listeners = new Set();
    this.source = 'empty'; // 'local' | 'published' | 'empty'
  }

  // -- lifecycle ------------------------------------------------------------

  async init() {
    const cached = localStorage.getItem(STORAGE_KEY);
    if (cached) {
      try {
        this.fc = normalize(JSON.parse(cached));
        this.source = 'local';
        return this;
      } catch {
        console.warn('Local trail data was unreadable; falling back to published file.');
      }
    }
    await this.loadPublished();
    return this;
  }

  async loadPublished() {
    try {
      const res = await fetch(`${DATA_URL}?v=${Date.now()}`, { cache: 'no-store' });
      if (res.ok) {
        this.fc = normalize(await res.json());
        this.source = this.fc.features.length ? 'published' : 'empty';
      }
    } catch {
      this.fc = emptyFC();
      this.source = 'empty';
    }
    this.past = [];
    this.persist();
    this.emit();
  }

  // -- events ---------------------------------------------------------------

  on(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  emit(detail = {}) { for (const fn of this.listeners) fn(this.fc, detail); }

  // -- reads ----------------------------------------------------------------

  get features() { return this.fc.features; }
  get(id) { return this.fc.features.find((f) => f.properties.id === id) ?? null; }
  get canUndo() { return this.past.length > 0; }

  // -- writes ---------------------------------------------------------------

  /** Snapshot current state so the next mutation is undoable. */
  checkpoint() {
    this.past.push(JSON.stringify(this.fc));
    if (this.past.length > HISTORY_LIMIT) this.past.shift();
  }

  addFeature(geometry, props = {}) {
    this.checkpoint();
    const base = geometry.type === 'Point' ? NEW_PLACE : NEW_TRAIL;
    const feature = {
      type: 'Feature',
      geometry,
      properties: { ...base, ...props, id: props.id ?? newId(), created: nowISO(), updated: nowISO() },
    };
    this.fc.features.push(feature);
    this.commit({ type: 'add', id: feature.properties.id });
    return feature;
  }

  updateProps(id, patch) {
    const f = this.get(id);
    if (!f) return null;
    this.checkpoint();
    Object.assign(f.properties, patch, { updated: nowISO() });
    this.commit({ type: 'update', id });
    return f;
  }

  setGeometry(id, geometry) {
    const f = this.get(id);
    if (!f) return null;
    this.checkpoint();
    f.geometry = geometry;
    f.properties.updated = nowISO();
    this.commit({ type: 'geometry', id });
    return f;
  }

  remove(id) {
    const i = this.fc.features.findIndex((f) => f.properties.id === id);
    if (i < 0) return false;
    this.checkpoint();
    this.fc.features.splice(i, 1);
    this.commit({ type: 'remove', id });
    return true;
  }

  /** Merge an imported collection in alongside what's already there. */
  merge(incoming) {
    const clean = normalize(incoming);
    if (!clean.features.length) return 0;
    this.checkpoint();
    const seen = new Set(this.fc.features.map((f) => f.properties.id));
    for (const f of clean.features) {
      if (seen.has(f.properties.id)) f.properties.id = newId();
      seen.add(f.properties.id);
      this.fc.features.push(f);
    }
    this.commit({ type: 'merge', count: clean.features.length });
    return clean.features.length;
  }

  undo() {
    const prev = this.past.pop();
    if (!prev) return false;
    this.fc = JSON.parse(prev);
    this.persist();
    this.emit({ type: 'undo' });
    return true;
  }

  commit(detail) {
    this.persist();
    this.emit(detail);
  }

  persist() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.fc));
      this.source = 'local';
    } catch (err) {
      console.warn('Could not save locally (storage full or blocked).', err);
    }
  }

  /** Stable, pretty-printable copy for export. */
  toGeoJSON() {
    return {
      type: 'FeatureCollection',
      features: this.fc.features.map((f) => ({
        type: 'Feature',
        properties: { ...f.properties },
        geometry: f.geometry,
      })),
    };
  }
}

const nowISO = () => new Date().toISOString();

/** Accept anything GeoJSON-ish and hand back features we know how to draw. */
export function normalize(input) {
  const raw =
    input?.type === 'FeatureCollection' ? input.features
    : input?.type === 'Feature' ? [input]
    : Array.isArray(input) ? input
    : [];

  const out = [];
  for (const f of raw) {
    if (!f?.geometry) continue;
    const props = { ...(f.properties ?? {}) };
    // MultiLineString from a GPX with several segments -> one feature per part.
    const parts =
      f.geometry.type === 'MultiLineString'
        ? f.geometry.coordinates.map((c) => ({ type: 'LineString', coordinates: c }))
        : [f.geometry];

    for (const geometry of parts) {
      if (geometry.type !== 'LineString' && geometry.type !== 'Point') continue;
      if (geometry.type === 'LineString' && geometry.coordinates.length < 2) continue;
      const base = geometry.type === 'Point' ? NEW_PLACE : NEW_TRAIL;
      out.push({
        type: 'Feature',
        geometry: { type: geometry.type, coordinates: strip(geometry.coordinates) },
        properties: {
          ...base,
          ...props,
          kind: geometry.type === 'Point' ? 'place' : 'trail',
          id: props.id ?? newId(),
        },
      });
    }
  }
  // De-dupe ids that arrived colliding.
  const seen = new Set();
  for (const f of out) {
    while (seen.has(f.properties.id)) f.properties.id = newId();
    seen.add(f.properties.id);
  }
  return { type: 'FeatureCollection', features: out };
}

/** Drop elevation/time from positions — keeps geometry to [lng, lat]. */
function strip(coords) {
  if (typeof coords[0] === 'number') return [coords[0], coords[1]];
  return coords.map(strip);
}
