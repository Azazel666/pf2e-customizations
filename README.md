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

## Installation

### Manual

1. In Foundry VTT, open **Configuration > Add-on Modules > Install Module**
2. Paste the manifest URL into the **Manifest URL** field and click Install
3. Enable the module in your world under **Game Settings > Manage Modules**

### From the filesystem

Copy or clone this repository into your Foundry `Data/modules/` directory as `pf2e-customizations`, then enable it in your world.

---

## Configuration

All features are disabled by default and require a world reload (`requiresReload: true`) when toggled. Settings are world-scoped and only visible to the GM.

| Setting | Default | Description |
|---------|---------|-------------|
| Item Durability Fields | Off | Show HP/hardness fields on physical item sheets |

---

## Compatibility

| Software | Version |
|----------|---------|
| Foundry VTT | v13 |
| PF2e system | current |

---

## License

[MIT](LICENSE)
