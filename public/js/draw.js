// ---------------------------------------------------------------------------
// Drawing and shape-editing on top of MapLibre.
//
// Deliberately dependency-free: mapbox-gl-draw doesn't track MapLibre cleanly,
// and a trail map only needs lines, points, and vertex editing. Everything is
// two GeoJSON sources ("what I'm drawing" and "the handles") plus pointer
// bookkeeping.
// ---------------------------------------------------------------------------

import { drawLayers } from './layers.js';

const DRAFT_SRC = 'draw-draft';
const HANDLE_SRC = 'draw-handles';

const EMPTY = { type: 'FeatureCollection', features: [] };
const clone = (c) => c.map((p) => [p[0], p[1]]);

export class DrawTool {
  /**
   * @param {maplibregl.Map} map
   * @param {object} hooks
   *   onFinishLine(coords)        a new trail was completed
   *   onFinishPoint(coord)        a new place was dropped
   *   onEditPreview(geometry)     shape is mid-drag; repaint, don't save
   *   onEditCommit(geometry)      shape settled; save one undo step
   *   onProgress(state)           draft changed: {mode, count, coords}
   *   onModeChange(mode)
   *   snap(lngLat)                -> [lng, lat] | null
   */
  constructor(map, hooks = {}) {
    this.map = map;
    this.hooks = hooks;
    this.mode = 'idle';
    this.coords = [];       // in-progress line
    this.cursor = null;     // rubber-band end
    this.editing = null;    // { id, type, coords }
    this.drag = null;       // { index }
    this._bound = false;
  }

  // -- setup ---------------------------------------------------------------

  addLayers() {
    const { map } = this;
    map.addSource(DRAFT_SRC, { type: 'geojson', data: EMPTY });
    map.addSource(HANDLE_SRC, { type: 'geojson', data: EMPTY });
    for (const layer of drawLayers(DRAFT_SRC, HANDLE_SRC)) map.addLayer(layer);
    this._bind();
  }

  _bind() {
    if (this._bound) return;
    const { map } = this;
    this._onClick = (e) => this._handleClick(e);
    this._onMove = (e) => this._handleMove(e);
    this._onDblClick = (e) => { if (this.mode === 'line') { e.preventDefault(); this.finish(); } };
    this._onKey = (e) => this._handleKey(e);
    this._onHandleDown = (e) => this._startDrag(e);
    this._onMidDown = (e) => this._insertVertex(e);
    this._onHandleEnter = () => { if (this.editing) map.getCanvas().style.cursor = 'move'; };
    this._onHandleLeave = () => { if (this.editing) map.getCanvas().style.cursor = ''; };
    this._onHandleContext = (e) => this._deleteVertex(e);

    map.on('click', this._onClick);
    map.on('mousemove', this._onMove);
    map.on('dblclick', this._onDblClick);
    map.on('mousedown', 'draw-vertex', this._onHandleDown);
    map.on('touchstart', 'draw-vertex', this._onHandleDown);
    map.on('mousedown', 'draw-mid', this._onMidDown);
    map.on('touchstart', 'draw-mid', this._onMidDown);
    map.on('mouseenter', 'draw-vertex', this._onHandleEnter);
    map.on('mouseleave', 'draw-vertex', this._onHandleLeave);
    map.on('contextmenu', 'draw-vertex', this._onHandleContext);
    window.addEventListener('keydown', this._onKey);
    this._bound = true;
  }

  // -- modes ---------------------------------------------------------------

  setMode(mode, opts = {}) {
    if (mode === this.mode && mode !== 'edit') return;
    this._resetDraft();
    this.editing = null;
    this.mode = mode;

    if (mode === 'line') this.map.doubleClickZoom.disable();
    else this.map.doubleClickZoom.enable();

    if (mode === 'edit') {
      const { id, geometry } = opts;
      this.editing = {
        id,
        type: geometry.type,
        coords: geometry.type === 'Point' ? [clone([geometry.coordinates])[0]] : clone(geometry.coordinates),
      };
    }

    this._render();
    this.hooks.onModeChange?.(mode);
    this._progress();
  }

  get isDrawing() { return this.mode === 'line' && this.coords.length > 0; }

  finish() {
    if (this.mode !== 'line') return;
    const coords = this.coords.slice();
    this._resetDraft();
    this._render();
    if (coords.length >= 2) this.hooks.onFinishLine?.(coords);
    else this._progress();
  }

  cancel() {
    if (this.mode === 'line' && this.coords.length) {
      this._resetDraft();
      this._render();
      this._progress();
      return true;
    }
    return false;
  }

  undoVertex() {
    if (this.mode !== 'line' || !this.coords.length) return;
    this.coords.pop();
    this._render();
    this._progress();
  }

  // -- pointer handling ----------------------------------------------------

  _handleClick(e) {
    if (this.drag) return;

    if (this.mode === 'point') {
      const at = this.hooks.snap?.(e.lngLat, { altKey: e.originalEvent?.altKey }) ?? [e.lngLat.lng, e.lngLat.lat];
      this.hooks.onFinishPoint?.(at);
      return;
    }

    if (this.mode !== 'line') return;

    // Clicking the first vertex closes the loop.
    if (this.coords.length > 2) {
      const near = this.map.queryRenderedFeatures(e.point, { layers: ['draw-vertex'] })
        .find((f) => f.properties.first);
      if (near) {
        this.coords.push(clone([this.coords[0]])[0]);
        this.finish();
        return;
      }
    }

    const at = this.hooks.snap?.(e.lngLat, { altKey: e.originalEvent?.altKey }) ?? [e.lngLat.lng, e.lngLat.lat];
    const last = this.coords.at(-1);
    if (last && last[0] === at[0] && last[1] === at[1]) return; // ignore double-fire
    this.coords.push(at);
    this._render();
    this._progress();
  }

  _handleMove(e) {
    if (this.mode !== 'line' || !this.coords.length) return;
    this.cursor = this.hooks.snap?.(e.lngLat, { altKey: e.originalEvent?.altKey }) ?? [e.lngLat.lng, e.lngLat.lat];
    this._render();
    this._progress();
  }

  _handleKey(e) {
    const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(e.target?.tagName ?? '');
    if (typing) return;
    if (this.mode !== 'line') return;
    if (e.key === 'Enter') { e.preventDefault(); this.finish(); }
    else if (e.key === 'Backspace' || e.key === 'Delete') { e.preventDefault(); this.undoVertex(); }
  }

  // -- vertex editing ------------------------------------------------------

  _startDrag(e) {
    if (!this.editing) return;
    e.preventDefault(); // stops the map from paning under us
    const index = e.features?.[0]?.properties?.index;
    if (index == null) return;
    this.drag = { index: Number(index) };
    this.map.getCanvas().style.cursor = 'grabbing';

    const move = (ev) => {
      const at = this.hooks.snap?.(ev.lngLat, { exclude: this.editing.id, altKey: ev.originalEvent?.altKey })
        ?? [ev.lngLat.lng, ev.lngLat.lat];
      this.editing.coords[this.drag.index] = at;
      this._render();
      this.hooks.onEditPreview?.(this.geometry());
    };
    const end = () => {
      this.map.off('mousemove', move);
      this.map.off('touchmove', move);
      this.map.getCanvas().style.cursor = '';
      this.drag = null;
      this._render();
      this.hooks.onEditCommit?.(this.geometry());
    };

    this.map.on('mousemove', move);
    this.map.on('touchmove', move);
    this.map.once('mouseup', end);
    this.map.once('touchend', end);
  }

  _insertVertex(e) {
    if (!this.editing) return;
    e.preventDefault();
    const f = e.features?.[0];
    if (!f) return;
    const after = Number(f.properties.index);
    const at = f.geometry.coordinates;
    this.editing.coords.splice(after + 1, 0, [at[0], at[1]]);
    this._render();
    this.hooks.onEditCommit?.(this.geometry());
    // Hand the new vertex straight to the drag handler so it feels continuous.
    this._startDrag({ ...e, preventDefault: () => {}, features: [{ properties: { index: after + 1 } }] });
  }

  _deleteVertex(e) {
    if (!this.editing || this.editing.type === 'Point') return;
    e.preventDefault();
    const index = Number(e.features?.[0]?.properties?.index);
    if (!Number.isInteger(index) || this.editing.coords.length <= 2) return;
    this.editing.coords.splice(index, 1);
    this._render();
    this.hooks.onEditCommit?.(this.geometry());
  }

  geometry() {
    if (!this.editing) return null;
    return this.editing.type === 'Point'
      ? { type: 'Point', coordinates: this.editing.coords[0] }
      : { type: 'LineString', coordinates: clone(this.editing.coords) };
  }

  // -- rendering -----------------------------------------------------------

  _resetDraft() {
    this.coords = [];
    this.cursor = null;
    this.drag = null;
  }

  _render() {
    const draft = [];
    const handles = [];

    if (this.mode === 'line' && this.coords.length) {
      const line = this.cursor ? [...this.coords, this.cursor] : this.coords;
      if (line.length >= 2) {
        draft.push({ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: line } });
      }
      this.coords.forEach((c, i) => {
        handles.push(vertex(c, i, i === 0 && this.coords.length > 2));
      });
    }

    if (this.editing) {
      const { coords, type } = this.editing;
      coords.forEach((c, i) => handles.push(vertex(c, i, false)));
      if (type !== 'Point') {
        for (let i = 0; i < coords.length - 1; i++) {
          const a = coords[i], b = coords[i + 1];
          handles.push({
            type: 'Feature',
            properties: { handle: 'mid', index: i },
            geometry: { type: 'Point', coordinates: [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2] },
          });
        }
      }
    }

    this.map.getSource(DRAFT_SRC)?.setData({ type: 'FeatureCollection', features: draft });
    this.map.getSource(HANDLE_SRC)?.setData({ type: 'FeatureCollection', features: handles });
  }

  _progress() {
    this.hooks.onProgress?.({
      mode: this.mode,
      count: this.coords.length,
      coords: this.cursor ? [...this.coords, this.cursor] : this.coords,
    });
  }
}

const vertex = (coordinates, index, first) => ({
  type: 'Feature',
  properties: { handle: 'vertex', index, first: !!first },
  geometry: { type: 'Point', coordinates },
});
