// GM-editable content banks. Each entry is used directly, verbatim, as both the internal
// identifier and the displayed text — no localization indirection (the same lesson learned from
// timeline-puzzle's event bank: routing GM-authored content through game.i18n.localize broke when
// the bank was customized, since there's no matching translation-key entry for arbitrary content).
// Each bank needs at least 4 unique entries to cover the Expert tier (4x4x4) — this is enforced by
// convention/comment only, not a runtime check.
export const SUSPECT_BANK = [
  'Alistair Voss', 'Dame Odessa Vane', 'Corwin Ashgrove', 'Mireille Duquesne',
  'Thaddeus Marrow', 'Lady Seraphina Cole', 'Bartholomew Ferrow', 'Ingrid Solvane',
  'Percival Wrenfield', 'Cassandra Nightwell', 'Reginald Ashby', 'Ophelia Marchetti',
];

export const ROOM_BANK = [
  'Library', 'Vault', 'Crypt', 'Conservatory', 'Wine Cellar', 'Study',
  'Ballroom', 'Gallery', 'Kitchen', 'Observatory', 'Armory', 'Chapel',
];

export const MOTIVE_BANK = [
  'Revenge', 'Greed', 'Blackmail', 'Jealousy', 'Inheritance', 'Betrayal',
  'Desperation', 'Ambition', 'Fear', 'Loyalty', 'Obsession', 'Pride',
];

export const ALIBI_MATRIX_CONFIG = {
  // DC boundaries for matrix dimensions; open-ended at both ends, so any DC (even <15 or >40) maps
  // without special-casing — see design.md "DC handling". DC itself is never clamped.
  DIMENSION_TIER_BOUNDARIES: [15, 25, 35],
  // neededRoll <= this => full (N, N in 3-cat connected) clue set; above => reduced (N-1). Same
  // axis/cutoff as timeline-puzzle's clueMode.
  NEEDED_ROLL_FULL_CLUES_MAX: 10,
  // First-draft guesses: more generous than timeline-puzzle's tuned values (a genuinely harder
  // puzzle type — more categories, more clue types to cross-reference), but well short of the
  // original spec's raw 12x+90, which would likely draw the same "too generous" feedback timeline
  // got. Revisit after playtesting — these are the only two numbers that need to change.
  TIME_ALLOWANCE_PER_STAT_POINT: 7,
  TIME_ALLOWANCE_BASE_SECONDS: 50,
  CRITICAL_SUCCESS_TIME_PERCENT: 0.25,
};

export function dimensionsForDc(dc) {
  const [t1, t2, t3] = ALIBI_MATRIX_CONFIG.DIMENSION_TIER_BOUNDARIES;
  if (dc <= t1) return { categoryCount: 2, n: 3 };
  if (dc <= t2) return { categoryCount: 2, n: 4 };
  if (dc <= t3) return { categoryCount: 3, n: 3 };
  return { categoryCount: 3, n: 4 };
}

const GRID_DEFS_2CAT = [
  { key: 'suspectRoom', rowCategory: 'suspect', colCategory: 'room' },
];
const GRID_DEFS_3CAT = [
  { key: 'suspectRoom', rowCategory: 'suspect', colCategory: 'room' },
  { key: 'suspectMotive', rowCategory: 'suspect', colCategory: 'motive' },
  { key: 'roomMotive', rowCategory: 'room', colCategory: 'motive' },
];

export function gridDefsForCategoryCount(categoryCount) {
  return categoryCount === 3 ? GRID_DEFS_3CAT : GRID_DEFS_2CAT;
}

// Perception isn't under `actor.system.skills` in PF2e's data model — it's a sibling field.
export function liveTotalPcStat(actor, skillSlug, circumstanceMod) {
  const base = skillSlug === 'perception'
    ? actor.system.perception.totalModifier
    : actor.system.skills[skillSlug].totalModifier;
  return base + circumstanceMod;
}

export function baseTimeAllowanceSeconds(totalPcStat) {
  const { TIME_ALLOWANCE_PER_STAT_POINT, TIME_ALLOWANCE_BASE_SECONDS } = ALIBI_MATRIX_CONFIG;
  return totalPcStat * TIME_ALLOWANCE_PER_STAT_POINT + TIME_ALLOWANCE_BASE_SECONDS;
}

// Minimum d20 result that would meet/beat the DC. Clamped to [1,20] as a face-count bound, not a
// DC bound — the DC itself is never clamped (see design.md "DC handling").
export function neededRollForDc(dc, totalPcStat) {
  return Math.min(20, Math.max(1, dc - totalPcStat));
}

export function clueModeForNeededRoll(neededRoll) {
  return neededRoll <= ALIBI_MATRIX_CONFIG.NEEDED_ROLL_FULL_CLUES_MAX ? 'full' : 'reduced';
}

function shuffle(array) {
  const result = [...array];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

function samplePermutation(n) {
  return shuffle([...Array(n).keys()]);
}

function pickUniformExcluding(n, exclude) {
  if (n <= 1) return exclude;
  let j;
  do {
    j = Math.floor(Math.random() * n);
  } while (j === exclude);
  return j;
}

// Independent drop per grid/per clue-set — callers must invoke this separately for each grid
// rather than sharing one dropped index across multiple grids.
function dropOneRandom(array) {
  const dropIndex = Math.floor(Math.random() * array.length);
  return array.filter((_, i) => i !== dropIndex);
}

// One shuffle samples each category's items; permRoom/permMotive are independent bijections
// suspect-index -> room/motive-index. Context-free — the permutations picked here ARE the truth,
// same philosophy as timeline-puzzle's sampleTrueOrder.
export function generateSolution({ categoryCount, n, suspectBank, roomBank, motiveBank }) {
  const suspects = shuffle(suspectBank).slice(0, n);
  const rooms = shuffle(roomBank).slice(0, n);
  const motives = categoryCount === 3 ? shuffle(motiveBank).slice(0, n) : null;
  const permRoom = samplePermutation(n);
  const permMotive = categoryCount === 3 ? samplePermutation(n) : null;
  return { n, suspects, rooms, motives, permRoom, permMotive };
}

// permRoom/permMotive are both indexed by SUSPECT. For the roomMotive grid, "row" means
// room-index, not suspect-index — naively reusing suspect-indexed pairs would silently
// misattribute every clue/check on that grid to the wrong room. Build trueColForRow explicitly
// per grid instead.
//
// The roomMotive inversion (trueColForRow[permRoom[i]] = permMotive[i]) is a valid N-length
// bijection: permRoom is onto, so every room index gets exactly one assignment; permMotive is
// injective, so two different rooms (via two different suspects) can never collide on the same
// motive. Total + injective = valid bijection.
export function trueColForRowByGrid(gridKey, solution) {
  const { n, permRoom, permMotive } = solution;
  const trueColForRow = new Array(n);
  if (gridKey === 'suspectRoom') {
    for (let i = 0; i < n; i++) trueColForRow[i] = permRoom[i];
  } else if (gridKey === 'suspectMotive') {
    for (let i = 0; i < n; i++) trueColForRow[i] = permMotive[i];
  } else if (gridKey === 'roomMotive') {
    for (let i = 0; i < n; i++) trueColForRow[permRoom[i]] = permMotive[i];
  }
  return trueColForRow;
}

export function truePairsSetForGrid(gridKey, solution) {
  const trueColForRow = trueColForRowByGrid(gridKey, solution);
  return new Set(trueColForRow.map((col, row) => `${row},${col}`));
}

// Negative clues: one per row in 'full' mode (N clues, full row coverage), one row dropped at
// random in 'reduced' mode (N-1). Always true by construction — stating a row is NOT paired with
// a deliberately wrong column.
export function generateNegativeClues(gridKey, trueColForRow, n, clueMode) {
  const rows = clueMode === 'full' ? [...Array(n).keys()] : dropOneRandom([...Array(n).keys()]);
  return rows.map((row) => ({
    type: 'negative',
    gridKey,
    row,
    col: pickUniformExcluding(n, trueColForRow[row]),
  }));
}

// Connected/disjunction clues — only meaningful when categoryCount===3 (nothing to connect across
// with just Suspect x Room). One per suspect in 'full' mode, one dropped in 'reduced'. Exactly one
// side (room or motive, chosen randomly per clue) is the real value — true by construction
// regardless of the decoy side.
export function generateConnectedClues(solution, clueMode) {
  const { n, permRoom, permMotive } = solution;
  const suspectIdx = clueMode === 'full' ? [...Array(n).keys()] : dropOneRandom([...Array(n).keys()]);
  return suspectIdx.map((i) => {
    const roomIsTrueSide = Math.random() < 0.5;
    return {
      type: 'connected',
      suspect: i,
      roomIdx: roomIsTrueSide ? permRoom[i] : pickUniformExcluding(n, permRoom[i]),
      motiveIdx: roomIsTrueSide ? pickUniformExcluding(n, permMotive[i]) : permMotive[i],
    };
  });
}

// Top-level orchestrator — must be called fresh every single attempt (never at GM-request time),
// same architecture lesson learned from timeline-puzzle: baking randomized content into the
// ChatMessage meant re-attempting the same request always replayed the identical puzzle.
export function generateAttempt({ dc, totalPcStat, suspectBank, roomBank, motiveBank }) {
  const { categoryCount, n } = dimensionsForDc(dc);
  const solution = generateSolution({ categoryCount, n, suspectBank, roomBank, motiveBank });
  const grids = gridDefsForCategoryCount(categoryCount).map((def) => ({
    ...def,
    n,
    trueColForRow: trueColForRowByGrid(def.key, solution),
  }));
  const clueMode = clueModeForNeededRoll(neededRollForDc(dc, totalPcStat));
  const negativeClues = grids.flatMap((g) => generateNegativeClues(g.key, g.trueColForRow, n, clueMode));
  const connectedClues = categoryCount === 3 ? generateConnectedClues(solution, clueMode) : [];
  return { categoryCount, n, solution, grids, clueMode, negativeClues, connectedClues };
}

// A grid is complete+correct iff exactly N cells are checked AND every one is a true pair. If
// checked.length===N but includes any wrong cell, that cell can't be a member of the N-element
// true set, so .every() fails — and a correct cell is then necessarily missing too (displaced to
// keep the count at N). Both malformed cases (too many checks; right count but wrong cells) are
// rejected by these two conditions together.
export function isGridFullyCorrect(cellStates, truePairsSet, n) {
  const checked = [];
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      if (cellStates[r][c] === 'check') checked.push(`${r},${c}`);
    }
  }
  return checked.length === n && checked.every((key) => truePairsSet.has(key));
}

export function resolveOutcomeOnCorrectSubmission(elapsedSeconds, baseSeconds, allowCriticalOutcomes) {
  const percentUsed = baseSeconds > 0 ? elapsedSeconds / baseSeconds : 1;
  if (percentUsed <= ALIBI_MATRIX_CONFIG.CRITICAL_SUCCESS_TIME_PERCENT) {
    return allowCriticalOutcomes ? 'criticalSuccess' : 'success';
  }
  return 'success';
}

// Per spec: >=1 fully-correct grid at expiration is still just 'failure', not a partial-credit tier.
export function resolveOutcomeOnExpiration(correctGridCount, allowCriticalOutcomes) {
  if (correctGridCount === 0) return allowCriticalOutcomes ? 'criticalFailure' : 'failure';
  return 'failure';
}
