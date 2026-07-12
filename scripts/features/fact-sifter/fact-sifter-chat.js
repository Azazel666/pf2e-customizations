import { FactSifterApp } from './fact-sifter-app.js';
import { FACT_CHAIN_BANK, generateAttempt } from './fact-sifter-logic.js';

const FLAG_SCOPE = 'pf2e-customizations';

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[char]);
}

// ChatMessage documents have no `ownership` schema field in v13, so a player can never be granted
// write access to a GM-authored message. Claim/outcome state instead lives on the acting actor's
// flags (namespaced per message id) since the owning player already has real OWNER permission there.
function getAttemptState(actor, messageId) {
  return actor?.getFlag(FLAG_SCOPE, `factSifter.${messageId}`) ?? { claimedBy: null, resolved: null };
}

async function setAttemptState(actor, messageId, patch) {
  const current = getAttemptState(actor, messageId);
  await actor.setFlag(FLAG_SCOPE, `factSifter.${messageId}`, { ...current, ...patch });
}

function statusHtml(state, actor) {
  const i18n = (key) => game.i18n.localize(`pf2e-customizations.factSifter.card.${key}`);
  const isOwner = actor?.isOwner ?? false;

  if (state.resolved === 'criticalSuccess' || state.resolved === 'success') {
    return `<p class="fact-sifter-card-outcome is-success">${i18n(state.resolved)}</p>`;
  }

  // No lockout/reset flow — every outcome (including criticalFailure) stays freely re-attemptable
  // via a fresh GM request.
  const failureNote = (state.resolved === 'failure' || state.resolved === 'criticalFailure')
    ? `<p class="fact-sifter-card-outcome is-failure">${i18n(state.resolved)}</p>`
    : '';

  if (!isOwner) return failureNote;

  if (state.claimedBy) {
    const label = state.claimedBy === game.user.id
      ? i18n('inProgressSelf')
      : game.i18n.format('pf2e-customizations.factSifter.card.inProgress', {
          name: escapeHtml(game.users.get(state.claimedBy)?.name ?? '?'),
        });
    return `${failureNote}<p class="fact-sifter-card-status-text">${label}</p>`;
  }

  return `${failureNote}<button type="button" data-fact-sifter-action="attempt">${i18n('attempt')}</button>`;
}

async function onAttempt(message, config, actor) {
  const current = getAttemptState(actor, message.id);
  if (current.claimedBy) {
    ui.notifications.warn(game.i18n.localize('pf2e-customizations.factSifter.card.alreadyClaimed'));
    return;
  }

  await setAttemptState(actor, message.id, { claimedBy: game.user.id });
  const settled = getAttemptState(actor, message.id);
  if (settled.claimedBy !== game.user.id) {
    ui.notifications.warn(game.i18n.localize('pf2e-customizations.factSifter.card.alreadyClaimed'));
    return;
  }

  // Generated fresh on every attempt (not baked into the message at request time) — so
  // re-attempting the same request, including after cancelling, is a genuinely new pool each time.
  const { fragments, closingLead } = generateAttempt({ dc: config.dc, factChainBank: FACT_CHAIN_BANK });

  const result = await FactSifterApp.run({
    actor,
    skillSlug: config.skillSlug,
    circumstanceMod: config.circumstanceMod,
    allowCriticalOutcomes: config.allowCriticalOutcomes,
    pool: fragments,
    closingLead,
  });

  const patch = { claimedBy: null };
  if (result.attempted) patch.resolved = result.outcome;
  await setAttemptState(actor, message.id, patch);
}

function renderCard(message, element) {
  const config = message.getFlag(FLAG_SCOPE, 'factSifter');
  if (!config) return;

  // The DC is never shown to players — only rendered into this client's own DOM when the viewing
  // user is a GM, never written into the message's stored (shared) content. Same minimal format as
  // lock-picking/alibi-matrix's GM-only line: display:none set here in JS, not via CSS.
  const gmDcEl = element.querySelector('[data-fact-sifter-gm-dc]');
  if (gmDcEl) {
    gmDcEl.style.display = game.user.isGM ? '' : 'none';
    gmDcEl.textContent = game.user.isGM
      ? game.i18n.format('pf2e-customizations.factSifter.card.gmOnlyDc', { dc: config.dc })
      : '';
  }

  const container = element.querySelector('[data-fact-sifter-status]');
  if (!container) return;

  const actor = game.actors.get(config.actorId);
  const state = getAttemptState(actor, message.id);
  container.innerHTML = statusHtml(state, actor);

  container.querySelector('[data-fact-sifter-action="attempt"]')
    ?.addEventListener('click', () => onAttempt(message, config, actor));
}

function onRenderChatMessage(message, html) {
  const element = html instanceof HTMLElement ? html : html[0];
  renderCard(message, element);
}

// Updating actor flags doesn't trigger a chat re-render on its own (unlike updating the message
// itself would), so any currently-displayed fact-sifter card for this actor is refreshed by hand.
function onUpdateActor(actor, changes) {
  if (!foundry.utils.hasProperty(changes, `flags.${FLAG_SCOPE}.factSifter`)) return;

  for (const message of game.messages) {
    const config = message.getFlag(FLAG_SCOPE, 'factSifter');
    if (!config || config.actorId !== actor.id) continue;
    const element = document.querySelector(`[data-message-id="${message.id}"]`);
    if (element) renderCard(message, element);
  }
}

export function initFactSifter() {
  // v13-native hook; passes an HTMLElement. If the card never gains its status area, this may need
  // to fall back to the legacy jQuery-based "renderChatMessage" hook instead.
  Hooks.on('renderChatMessageHTML', onRenderChatMessage);
  Hooks.on('updateActor', onUpdateActor);
}
