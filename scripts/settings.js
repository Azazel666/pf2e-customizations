export function registerSettings() {
  game.settings.register('pf2e-customizations', 'itemDurabilityEnabled', {
    name: 'pf2e-customizations.settings.itemDurability.name',
    hint: 'pf2e-customizations.settings.itemDurability.hint',
    scope: 'world',
    config: true,
    type: Boolean,
    default: true,
    requiresReload: true,
  });
}
