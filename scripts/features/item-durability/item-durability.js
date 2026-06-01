// Physical item types that have hp/hardness in the data model but no sheet UI.
// Shields are excluded — they already display these fields natively.
const SUPPORTED_TYPES = ['weapon', 'equipment', 'backpack', 'treasure', 'consumable'];

function injectDurabilityFields(app, html) {
  const item = app.document ?? app.item;
  if (!item || !SUPPORTED_TYPES.includes(item.type)) return;

  // html is HTMLElement in ApplicationV2; fall back to [0] if jQuery is passed
  const element = html instanceof HTMLElement ? html : html[0];

  // Scope to the details tab to avoid matching mystify-panel.hbs's own .basics fieldset.
  const detailsTab = element.querySelector('section[data-tab="details"]');
  if (!detailsTab) return;
  const basics = detailsTab.querySelector('.basics');
  const publication = detailsTab.querySelector('fieldset.publication');
  if (!basics && !publication) return;
  const [target, position] = basics ? [basics, 'beforeend'] : [publication, 'beforebegin'];

  // Guard against re-injection on repeated renders
  if (detailsTab.querySelector('.item-durability-fields')) return;

  const hp = item.system.hp ?? { value: 0, max: 0, brokenThreshold: 0 };
  const hardness = item.system.hardness ?? 0;

  target.insertAdjacentHTML(position, `
    <div class="item-durability-fields">
      <div class="form-group">
        <label>${game.i18n.localize('pf2e-customizations.durability.hp')}</label>
        <div class="form-fields">
          <input type="number" data-property="system.hp.value" value="${hp.value}" min="0">
          <span class="sep">/</span>
          <input type="number" data-property="system.hp.max" value="${hp.max}" min="0">
        </div>
      </div>
      <div class="form-group">
        <label>${game.i18n.localize('pf2e-customizations.durability.hardness')}</label>
        <input type="number" data-property="system.hardness" value="${hardness}" min="0">
      </div>
      <div class="form-group">
        <label>${game.i18n.localize('pf2e-customizations.durability.bt')}</label>
        <input type="number" data-property="system.hp.brokenThreshold" value="${hp.brokenThreshold}" min="0">
      </div>
    </div>
  `);

  // Dynamically injected inputs are outside PF2e's normal save flow, so we update directly.
  detailsTab.querySelector('.item-durability-fields').addEventListener('change', (event) => {
    const input = event.target.closest('input[data-property]');
    if (!input) return;
    const value = Number(input.value);
    if (isNaN(value)) return;
    item.update({ [input.dataset.property]: value });
  });
}

export function initItemDurability() {
  // "renderItemSheetPF2e" fires for all PF2e item sheets in v13 (ApplicationV2).
  // If the fields don't appear, the hook name may differ — try "renderPhysicalItemSheetPF2e"
  // or per-class hooks ("renderWeaponSheetPF2e", etc.) as fallbacks.
  Hooks.on('renderItemSheetPF2e', injectDurabilityFields);
}
