import {
  baseTimeAllowanceSeconds,
  liveTotalPcStat,
  resolveOutcomeOnCorrectSubmission,
  resolveOutcomeOnExpiration,
} from './fact-sifter-logic.js';

const TEMPLATE_PATH = 'modules/pf2e-customizations/scripts/features/fact-sifter/fact-sifter-app.hbs';
const GLITCH_FLASH_MS = 400;

function formatSeconds(totalSeconds) {
  const clamped = Math.max(0, Math.round(totalSeconds));
  const minutes = Math.floor(clamped / 60);
  const seconds = clamped % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

export class FactSifterApp extends foundry.applications.api.HandlebarsApplicationMixin(
  foundry.applications.api.ApplicationV2
) {
  static DEFAULT_OPTIONS = {
    id: 'pf2e-customizations-fact-sifter',
    classes: ['pf2e-customizations', 'fact-sifter-app'],
    tag: 'div',
    window: {
      title: 'pf2e-customizations.factSifter.appTitle',
      resizable: false,
      minimizable: false,
    },
    // Static — unlike alibi-matrix, pool size never changes the layout shape (always a single
    // scrollable list), so there's no need to vary width per attempt.
    position: { width: 560 },
    actions: {
      begin: FactSifterApp.#onBegin,
      toggleFragment: FactSifterApp.#onToggleFragment,
      verifyDataset: FactSifterApp.#onVerifyDataset,
      showHelp: FactSifterApp.#onShowHelp,
      closeHelp: FactSifterApp.#onCloseHelp,
    },
  };

  static PARTS = {
    puzzle: { template: TEMPLATE_PATH, root: true },
  };

  /** Opens the puzzle and resolves once it ends, for any reason. */
  static async run({ actor, skillSlug, circumstanceMod, allowCriticalOutcomes, pool, closingLead }) {
    return new Promise((resolve) => {
      const app = new FactSifterApp({ actor, skillSlug, circumstanceMod, allowCriticalOutcomes, pool, closingLead, resolve });
      app.render(true);
    });
  }

  #actor;
  #skillSlug;
  #circumstanceMod;
  #allowCriticalOutcomes;
  #pool;
  #closingLead;
  #resolve;
  #resolved = false;
  #result = null;
  #inputLocked = false;

  // Same instructions/ready/started/help gate as the sibling features: #stage controls the full
  // instructions text; #started is independent and always starts false, so fragments/countdown are
  // never revealed automatically even when instructions are hidden by client setting.
  #stage = 'instructions';
  #started = false;
  #helpVisible = false;

  #startTimestamp = null;
  #baseTimeAllowanceSeconds = 0;
  #timerIntervalId = null;
  #glitchTimeoutId = null;
  #selectedIds = new Set();

  constructor({ actor, skillSlug, circumstanceMod, allowCriticalOutcomes, pool, closingLead, resolve, ...options }) {
    super(options);
    this.#actor = actor;
    this.#skillSlug = skillSlug;
    this.#circumstanceMod = circumstanceMod;
    this.#allowCriticalOutcomes = allowCriticalOutcomes;
    this.#pool = pool;
    // Null at Expert tier by design (see fact-sifter-logic.js's `closingLeads` doc comment) — the
    // template only renders the Lead line when this is truthy.
    this.#closingLead = closingLead ?? null;
    this.#resolve = resolve;

    if (game.settings.get('pf2e-customizations', 'factSifterHideInstructions')) {
      this.#stage = 'puzzle';
    }
  }

  async _prepareContext(_options) {
    return {
      stage: this.#stage,
      started: this.#started,
      helpVisible: this.#helpVisible,
      actorName: this.#actor.name,
      poolSize: this.#pool.length,
      // The target count (how many fragments to select) is safe to show the player — it doesn't
      // reveal WHICH fragments are true, only how many. Without it, exact-match validation would be
      // a blind guessing game about quantity on top of the actual content puzzle.
      trueFactCount: this.#trueIds().size,
      selectedCount: this.#selectedIds.size,
      closingLead: this.#closingLead,
      // isTrue must never reach the rendered DOM — only id/text/selected.
      fragments: this.#pool.map((f) => ({ id: f.id, text: f.text, selected: this.#selectedIds.has(f.id) })),
    };
  }

  _onRender(context, options) {
    super._onRender(context, options);

    // Fragments/countdown only exist in the DOM once the puzzle has actually started — nothing to
    // wire up before then.
    if (this.#stage !== 'puzzle' || !this.#started) return;

    if (this.#startTimestamp === null) {
      this.#startTimestamp = Date.now();
      this.#baseTimeAllowanceSeconds = baseTimeAllowanceSeconds(
        liveTotalPcStat(this.#actor, this.#skillSlug, this.#circumstanceMod)
      );
      this.#tick();
      this.#timerIntervalId = setInterval(() => this.#tick(), 1000);
    }
  }

  #tick() {
    const elapsedSeconds = (Date.now() - this.#startTimestamp) / 1000;
    const remainingSeconds = Math.max(0, this.#baseTimeAllowanceSeconds - elapsedSeconds);

    const countdownEl = this.element.querySelector('[data-fact-sifter-countdown]');
    if (countdownEl) countdownEl.textContent = formatSeconds(remainingSeconds);

    if (remainingSeconds <= 0) this.#finishOnExpiration();
  }

  #flashGlitch() {
    this.element.classList.add('is-glitch');
    clearTimeout(this.#glitchTimeoutId);
    this.#glitchTimeoutId = setTimeout(() => this.element.classList.remove('is-glitch'), GLITCH_FLASH_MS);
  }

  #trueIds() {
    return new Set(this.#pool.filter((f) => f.isTrue).map((f) => f.id));
  }

  // Handles both possible entry points into real play: dismissing the full instructions screen, and
  // clicking Start on the compact "ready" screen (shown instead when instructions are hidden).
  static #onBegin() {
    const dontShowAgain = this.element.querySelector('[data-dont-show-again]')?.checked ?? false;
    if (dontShowAgain) game.settings.set('pf2e-customizations', 'factSifterHideInstructions', true);

    this.#stage = 'puzzle';
    this.#started = true;
    this.render();
  }

  // Direct DOM patch, no full re-render — binary toggle, not alibi-matrix's tri-state cycle.
  static #onToggleFragment(_event, target) {
    if (this.#inputLocked) return;
    const id = Number(target.dataset.fragmentId);
    if (this.#selectedIds.has(id)) {
      this.#selectedIds.delete(id);
      target.classList.remove('is-selected');
    } else {
      this.#selectedIds.add(id);
      target.classList.add('is-selected');
    }
    this.#updateSelectionCounter();
  }

  #updateSelectionCounter() {
    const el = this.element.querySelector('[data-fact-sifter-selected-count]');
    if (!el) return;
    const trueFactCount = this.#trueIds().size;
    el.textContent = game.i18n.format('pf2e-customizations.factSifter.selectedCountLabel', {
      selected: this.#selectedIds.size,
      total: trueFactCount,
    });
    el.classList.toggle('is-at-target', this.#selectedIds.size === trueFactCount);
  }

  static #onVerifyDataset() {
    if (this.#inputLocked) return;
    const trueIds = this.#trueIds();
    const isExactMatch = this.#selectedIds.size === trueIds.size
      && [...this.#selectedIds].every((id) => trueIds.has(id));
    if (isExactMatch) this.#finishOnSuccess();
    else this.#flashGlitch();
  }

  // Same full-re-render-is-safe reasoning as the sibling features: the timer-start guard keys off
  // #startTimestamp, not off "is this the first render," so toggling help never restarts the clock
  // or loses selection state (re-derived fresh from private fields on every _prepareContext call).
  static #onShowHelp() {
    this.#helpVisible = true;
    this.render();
  }

  static #onCloseHelp() {
    this.#helpVisible = false;
    this.render();
  }

  #lockInputs() {
    this.#inputLocked = true;
    this.element.classList.add('is-locked');
    if (this.#timerIntervalId !== null) {
      clearInterval(this.#timerIntervalId);
      this.#timerIntervalId = null;
    }
  }

  #finishOnSuccess() {
    if (this.#resolved) return;
    const elapsedSeconds = (Date.now() - this.#startTimestamp) / 1000;
    const outcome = resolveOutcomeOnCorrectSubmission(elapsedSeconds, this.#baseTimeAllowanceSeconds, this.#allowCriticalOutcomes);
    this.#settle({ outcome, attempted: true });
  }

  #finishOnExpiration() {
    if (this.#resolved) return;
    const trueIds = this.#trueIds();
    const selectedCount = this.#selectedIds.size;
    const correctSelectedCount = [...this.#selectedIds].filter((id) => trueIds.has(id)).length;
    const outcome = resolveOutcomeOnExpiration(selectedCount, correctSelectedCount, this.#allowCriticalOutcomes);
    this.#settle({ outcome, attempted: true });
  }

  #settle(result) {
    if (this.#resolved) return;
    this.#resolved = true;
    this.#result = result;
    this.#lockInputs();
    if (this.rendered) this.close();
  }

  _onClose(options) {
    if (this.#timerIntervalId !== null) {
      clearInterval(this.#timerIntervalId);
      this.#timerIntervalId = null;
    }
    if (!this.#resolved) {
      this.#resolved = true;
      this.#result = { outcome: 'cancelled', attempted: false };
    }
    this.#resolve(this.#result);
    super._onClose(options);
  }
}
