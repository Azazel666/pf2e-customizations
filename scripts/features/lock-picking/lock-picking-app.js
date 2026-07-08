import { randomizeWindowCenter, isWithinWindow } from './lock-picking-logic.js';

const TEMPLATE_PATH = 'modules/pf2e-customizations/scripts/features/lock-picking/lock-picking-app.hbs';
const SOUND_PASSING = 'modules/pf2e-customizations/assets/features/lock-picking/passing.mp3';
const SOUND_CLICK = 'modules/pf2e-customizations/assets/features/lock-picking/click.mp3';

// Value-delta grid the slider must cross before another feedback tick plays/pulses, so dragging
// doesn't spam a tick on every pixel of movement (native `input` events fire far more often than that).
const TICK_STEP = 4;

function playTick(src) {
  foundry.audio.AudioHelper.play({ src, volume: 0.6, autoplay: true, loop: false }, false);
}

export class LockPickingApp extends foundry.applications.api.HandlebarsApplicationMixin(
  foundry.applications.api.ApplicationV2
) {
  static DEFAULT_OPTIONS = {
    id: 'pf2e-customizations-lock-picking',
    classes: ['pf2e-customizations', 'lock-picking-app'],
    tag: 'div',
    window: {
      title: 'pf2e-customizations.lockPicking.appTitle',
      resizable: false,
      minimizable: false,
    },
    position: { width: 420 },
    actions: {
      begin: LockPickingApp.#onBegin,
      cancelInstructions: LockPickingApp.#onCancelInstructions,
      setPin: LockPickingApp.#onSetPin,
      giveUp: LockPickingApp.#onGiveUp,
    },
  };

  static PARTS = {
    puzzle: { template: TEMPLATE_PATH, root: true },
  };

  /** Opens the puzzle and resolves once it ends, for any reason. */
  static async run({ actor, dc, pinCount, windowWidthPercent, mistakeThreshold }) {
    return new Promise((resolve) => {
      const app = new LockPickingApp({ actor, dc, pinCount, windowWidthPercent, mistakeThreshold, resolve });
      app.render(true);
    });
  }

  #actor;
  #dc;
  #pinCount;
  #windowWidthPercent;
  #mistakeThreshold;
  #resolve;
  #stage = 'instructions';
  #pins = [];
  #pinWindows = [];
  #activeIndex = 0;
  #mistakes = 0;
  #lastMistakeIndex = null;
  #lastTickValue = null;
  #resolved = false;
  #result = null;

  constructor({ actor, dc, pinCount, windowWidthPercent, mistakeThreshold, resolve, ...options }) {
    super(options);
    this.#actor = actor;
    this.#dc = dc;
    this.#pinCount = pinCount;
    this.#windowWidthPercent = windowWidthPercent;
    this.#mistakeThreshold = mistakeThreshold;
    this.#resolve = resolve;
  }

  #setupPins() {
    this.#pins = Array.from({ length: this.#pinCount }, (_, i) => ({ state: i === 0 ? 'active' : 'pending' }));
    this.#pinWindows = Array.from({ length: this.#pinCount }, () => randomizeWindowCenter(this.#windowWidthPercent));
    this.#activeIndex = 0;
    this.#mistakes = 0;
    this.#lastMistakeIndex = null;
  }

  async _prepareContext(_options) {
    return {
      stage: this.#stage,
      actorName: this.#actor.name,
      dc: this.#dc,
      pinCount: this.#pinCount,
      mistakes: this.#mistakes,
      mistakeThreshold: this.#mistakeThreshold,
      warningMistakes: this.#mistakes >= this.#mistakeThreshold - 1,
      pins: this.#pins.map((pin, index) => ({
        index,
        state: pin.state,
        mistake: index === this.#lastMistakeIndex,
      })),
    };
  }

  _onRender(context, options) {
    super._onRender(context, options);
    this.#lastMistakeIndex = null;

    if (this.#stage !== 'puzzle') return;
    const activePin = this.element.querySelector('.lock-picking-pin.is-active');
    const input = activePin?.querySelector('input[type="range"]');
    const track = activePin?.querySelector('.lock-picking-tension');
    if (!input) return;

    this.#lastTickValue = Number(input.value);
    input.addEventListener('input', (event) => this.#onSlide(Number(event.target.value), track));
  }

  // Feedback is deliberately discrete (a tick every TICK_STEP units), not a continuously graded
  // readout — the player has to listen for the distinct click sound near the sweet spot rather than
  // just watching a meter fill up, which made the puzzle trivial.
  #onSlide(value, trackEl) {
    if (this.#lastTickValue !== null && Math.abs(value - this.#lastTickValue) < TICK_STEP) return;
    this.#lastTickValue = value;

    const center = this.#pinWindows[this.#activeIndex];
    const hit = isWithinWindow(value, center, this.#windowWidthPercent);
    playTick(hit ? SOUND_CLICK : SOUND_PASSING);
    this.#pulse(trackEl, hit ? 'is-click-tick' : 'is-passing-tick');
  }

  #pulse(trackEl, variant) {
    if (!trackEl) return;
    trackEl.classList.remove('is-click-tick', 'is-passing-tick');
    void trackEl.offsetWidth; // force reflow so re-adding the same class restarts its CSS animation
    trackEl.classList.add(variant);
  }

  static #onBegin() {
    this.#stage = 'puzzle';
    this.#setupPins();
    this.render();
  }

  static #onCancelInstructions() {
    this.#finish('cancelled', false);
  }

  static #onSetPin() {
    const activePin = this.element.querySelector('.lock-picking-pin.is-active');
    const input = activePin?.querySelector('input[type="range"]');
    if (!input) return;

    const value = Number(input.value);
    const center = this.#pinWindows[this.#activeIndex];

    if (isWithinWindow(value, center, this.#windowWidthPercent)) {
      this.#pins[this.#activeIndex].state = 'set';
      this.#activeIndex += 1;

      if (this.#activeIndex >= this.#pinCount) {
        this.#finish(this.#mistakes === 0 ? 'criticalSuccess' : 'success', true);
        return;
      }

      this.#pins[this.#activeIndex].state = 'active';
      this.render();
      return;
    }

    this.#mistakes += 1;
    this.#lastMistakeIndex = this.#activeIndex;
    this.#pinWindows[this.#activeIndex] = randomizeWindowCenter(this.#windowWidthPercent);

    if (this.#mistakes >= this.#mistakeThreshold) {
      this.#finish('criticalFailure', true);
      return;
    }

    this.render();
  }

  static #onGiveUp() {
    const attempted = this.#mistakes > 0 || this.#activeIndex > 0;
    this.#finish(attempted ? 'failure' : 'cancelled', attempted);
  }

  #finish(outcome, attempted) {
    if (this.#resolved) return;
    this.#resolved = true;
    this.#result = { outcome, mistakes: this.#mistakes, pinsSet: this.#activeIndex, attempted };
    this.close();
  }

  _onClose(options) {
    if (!this.#resolved) {
      this.#resolved = true;
      const attempted = this.#stage === 'puzzle' && (this.#mistakes > 0 || this.#activeIndex > 0);
      this.#result = {
        outcome: attempted ? 'failure' : 'cancelled',
        mistakes: this.#mistakes,
        pinsSet: this.#activeIndex,
        attempted,
      };
    }
    this.#resolve(this.#result);
    super._onClose(options);
  }
}
