export const JIGSAW_PUZZLE_CONFIG = {
  // DC boundaries for grid size; open-ended at both ends, so any DC (even <15 or >40) maps without
  // special-casing — see design.md "DC handling". DC itself is never clamped.
  GRID_TIER_BOUNDARIES: [15, 25, 35],
  // Unlike every sibling feature, piece count (DC-driven) also factors into the time formula here,
  // not just totalPcStat — a jigsaw puzzle's manipulation effort scales close to linearly with piece
  // count (each tile has to be located, evaluated, and dragged/placed) in a way reading-a-pool or
  // filling-a-fixed-size-grid doesn't. First-draft constants, expect a retuning pass after
  // playtesting, same as every sibling's own constants needed at least one retune.
  TIME_ALLOWANCE_PER_STAT_POINT: 5,
  TIME_ALLOWANCE_PER_PIECE_SECONDS: 6,
  TIME_ALLOWANCE_BASE_SECONDS: 20,
  CRITICAL_SUCCESS_TIME_PERCENT: 0.25,
  // ratio >= this => failure, otherwise criticalFailure (or plain failure if allowCriticalOutcomes
  // is off). Deliberately the OPPOSITE boundary direction from fact-sifter's own ratio check (there,
  // exactly 50% lands in criticalFailure) — this is intentional per this feature's own spec, not an
  // inconsistency to "fix" to match fact-sifter.
  EXPIRATION_RATIO_THRESHOLD: 0.5,
};

// Retuned after playtesting showed the original 3x2/3x3 tiers (6/9 pieces) were trivially easy
// regardless of DC — 4x4 (16 pieces) is now the EASIEST tier, scaling up from there. The time
// formula's per-piece term (see baseTimeAllowanceSeconds) grows alongside this automatically, so
// harder/larger grids still get proportionally more time, not just a bigger board.
export function gridDimensionsForDc(dc) {
  const [t1, t2, t3] = JIGSAW_PUZZLE_CONFIG.GRID_TIER_BOUNDARIES;
  if (dc <= t1) return { cols: 4, rows: 4 };
  if (dc <= t2) return { cols: 5, rows: 4 };
  if (dc <= t3) return { cols: 5, rows: 5 };
  return { cols: 6, rows: 5 };
}

// Perception isn't under `actor.system.skills` in PF2e's data model — it's a sibling field. Read
// live at attempt-open time (never snapshotted at request time) so buffs/penalties active at
// attempt time apply — same convention as all four sibling features.
export function liveTotalPcStat(actor, skillSlug, circumstanceMod) {
  const base = skillSlug === 'perception'
    ? actor.system.perception.totalModifier
    : actor.system.skills[skillSlug].totalModifier;
  return base + circumstanceMod;
}

export function baseTimeAllowanceSeconds(totalPcStat, pieceCount) {
  const {
    TIME_ALLOWANCE_PER_STAT_POINT,
    TIME_ALLOWANCE_PER_PIECE_SECONDS,
    TIME_ALLOWANCE_BASE_SECONDS,
  } = JIGSAW_PUZZLE_CONFIG;
  return totalPcStat * TIME_ALLOWANCE_PER_STAT_POINT
    + pieceCount * TIME_ALLOWANCE_PER_PIECE_SECONDS
    + TIME_ALLOWANCE_BASE_SECONDS;
}

// Pixel-dimension-independent by construction: background-size of cols*100% / rows*100% makes the
// source image cols/rows times the element's own box in each axis, and CSS percentage
// background-position semantics (0% = image's left/top edge flush with the box's left/top; 100% =
// image's right/bottom edge flush with the box's right/bottom) mean slice c of `cols` total is
// revealed at c/(cols-1)*100% — solving offset = (boxWidth - bgWidth)*P/100 = -c*boxWidth for P.
export function pieceBackgroundPosition(pieceId, cols, rows) {
  const col = pieceId % cols;
  const row = Math.floor(pieceId / cols);
  const x = cols > 1 ? (col / (cols - 1)) * 100 : 0;
  const y = rows > 1 ? (row / (rows - 1)) * 100 : 0;
  return {
    backgroundSize: `${cols * 100}% ${rows * 100}%`,
    backgroundPositionX: `${x}%`,
    backgroundPositionY: `${y}%`,
  };
}

function shuffle(array) {
  const result = [...array];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

// Called fresh in onAttempt() every single attempt, never at GM-request time — same architecture
// lesson learned from timeline-puzzle: baking randomized content into the ChatMessage meant
// re-attempting the same request always replayed the identical puzzle. `imagePath`/`aspectRatio`
// are resolved by the caller (chat.js) before this is called, since that requires an async
// FilePicker/Image preload this pure module deliberately has no access to.
export function generateAttempt({ dc, imagePath, aspectRatio }) {
  const { cols, rows } = gridDimensionsForDc(dc);
  const pieceCount = cols * rows;
  const trayOrder = shuffle(Array.from({ length: pieceCount }, (_, id) => id));
  return { imagePath, aspectRatio, cols, rows, pieceCount, trayOrder };
}

export function resolveOutcomeOnCorrectSubmission(elapsedSeconds, baseSeconds, allowCriticalOutcomes) {
  const percentUsed = baseSeconds > 0 ? elapsedSeconds / baseSeconds : 1;
  if (percentUsed <= JIGSAW_PUZZLE_CONFIG.CRITICAL_SUCCESS_TIME_PERCENT) {
    return allowCriticalOutcomes ? 'criticalSuccess' : 'success';
  }
  return 'success';
}

// Ratio-based outcome, same shape as fact-sifter's own expiration check but with the boundary
// flipped: exactly 50% correct here is still a plain failure (>=), not a criticalFailure — see the
// EXPIRATION_RATIO_THRESHOLD comment above for why this isn't a bug relative to fact-sifter.
export function resolveOutcomeOnExpiration(correctSlotCount, pieceCount, allowCriticalOutcomes) {
  const ratio = pieceCount > 0 ? correctSlotCount / pieceCount : 0;
  if (ratio >= JIGSAW_PUZZLE_CONFIG.EXPIRATION_RATIO_THRESHOLD) return 'failure';
  return allowCriticalOutcomes ? 'criticalFailure' : 'failure';
}
