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

export function randomizeWindowCenter(widthPercent) {
  const half = widthPercent / 2;
  return half + Math.random() * (100 - widthPercent);
}

export function isWithinWindow(value, center, widthPercent) {
  return Math.abs(value - center) <= widthPercent / 2;
}
