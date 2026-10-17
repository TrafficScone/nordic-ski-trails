// ---------------------------------------------------------------------------
// What a trail and a place *are*. Add a field here and it shows up in the
// editor form, the popup, and the export automatically.
// ---------------------------------------------------------------------------

export const DIFFICULTY = [
  { value: 'easiest',        label: 'Easiest',        color: '#16a34a', glyph: '●' },
  { value: 'more-difficult', label: 'More difficult', color: '#2563eb', glyph: '■' },
  { value: 'most-difficult', label: 'Most difficult', color: '#111827', glyph: '◆' },
  { value: 'expert',         label: 'Expert',         color: '#7c3aed', glyph: '◆◆' },
  { value: 'unrated',        label: 'Unrated',        color: '#6b7280', glyph: '–' },
];

export const TECHNIQUE = [
  { value: 'both',     label: 'Classic + skate' },
  { value: 'classic',  label: 'Classic only' },
  { value: 'skate',    label: 'Skate only' },
  { value: 'ungroomed', label: 'Ungroomed / backcountry' },
];

export const STATUS = [
  { value: 'open',     label: 'Open' },
  { value: 'grooming', label: 'Being groomed' },
  { value: 'closed',   label: 'Closed' },
  { value: 'unknown',  label: 'Unknown' },
];

export const PLACE_TYPE = [
  { value: 'trailhead',   label: 'Trailhead',    emoji: '🚩', color: '#dc2626' },
  { value: 'parking',     label: 'Parking',      emoji: '🅿️', color: '#2563eb' },
  { value: 'warming-hut', label: 'Warming hut',  emoji: '🔥', color: '#ea580c' },
  { value: 'lodge',       label: 'Lodge / chalet', emoji: '🏠', color: '#a16207' },
  { value: 'restroom',    label: 'Restroom',     emoji: '🚻', color: '#0891b2' },
  { value: 'water',       label: 'Water',        emoji: '💧', color: '#0284c7' },
  { value: 'junction',    label: 'Junction',     emoji: '🔀', color: '#4b5563' },
  { value: 'viewpoint',   label: 'Viewpoint',    emoji: '🏔️', color: '#0d9488' },
  { value: 'hazard',      label: 'Hazard',       emoji: '⚠️', color: '#b91c1c' },
  { value: 'sign',        label: 'Sign / map',   emoji: '🪧', color: '#64748b' },
  { value: 'other',       label: 'Other',        emoji: '📍', color: '#475569' },
];

export const TRAIL_FIELDS = [
  { key: 'name',        label: 'Name',       type: 'text', placeholder: 'Untitled trail' },
  { key: 'difficulty',  label: 'Difficulty', type: 'select', options: DIFFICULTY },
  { key: 'technique',   label: 'Grooming',   type: 'select', options: TECHNIQUE },
  { key: 'status',      label: 'Status',     type: 'select', options: STATUS },
  { key: 'oneway',      label: 'One-way',            type: 'toggle' },
  { key: 'lit',         label: 'Lit for night skiing', type: 'toggle' },
  { key: 'dogs',        label: 'Dogs allowed',       type: 'toggle' },
  { key: 'description', label: 'Notes',      type: 'textarea', placeholder: 'Conditions, landmarks, cautions…' },
];

export const PLACE_FIELDS = [
  { key: 'name',        label: 'Name', type: 'text', placeholder: 'Untitled place' },
  { key: 'placeType',   label: 'Type', type: 'select', options: PLACE_TYPE },
  { key: 'description', label: 'Notes', type: 'textarea', placeholder: 'Hours, amenities, notes…' },
];

export const NEW_TRAIL = {
  kind: 'trail', name: '', difficulty: 'unrated', technique: 'both',
  status: 'open', oneway: false, lit: false, dogs: false, description: '',
};

export const NEW_PLACE = {
  kind: 'place', name: '', placeType: 'trailhead', description: '',
};

const index = (list) => Object.fromEntries(list.map((o) => [o.value, o]));
export const DIFFICULTY_BY = index(DIFFICULTY);
export const TECHNIQUE_BY = index(TECHNIQUE);
export const STATUS_BY = index(STATUS);
export const PLACE_TYPE_BY = index(PLACE_TYPE);

export const difficultyColor = (v) => (DIFFICULTY_BY[v] || DIFFICULTY_BY.unrated).color;
export const fieldsFor = (kind) => (kind === 'place' ? PLACE_FIELDS : TRAIL_FIELDS);

/** MapLibre `match` expression: difficulty -> color. */
export const difficultyColorExpr = [
  'match', ['get', 'difficulty'],
  ...DIFFICULTY.flatMap((d) => [d.value, d.color]),
  DIFFICULTY_BY.unrated.color,
];
