const CHAT_CARD_TEMPLATE = 'modules/pf2e-customizations/scripts/features/fact-sifter/fact-sifter-chat-card.hbs';

function skillLabel(skillSlug) {
  if (skillSlug === 'perception') {
    return game.i18n.localize('pf2e-customizations.factSifter.skill.perception');
  }
  return game.i18n.localize(CONFIG.PF2E.skills[skillSlug].label);
}

function buildSkillOptions() {
  const entries = [
    ...Object.entries(CONFIG.PF2E.skills).map(([slug, def]) => ({ slug, label: game.i18n.localize(def.label) })),
    { slug: 'perception', label: game.i18n.localize('pf2e-customizations.factSifter.skill.perception') },
  ];
  entries.sort((a, b) => a.label.localeCompare(b.label));
  return entries.map((entry) => `<option value="${entry.slug}">${entry.label}</option>`).join('');
}

async function requestFactSifter() {
  const i18n = (key) => game.i18n.localize(`pf2e-customizations.macro.requestFactSifter.${key}`);

  if (!game.user.isGM) {
    ui.notifications.warn(i18n('gmOnly'));
    return;
  }

  if (!game.settings.get('pf2e-customizations', 'factSifterEnabled')) {
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
        <label>${i18n('skill')}</label>
        <div class="form-fields">
          <select name="skillSlug">${buildSkillOptions()}</select>
        </div>
      </div>
      <div class="form-group">
        <label>${i18n('dc')}</label>
        <div class="form-fields">
          <input type="number" name="dc" value="20">
        </div>
      </div>
      <div class="form-group">
        <label>${i18n('circumstanceMod')}</label>
        <div class="form-fields">
          <input type="number" name="circumstanceMod" value="0" step="1">
        </div>
      </div>
      <div class="form-group">
        <label>${i18n('allowCriticalOutcomes')}</label>
        <div class="form-fields">
          <input type="checkbox" name="allowCriticalOutcomes" checked>
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
            const skillSlug = data.get('skillSlug');
            const dc = Number(data.get('dc'));
            const circumstanceModRaw = data.get('circumstanceMod');
            const circumstanceMod = circumstanceModRaw === '' ? 0 : Number(circumstanceModRaw);
            const allowCriticalOutcomes = form.querySelector('[name="allowCriticalOutcomes"]').checked;

            if (!actor || !Number.isFinite(dc) || !Number.isFinite(circumstanceMod)) {
              ui.notifications.error(i18n('invalidDc'));
              resolve(null);
              return;
            }

            // DC is used exactly as entered — never clamped. The DC->pool-size table is open-ended
            // at both extremes, so no special-casing is needed for a DC outside 15-40.
            //
            // Only the GM's raw inputs are stored here — the pool (which scenario, which true facts,
            // which noise, shuffle order) is NOT baked in at request time. It's computed fresh every
            // time a player clicks "Attempt" (see onAttempt in fact-sifter-chat.js), so re-attempting
            // the same request — including after cancelling — gets a genuinely new pool each time.
            const cardContent = await renderTemplate(CHAT_CARD_TEMPLATE, {
              actorName: actor.name,
              skillLabel: skillLabel(skillSlug),
            });

            // ChatMessage documents have no `ownership` schema field, so players can never be granted
            // write access to a GM-authored message. This message's flags are write-once (set here,
            // read-only afterward); claim/outcome state lives on the actor instead (see
            // fact-sifter-chat.js).
            const message = await ChatMessage.create({
              speaker: ChatMessage.getSpeaker({ actor }),
              content: cardContent,
              flags: {
                'pf2e-customizations': {
                  factSifter: {
                    actorId: actor.id,
                    dc,
                    skillSlug,
                    circumstanceMod,
                    allowCriticalOutcomes,
                  },
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
      default: 'send',
    }).render(true);
  });
}

export function initRequestFactSifterMacro() {
  globalThis.pf2eCustomizations ??= {};
  globalThis.pf2eCustomizations.requestFactSifter = requestFactSifter;
}
