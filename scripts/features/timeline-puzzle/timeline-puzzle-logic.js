// GM-authored event pool shared across all timeline puzzles. Each entry is used directly as both
// the internal identifier (must be unique — duplicates would make two cards indistinguishable and
// break position-based comparisons) and the displayed card text, with no localization indirection;
// edit this list freely to reskin the puzzle for your own campaign.
export const EVENT_BANK_IDS = [
  // --- COSMIC, MYTHOLOGICAL, & CREATION ERAS ---
  'The First Spark',
  'The Shattering of the Moon',
  'The Slumber of the World Dragon',
  'The Celestial Treaty',
  'The Theft of the Sun Core',
  'The Falling of the Stars',
  'The Birthing of the Leylines',
  'The First Mortal Breath',
  'The Forging of the Pillars',
  'The Tears of the Creator',
  'The Banishing of the Old Gods',
  'The Separation of Sea and Sky',
  'The Dawn of the First Phoenix',
  'The Awakening of Time',
  'The Sealing of the Abyss',
  'The Weaving of the Veil',
  'The Great Alignment',
  'The Fracturing of Reality',
  'The Genesis of the Wilds',
  'The Whispering Winds',
  'The Descent of the Archangels',
  'The Shattered Mirror',
  'The First Eclipse',
  'The Churning Chaos',
  'The Birth of Magic',

  // --- EMPIRES, KINGDOMS, & AGE OF MORTALS ---
  'The Coronation of the Lich King',
  'The Rise of the Sunken Citadel',
  'The Great Automaton Rebellion',
  'The Discovery of Aetherium',
  'The Unification of the Tribes',
  'The Golden Age of Alchemists',
  'The Age of the Sky-Sailors',
  'The Founding of Valerius',
  'The Iron Crown Conspiracy',
  'The Fall of the Obsidian Dynasty',
  'The Merchant King\'s Betrayal',
  'The Building of the Grand Wall',
  'The Signing of the Emerald Pact',
  'The Siege of the White Tower',
  'The Discovery of the New Shore',
  'The Great Library Fire',
  'The Golden Jubilee',
  'The Banishing of the Mages',
  'The Treaty of the Iron Hills',
  'The Coronation of the Child Queen',
  'The Rise of the Guilds',
  'The Exile of the Heretics',
  'The Dawn of Steam',
  'The Bloodline Purge',
  'The Rebirth of the Republic',

  // --- CATACLYSMS, WARS, & MAGICAL ANOMALIES ---
  'The Convergence of Seven Planes',
  'The Year of the Blood Rain',
  'The Silencing of the Leylines',
  'The Awakening of the World Tree',
  'The Day the Shadows Walked',
  'The Eclipse of the Void Eye',
  'The Great Petrification',
  'The Spellplague',
  'The Night of Crimson Snow',
  'The Bleeding of the Veil',
  'The Great Rift',
  'The Whispering Plague',
  'The Frostfall Cataclysm',
  'The Day the Stars Fell',
  'The Unleashing of the Kraken',
  'The Ashfall Century',
  'The Ashen Winter',
  'The Ruin of Eldoria',
  'The Chrono-Storm',
  'The Wild Magic Surge',
  'The Shattering of the Wards',
  'The Void Incursion',
  'The Year Without a Summer',
  'The Plague of Madness',
  'The Sunken Kingdom',

  // --- ELVEN, DWARVEN, & ANCIENT RACES ---
  'The Deep-Forge Catastrophe',
  'The Withering of the Primal Grove',
  'The Great Dragon Migration',
  'The Awakening of the Stone Giants',
  'The Fae Incursion',
  'The Curse of the Silver Blood',
  'The Flight of the Gryphons',
  'The Dragonmaw War',
  'The Great Elven Migration',
  'The Awakening of the Golems',
  'The Siren\'s Lament',
  'The Underdark Uprising',
  'The Centaur Crusade',
  'The Merfolk Treaty',
  'The Frost Giant Siege',
  'The Phoenix Ascent',
  'The Wolfpack Horde',
  'The Awakening of the Ents',
  'The Pixie Rebellion',
  'The Curse of the Lycans',
  'The Harpy Horde',
  'The Minotaur Labyrinth',
  'The Dragon\'s Slumber',
  'The Elven Schism',
  'The Dwarven Exodu'
];

export const TIMELINE_PUZZLE_CONFIG = {
  // DC boundaries for grid size (event count); open-ended at both ends, so any DC (even <15 or
  // >40) maps without special-casing — see design.md "DC handling".
  EVENT_COUNT_TIER_BOUNDARIES: [15, 25, 35],
  MIN_EVENT_COUNT: 3,
  // neededRoll <= this => full (N-1) clue set; above => reduced (N-2). neededRoll is the minimum
  // d20 result that would meet/beat the DC, so this is roughly a 55%-chance-to-succeed cutoff.
  NEEDED_ROLL_FULL_CLUES_MAX: 10,
  // First-draft guesses, retuned once already after playtesting felt too generous — the original
  // 10x/60s gave an untrained (+0) character a full minute for what's meant to be an easy puzzle,
  // and let a high-stat character blow well past 2 minutes. 4x/30s keeps untrained at 30s and
  // keeps even a +20 character (a very high-stat case) under ~2 minutes. Revisit again if actual
  // play still feels off — these are the only two numbers that need to change.
  TIME_ALLOWANCE_PER_STAT_POINT: 4,
  TIME_ALLOWANCE_BASE_SECONDS: 30,
  CRITICAL_SUCCESS_TIME_PERCENT: 0.25,
};

export function eventCountForDc(dc) {
  const [t1, t2, t3] = TIMELINE_PUZZLE_CONFIG.EVENT_COUNT_TIER_BOUNDARIES;
  if (dc <= t1) return TIMELINE_PUZZLE_CONFIG.MIN_EVENT_COUNT;
  if (dc <= t2) return TIMELINE_PUZZLE_CONFIG.MIN_EVENT_COUNT + 1;
  if (dc <= t3) return TIMELINE_PUZZLE_CONFIG.MIN_EVENT_COUNT + 2;
  return TIMELINE_PUZZLE_CONFIG.MIN_EVENT_COUNT + 3;
}

// Perception isn't under `actor.system.skills` in PF2e's data model — it's a sibling field.
export function liveTotalPcStat(actor, skillSlug, circumstanceMod) {
  const base = skillSlug === 'perception'
    ? actor.system.perception.totalModifier
    : actor.system.skills[skillSlug].totalModifier;
  return base + circumstanceMod;
}

export function baseTimeAllowanceSeconds(totalPcStat) {
  const { TIME_ALLOWANCE_PER_STAT_POINT, TIME_ALLOWANCE_BASE_SECONDS } = TIMELINE_PUZZLE_CONFIG;
  return totalPcStat * TIME_ALLOWANCE_PER_STAT_POINT + TIME_ALLOWANCE_BASE_SECONDS;
}

// Minimum d20 result that would meet/beat the DC. Clamped to [1,20] as a face-count bound, not a
// DC bound — the DC itself is never clamped (see design.md "DC handling").
export function neededRollForDc(dc, totalPcStat) {
  return Math.min(20, Math.max(1, dc - totalPcStat));
}

export function clueModeForNeededRoll(neededRoll) {
  return neededRoll <= TIMELINE_PUZZLE_CONFIG.NEEDED_ROLL_FULL_CLUES_MAX ? 'full' : 'reduced';
}

function shuffle(array) {
  const result = [...array];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

function arraysEqual(a, b) {
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

// One shuffle produces both the subset AND its true order — these events are context-free, so
// there's no inherent "truth"; the permutation picked here becomes the truth clues are derived
// from.
export function sampleTrueOrder(eventCount) {
  return shuffle(EVENT_BANK_IDS).slice(0, eventCount);
}

// A starting arrangement for the player, guaranteed different from the true order (never start
// already solved).
export function shuffleDisplayOrderDifferentFrom(solutionOrder) {
  const attempt = shuffle(solutionOrder);
  if (arraysEqual(attempt, solutionOrder)) {
    [attempt[0], attempt[1]] = [attempt[1], attempt[0]];
  }
  return attempt;
}

// Slot i (0..N-2) represents "order[i] immediately precedes order[i+1]". The two boundary slots
// (i===0, i===N-2) touch the true first/last event and phrase as direct anchor clues; interior
// slots phrase as "X happens immediately before Y". clueMode 'full' keeps all N-1 slots (fully
// chain-determines the unique order, no guessing); 'reduced' drops one random slot entirely,
// leaving exactly N-2 clues and one genuine gap the player resolves by free, unpenalized trial.
export function generateClueDescriptors(order, clueMode) {
  const n = order.length;
  const slots = [];
  for (let i = 0; i <= n - 2; i++) {
    if (i === 0) slots.push({ type: 'first', eventId: order[0] });
    else if (i === n - 2) slots.push({ type: 'last', eventId: order[n - 1] });
    else slots.push({ type: 'adjacent', beforeId: order[i], afterId: order[i + 1] });
  }

  if (clueMode === 'full') return slots;

  const dropIndex = Math.floor(Math.random() * slots.length);
  return slots.filter((_, index) => index !== dropIndex);
}

export function resolveOutcomeOnCorrectSubmission(elapsedSeconds, baseSeconds, allowCriticalOutcomes) {
  const percentUsed = baseSeconds > 0 ? elapsedSeconds / baseSeconds : 1;
  if (percentUsed <= TIMELINE_PUZZLE_CONFIG.CRITICAL_SUCCESS_TIME_PERCENT) {
    return allowCriticalOutcomes ? 'criticalSuccess' : 'success';
  }
  return 'success';
}

export function resolveOutcomeOnExpiration(displayOrder, solutionOrder, allowCriticalOutcomes) {
  const correctCount = displayOrder.filter((id, index) => id === solutionOrder[index]).length;
  if (correctCount === 0) return allowCriticalOutcomes ? 'criticalFailure' : 'failure';
  return 'failure';
}
