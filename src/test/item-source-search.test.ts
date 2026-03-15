import { describe, expect, it } from 'vitest'
import { createSourceItemSearchIndex } from '../domain/item-source-search'

describe('item source fuzzy search', () => {
  const index = createSourceItemSearchIndex()

  it('finds close fuzzy matches by name', () => {
    const hits = index.search('tinder box', 5)
    expect(hits.length).toBeGreaterThan(0)
    expect(hits[0]?.item.name).toContain('Tinderbox')
  })

  it('supports group filter', () => {
    const hits = index.search('shield', 10, { groups: ['armor-and-barding'] })
    expect(hits.length).toBeGreaterThan(0)
    for (const hit of hits) {
      expect(hit.item.group).toBe('armor-and-barding')
    }
  })

  it('supports encumbrance-kind filter', () => {
    const hits = index.search('', 20, { encumbranceKinds: ['by-weight'] })
    expect(hits.length).toBeGreaterThan(0)
    for (const hit of hits) {
      expect(hit.item.encumbrance.kind).toBe('by-weight')
    }
  })

  it('supports category token filtering in query text', () => {
    const hits = index.search('category:weapons dagger', 10)
    expect(hits.length).toBeGreaterThan(0)
    for (const hit of hits) {
      expect(hit.item.group).toBe('weapons')
    }
  })

  it('suggests category tokens from query context', () => {
    const suggestions = index.suggest('shield priest')
    expect(suggestions.length).toBeGreaterThan(0)
    expect(suggestions.some((suggestion) => suggestion.token.startsWith('category:'))).toBe(true)
  })

  it('suggests category completion tokens while typing', () => {
    const suggestions = index.suggest('category:w')
    expect(suggestions.map((suggestion) => suggestion.token)).toContain('category:weapons')
  })

  it('supports enc token filtering in query text', () => {
    const hits = index.search('enc:by-weight', 10)
    expect(hits.length).toBeGreaterThan(0)
    for (const hit of hits) {
      expect(hit.item.encumbrance.kind).toBe('by-weight')
    }
  })

  it('extracts active chips from multi-token query', () => {
    const analyzed = index.analyzeQuery('category:armor enc:fixed name:"holy symbol"')
    expect(analyzed.activeTags.some((tag) => tag.kind === 'category' && tag.value === 'armor')).toBe(true)
    expect(analyzed.activeTags.some((tag) => tag.kind === 'enc' && tag.value === 'fixed')).toBe(true)
    expect(analyzed.activeTags.some((tag) => tag.kind === 'name' && tag.value === 'holy symbol')).toBe(true)
  })
})

