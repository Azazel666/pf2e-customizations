import { getPuzzleIndex } from '../features/puzzle-board/puzzle-board-data.js';
import { PuzzleBoardApp } from '../features/puzzle-board/puzzle-board-app.js';

// Player-facing, unlike every sibling feature's request macro — any player runs this, not just
// the GM, per the locked design ("players pick from a list of revealed puzzles, auto-load if only
// one exists").
async function openPuzzleBoard() {
  const i18n = (key) => game.i18n.localize(`pf2e-customizations.macro.openPuzzleBoard.${key}`);

  if (!game.settings.get('pf2e-customizations', 'puzzleBoardEnabled')) {
    ui.notifications.warn(i18n('disabled'));
    return;
  }

  const index = getPuzzleIndex();
  const revealed = index.puzzles.filter((p) => p.revealed);

  if (!revealed.length) {
    ui.notifications.warn(i18n('noneRevealed'));
    return;
  }

  if (revealed.length === 1) {
    await PuzzleBoardApp.run({ journalEntryId: revealed[0].journalEntryId });
    return;
  }

  const options = revealed.map((p) => `<option value="${p.journalEntryId}">${p.name}</option>`).join('');
  const journalEntryId = await new Promise((resolve) => {
    new Dialog({
      title: i18n('title'),
      content: `
        <form>
          <div class="form-group">
            <label>${i18n('choosePuzzle')}</label>
            <div class="form-fields"><select name="journalEntryId">${options}</select></div>
          </div>
        </form>
      `,
      buttons: {
        open: { label: i18n('open'), callback: (html) => resolve(html[0].querySelector('[name="journalEntryId"]').value) },
        cancel: { label: i18n('cancel'), callback: () => resolve(null) },
      },
      default: 'open',
    }).render(true);
  });

  if (!journalEntryId) return;
  await PuzzleBoardApp.run({ journalEntryId });
}

export function initOpenPuzzleBoardMacro() {
  globalThis.pf2eCustomizations ??= {};
  globalThis.pf2eCustomizations.openPuzzleBoard = openPuzzleBoard;
}
