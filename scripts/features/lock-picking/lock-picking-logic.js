// PF2e lock DCs (GM Core): Simple 15 / Average 20 / Good 25 / Superior 30.
export const LOCK_TIERS = [
  { key: 'simple', dc: 15 },
  { key: 'average', dc: 20 },
  { key: 'good', dc: 25 },
  { key: 'superior', dc: 30 },
];

export const LOCK_PICKING_CONFIG = {
  DC_TIER_BASE: 15,
  DC_TIER_STEP: 5,
  MIN_PINS: 2,
  MAX_PINS: 5,
  WINDOW_BASE_PERCENT: 18,
  WINDOW_PERCENT_PER_DIFF: 1.5,
  WINDOW_MIN_PERCENT: 6,
  WINDOW_MAX_PERCENT: 45,
  // Direct 360/100 mapping so the already-tuned percent-space difficulty curve
  // (6-45%) carries over as degree-space tolerance (21.6-162deg) with no reinterpretation.
  DEG_PER_WINDOW_PERCENT: 3.6,
  // Flat (not scaled) buffer beyond the tolerance half-width where jitter/hard-stop
  // ramps in, so all skill levels get the same absolute "warning" buffer.
  RESISTANCE_ZONE_MARGIN_DEG: 20,
  // Strain grace window (ms) before a sustained miss registers as a mistake, scaled by
  // the acting character's Thievery proficiency rank (0=untrained .. 4=legendary).
  STRAIN_MS_BASE: 550,
  STRAIN_MS_PER_RANK: 150,
  STRAIN_MS_MIN: 400,
  STRAIN_MS_MAX: 1400,
};

function tierIndexForDc(dc) {
  const { DC_TIER_BASE, DC_TIER_STEP, MIN_PINS, MAX_PINS } = LOCK_PICKING_CONFIG;
  const raw = Math.round((dc - DC_TIER_BASE) / DC_TIER_STEP);
  return Math.min(MAX_PINS - MIN_PINS, Math.max(0, raw));
}

export function pinCountForDc(dc) {
  return LOCK_PICKING_CONFIG.MIN_PINS + tierIndexForDc(dc);
}

export function dcTierLabelForDc(dc) {
  return ['simple', 'average', 'good', 'superior'][tierIndexForDc(dc)];
}

export function windowWidthPercentForDiff(diff) {
  const { WINDOW_BASE_PERCENT, WINDOW_PERCENT_PER_DIFF, WINDOW_MIN_PERCENT, WINDOW_MAX_PERCENT } = LOCK_PICKING_CONFIG;
  const raw = WINDOW_BASE_PERCENT + diff * WINDOW_PERCENT_PER_DIFF;
  return Math.min(WINDOW_MAX_PERCENT, Math.max(WINDOW_MIN_PERCENT, raw));
}

export function strainMsForProficiencyRank(rank) {
  const { STRAIN_MS_BASE, STRAIN_MS_PER_RANK, STRAIN_MS_MIN, STRAIN_MS_MAX } = LOCK_PICKING_CONFIG;
  const raw = STRAIN_MS_BASE + rank * STRAIN_MS_PER_RANK;
  return Math.min(STRAIN_MS_MAX, Math.max(STRAIN_MS_MIN, raw));
}

export function toleranceDegForWindowWidthPercent(windowWidthPercent) {
  return windowWidthPercent * LOCK_PICKING_CONFIG.DEG_PER_WINDOW_PERCENT;
}

export function resistanceZoneDegForToleranceDeg(toleranceDeg) {
  return toleranceDeg / 2 + LOCK_PICKING_CONFIG.RESISTANCE_ZONE_MARGIN_DEG;
}

// Shortest-path distance between two angles (degrees) on a circle, always in [0, 180].
export function angularDistanceDeg(a, b) {
  const d = Math.abs(a - b) % 360;
  return d > 180 ? 360 - d : d;
}

// Picks a random window center guaranteed at least `minDistanceDeg` away (in either direction, by
// shortest angular path) from `excludeDeg`. Used to keep a freshly (re)initialized dial's window
// away from its fixed 0° start angle — without this, luck alone could place the window close enough
// that the dial starts already inside (or on the edge of) the resistance band before the player has
// even had a chance to move the pointer, racking up strain with zero input.
export function randomizeWindowCenterDeg(excludeDeg = 0, minDistanceDeg = 0) {
  if (minDistanceDeg <= 0) return Math.random() * 360;
  const safeMinDistanceDeg = Math.min(minDistanceDeg, 170);
  const usableSpanDeg = 360 - 2 * safeMinDistanceDeg;
  const offsetDeg = safeMinDistanceDeg + Math.random() * usableSpanDeg;
  return ((excludeDeg + offsetDeg) % 360 + 360) % 360;
}

export function isWithinWindowDeg(angleDeg, centerDeg, toleranceDeg) {
  return angularDistanceDeg(angleDeg, centerDeg) <= toleranceDeg / 2;
}
