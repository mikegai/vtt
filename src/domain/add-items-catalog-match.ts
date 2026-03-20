import type { ItemCatalogRow } from './types'
import { singularizeInventoryWord } from './inventory-text-parser'

export type AddItemsMatchAlternative = {
  readonly itemId: string
  readonly itemName: string
  readonly score: number
}

const MAX_ALTS = 10

const nameKeys = (phrase: string): readonly string[] => {
  const t = phrase.trim().toLowerCase()
  if (!t) return []
  const s = singularizeInventoryWord(t)
  return s !== t ? [t, s] : [t]
}

/** Index canonical names (plain + singular) → rows (dedup by id per bucket in collect). */
const buildNameIndex = (catalog: readonly ItemCatalogRow[]): Map<string, ItemCatalogRow[]> => {
  const index = new Map<string, ItemCatalogRow[]>()
  for (const row of catalog) {
    for (const key of nameKeys(row.canonicalName)) {
      const list = index.get(key)
      if (list) {
        if (!list.some((r) => r.id === row.id)) list.push(row)
      } else {
        index.set(key, [row])
      }
    }
  }
  return index
}

const collectExact = (keys: readonly string[], index: Map<string, ItemCatalogRow[]>): ItemCatalogRow[] => {
  const seen = new Set<string>()
  const out: ItemCatalogRow[] = []
  for (const k of keys) {
    const bucket = index.get(k)
    if (!bucket) continue
    for (const row of bucket) {
      if (seen.has(row.id)) continue
      seen.add(row.id)
      out.push(row)
    }
  }
  return out
}

/** Exact canonical name match only (no Fuse). */
export const resolveAddItemsCatalogMatch = (
  candidateName: string,
  prototypeName: string | undefined,
  catalog: readonly ItemCatalogRow[],
): {
  status: 'resolved' | 'ambiguous' | 'unknown'
  confidence: number
  resolvedItemId?: string
  resolvedItemName?: string
  alternatives: readonly AddItemsMatchAlternative[]
} => {
  if (catalog.length === 0) {
    return { status: 'unknown', confidence: 0, alternatives: [] }
  }

  const index = buildNameIndex(catalog)

  const tryKeys: string[][] = []
  if (prototypeName?.trim()) {
    tryKeys.push([...nameKeys(prototypeName.trim())])
  }
  tryKeys.push([...nameKeys(candidateName)])

  let hits: ItemCatalogRow[] = []
  for (const keys of tryKeys) {
    const found = collectExact(keys, index)
    if (found.length > 0) {
      hits = found
      break
    }
  }

  if (hits.length === 0) {
    return { status: 'unknown', confidence: 0, alternatives: [] }
  }

  const capped = hits.slice(0, MAX_ALTS)
  const alternatives: AddItemsMatchAlternative[] = capped.map((h) => ({
    itemId: h.id,
    itemName: h.canonicalName,
    score: 0,
  }))

  if (hits.length === 1 && capped.length === 1) {
    const top = capped[0]!
    return {
      status: 'resolved',
      confidence: 1,
      resolvedItemId: top.id,
      resolvedItemName: top.canonicalName,
      alternatives,
    }
  }

  return {
    status: 'ambiguous',
    confidence: 0.75,
    alternatives,
  }
}
