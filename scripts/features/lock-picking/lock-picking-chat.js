import { windowWidthPercentForDiff } from './lock-picking-logic.js';
import { LockPickingApp } from './lock-picking-app.js';

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
  return actor?.getFlag(FLAG_SCOPE, `lockPicking.${messageId}`) ?? { claimedBy: null, resolved: null };
}

async function setAttemptState(actor, messageId, patch) {
  const current = getAttemptState(actor, messageId);
  await actor.setFlag(FLAG_SCOPE, `lockPicking.${messageId}`, { ...current, ...patch });
}

function statusHtml(config, state, actor) {
  const i18n = (key) => game.i18n.localize(`pf2e-customizations.lockPicking.card.${key}`);
  const isOwner = actor?.isOwner ?? false;

  if (state.resolved === 'criticalSuccess' || state.resolved === 'success') {
    return `<p class="lock-picking-card-outcome is-success">${i18n(state.resolved)}</p>`;
  }

  if (state.resolved === 'criticalFailure') {
    const resetButton = game.user.isGM
      ? `<button type="button" data-lock-picking-action="reset">${i18n('reset')}</button>`
      : '';
    return `<p class="lock-picking-card-outcome is-failure">${i18n('criticalFailure')}</p>${resetButton}`;
  }

  const failureNote = state.resolved === 'failure'
    ? `<p class="lock-picking-card-outcome is-failure">${i18n('failure')}</p>`
    : '';

  if (!isOwner) return failureNote;

  if (state.claimedBy) {
    const label = state.claimedBy === game.user.id
      ? i18n('inProgressSelf')
      : game.i18n.format('pf2e-customizations.lockPicking.card.inProgress', {
          name: escapeHtml(game.users.get(state.claimedBy)?.name ?? '?'),
        });
    return `${failureNote}<p class="lock-picking-card-status-text">${label}</p>`;
  }

  return `${failureNote}<button type="button" data-lock-picking-action="attempt">${i18n('attempt')}</button>`;
}

async function onAttempt(message, config, actor) {
  const current = getAttemptState(actor, message.id);
  if (current.claimedBy) {
    ui.notifications.warn(game.i18n.localize('pf2e-customizations.lockPicking.card.alreadyClaimed'));
    return;
  }

  await setAttemptState(actor, message.id, { claimedBy: game.user.id });
  const settled = getAttemptState(actor, message.id);
  if (settled.claimedBy !== game.user.id) {
    ui.notifications.warn(game.i18n.localize('pf2e-customizations.lockPicking.card.alreadyClaimed'));
    return;
  }

  const totalModifier = actor.system.skills.thievery.totalModifier;
  const windowWidthPercent = windowWidthPercentForDiff(totalModifier - config.dc);

  const result = await LockPickingApp.run({
    actor,
    dc: config.dc,
    pinCount: config.pinCount,
    windowWidthPercent,
    mistakeThreshold: config.mistakeThreshold,
  });

  const patch = { claimedBy: null };
  if (result.attempted) patch.resolved = result.outcome;
  await setAttemptState(actor, message.id, patch);
}

async function onReset(actor, messageId) {
  await setAttemptState(actor, messageId, { claimedBy: null, resolved: null });
}

function renderCard(message, element) {
  const config = message.getFlag(FLAG_SCOPE, 'lockPicking');
  if (!config) return;

  const container = element.querySelector('[data-lock-picking-status]');
  if (!container) return;

  const actor = game.actors.get(config.actorId);
  const state = getAttemptState(actor, message.id);
  container.innerHTML = statusHtml(config, state, actor);

  container.querySelector('[data-lock-picking-action="attempt"]')
    ?.addEventListener('click', () => onAttempt(message, config, actor));
  container.querySelector('[data-lock-picking-action="reset"]')
    ?.addEventListener('click', () => onReset(actor, message.id));
}

function onRenderChatMessage(message, html) {
  const element = html instanceof HTMLElement ? html : html[0];
  renderCard(message, element);
}

// Updating actor flags doesn't trigger a chat re-render on its own (unlike updating the message
// itself would), so any currently-displayed lock-picking card for this actor is refreshed by hand.
function onUpdateActor(actor, changes) {
  if (!foundry.utils.hasProperty(changes, `flags.${FLAG_SCOPE}.lockPicking`)) return;

  for (const message of game.messages) {
    const config = message.getFlag(FLAG_SCOPE, 'lockPicking');
    if (!config || config.actorId !== actor.id) continue;
    const element = document.querySelector(`[data-message-id="${message.id}"]`);
    if (element) renderCard(message, element);
  }
}

export function initLockPicking() {
  // v13-native hook; passes an HTMLElement. If the card never gains its status area, this may need to
  // fall back to the legacy jQuery-based "renderChatMessage" hook instead.
  Hooks.on('renderChatMessageHTML', onRenderChatMessage);
  Hooks.on('updateActor', onUpdateActor);
}
