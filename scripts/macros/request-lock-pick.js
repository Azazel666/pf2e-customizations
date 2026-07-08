import { LOCK_TIERS, pinCountForDc, dcTierLabelForDc } from '../features/lock-picking/lock-picking-logic.js';

const CHAT_CARD_TEMPLATE = 'modules/pf2e-customizations/scripts/features/lock-picking/lock-picking-chat-card.hbs';

function buildTierOptions() {
  const tierOptions = LOCK_TIERS.map((tier) => {
    const label = game.i18n.localize(`pf2e-customizations.lockPicking.tier.${tier.key}`);
    return `<option value="${tier.dc}">${label} (DC ${tier.dc})</option>`;
  }).join('');
  const customLabel = game.i18n.localize('pf2e-customizations.macro.requestLockPick.customDc');
  return `${tierOptions}<option value="custom">${customLabel}</option>`;
}

async function requestLockPick() {
  const i18n = (key) => game.i18n.localize(`pf2e-customizations.macro.requestLockPick.${key}`);

  if (!game.user.isGM) {
    ui.notifications.warn(i18n('gmOnly'));
    return;
  }

  if (!game.settings.get('pf2e-customizations', 'lockPickingEnabled')) {
    ui.notifications.warn(i18n('disabled'));
    return;
  }

  const controlledToken = canvas.tokens?.controlled[0];
  const pcActors = game.actors
    .filter((a) => a.type === 'character' && a.hasPlayerOwner)
    .sort((a, b) => a.name.localeCompare(b.name));

  if (!pcActors.length) {
    ui.notifications.warn(i18n('noActors'));
    return;
  }

  const controlledActor = controlledToken?.actor;
  const initialActor = (controlledActor?.type === 'character' && controlledActor.hasPlayerOwner)
    ? controlledActor
    : pcActors[0];

  const actorOptions = pcActors
    .map((a) => `<option value="${a.id}"${a.id === initialActor.id ? ' selected' : ''}>${a.name}</option>`)
    .join('');

  const content = `
    <form class="pf2e-customizations-macro-form">
      <div class="form-group">
        <label>${i18n('actor')}</label>
        <div class="form-fields">
          <select name="actorId">${actorOptions}</select>
        </div>
      </div>
      <div class="form-group">
        <label>${i18n('lockDifficulty')}</label>
        <div class="form-fields">
          <select name="dcTier">${buildTierOptions()}</select>
        </div>
      </div>
      <div class="form-group" data-custom-dc-group style="display:none;">
        <label>${i18n('customDc')}</label>
        <div class="form-fields">
          <input type="number" name="customDc" value="20" min="1">
        </div>
      </div>
    </form>
  `;

  return new Promise((resolve) => {
    new Dialog({
      title: i18n('title'),
      content,
      buttons: {
        send: {
          label: i18n('send'),
          callback: async (html) => {
            const form = html[0].querySelector('form');
            const data = new FormData(form);
            const actor = game.actors.get(data.get('actorId'));
            const tierValue = data.get('dcTier');
            const dc = tierValue === 'custom' ? Number(data.get('customDc')) : Number(tierValue);

            if (!actor || !Number.isFinite(dc) || dc < 1) {
              ui.notifications.error(i18n('invalidDc'));
              resolve(null);
              return;
            }

            const pinCount = pinCountForDc(dc);
            const tierLabel = game.i18n.localize(`pf2e-customizations.lockPicking.tier.${dcTierLabelForDc(dc)}`);
            const mistakeThreshold = game.settings.get('pf2e-customizations', 'lockPickingMistakeThreshold');

            const cardContent = await renderTemplate(CHAT_CARD_TEMPLATE, { actorName: actor.name, tierLabel, dc });

            // ChatMessage documents have no `ownership` schema field, so players can never be granted
            // write access to a GM-authored message. This message's flags are write-once (set here,
            // read-only afterward); claim/outcome state lives on the actor instead (see lock-picking-chat.js).
            const message = await ChatMessage.create({
              speaker: ChatMessage.getSpeaker({ actor }),
              content: cardContent,
              flags: {
                'pf2e-customizations': {
                  lockPicking: { actorId: actor.id, dc, pinCount, mistakeThreshold },
                },
              },
            });

            resolve(message);
          },
        },
        cancel: {
          label: i18n('cancel'),
          callback: () => resolve(null),
        },
      },
      render: (html) => {
        const root = html[0];
        const tierSelect = root.querySelector('select[name="dcTier"]');
        const customGroup = root.querySelector('[data-custom-dc-group]');
        const toggleCustom = () => {
          customGroup.style.display = tierSelect.value === 'custom' ? '' : 'none';
        };
        tierSelect.addEventListener('change', toggleCustom);
        toggleCustom();
      },
      default: 'send',
    }).render(true);
  });
}

export function initRequestLockPickMacro() {
  globalThis.pf2eCustomizations ??= {};
  globalThis.pf2eCustomizations.requestLockPick = requestLockPick;
}
