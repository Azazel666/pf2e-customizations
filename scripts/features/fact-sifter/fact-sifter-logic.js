// GM-editable content banks. Every fact/noise/irrelevantNoise string within a scenario must be
// pairwise unique — enforced by convention only, not a runtime check, same as the other features'
// content banks. Used directly, verbatim — no localization indirection (the lesson learned from
// timeline-puzzle's event bank: routing GM-authored content through game.i18n.localize broke when
// the bank was customized, since there's no matching translation-key entry for arbitrary content).
//
// Authoring rule for every scenario's `chain` (REQUIRED, not just a style preference): fact i>=2
// must verbatim-restate one specific, checkable token from fact i-1's TRUE value, in ALL THREE of
// its own variants (true + both noise options). This is what makes the chain traceable once
// fragments are shuffled — a player scans the pool for the sentence containing that token, and
// disambiguates among its ~3 candidates using the rest of the chain they've already anchored.
// Implicit references ("that entry", "the station") do NOT work: they have no fixed antecedent
// once shuffled into a flat list, which is exactly what made the original content unsolvable (see
// design.md Phase 5 for the incident writeup). The first fact in a chain has no prior link to
// restate (it's the anchor); the last fact in any truncated tier-prefix has no forward
// corroboration for its own newly-introduced detail — accepted as a bounded (~3-way) judgment
// call, mitigated by the puzzle's free/unlimited-retry mechanic.
//
// Two easy-to-miss ways this rule breaks even when it looks satisfied at a glance (both caused a
// real playtest failure — see design.md Phase 5):
//   (a) EXACT substring, not a paraphrase. Fact i's own TRUE text must contain the literal token
//       fact i+1 restates — "offline for the entire prior shift" does NOT satisfy a restatement of
//       "offline for the entire shift" (the inserted word breaks the substring match), and "six
//       hours" does NOT satisfy a restatement of "six-hour". A player scanning for an exact phrase
//       won't connect near-miss wording, silently breaking that link.
//   (c) The forward token must NOT leak into fact i's own noise options. If both a true fact and
//       one of its noise siblings contain the same token that the next fact restates, the next
//       fact's restatement no longer disambiguates between them — both look equally corroborated.
//       (e.g. a noise option describing "an unattended relay in a neighboring sector" reused the
//       exact phrase "unattended relay" that the true fact also used, so restating "unattended
//       relay" one link later matched two candidates instead of one.)
//
// `closingLeads` (REQUIRED for tiers Easy/Medium/Hard, i.e. keys 3/4/5): the tier-boundary problem
// noted above ("the last fact in any truncated tier-prefix has no forward corroboration") is not
// just a theoretical edge case — a real playtest transcript confirmed it's a guaranteed, unsolvable
// coin-flip on one of the required facts every single attempt, no matter how carefully the player
// reads (see design.md Phase 5 "Closing leads" for the full transcript analysis). `closingLeads[T]`
// is a single GIVEN sentence, shown separately from the shuffled pool (never itself selectable),
// that restates the exact forward token chain[T-1]'s true value would otherwise need — i.e. exactly
// the corroboration that link T+1 would have provided had it not been excluded by the tier cutoff.
// This closes the ONE genuinely unsolvable gap while leaving every other fact's resolution to real
// cross-referencing effort. Deliberately has no entry for key 6 (Expert/full-chain): the final link
// of the authored chain is written to be inferable from narrative logic once facts 1-5 are known
// (a "capstone" payoff for the hardest tier, not a token restatement) — revisit if that turns out
// not to hold up in play.
export const FACT_CHAIN_BANK = [
  {
    // Scenario A: the Ashwatch tower's signal-fire investigation
    chain: [
      {
        fact: 'The signal fire burns violet.',
        noise: ['The signal fire burns emerald.', 'The signal fire burns argent.'],
      },
      {
        fact: 'Only the Ashwatch tower is warded to burn its fire violet.',
        noise: ['Only the Cindermoor tower is warded to burn its fire violet.', 'Only the Ravenspire tower is warded to burn its fire violet.'],
      },
      {
        fact: 'The Ashwatch tower stood empty at midnight.',
        noise: ['The Ashwatch tower stood fully manned at midnight.', 'The Ashwatch tower stood sealed at midnight.'],
      },
      {
        fact: 'Because the tower stood empty, a stray watch-sprite kept the fire lit past midnight.',
        noise: ['Because the tower stood empty, every fire was doused before midnight.', 'Because the tower stood empty, a passing pilgrim relit the fire near dawn.'],
      },
      {
        fact: 'The watch-sprite kept the flame burning unbroken for six hours.',
        noise: ["The watch-sprite's flame flickered in three short bursts, each under a minute.", 'The watch-sprite kept the flame burning unbroken for six minutes.'],
      },
      {
        fact: 'A ward burning six hours unbroken is merely stuck, not a genuine distress signal.',
        noise: ['A ward burning six hours unbroken is exactly the mark of a genuine distress signal.', 'A ward burning six hours unbroken means nothing more than a routine relighting ritual.'],
      },
    ],
    irrelevantNoise: [
      'The garrison quartermaster requested three more oil lamps that same week.',
      'A stable hand reported two horses missing from the west paddock.',
      'The chapel bell rang an unrelated hour marking evensong.',
      "A traveling merchant's wagon lost a wheel on the north road that night.",
      "The blacksmith repaired a bent hinge on the tower's outer gate.",
      'A separate patrol found nothing unusual along the coastal path.',
      "The scribe's apprentice misfiled an unrelated supply requisition.",
      'A stray dog was seen near the market square before dawn.',
    ],
    closingLeads: {
      3: "The gate porter's log confirms the tower stood empty that night.",
      4: 'A passing forester swears a watch-sprite was seen darting around the beacon after midnight.',
      5: 'The relief watch clocked the flame burning unbroken for six hours before it was found.',
    },
  },
  {
    // Scenario B: the temple's forged tithe-ledger investigation
    chain: [
      {
        fact: "The tithe ledger's closing sum was recorded as 120 gold.",
        noise: ["The tithe ledger's closing sum was recorded as 125 gold.", "The tithe ledger's closing sum was recorded as 210 gold."],
      },
      {
        fact: 'The 120 gold entry was inked by Brother Ostan.',
        noise: ['The 120 gold entry was inked by Sister Elwyn.', 'The 120 gold entry was inked in an unsigned margin note.'],
      },
      {
        fact: 'Brother Ostan was away on pilgrimage that entire week.',
        noise: ['Brother Ostan was in the scriptorium that entire week.', 'Brother Ostan had returned from his travels only two days before the entry was made.'],
      },
      {
        fact: 'Because Brother Ostan was on pilgrimage, the entry could not be his hand — it must have been forged.',
        noise: ['Because Brother Ostan was on pilgrimage, the entry was dictated to a scribe by messenger-bird.', 'Because Brother Ostan was on pilgrimage, a novice mistakenly copied it from an older ledger.'],
      },
      {
        fact: "The forged entry copied Brother Ostan's seal from a tithe scroll three years old.",
        noise: ['The forged entry copied a seal that never existed.', "The forged entry copied the wrong ledger's seal entirely."],
      },
      {
        fact: "A seal three years old no longer matches the temple's current wax stamp, exposing the forgery.",
        noise: ["A seal three years old perfectly matches the temple's current wax stamp, clearing him of suspicion.", "A seal three years old has no bearing on the temple's current wax stamp either way."],
      },
    ],
    irrelevantNoise: [
      'The sexton requested three new candles for the vestry that week.',
      'A separate donation box was found short by a handful of copper.',
      'The chapter house roof was patched the following month.',
      'A traveling friar delivered unrelated correspondence from the abbey.',
      'The choir rehearsed an unrelated hymn for the coming feast day.',
      'A novice swept the nave twice that week, as was custom.',
      'The gardener pruned the cloister hedges during routine upkeep.',
      'A courier delivered an unrelated parcel to the wrong chapter house.',
    ],
    closingLeads: {
      3: 'The gatehouse register confirms Brother Ostan departed on pilgrimage six days before the entry was made.',
      4: "The abbot's steward suspects the entry was forged the moment he saw it.",
      5: "The abbey's own records show that particular seal design is three years old.",
    },
  },
];

export const FACT_SIFTER_CONFIG = {
  // DC boundaries for pool size; open-ended at both ends, so any DC (even <15 or >40) maps without
  // special-casing — see design.md "DC handling". DC itself is never clamped.
  POOL_TIER_BOUNDARIES: [15, 25, 35],
  // Originally retuned down from the spec's suggested *10+75 to *5+40, following the pattern set by
  // timeline (*10+60 -> *4+30) and alibi-matrix (*12+90 -> *7+50). Bumped back up after playtesting
  // showed *5+40 was too tight for what this puzzle actually demands: unlike timeline's card-sort or
  // alibi-matrix's grid-fill, solving this one requires reading every fragment, then re-scanning the
  // whole pool multiple times to trace a repeated phrase across fragments — closer in effort to
  // alibi-matrix's cross-referencing than to a flat reading task. Now matches alibi-matrix's *7+50
  // almost exactly, with a slightly higher base (60 vs. 50) reflecting the larger reading volume (up
  // to 16 rows at Expert tier vs. alibi-matrix's fixed grid size).
  TIME_ALLOWANCE_PER_STAT_POINT: 7,
  TIME_ALLOWANCE_BASE_SECONDS: 60,
  CRITICAL_SUCCESS_TIME_PERCENT: 0.25,
  // ratio <= this => criticalFailure (or failure if allowCriticalOutcomes is off)
  EXPIRATION_RATIO_THRESHOLD: 0.5,
};

export function dimensionsForDc(dc) {
  const [t1, t2, t3] = FACT_SIFTER_CONFIG.POOL_TIER_BOUNDARIES;
  if (dc <= t1) return { trueFactCount: 3, noiseCount: 3 };
  if (dc <= t2) return { trueFactCount: 4, noiseCount: 5 };
  if (dc <= t3) return { trueFactCount: 5, noiseCount: 7 };
  return { trueFactCount: 6, noiseCount: 10 };
}

// Perception isn't under `actor.system.skills` in PF2e's data model — it's a sibling field.
export function liveTotalPcStat(actor, skillSlug, circumstanceMod) {
  const base = skillSlug === 'perception'
    ? actor.system.perception.totalModifier
    : actor.system.skills[skillSlug].totalModifier;
  return base + circumstanceMod;
}

export function baseTimeAllowanceSeconds(totalPcStat) {
  const { TIME_ALLOWANCE_PER_STAT_POINT, TIME_ALLOWANCE_BASE_SECONDS } = FACT_SIFTER_CONFIG;
  return totalPcStat * TIME_ALLOWANCE_PER_STAT_POINT + TIME_ALLOWANCE_BASE_SECONDS;
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
// re-attempting the same request always replayed the identical puzzle.
export function generateAttempt({ dc, factChainBank }) {
  const { trueFactCount, noiseCount } = dimensionsForDc(dc);
  const scenario = factChainBank[Math.floor(Math.random() * factChainBank.length)];

  // Contiguous PREFIX of the chain, not a random subset — later facts genuinely build on earlier
  // ones (e.g. "the Ashwatch tower is warded to burn violet" only makes sense once "the signal fire
  // burns violet" is established), so an arbitrary subset (links 2,4,6 without 1,3,5) could read as
  // narratively incoherent. A prefix always preserves "each fact follows from the priors" as authored.
  const trueLinks = scenario.chain.slice(0, trueFactCount);
  const targetedNoise = trueLinks.map((link) => link.noise[Math.floor(Math.random() * link.noise.length)]);

  // Extra noise beyond 1-per-true-fact draws from BOTH noise options of each unused chain link
  // (their fact isn't in the true set, so their noise is just as "irrelevant" as filler) plus the
  // scenario's dedicated irrelevantNoise pool. Sufficiency verified for all 4 tiers against a
  // 6-link chain + 8-entry irrelevantNoise pool — Expert tier (0 unused links, extraNeeded=4) is
  // the tightest case, still comfortably covered.
  const leftoverPool = [
    ...scenario.chain.slice(trueFactCount).flatMap((link) => link.noise),
    ...scenario.irrelevantNoise,
  ];
  const extraNeeded = Math.max(0, noiseCount - targetedNoise.length);
  const extraNoise = shuffle(leftoverPool).slice(0, extraNeeded);

  const combined = [
    ...trueLinks.map((link) => ({ text: link.fact, isTrue: true })),
    ...targetedNoise.map((text) => ({ text, isTrue: false })),
    ...extraNoise.map((text) => ({ text, isTrue: false })),
  ];
  const fragments = shuffle(combined).map((entry, id) => ({ ...entry, id })); // id assigned post-shuffle = display order

  // See the `closingLeads` doc comment above the bank: undefined at Expert tier (6) by design, where
  // the final fact is meant to be inferable from narrative logic rather than a given corroboration.
  const closingLead = scenario.closingLeads?.[trueFactCount] ?? null;

  return { fragments, closingLead };
}

export function resolveOutcomeOnCorrectSubmission(elapsedSeconds, baseSeconds, allowCriticalOutcomes) {
  const percentUsed = baseSeconds > 0 ? elapsedSeconds / baseSeconds : 1;
  if (percentUsed <= FACT_SIFTER_CONFIG.CRITICAL_SUCCESS_TIME_PERCENT) {
    return allowCriticalOutcomes ? 'criticalSuccess' : 'success';
  }
  return 'success';
}

// Ratio-based outcome — different in shape from the sibling features (timeline uses
// position-count, alibi-matrix uses whole-grid-correctness). selectedCount===0 correctly falls
// back to ratio=0, landing in criticalFailure (the spec explicitly calls "selected nothing" a
// critical-failure case). Boundary: exactly 50% correct (e.g. 2-of-4 selected true) lands on
// criticalFailure, matching "half or fewer" wording precisely.
export function resolveOutcomeOnExpiration(selectedCount, correctSelectedCount, allowCriticalOutcomes) {
  const ratio = selectedCount > 0 ? correctSelectedCount / selectedCount : 0;
  if (ratio > FACT_SIFTER_CONFIG.EXPIRATION_RATIO_THRESHOLD) return 'failure';
  return allowCriticalOutcomes ? 'criticalFailure' : 'failure';
}
