import { PuzzleBoardManagerApp } from '../features/puzzle-board/puzzle-board-manager-app.js';

function managePuzzleBoards() {
  const i18n = (key) => game.i18n.localize(`pf2e-customizations.macro.managePuzzleBoards.${key}`);

  if (!game.user.isGM) {
    ui.notifications.warn(i18n('gmOnly'));
    return;
  }

  if (!game.settings.get('pf2e-customizations', 'puzzleBoardEnabled')) {
    ui.notifications.warn(i18n('disabled'));
    return;
  }

  PuzzleBoardManagerApp.show();
}

export function initManagePuzzleBoardsMacro() {
  globalThis.pf2eCustomizations ??= {};
  globalThis.pf2eCustomizations.managePuzzleBoards = managePuzzleBoards;
}
