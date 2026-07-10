# CLAUDE.md

Guidance specific to the lock-picking feature (see the root `CLAUDE.md` for repo-wide conventions).

## Phase 2: Lock Picking Minigame

An interactive pin-tumbler puzzle that stands in for a flat Thievery check. The GM sends a lock-picking request into chat for a specific PC (`pf2eCustomizations.requestLockPick()`); any owning player can open the puzzle from the chat card (one attempt in flight at a time). Pin count is derived from the lock's DC tier; each pin's forgiveness (window width) is derived from the acting character's live Thievery total modifier vs. the DC.

- **Target files**: `scripts/features/lock-picking/` (`lock-picking-logic.js`, `lock-picking-app.js` + `.hbs`, `lock-picking-chat.js` + `-chat-card.hbs`), `scripts/macros/request-lock-pick.js`
- **First real usage of `ApplicationV2` + `HandlebarsApplicationMixin`** in this codebase (the puzzle window) — item-durability's template-literal injection pattern does not apply here since this is a standalone window, not a fragment injected into a foreign PF2e sheet.
- **Trigger**: `Hooks.on('renderChatMessageHTML', ...)` renders/gates an "Attempt Lock" button on the request card based on `flags['pf2e-customizations'].lockPicking` (claim/resolution state); no PF2e hook exists to intercept the built-in Pick a Lock/Disable Device actions, so this is a standalone flow, not an interception.

See `design.md` for the DC→pin-count and modifier-diff→window-width formulas, mistake-threshold rationale, and open implementation questions (verifying `renderChatMessageHTML` vs. legacy `renderChatMessage`, ApplicationV2 API surface).
