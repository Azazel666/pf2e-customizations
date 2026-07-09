# PF2e Customizations

A Foundry VTT module providing small Pathfinder 2e quality-of-life improvements. Each feature is independently toggleable via GM settings and requires a world reload to take effect.

**Requires:** Foundry VTT v13, PF2e system

---

## Features

### Item Durability

Exposes the existing HP, Max HP, Broken Threshold, and Hardness fields on physical item sheets, plus two macros for working with them without needing to open the item sheet.

#### Durability Fields (Item Sheet)

Exposes the existing HP, Max HP, Broken Threshold, and Hardness fields on physical item sheets (Details tab). These fields exist in the PF2e data model for all physical items but have no UI outside of shields — this feature surfaces them consistently.

**Affected item types:** Weapons, Armor, Equipment, Containers, Treasure, Consumables

**Fields added:**
- **Hardness** — damage reduction against most physical hits
- **Hit Points** — current / max HP
- **Broken Threshold** — item becomes broken when HP falls to or below this value (PF2e rules: half of max HP)

Enable via **Game Settings > Module Settings > Item Durability Fields**.

#### Set Item Durability (Macro)

A macro utility that lets any player edit the durability fields of an item in their inventory without opening the item sheet — useful mid-session when a weapon gets damaged or armor takes a hit.

**Setup:** Create a world macro (or hotbar macro) with this single line:

```js
pf2eCustomizations.setItemDurability();
```

**Usage:**

1. Select your token on the canvas (or have an owned character — the macro falls back to any actor you own).
2. Run the macro.
3. If you own multiple characters, pick one from the **Character** dropdown.
4. Pick an item from the **Item** dropdown — the fields populate with its current values.
5. Edit **Hit Points** (current / max), **Broken Threshold**, and/or **Hardness** as needed.
6. Click **Save**.

**Supported item types:** Weapons, Armor, Equipment, Containers, Treasure, Consumables

This macro is always available once the module is enabled — no additional setting required.

#### Apply Item Damage (Macro)

A GM-only macro that applies raw damage to an item, subtracting Hardness and reducing the item's current HP — without doing the math by hand.

**Setup:** Create a world macro (or hotbar macro) with this single line:

```js
pf2eCustomizations.applyItemDamage();
```

**Usage:**

1. As the GM, select the token whose item took damage.
2. Run the macro.
3. Pick the item from the **Item** dropdown — its current HP and Hardness are shown.
4. Enter the raw **Damage** amount.
5. Click **Apply** — Hardness is subtracted from the damage first, and the remainder reduces the item's current HP (never below 0).

If the item's HP and Hardness haven't been configured yet (both still unset), the macro shows an error instead — set them first via **Set Item Durability**. If the resulting HP drops to or below the item's Broken Threshold, an additional notification warns that the item is now broken.

**Supported item types:** Weapons, Armor, Equipment, Containers, Treasure, Consumables

This macro is always available once the module is enabled — no additional setting required. Only the GM can run it; it requires a token to be selected first.

---

### Lock Picking Minigame

An interactive pin-tumbler dial puzzle that stands in for a flat Thievery check, triggered by the GM for a specific PC and attempted by that PC's owning player.

#### Request Lock Pick (Macro)

**Setup:** Create a GM world macro (or hotbar macro) with this single line:

```js
pf2eCustomizations.requestLockPick();
```

**Usage (GM):**

1. Run the macro.
2. Pick the target **Character** (defaults to your controlled token if it's a player-owned PC) and the **Lock Difficulty** — Simple (DC 15), Average (DC 20), Good (DC 25), Superior (DC 30), or a Custom DC.
3. Click **Send** — a chat card is posted publicly, naming the actor and lock tier. The DC itself is never shown to players; it's rendered GM-only, directly on the same card.

This macro is always available once the module is enabled — no additional setting required. Only the GM can run it.

#### Attempting the Lock (Player)

1. Any player who owns the targeted PC can click **Attempt Lock** on the chat card. Only one attempt can be in flight at a time — everyone else sees an "in progress" status until it resolves.
2. The puzzle opens to a brief instructions screen first (skippable via a setting); clicking **Begin** generates the pins.
3. Drag each pin's dial to rotate it. There's no visual meter — proximity is only *felt*: as the dial nears the correct spot it resists and shudders, with a strain sound cue. Ease off before it fights back too long, or the pin snaps back to the start and counts as a mistake.
4. Once the dial turns freely, click **Set Pin**.
5. Repeat for every pin. Reaching the mistake threshold (default 3) breaks the pick — a critical failure that locks out further attempts until new tools are acquired (the GM can reset this from the chat card). Finishing with zero mistakes is a critical success; finishing with at least one is a plain success.
6. **Give Up** at any time to walk away with a plain failure instead of risking a broken pick — a plain failure leaves the card attemptable again.

**Difficulty scaling:**
- Pin count is derived from the lock's DC tier (Simple → 2 pins, Average → 3, Good → 4, Superior → 5).
- Both the size of the correct window and the grace period before a mistake registers scale with the acting character's live Thievery total modifier and proficiency rank against the DC, read fresh when the puzzle opens — a more skilled character gets a more forgiving puzzle.

Enable via **Game Settings > Module Settings > Lock Picking Minigame**.

---

## Installation

### Manual

1. In Foundry VTT, open **Configuration > Add-on Modules > Install Module**
2. Paste the manifest URL into the **Manifest URL** field and click Install
3. Enable the module in your world under **Game Settings > Manage Modules**

### From the filesystem

Copy or clone this repository into your Foundry `Data/modules/` directory as `pf2e-customizations`, then enable it in your world.

---

## Configuration

Settings marked **World** are GM-only, under **Game Settings > Module Settings**. Settings marked **Client** are per-player and don't require a reload.

| Setting | Scope | Default | Description |
|---------|-------|---------|-------------|
| Item Durability Fields | World (reload) | On | Show HP/hardness fields on physical item sheets |
| Lock Picking Minigame | World (reload) | Off | Enable the interactive lock picking puzzle |
| Lock Picking Mistake Threshold | World | 3 | Mistakes allowed before a lock picking attempt critically fails |
| Skip Lock Picking Instructions | Client | Off | Don't show the how-to-play screen before each attempt |
| Lock Picking: Show Sweet Spot (Debug) | Client | Off | Draws each pin's correct window on the dial, for testing/tuning only |

---

## Compatibility

| Software | Version |
|----------|---------|
| Foundry VTT | v13 |
| PF2e system | current |

---

## License

[MIT](LICENSE)
