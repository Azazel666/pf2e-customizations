import {
  isWithinWindowDeg,
  randomizeWindowCenterDeg,
  resistanceZoneDegForToleranceDeg,
  toleranceDegForWindowWidthPercent,
} from './lock-picking-logic.js';

const TEMPLATE_PATH = 'modules/pf2e-customizations/scripts/features/lock-picking/lock-picking-app.hbs';
const SOUND_CLICK = 'modules/pf2e-customizations/assets/features/lock-picking/click.mp3';
const SOUND_STRAIN_LOOP = 'modules/pf2e-customizations/assets/features/lock-picking/strain-loop.mp3';
const SOUND_MISTAKE_SNAP = 'modules/pf2e-customizations/assets/features/lock-picking/mistake-snap.mp3';
const SOUND_PICK_BREAK = 'modules/pf2e-customizations/assets/features/lock-picking/pick-break.mp3';

// Interaction-feel tuning, first-draft guesses to revisit after playtesting (same status as the
// DC/window-width constants in lock-picking-logic.js).
// Time constant (ms) for the displayed dial's exponential approach to the real pointer target.
// Time-based (not a flat per-frame factor) so catch-up speed stays consistent regardless of
// frame rate — a flat per-frame factor makes lag worse in real time whenever frames drop, which
// is what produced the "dial keeps drifting for up to a second" symptom.
const CATCH_UP_TAU_MS = 45;
const MAX_JITTER_DEG = 6;
const JITTER_FACTOR = 0.25;
const MAX_JITTER_PX = 3;
const MIN_DRAG_RADIUS_PX = 16; // atan2 is numerically unstable this close to the dial center
const SHATTER_ANIMATION_MS = 650;
const CRIT_SUCCESS_ANIMATION_MS = 450;
// Extra breathing room (beyond the resistance zone itself) kept between a freshly (re)randomized
// window and the dial's fixed 0° start angle, so the player always begins in the free zone with
// some runway before any resistance, instead of possibly starting on top of (or inside) it.
const STARTING_SAFE_BUFFER_DEG = 15;
// lockpick.webp's art is drawn with its long axis horizontal (handle right, pick tip left), but the
// rest of the physics/debug-overlay code uses a "0deg = up, clockwise" convention. This constant
// rotates the art into that convention before the live currentAngleDeg is applied on top.
const PICK_BASE_ROTATION_DEG = 90;

function playOneShot(src, volume = 0.6) {
  foundry.audio.AudioHelper.play({ src, volume, autoplay: true, loop: false }, false);
}

function normalizeDeg(deg) {
  return ((deg % 360) + 360) % 360;
}

// Shortest signed delta (in (-180, 180]) to rotate `fromDeg` into `toDeg`.
function signedDelta(fromDeg, toDeg) {
  let d = (toDeg - fromDeg) % 360;
  if (d > 180) d -= 360;
  if (d < -180) d += 360;
  return d;
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
      showHelp: LockPickingApp.#onShowHelp,
      closeHelp: LockPickingApp.#onCloseHelp,
    },
  };

  static PARTS = {
    puzzle: { template: TEMPLATE_PATH, root: true },
  };

  /** Opens the puzzle and resolves once it ends, for any reason. */
  static async run({ actor, dc, pinCount, windowWidthPercent, strainMs, mistakeThreshold }) {
    return new Promise((resolve) => {
      const app = new LockPickingApp({ actor, dc, pinCount, windowWidthPercent, strainMs, mistakeThreshold, resolve });
      app.render(true);
      if (app.#stage === 'puzzle') app.#startLoop();
    });
  }

  #actor;
  #dc;
  #pinCount;
  #windowWidthPercent;
  #toleranceDeg;
  #resistanceZoneDeg;
  #strainMs;
  #mistakeThreshold;
  #resolve;
  #stage = 'instructions';
  #pinWindows = [];
  #activeIndex = 0;
  #mistakes = 0;
  #hadStrain = false;
  #justMistake = false;
  #justSetPin = false;
  #resolved = false;
  #result = null;
  #shattered = false;
  #celebrating = false;
  #inputLocked = false;
  #helpVisible = false;

  // Physics/audio state for whichever pin is currently active. Rebuilt fresh (angle reset to 0°)
  // on every pin advance and on every mistake.
  #dial = null;
  #rafHandle = null;
  #lastFrameTime = null;
  #dialIndicatorEl = null;
  #dialJitterEl = null;
  #dragAbortController = null;
  #strainSound = null;
  #strainSoundToken = 0;

  constructor({ actor, dc, pinCount, windowWidthPercent, strainMs, mistakeThreshold, resolve, ...options }) {
    super(options);
    this.#actor = actor;
    this.#dc = dc;
    this.#pinCount = pinCount;
    this.#windowWidthPercent = windowWidthPercent;
    this.#toleranceDeg = toleranceDegForWindowWidthPercent(windowWidthPercent);
    this.#resistanceZoneDeg = resistanceZoneDegForToleranceDeg(this.#toleranceDeg);
    this.#strainMs = strainMs;
    this.#mistakeThreshold = mistakeThreshold;
    this.#resolve = resolve;

    if (game.settings.get('pf2e-customizations', 'lockPickingHideInstructions')) {
      this.#stage = 'puzzle';
      this.#setupPins();
    }
  }

  #setupPins() {
    this.#pinWindows = Array.from({ length: this.#pinCount }, () => this.#randomizeSafeWindowCenter());
    this.#activeIndex = 0;
    this.#mistakes = 0;
    this.#hadStrain = false;
    this.#justMistake = false;
    this.#initDial();
  }

  // Every dial starts at raw angle 0° (see #initDial below), so keep freshly (re)randomized windows
  // far enough from 0° that the dial never starts already inside, or right on the edge of, the
  // resistance band — see STARTING_SAFE_BUFFER_DEG.
  #randomizeSafeWindowCenter() {
    return randomizeWindowCenterDeg(0, this.#resistanceZoneDeg + STARTING_SAFE_BUFFER_DEG);
  }

  #initDial() {
    this.#dial = {
      windowCenterDeg: this.#pinWindows[this.#activeIndex],
      toleranceDeg: this.#toleranceDeg,
      resistanceZoneDeg: this.#resistanceZoneDeg,
      pointerRawDeg: 0,
      currentAngleDeg: 0,
      lastRawScreenDeg: null,
      isOverStrained: false,
      strainMs: 0,
      lastDistanceDeg: null,
    };
  }

  async _prepareContext(_options) {
    return {
      stage: this.#stage,
      actorName: this.#actor.name,
      dc: this.#dc,
      pinCount: this.#pinCount,
      pinsSet: this.#activeIndex,
      mistakes: this.#mistakes,
      mistakeThreshold: this.#mistakeThreshold,
      warningMistakes: this.#mistakes >= this.#mistakeThreshold - 1,
      shattered: this.#shattered,
      celebrating: this.#celebrating,
      helpVisible: this.#helpVisible,
      mistake: this.#justMistake,
      justSet: this.#justSetPin,
    };
  }

  _onRender(context, options) {
    super._onRender(context, options);
    this.#justMistake = false;
    this.#justSetPin = false;

    if (this.#stage !== 'puzzle' || this.#helpVisible) return;
    const dialEl = this.element.querySelector('.lock-picking-lock-dial');
    this.#dialIndicatorEl = dialEl?.querySelector('.lock-picking-lock-pick') ?? null;
    this.#dialJitterEl = dialEl?.querySelector('.lock-picking-lock-pick-wrap') ?? null;

    // Re-paint immediately so a discrete render (pin advance, mistake, shatter) doesn't wait for the
    // next rAF frame to reflect the current physics state on the freshly-generated DOM nodes.
    if (this.#dial) this.#renderDialTransform(0);

    // Debug aid, off by default (lockPickingDebugShowWindow) — the window position is fixed for the
    // whole time this pin is active, so it only needs painting once per render, not every rAF tick.
    const debugEl = dialEl?.querySelector('.lock-picking-lock-debug');
    if (debugEl) debugEl.style.background = this.#buildDebugBackground();

    if (!dialEl || this.#inputLocked) return;
    dialEl.addEventListener('pointerdown', (event) => this.#onPointerDown(event, dialEl));
  }

  #angleFromPointer(clientX, clientY, centerX, centerY) {
    const dx = clientX - centerX;
    const dy = clientY - centerY;
    if (Math.hypot(dx, dy) < MIN_DRAG_RADIUS_PX) return null;
    return normalizeDeg(Math.atan2(dy, dx) * (180 / Math.PI));
  }

  #onPointerDown(event, dialEl) {
    if (this.#inputLocked || !this.#dial) return;
    event.preventDefault();
    dialEl.setPointerCapture(event.pointerId);

    const rect = dialEl.getBoundingClientRect();
    this.#dial.lastRawScreenDeg = this.#angleFromPointer(
      event.clientX, event.clientY, rect.left + rect.width / 2, rect.top + rect.height / 2
    );

    this.#dragAbortController?.abort();
    const controller = new AbortController();
    this.#dragAbortController = controller;
    const { signal } = controller;

    window.addEventListener('pointermove', (e) => this.#onPointerMove(e), { signal });
    window.addEventListener('pointerup', () => this.#onPointerUp(controller), { signal });
    window.addEventListener('pointercancel', () => this.#onPointerUp(controller), { signal });
  }

  // Bound to `window`, not the dial element, so a mistake/pin-advance re-render mid-gesture (which
  // discards and replaces the dial node, silently releasing pointer capture) doesn't drop the drag.
  #onPointerMove(event) {
    if (this.#inputLocked || !this.#dial) return;
    const dialEl = this.element.querySelector('.lock-picking-lock-dial');
    if (!dialEl) return;

    const rect = dialEl.getBoundingClientRect();
    const raw = this.#angleFromPointer(
      event.clientX, event.clientY, rect.left + rect.width / 2, rect.top + rect.height / 2
    );
    if (raw === null) return;

    if (this.#dial.lastRawScreenDeg !== null) {
      this.#dial.pointerRawDeg += signedDelta(this.#dial.lastRawScreenDeg, raw);
    }
    this.#dial.lastRawScreenDeg = raw;
  }

  #onPointerUp(controller) {
    controller.abort();
    if (this.#dragAbortController === controller) this.#dragAbortController = null;
  }

  #startLoop() {
    this.#lastFrameTime = null;
    this.#rafHandle = requestAnimationFrame(this.#tick);
  }

  #stopLoop() {
    if (this.#rafHandle !== null) {
      cancelAnimationFrame(this.#rafHandle);
      this.#rafHandle = null;
    }
    this.#stopStrainLoopSound();
  }

  // Schedules its own next frame first, so a mistake/finish triggered mid-tick can cancel the
  // already-pending handle via #stopLoop() without any ordering race.
  #tick = (now) => {
    this.#rafHandle = requestAnimationFrame(this.#tick);
    const deltaMs = this.#lastFrameTime === null ? 0 : now - this.#lastFrameTime;
    this.#lastFrameTime = now;

    if (this.#dial && !this.#inputLocked) this.#advancePhysics(deltaMs);
  };

  #advancePhysics(deltaMs) {
    const dial = this.#dial;
    const rawTarget = normalizeDeg(dial.pointerRawDeg);
    const delta = signedDelta(dial.windowCenterDeg, rawTarget);
    const distanceDeg = Math.abs(delta);
    const toleranceHalf = dial.toleranceDeg / 2;
    const inResistanceBand = distanceDeg > toleranceHalf && distanceDeg < dial.resistanceZoneDeg;

    if (inResistanceBand) {
      // Hard stop: the cursor keeps moving, the graphic doesn't — a physical obstruction, not a lag.
      const direction = delta >= 0 ? 1 : -1;
      dial.currentAngleDeg = normalizeDeg(dial.windowCenterDeg + direction * dial.resistanceZoneDeg);
    } else {
      const towardDelta = signedDelta(dial.currentAngleDeg, rawTarget);
      const alpha = 1 - Math.exp(-deltaMs / CATCH_UP_TAU_MS);
      dial.currentAngleDeg = normalizeDeg(dial.currentAngleDeg + towardDelta * alpha);
    }

    const wasOverStrained = dial.isOverStrained;
    dial.isOverStrained = inResistanceBand;

    let shakeDeg = 0;
    if (dial.isOverStrained) {
      // Only sustained/worsening misalignment builds strain — steadily closing in on the window,
      // even slowly, never counts against the player; only stalling or drifting further away does.
      // Without this, any careful approach necessarily dwells in the band and racks up strain,
      // while a fast blind flick-through minimizes time-in-band and is rewarded instead — backwards
      // from the intended "deliberate is safer" feel.
      const closingIn = dial.lastDistanceDeg !== null && distanceDeg < dial.lastDistanceDeg;
      if (!closingIn) {
        dial.strainMs += deltaMs;
        this.#hadStrain = true;
      }
      shakeDeg = Math.min(MAX_JITTER_DEG, (dial.resistanceZoneDeg - distanceDeg) * JITTER_FACTOR);
    } else {
      dial.strainMs = 0;
    }
    dial.lastDistanceDeg = distanceDeg;

    if (dial.isOverStrained && !wasOverStrained) this.#startStrainLoopSound();
    else if (!dial.isOverStrained && wasOverStrained) this.#stopStrainLoopSound();

    this.#renderDialTransform(shakeDeg);

    if (dial.strainMs >= this.#strainMs) this.#registerMistake();
  }

  #renderDialTransform(shakeDeg) {
    if (this.#dialIndicatorEl?.isConnected) {
      this.#dialIndicatorEl.style.transform = `rotate(${PICK_BASE_ROTATION_DEG + this.#dial.currentAngleDeg}deg)`;
    }
    if (this.#dialJitterEl?.isConnected) {
      if (shakeDeg > 0) {
        const jitterPx = MAX_JITTER_PX * (shakeDeg / MAX_JITTER_DEG);
        const jitterX = (Math.random() - 0.5) * 2 * jitterPx;
        const jitterY = (Math.random() - 0.5) * 2 * jitterPx;
        this.#dialJitterEl.style.transform = `translate(${jitterX.toFixed(2)}px, ${jitterY.toFixed(2)}px)`;
      } else {
        this.#dialJitterEl.style.transform = '';
      }
    }
  }

  // Debug-only visualization of the current pin's target window and strain band, using the same
  // "0deg = up, clockwise" convention as the indicator's `rotate()` so the painted zones line up
  // exactly with where the indicator needs to sit. Anchored ("from") at the strain band's start
  // edge so every stop offset is a small positive degree value, sidestepping wraparound entirely.
  #buildDebugBackground() {
    if (!game.settings.get('pf2e-customizations', 'lockPickingDebugShowWindow') || !this.#dial) return '';

    const { windowCenterDeg, toleranceDeg, resistanceZoneDeg } = this.#dial;
    const toleranceHalf = toleranceDeg / 2;
    const strainWidth = resistanceZoneDeg - toleranceHalf;
    const safeEndDeg = strainWidth + toleranceDeg;
    const strainEndDeg = safeEndDeg + strainWidth;
    const fromDeg = normalizeDeg(windowCenterDeg - resistanceZoneDeg);

    const strain = 'rgba(234, 179, 8, 0.35)';
    const safe = 'rgba(34, 197, 94, 0.45)';
    return `conic-gradient(from ${fromDeg}deg,`
      + ` ${strain} 0deg, ${strain} ${strainWidth}deg,`
      + ` ${safe} ${strainWidth}deg, ${safe} ${safeEndDeg}deg,`
      + ` ${strain} ${safeEndDeg}deg, ${strain} ${strainEndDeg}deg,`
      + ` transparent ${strainEndDeg}deg, transparent 360deg)`;
  }

  async #startStrainLoopSound() {
    const token = ++this.#strainSoundToken;
    const sound = await foundry.audio.AudioHelper.play(
      { src: SOUND_STRAIN_LOOP, volume: 0.5, autoplay: true, loop: true }, false
    );
    if (token !== this.#strainSoundToken) {
      // Strain ended (or restarted) before this resolved — don't leave an orphaned loop playing.
      sound?.stop();
      return;
    }
    this.#strainSound = sound;
  }

  #stopStrainLoopSound() {
    this.#strainSoundToken++;
    this.#strainSound?.stop();
    this.#strainSound = null;
  }

  #registerMistake() {
    this.#stopStrainLoopSound();
    this.#mistakes += 1;
    this.#justMistake = true;

    // Preserve where the physical pointer actually is so delta tracking stays continuous across
    // the reset instead of the next move producing one huge jump.
    const lastRawScreenDeg = this.#dial?.lastRawScreenDeg ?? null;
    this.#pinWindows[this.#activeIndex] = this.#randomizeSafeWindowCenter();
    this.#initDial();
    this.#dial.lastRawScreenDeg = lastRawScreenDeg;

    playOneShot(SOUND_MISTAKE_SNAP);

    if (this.#mistakes >= this.#mistakeThreshold) {
      this.#finish('criticalFailure', true);
      return;
    }

    this.render();
  }

  #advancePin() {
    this.#justSetPin = true;
    this.#activeIndex += 1;

    if (this.#activeIndex >= this.#pinCount) {
      this.#finish(!this.#hadStrain ? 'criticalSuccess' : 'success', true);
      return;
    }

    this.#initDial();
    this.render();
  }

  static #onBegin() {
    const dontShowAgain = this.element.querySelector('[data-dont-show-again]')?.checked ?? false;
    if (dontShowAgain) game.settings.set('pf2e-customizations', 'lockPickingHideInstructions', true);

    this.#stage = 'puzzle';
    this.#setupPins();
    this.render();
    this.#startLoop();
  }

  static #onCancelInstructions() {
    this.#finish('cancelled', false);
  }

  static #onShowHelp() {
    this.#helpVisible = true;
    this.#stopLoop();
    this.render();
  }

  static #onCloseHelp() {
    this.#helpVisible = false;
    this.render();
    this.#startLoop();
  }

  static #onSetPin() {
    if (!this.#dial) return;
    // Misalignment is punished only by sustained strain now, not by clicking — a misaligned click
    // is a silent no-op rather than a registered mistake.
    if (!isWithinWindowDeg(this.#dial.currentAngleDeg, this.#dial.windowCenterDeg, this.#dial.toleranceDeg)) return;

    playOneShot(SOUND_CLICK);
    this.#advancePin();
  }

  static #onGiveUp() {
    const attempted = this.#mistakes > 0 || this.#activeIndex > 0;
    this.#finish(attempted ? 'failure' : 'cancelled', attempted);
  }

  async #finish(outcome, attempted) {
    if (this.#resolved) return;
    this.#resolved = true;
    this.#stopLoop();
    this.#dragAbortController?.abort();
    this.#dragAbortController = null;
    this.#inputLocked = true;
    this.#result = { outcome, mistakes: this.#mistakes, pinsSet: this.#activeIndex, attempted };

    if (outcome === 'criticalFailure') {
      this.#shattered = true;
      this.render();
      playOneShot(SOUND_PICK_BREAK);
      await new Promise((resolve) => setTimeout(resolve, SHATTER_ANIMATION_MS));
    } else if (outcome === 'criticalSuccess') {
      this.#celebrating = true;
      this.render();
      playOneShot(SOUND_CLICK);
      await new Promise((resolve) => setTimeout(resolve, CRIT_SUCCESS_ANIMATION_MS));
    }

    if (this.rendered) this.close();
  }

  _onClose(options) {
    this.#stopLoop();
    this.#dragAbortController?.abort();
    this.#dragAbortController = null;

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
