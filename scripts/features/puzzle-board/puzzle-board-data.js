import { computeBoardFrame, generatePieceLayout } from './puzzle-board-logic.js';

const FLAG_SCOPE = 'pf2e-customizations';
const FLAG_KEY = 'puzzleBoard';
const INDEX_SETTING = 'puzzleBoardIndex';
const FOLDER_NAME = 'Puzzle Board Data';

// The index is deliberately thin (id/name/journalEntryId/revealed/createdAt only) and is only ever
// written by explicit GM actions in the manager app — world-scope settings require the
// SETTINGS_MODIFY permission, GM-only by default, so this is never something a player writes.
// Anything that changes as a side effect of play (difficultyTier, solved, pieces) lives on the
// puzzle's own JournalEntry instead, read directly whenever it's needed.
export function getPuzzleIndex() {
  return game.settings.get(FLAG_SCOPE, INDEX_SETTING);
}

async function setPuzzleIndex(index) {
  await game.settings.set(FLAG_SCOPE, INDEX_SETTING, index);
}

async function ensurePuzzleBoardFolder() {
  const existing = game.folders.find((f) => f.type === 'JournalEntry' && f.name === FOLDER_NAME);
  if (existing) return existing;
  return Folder.create({ name: FOLDER_NAME, type: 'JournalEntry', parent: null });
}

export function getPuzzleBoard(journalEntry) {
  return journalEntry?.getFlag(FLAG_SCOPE, FLAG_KEY) ?? null;
}

// Creates the puzzle's backing JournalEntry (status: 'draft') and registers it in the index. Image
// resolution/preload is the caller's responsibility (mirrors request-jigsaw-puzzle.js's own
// preloadImage() pattern) — this function only needs the already-resolved imagePath/aspectRatio.
export async function createPuzzle({ name, imagePath, aspectRatio, requestedPieceCount, cols, rows, pieceCount }) {
  const folder = await ensurePuzzleBoardFolder();
  const boardFrame = computeBoardFrame(aspectRatio);
  const pieces = generatePieceLayout({ cols, rows, frame: boardFrame });
  const puzzleId = foundry.utils.randomID();

  const journalEntry = await JournalEntry.create({
    name,
    folder: folder.id,
    pages: [{
      name,
      type: 'text',
      text: {
        content: `<p>${game.i18n.localize('pf2e-customizations.puzzleBoard.journalPlaceholder')}</p>`,
      },
    }],
    flags: {
      [FLAG_SCOPE]: {
        [FLAG_KEY]: {
          version: 1,
          puzzleId,
          name,
          status: 'draft',
          imagePath,
          aspectRatio,
          requestedPieceCount,
          cols,
          rows,
          pieceCount,
          ...boardFrame,
          difficultyTier: null,
          pendingRollRequest: null,
          pieces,
          solved: false,
          solvedAt: null,
        },
      },
    },
  });

  const index = getPuzzleIndex();
  index.puzzles.push({
    id: puzzleId,
    name,
    journalEntryId: journalEntry.id,
    revealed: false,
    createdAt: Date.now(),
  });
  await setPuzzleIndex(index);

  return journalEntry;
}

export async function renamePuzzle(journalEntry, name) {
  const index = getPuzzleIndex();
  const entry = index.puzzles.find((p) => p.journalEntryId === journalEntry.id);
  if (entry) {
    entry.name = name;
    await setPuzzleIndex(index);
  }
  await journalEntry.update({ name, [`flags.${FLAG_SCOPE}.${FLAG_KEY}.name`]: name });
}

export async function deletePuzzle(journalEntry) {
  const index = getPuzzleIndex();
  index.puzzles = index.puzzles.filter((p) => p.journalEntryId !== journalEntry.id);
  await setPuzzleIndex(index);
  await journalEntry.delete();
}

export async function setPendingRollRequest(journalEntry, pendingRollRequest) {
  await journalEntry.update({
    [`flags.${FLAG_SCOPE}.${FLAG_KEY}.pendingRollRequest`]: pendingRollRequest,
    [`flags.${FLAG_SCOPE}.${FLAG_KEY}.status`]: pendingRollRequest ? 'awaiting-roll' : 'draft',
  });
}

export async function lockInDifficulty(journalEntry, tier, pieces) {
  await journalEntry.update({
    [`flags.${FLAG_SCOPE}.${FLAG_KEY}.difficultyTier`]: tier,
    [`flags.${FLAG_SCOPE}.${FLAG_KEY}.status`]: 'ready',
    [`flags.${FLAG_SCOPE}.${FLAG_KEY}.pendingRollRequest`]: null,
    [`flags.${FLAG_SCOPE}.${FLAG_KEY}.pieces`]: pieces,
  });
}

// The single highest-risk call in this feature (see CLAUDE.md): granting broad ownership is what
// lets any subsequent player client legally call .setFlag() on this document directly, with no
// socket-relay plumbing. Must only ever be called by a GM (the manager app already gates this).
export async function revealPuzzle(journalEntry) {
  await journalEntry.update({ ownership: { default: CONST.DOCUMENT_OWNERSHIP_LEVELS.OWNER } });
  await journalEntry.setFlag(FLAG_SCOPE, `${FLAG_KEY}.status`, 'revealed');

  const index = getPuzzleIndex();
  const entry = index.puzzles.find((p) => p.journalEntryId === journalEntry.id);
  if (entry) {
    entry.revealed = true;
    await setPuzzleIndex(index);
  }
}

// Scoped dotted-path write, stopping at `.current`/`.placed` specifically — NOT at the piece's own
// key. Foundry's update merges nested plain objects at the exact dotted path given, so writing at
// the piece-level key (`pieces.<id>`) would replace the WHOLE piece object, wiping out its
// `target`/`polygon`/`bbox` (siblings of `current`/`placed`, never meant to change here). Ending
// the path one level deeper touches only these two leaves, so two different players dragging two
// different pieces at the same moment land independently instead of clobbering each other (see
// CLAUDE.md). Any client with real OWNER permission on the document — i.e. any player, once
// revealPuzzle() has run — can call this directly.
export async function setPieceCurrent(journalEntry, pieceId, { current, placed }) {
  await journalEntry.update({
    [`flags.${FLAG_SCOPE}.${FLAG_KEY}.pieces.${pieceId}.current`]: current,
    [`flags.${FLAG_SCOPE}.${FLAG_KEY}.pieces.${pieceId}.placed`]: placed,
  });
}

export async function markSolved(journalEntry) {
  await journalEntry.update({
    [`flags.${FLAG_SCOPE}.${FLAG_KEY}.solved`]: true,
    [`flags.${FLAG_SCOPE}.${FLAG_KEY}.solvedAt`]: Date.now(),
  });
}
