import { AlibiMatrixApp } from './alibi-matrix-app.js';
import {
  generateAttempt,
  liveTotalPcStat,
  MOTIVE_BANK,
  ROOM_BANK,
  SUSPECT_BANK,
} from './alibi-matrix-logic.js';

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
  return actor?.getFlag(FLAG_SCOPE, `alibiMatrix.${messageId}`) ?? { claimedBy: null, resolved: null };
}

async function setAttemptState(actor, messageId, patch) {
  const current = getAttemptState(actor, messageId);
  await actor.setFlag(FLAG_SCOPE, `alibiMatrix.${messageId}`, { ...current, ...patch });
}

function statusHtml(state, actor) {
  const i18n = (key) => game.i18n.localize(`pf2e-customizations.alibiMatrix.card.${key}`);
  const isOwner = actor?.isOwner ?? false;

  if (state.resolved === 'criticalSuccess' || state.resolved === 'success') {
    return `<p class="alibi-matrix-card-outcome is-success">${i18n(state.resolved)}</p>`;
  }

  // No lockout/reset flow — every outcome (including criticalFailure) stays freely re-attemptable
  // via a fresh GM request.
  const failureNote = (state.resolved === 'failure' || state.resolved === 'criticalFailure')
    ? `<p class="alibi-matrix-card-outcome is-failure">${i18n(state.resolved)}</p>`
    : '';

  if (!isOwner) return failureNote;

  if (state.claimedBy) {
    const label = state.claimedBy === game.user.id
      ? i18n('inProgressSelf')
      : game.i18n.format('pf2e-customizations.alibiMatrix.card.inProgress', {
          name: escapeHtml(game.users.get(state.claimedBy)?.name ?? '?'),
        });
    return `${failureNote}<p class="alibi-matrix-card-status-text">${label}</p>`;
  }

  return `${failureNote}<button type="button" data-alibi-matrix-action="attempt">${i18n('attempt')}</button>`;
}

async function onAttempt(message, config, actor) {
  const current = getAttemptState(actor, message.id);
  if (current.claimedBy) {
    ui.notifications.warn(game.i18n.localize('pf2e-customizations.alibiMatrix.card.alreadyClaimed'));
    return;
  }

  await setAttemptState(actor, message.id, { claimedBy: game.user.id });
  const settled = getAttemptState(actor, message.id);
  if (settled.claimedBy !== game.user.id) {
    ui.notifications.warn(game.i18n.localize('pf2e-customizations.alibiMatrix.card.alreadyClaimed'));
    return;
  }

  // Generated fresh on every attempt (not baked into the message at request time) — so
  // re-attempting the same request, including after cancelling, is a genuinely new matrix each
  // time, not a replay of the first one.
  const totalPcStat = liveTotalPcStat(actor, config.skillSlug, config.circumstanceMod);
  const attempt = generateAttempt({
    dc: config.dc,
    totalPcStat,
    suspectBank: SUSPECT_BANK,
    roomBank: ROOM_BANK,
    motiveBank: MOTIVE_BANK,
  });

  const result = await AlibiMatrixApp.run({
    actor,
    skillSlug: config.skillSlug,
    circumstanceMod: config.circumstanceMod,
    allowCriticalOutcomes: config.allowCriticalOutcomes,
    categoryCount: attempt.categoryCount,
    n: attempt.n,
    grids: attempt.grids,
    negativeClues: attempt.negativeClues,
    connectedClues: attempt.connectedClues,
    solution: attempt.solution,
  });

  const patch = { claimedBy: null };
  if (result.attempted) patch.resolved = result.outcome;
  await setAttemptState(actor, message.id, patch);
}

function renderCard(message, element) {
  const config = message.getFlag(FLAG_SCOPE, 'alibiMatrix');
  if (!config) return;

  // The DC is never shown to players — only rendered into this client's own DOM when the viewing
  // user is a GM, never written into the message's stored (shared) content. Kept minimal (just the
  // DC, matching lock-picking's exact format) — an earlier version of the timeline puzzle's card
  // also showed a computed preview here and it read as confusing for little benefit.
  const gmDcEl = element.querySelector('[data-alibi-matrix-gm-dc]');
  if (gmDcEl) {
    gmDcEl.style.display = game.user.isGM ? '' : 'none';
    gmDcEl.textContent = game.user.isGM
      ? game.i18n.format('pf2e-customizations.alibiMatrix.card.gmOnlyDc', { dc: config.dc })
      : '';
  }

  const container = element.querySelector('[data-alibi-matrix-status]');
  if (!container) return;

  const actor = game.actors.get(config.actorId);
  const state = getAttemptState(actor, message.id);
  container.innerHTML = statusHtml(state, actor);

  container.querySelector('[data-alibi-matrix-action="attempt"]')
    ?.addEventListener('click', () => onAttempt(message, config, actor));
}

function onRenderChatMessage(message, html) {
  const element = html instanceof HTMLElement ? html : html[0];
  renderCard(message, element);
}

// Updating actor flags doesn't trigger a chat re-render on its own (unlike updating the message
// itself would), so any currently-displayed alibi-matrix card for this actor is refreshed by hand.
function onUpdateActor(actor, changes) {
  if (!foundry.utils.hasProperty(changes, `flags.${FLAG_SCOPE}.alibiMatrix`)) return;

  for (const message of game.messages) {
    const config = message.getFlag(FLAG_SCOPE, 'alibiMatrix');
    if (!config || config.actorId !== actor.id) continue;
    const element = document.querySelector(`[data-message-id="${message.id}"]`);
    if (element) renderCard(message, element);
  }
}

export function initAlibiMatrix() {
  // v13-native hook; passes an HTMLElement. If the card never gains its status area, this may need
  // to fall back to the legacy jQuery-based "renderChatMessage" hook instead.
  Hooks.on('renderChatMessageHTML', onRenderChatMessage);
  Hooks.on('updateActor', onUpdateActor);
}
