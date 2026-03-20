import { describe, expect, it } from 'vitest'
import { resolveAddItemsCatalogMatch } from '../domain/add-items-catalog-match'
import type { ItemCatalogRow } from '../domain/types'

const catalog: readonly ItemCatalogRow[] = [
  { id: 'a', canonicalName: 'Short Sword', kind: 'standard', sixthsPerUnit: 1 },
  { id: 'b', canonicalName: 'Sword', kind: 'standard', sixthsPerUnit: 1 },
  { id: 'c', canonicalName: 'Leather Armor', kind: 'armor', sixthsPerUnit: 12 },
]

describe('add-items catalog match', () => {
  it('resolves single exact hit', () => {
    const m = resolveAddItemsCatalogMatch('short sword', undefined, catalog)
    expect(m.status).toBe('resolved')
    expect(m.resolvedItemId).toBe('a')
  })

  it('prefers prototypeName when both given', () => {
    const m = resolveAddItemsCatalogMatch('ornate blade', 'Sword', [...catalog])
    expect(m.status).toBe('resolved')
    expect(m.resolvedItemId).toBe('b')
  })

  it('returns ambiguous when two defs share normalized name', () => {
    const dup: ItemCatalogRow[] = [
      { id: 'x', canonicalName: 'Sword', kind: 'standard', sixthsPerUnit: 1 },
      { id: 'y', canonicalName: 'Sword', kind: 'standard', sixthsPerUnit: 1 },
    ]
    const m = resolveAddItemsCatalogMatch('sword', undefined, dup)
    expect(m.status).toBe('ambiguous')
    expect(m.alternatives.length).toBe(2)
  })

  it('unknown when no exact match', () => {
    const m = resolveAddItemsCatalogMatch('pants', undefined, catalog)
    expect(m.status).toBe('unknown')
    expect(m.alternatives.length).toBe(0)
  })

  it('empty catalog yields unknown', () => {
    const m = resolveAddItemsCatalogMatch('anything', undefined, [])
    expect(m.status).toBe('unknown')
    expect(m.alternatives.length).toBe(0)
  })
})
