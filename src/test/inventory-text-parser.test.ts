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
})

