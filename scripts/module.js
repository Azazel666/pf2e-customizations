import { registerSettings } from './settings.js';
import { initItemDurability } from './features/item-durability/item-durability.js';
import { initSetItemDurabilityMacro } from './macros/set-item-durability.js';
import { initApplyItemDamageMacro } from './macros/apply-item-damage.js';

Hooks.once('init', () => {
  registerSettings();

  if (game.settings.get('pf2e-customizations', 'itemDurabilityEnabled')) {
    initItemDurability();
  }

  initSetItemDurabilityMacro();
  initApplyItemDamageMacro();
});
