import { describe, expect, it } from 'vitest'
import { extractQuantityAndName, parseInventoryText, splitInventoryClauses } from '../domain/inventory-text-parser'

describe('inventory text parser', () => {
  it('splits clauses using commas and "and"', () => {
    const clauses = splitInventoryClauses('2 sacks, 14 torches and 3 flasks of oil')
    expect(clauses).toEqual(['2 sacks', '14 torches', '3 flasks of oil'])
  })

  it('extracts quantity and normalized candidate names', () => {
    expect(extractQuantityAndName('6 rolls of Varangian silk cloth')).toEqual({
      quantity: 6,
      candidateName: 'Varangian silk cloth',
    })
    expect(extractQuantityAndName('an shield')).toEqual({
      quantity: 1,
      candidateName: 'shield',
    })
  })

  it('extracts and strips stone/weight notation', () => {
    expect(extractQuantityAndName('mysterious artifact (4 st.)')).toEqual({
      quantity: 1,
      candidateName: 'mysterious artifact',
      stoneOverride: 4,
    })
    expect(extractQuantityAndName('chest weighing 4 stone')).toEqual({
      quantity: 1,
      candidateName: 'chest',
      stoneOverride: 4,
    })
    expect(extractQuantityAndName('heavy box 2 st')).toEqual({
      quantity: 1,
      candidateName: 'heavy box',
      stoneOverride: 2,
    })
    expect(extractQuantityAndName('small item 1/6 stone')).toEqual({
      quantity: 1,
      candidateName: 'small item',
      stoneOverride: 1 / 6,
    })
    expect(extractQuantityAndName('2 torches (1 st.)')).toEqual({
      quantity: 2,
      candidateName: 'torches',
      stoneOverride: 1,
    })
  })

  it('resolves obvious catalog items and keeps unknowns', () => {
    const parsed = parseInventoryText('plate armor, shield, short sword, 2 sacks of silver dust')
    expect(parsed.chunks.length).toBe(4)

    const plate = parsed.chunks[0]
    const shield = parsed.chunks[1]
    const sword = parsed.chunks[2]
    const dust = parsed.chunks[3]

    expect(plate?.status).toBe('resolved')
    expect(plate?.resolvedItemName?.toLowerCase()).toContain('plate armor')
    expect(shield?.status).toBe('resolved')
    expect(shield?.resolvedItemName?.toLowerCase()).toContain('shield')
    expect(sword?.status).toBe('resolved')
    expect(sword?.resolvedItemName?.toLowerCase()).toContain('short sword')
    expect(dust?.status).not.toBe('resolved')
  })

  it('merges prototypeName hint with ornate text for catalog search', () => {
    const parsed = parseInventoryText('a green musty iron-class spellbook', undefined, {
      prototypeName: 'Treatise, Apprentice',
    })
    expect(parsed.chunks.length).toBe(1)
    const chunk = parsed.chunks[0]
    expect(chunk?.resolvedItemName ?? chunk?.alternatives[0]?.itemName).toContain('Treatise')
  })

  it('ignores prototypeName when text splits into multiple clauses', () => {
    const withHint = parseInventoryText('plate armor, shield', undefined, { prototypeName: 'sword' })
    const noHint = parseInventoryText('plate armor, shield')
    expect(withHint.chunks.map((c) => c.alternatives.map((a) => a.itemId))).toEqual(
      noHint.chunks.map((c) => c.alternatives.map((a) => a.itemId)),
    )
  })
})

