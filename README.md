# PF2e Customizations

A Foundry VTT module providing small Pathfinder 2e quality-of-life improvements. Each feature is independently toggleable via GM settings and requires a world reload to take effect.

**Requires:** Foundry VTT v13, PF2e system

---

## Features

### Item Durability Fields

Exposes the existing HP, Max HP, Broken Threshold, and Hardness fields on physical item sheets (Details tab). These fields exist in the PF2e data model for all physical items but have no UI outside of shields — this feature surfaces them consistently.

**Affected item types:** Weapons, Armor, Equipment, Containers, Treasure, Consumables

**Fields added:**
- **Hardness** — damage reduction against most physical hits
- **Hit Points** — current / max HP
- **Broken Threshold** — item becomes broken when HP falls to or below this value (PF2e rules: half of max HP)

Enable via **Game Settings > Module Settings > Item Durability Fields**.

---

### Set Item Durability (Macro)

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

---

### Apply Item Damage (Macro)

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

An interactive pin-tumbler puzzle that stands in for a flat Thievery check when a PC picks a lock. Pin count is derived from the lock's difficulty tier; each pin's forgiveness is derived from the acting character's live Thievery modifier vs. the lock's DC.

**Setup:** Create a GM world macro (or hotbar macro) with this single line:

```js
pf2eCustomizations.requestLockPick();
```

**Usage:**

1. As the GM, run the macro.
2. Pick the target **Character** (defaults to your controlled token if it's a player-owned PC) and the **Lock Difficulty** — Simple (DC 15), Average (DC 20), Good (DC 25), Superior (DC 30), or a Custom DC.
3. Click **Send** — a chat card posts describing the lock and an **Attempt Lock** button.
4. Any player who owns that character can click **Attempt Lock**. Only one player can attempt at a time — others see an "in progress" status until it resolves.
5. The puzzle opens to a brief instructions screen first; clicking **Begin** generates the pins. Drag each pin's slider and watch the tension indicator to feel out the correct spot, then click **Set Pin**.
6. A missed pin is a recoverable mistake (it resets and re-randomizes) — but reaching the mistake threshold ends the attempt as a **critical failure** (broken pick). Click **Give Up** at any time to bank a safe **failure** instead of risking that; a plain failure leaves the card attemptable again.
7. Completing all pins succeeds (with a bonus "critical success" flavor if done with zero mistakes) and removes the button. A critical failure shows a GM-only **Reset** control once new tools are narratively acquired.

Enable via **Game Settings > Module Settings > Lock Picking Minigame**. The mistake threshold (default 3) is a separate world setting.

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

Each feature's toggle requires a world reload (`requiresReload: true`) when changed. Settings are world-scoped and only visible to the GM.

| Setting | Default | Description |
|---------|---------|-------------|
| Item Durability Fields | On | Show HP/hardness fields on physical item sheets |
| Lock Picking Minigame | Off | Enable the interactive lock-picking puzzle |
| Lock Picking Mistake Threshold | 3 | Mistakes allowed before a critical failure (no reload required) |

---

## Compatibility

| Software | Version |
|----------|---------|
| Foundry VTT | v13 |
| PF2e system | current |

---

## License

[MIT](LICENSE)
