import { getPuzzleIndex, getPuzzleBoard, lockInDifficulty } from './puzzle-board-data.js';
import { finalizePieceGeometry } from './puzzle-board-logic.js';
import { PuzzleBoardApp } from './puzzle-board-app.js';

const FLAG_SCOPE = 'pf2e-customizations';

// The only two PF2e chat-message context types a difficulty-roll request can ever be pointed at
// (a plain skill check, or Perception — which PF2e models as its own type rather than a "skill").
// Exported so the manager app's manual-resolve action can filter game.messages down to plausible
// candidates using the exact same definition, rather than duplicating it.
export const CHECK_TYPES = new Set(['skill-check', 'perception-check']);

// Confirmed via live testing: a real check's flags.pf2e.context has NO `.slug` field at all (first
// assumed from static source reading — wrong). The only reliable place the statistic's own slug
// appears is as a `check:statistic:<slug>` entry in `context.options` (e.g. `check:statistic:
// diplomacy`) — exported so the manager app's manual-resolve candidate list can extract the same
// label instead of duplicating this parsing.
export function extractSkillSlug(context) {
  if (context.type === 'perception-check') return 'perception';
  const tag = context.options?.find((option) => option.startsWith('check:statistic:'));
  return tag ? tag.slice('check:statistic:'.length) : undefined;
}

// Shared by both the automatic createChatMessage hook below and the manager app's manual-resolve
// action (for when no GM was connected at the moment the roll actually happened — see CLAUDE.md).
// Returns true if this journalEntry's pending request was actually matched and resolved.
export async function resolvePendingRoll(journalEntry, context) {
  const board = getPuzzleBoard(journalEntry);
  const pending = board?.pendingRollRequest;
  if (!pending || !context || !CHECK_TYPES.has(context.type)) return false;
  // Confirmed via live testing: context.actor is the bare Actor id (e.g. "chOzYBJo1BjDNOhg"), NOT
  // a "Actor.<id>" UUID string as first assumed from static source reading — compare against
  // pending.actorId, not pending.actorUuid (which is still stored on the request for possible
  // future display use, but is never the right thing to compare against this field).
  if (pending.actorId !== context.actor) return false;

  const skillSlug = extractSkillSlug(context);
  if (pending.skillSlug !== skillSlug) return false;
  if (!context.outcome) return false; // no DC was entered for this roll — nothing to lock in

  const tier = context.outcome; // PF2e's own 4 outcome strings ARE this feature's irregularity tiers
  const pieces = finalizePieceGeometry(board.pieces, board.cols, board.rows, tier);
  await lockInDifficulty(journalEntry, tier, pieces);
  return true;
}

// Gated on isActiveGM — Foundry core's own idiom for picking exactly one authoritative writer
// among possibly-multiple connected GM clients, so a roll is never resolved twice by two GM
// windows racing each other. A roll made while no GM is connected at all never retroactively
// resolves this way; the manager app's manual-resolve action is the required recovery path.
async function onCreateChatMessage(message) {
  if (!game.user.isActiveGM) return;

  const context = message.flags?.pf2e?.context;
  if (!context || !CHECK_TYPES.has(context.type)) return;

  const index = getPuzzleIndex();
  for (const entry of index.puzzles) {
    const journalEntry = game.journal.get(entry.journalEntryId);
    if (!journalEntry) continue;
    const resolved = await resolvePendingRoll(journalEntry, context);
    if (resolved) break; // a given roll can only lock in ONE puzzle's difficulty
  }
}

// The roll-request chat card's own flag is a write-once display cache (actorId/dc/skillSlug) set
// once by the manager app at post time — separate from the journal entry's own pendingRollRequest,
// which is the actual correlation source of truth. This only wires the GM-only soft-hidden DC line
// and the optional "Roll Now" convenience button; there's no claim/attempt state to track on this
// card the way every sibling feature's request card has, since nothing further happens to the
// message itself once posted.
function renderRollRequestCard(message, element) {
  const request = message.getFlag(FLAG_SCOPE, 'rollRequest');
  if (!request) return;

  const gmDcEl = element.querySelector('[data-puzzle-board-gm-dc]');
  if (gmDcEl) {
    gmDcEl.style.display = game.user.isGM ? '' : 'none';
    gmDcEl.textContent = game.user.isGM
      ? game.i18n.format('pf2e-customizations.puzzleBoard.card.gmOnlyDc', { dc: request.dc })
      : '';
  }

  const actor = game.actors.get(request.actorId);
  const rollButton = element.querySelector('[data-puzzle-board-action="rollNow"]');
  if (!rollButton) return;

  if (!actor?.isOwner) {
    rollButton.style.display = 'none';
    return;
  }

  rollButton.addEventListener('click', async () => {
    // First use of Statistic#roll() called from outside a character sheet in this codebase — a
    // nice-to-have convenience only. The safe fallback (rolling the skill directly from the sheet,
    // told to the player in the card's own request sentence) needs no new API surface at all.
    const statistic = actor.getStatistic(request.skillSlug);
    if (!statistic) {
      ui.notifications.error(game.i18n.localize('pf2e-customizations.puzzleBoard.card.rollFailed'));
      return;
    }
    await statistic.roll({ dc: { value: request.dc } });
  });
}

// Posted once by the manager app's reveal action (see puzzle-board-manager-app.js); every
// connected player sees this and can open the puzzle straight from the card, rather than needing
// to already know to run the "open puzzle board" macro.
function renderRevealCard(message, element) {
  const info = message.getFlag(FLAG_SCOPE, 'reveal');
  if (!info) return;

  element.querySelector('[data-puzzle-board-action="open"]')
    ?.addEventListener('click', () => PuzzleBoardApp.run({ journalEntryId: info.journalEntryId }));
}

function onRenderChatMessage(message, html) {
  const element = html instanceof HTMLElement ? html : html[0];
  renderRollRequestCard(message, element);
  renderRevealCard(message, element);
}

export function initPuzzleBoard() {
  Hooks.on('createChatMessage', onCreateChatMessage);
  Hooks.on('renderChatMessageHTML', onRenderChatMessage);
}
