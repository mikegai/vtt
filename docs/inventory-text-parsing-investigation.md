# Inventory Text Parsing Investigation (No LLM)

## Verdict

Your plan is strong. A hybrid pipeline is the right fit:

1. **Fast clause splitter + quantity extraction** (deterministic)
2. **winkNLP token layer** for robust number/unit phrase detection
3. **Catalog matcher (Fuse.js)** to resolve messy item names
4. **Confidence-scored candidates** with UI review/edit

This avoids brittle full-grammar parsing while staying fast enough for realtime client UX.

## Why This Works

- Inventory text is semi-structured, not free prose.
- Most failures come from **entity boundaries** and **name normalization**, not deep syntax.
- You already have a rich source item catalog and fuzzy index; that becomes the resolver stage.

## Recommended Parse Pipeline

### Stage A - Normalize and Segment

- Lowercase preserving original text for display.
- Normalize separators: commas, `and`, semicolons.
- Segment into candidate item chunks:
  - `"2 sacks, 14 torches and 3 flasks of oil"` -> 3 chunks.

### Stage B - Extract Quantity and Unit Phrase

- Extract leading quantity:
  - digits (`14`)
  - common words (`a`, `an`, `one`) -> `1`
- Keep quantity wrappers (e.g. `rolls of`, `flasks of`) as optional metadata.

### Stage C - Candidate Item Name

- Remove stop wrappers:
  - `rolls of`, `flasks of`, `sacks of`, `case with`, etc.
- Produce canonical candidate:
  - `6 rolls of varangian silk cloth` -> `varangian silk cloth`

### Stage D - Resolve to Catalog

- Fuse.js search against source item names + aliases.
- Pick top candidate if score passes threshold.
- Keep alternatives (top 3) for correction UI.

### Stage E - Emit Structured Result

- `rawText`, `quantity`, `candidateName`, `resolvedItemId`, `confidence`, `alternatives`.
- If unresolved, emit `unknown` with confidence and keep raw phrase.

## Role of winkNLP

Use winkNLP where it is strongest:

- tokenization
- numeric token detection
- phrase boundaries
- lightweight tagging

Do **not** rely on it for a strict grammar tree.

## Data Model Suggestion

```ts
type ParsedInventoryChunk = {
  raw: string
  quantity: number
  candidateName: string
  resolvedItemId?: string
  confidence: number
  alternatives: { itemId: string; score: number }[]
  status: 'resolved' | 'ambiguous' | 'unknown'
}
```

## Performance Notes

- Parse + resolve should be sub-10ms for typical party paste text.
- Debounce input by ~100ms while typing.
- Cache resolution by normalized phrase key.

## UX Pattern

- Show parsed chips immediately.
- Ambiguous chips get warning color + dropdown alternatives.
- Allow quick correction:
  - keyboard arrows + enter
  - click-to-replace candidate

## Known Ambiguity Zones

- "by weight" / "varies" entries
- container phrases (`sack of ...`)
- ammo bundles vs single ammo units
- horse-mounted text qualifiers (`while rations on horse`)

## Implementation Order

1. Deterministic chunk/quantity extractor (already enough for many cases)
2. Fuse resolver against current catalog
3. Confidence and alternatives
4. winkNLP-assisted boundary improvements
5. UI correction pass

