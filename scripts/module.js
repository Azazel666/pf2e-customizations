import { registerSettings } from './settings.js';
import { initItemDurability } from './features/item-durability/item-durability.js';
import { initLockPicking } from './features/lock-picking/lock-picking-chat.js';
import { initTimelinePuzzle } from './features/timeline-puzzle/timeline-puzzle-chat.js';
import { initAlibiMatrix } from './features/alibi-matrix/alibi-matrix-chat.js';
import { initSetItemDurabilityMacro } from './macros/set-item-durability.js';
import { initApplyItemDamageMacro } from './macros/apply-item-damage.js';
import { initRequestLockPickMacro } from './macros/request-lock-pick.js';
import { initRequestTimelinePuzzleMacro } from './macros/request-timeline-puzzle.js';
import { initRequestAlibiMatrixMacro } from './macros/request-alibi-matrix.js';

Hooks.once('init', () => {
  registerSettings();

  if (game.settings.get('pf2e-customizations', 'itemDurabilityEnabled')) {
    initItemDurability();
  }

  if (game.settings.get('pf2e-customizations', 'lockPickingEnabled')) {
    initLockPicking();
  }

  if (game.settings.get('pf2e-customizations', 'timelinePuzzleEnabled')) {
    initTimelinePuzzle();
  }

  if (game.settings.get('pf2e-customizations', 'alibiMatrixEnabled')) {
    initAlibiMatrix();
  }

  initSetItemDurabilityMacro();
  initApplyItemDamageMacro();
  initRequestLockPickMacro();
  initRequestTimelinePuzzleMacro();
  initRequestAlibiMatrixMacro();
});
