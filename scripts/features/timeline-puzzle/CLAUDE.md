# CLAUDE.md

Guidance specific to the timeline-puzzle feature (see the root `CLAUDE.md` for repo-wide conventions).

## Phase 3: Chronological Timeline Puzzle

An interactive chronological-sorting puzzle that stands in for a flat investigation/information-gathering skill check. The GM sends a request into chat for a specific PC, DC, skill, and circumstance modifier (`pf2eCustomizations.requestTimelinePuzzle()`); any owning player can open the puzzle from the chat card (one attempt in flight at a time). Grid size (event count) is derived from the DC alone; clue completeness is derived from the PC's live odds of success on the check (DC vs. skill total), a separate axis from grid size.

- **Target files**: `scripts/features/timeline-puzzle/` (`timeline-puzzle-logic.js`, `timeline-puzzle-app.js` + `.hbs`, `timeline-puzzle-chat.js` + `-chat-card.hbs`), `scripts/macros/request-timeline-puzzle.js`
- **Second `ApplicationV2` + `HandlebarsApplicationMixin` feature** in this codebase, mirroring lock-picking's file layout and flag-split rationale closely — but the countdown timer (real, visible, starts on first render) and drag-and-drop reordering are both new interaction patterns with no lock-picking precedent (its pointer-drag rotational dial is a different, non-reusable model).
- **Trigger**: same pattern as lock-picking — `Hooks.on('renderChatMessageHTML', ...)` renders/gates an "Attempt Timeline" button based on `flags['pf2e-customizations'].timelinePuzzle` (claim/resolution state on the actor, immutable config on the message).

See `design.md` for the DC→grid-size and odds→clue-completeness formulas, the event-bank/clue-generation algorithm, outcome tiers, and open implementation questions.
