# ACKS VTT Inventory Prototype

Renderer-agnostic ACKS II inventory/encumbrance prototype built with Vite + TypeScript.

## Quick Start

From `vtt`:

```bash
npm install
npm run dev
```

Open the local URL shown by Vite (default: `http://localhost:5174`).

## Useful Commands

```bash
npm run dev        # start local app
npm run test       # run Vitest tests
npm run test:watch # watch mode tests
npm run build      # typecheck + production build
```

## What You Should See

The app currently includes:

- **Source Search** panel
  - fuzzy search over catalog items
  - token filters: `category:`, `enc:`, `name:`
  - chip UI with removable chips
  - suggestion tokens (click to add)

- **Paste Inventory Text** panel
  - parse messy item text into chunks
  - status per chunk: `resolved`, `ambiguous`, `unknown`
  - quantity + confidence + alternatives

- **Bulk Import (Characters + Loot Piles)** panel
  - parse multi-block pasted text into container plans
  - infers container kind (`character`, `loot-pile`, `space`)
  - shows resolved/ambiguous/unknown counts

- **World Board (Pixi)**
  - pan/zoom canvas-style board
  - rows laid out left-to-right with slot grid + segment labels
  - drag row nodes directly on the board
  - hover segment events roundtrip to the worker
  - worker sends VM delta patches, adapter applies them to scene graph

- **Board Snapshot**
  - ASCII debug mirror output from `BoardVM`

## Example Inputs

### Search Input

- `shield priest`
- `category:weapons name:dagger`
- `enc:by-weight`

### Paste Inventory Text

- `2 sacks, 14 torches and 3 flasks of oil`
- `plate armor, shield, spear`

### Bulk Import

```text
Fighter:
plate armor, shield, spear

Loot Pile - Crypt Chest:
2 sacks, 14 torches and 3 flasks of oil

Mage:
scroll case, 3 torches, holy symbol
```

## Board Controls

- **Drag row node:** left-click and drag
- **Pan board:** middle mouse or right mouse drag
- **Zoom board:** mouse wheel

