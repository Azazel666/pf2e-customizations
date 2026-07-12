import { TimelinePuzzleApp } from './timeline-puzzle-app.js';
import {
  clueModeForNeededRoll,
  eventCountForDc,
  generateClueDescriptors,
  liveTotalPcStat,
  neededRollForDc,
  sampleTrueOrder,
  shuffleDisplayOrderDifferentFrom,
} from './timeline-puzzle-logic.js';

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
  return actor?.getFlag(FLAG_SCOPE, `timelinePuzzle.${messageId}`) ?? { claimedBy: null, resolved: null };
}

async function setAttemptState(actor, messageId, patch) {
  const current = getAttemptState(actor, messageId);
  await actor.setFlag(FLAG_SCOPE, `timelinePuzzle.${messageId}`, { ...current, ...patch });
}

function statusHtml(state, actor) {
  const i18n = (key) => game.i18n.localize(`pf2e-customizations.timelinePuzzle.card.${key}`);
  const isOwner = actor?.isOwner ?? false;

  if (state.resolved === 'criticalSuccess' || state.resolved === 'success') {
    return `<p class="timeline-puzzle-card-outcome is-success">${i18n(state.resolved)}</p>`;
  }

  // Unlike lock-picking, criticalFailure has no lockout/reset flow here — every outcome (including
  // criticalFailure) stays freely re-attemptable via a fresh GM request.
  const failureNote = (state.resolved === 'failure' || state.resolved === 'criticalFailure')
    ? `<p class="timeline-puzzle-card-outcome is-failure">${i18n(state.resolved)}</p>`
    : '';

  if (!isOwner) return failureNote;

  if (state.claimedBy) {
    const label = state.claimedBy === game.user.id
      ? i18n('inProgressSelf')
      : game.i18n.format('pf2e-customizations.timelinePuzzle.card.inProgress', {
          name: escapeHtml(game.users.get(state.claimedBy)?.name ?? '?'),
        });
    return `${failureNote}<p class="timeline-puzzle-card-status-text">${label}</p>`;
  }

  return `${failureNote}<button type="button" data-timeline-puzzle-action="attempt">${i18n('attempt')}</button>`;
}

async function onAttempt(message, config, actor) {
  const current = getAttemptState(actor, message.id);
  if (current.claimedBy) {
    ui.notifications.warn(game.i18n.localize('pf2e-customizations.timelinePuzzle.card.alreadyClaimed'));
    return;
  }

  await setAttemptState(actor, message.id, { claimedBy: game.user.id });
  const settled = getAttemptState(actor, message.id);
  if (settled.claimedBy !== game.user.id) {
    ui.notifications.warn(game.i18n.localize('pf2e-customizations.timelinePuzzle.card.alreadyClaimed'));
    return;
  }

  // Generated fresh on every attempt (not baked into the message at request time) — so
  // re-attempting the same request, including after cancelling, is a genuinely new puzzle each
  // time, not a replay of the first one. neededRoll/clueMode are also read live here, using the
  // actor's current stat, same live-read philosophy as baseTimeAllowanceSeconds in the app itself.
  const totalPcStat = liveTotalPcStat(actor, config.skillSlug, config.circumstanceMod);
  const eventCount = eventCountForDc(config.dc);
  const solutionOrder = sampleTrueOrder(eventCount);
  const displayOrder = shuffleDisplayOrderDifferentFrom(solutionOrder);
  const neededRoll = neededRollForDc(config.dc, totalPcStat);
  const clueMode = clueModeForNeededRoll(neededRoll);
  const clues = generateClueDescriptors(solutionOrder, clueMode);

  const result = await TimelinePuzzleApp.run({
    actor,
    skillSlug: config.skillSlug,
    circumstanceMod: config.circumstanceMod,
    allowCriticalOutcomes: config.allowCriticalOutcomes,
    eventCount,
    solutionOrder,
    displayOrder,
    clues,
  });

  const patch = { claimedBy: null };
  if (result.attempted) patch.resolved = result.outcome;
  await setAttemptState(actor, message.id, patch);
}

function renderCard(message, element) {
  const config = message.getFlag(FLAG_SCOPE, 'timelinePuzzle');
  if (!config) return;

  const actor = game.actors.get(config.actorId);

  // The DC is never shown to players — only rendered into this client's own DOM when the viewing
  // user is a GM, never written into the message's stored (shared) content. Same mechanism as
  // lock-picking's GM-only DC line: display:none set here in JS, not via CSS.
  const gmDcEl = element.querySelector('[data-timeline-puzzle-gm-dc]');
  if (gmDcEl) {
    gmDcEl.style.display = game.user.isGM ? '' : 'none';
    gmDcEl.textContent = game.user.isGM
      ? game.i18n.format('pf2e-customizations.timelinePuzzle.card.gmOnlyDc', { dc: config.dc })
      : '';
  }

  const container = element.querySelector('[data-timeline-puzzle-status]');
  if (!container) return;

  const state = getAttemptState(actor, message.id);
  container.innerHTML = statusHtml(state, actor);

  container.querySelector('[data-timeline-puzzle-action="attempt"]')
    ?.addEventListener('click', () => onAttempt(message, config, actor));
}

function onRenderChatMessage(message, html) {
  const element = html instanceof HTMLElement ? html : html[0];
  renderCard(message, element);
}

// Updating actor flags doesn't trigger a chat re-render on its own (unlike updating the message
// itself would), so any currently-displayed timeline-puzzle card for this actor is refreshed by hand.
function onUpdateActor(actor, changes) {
  if (!foundry.utils.hasProperty(changes, `flags.${FLAG_SCOPE}.timelinePuzzle`)) return;

  for (const message of game.messages) {
    const config = message.getFlag(FLAG_SCOPE, 'timelinePuzzle');
    if (!config || config.actorId !== actor.id) continue;
    const element = document.querySelector(`[data-message-id="${message.id}"]`);
    if (element) renderCard(message, element);
  }
}

export function initTimelinePuzzle() {
  // v13-native hook; passes an HTMLElement. If the card never gains its status area, this may need
  // to fall back to the legacy jQuery-based "renderChatMessage" hook instead.
  Hooks.on('renderChatMessageHTML', onRenderChatMessage);
  Hooks.on('updateActor', onUpdateActor);
}
