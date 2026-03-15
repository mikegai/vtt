import { describe, expect, it } from 'vitest'
import { packDeterministic, type PackInput } from '../domain/packing'
import { stoneToSixths } from '../domain/rules'
import type { InventoryEntry, ItemDefinition } from '../domain/types'

const defs: Record<string, ItemDefinition> = {
  armor: { id: 'armor', canonicalName: 'Plate Armor', kind: 'armor', armorClass: 6 },
  shield: { id: 'shield', canonicalName: 'Steel shield', kind: 'bulky' },
  sword: { id: 'sword', canonicalName: 'Long sword', kind: 'bulky' },
  pole: { id: 'pole', canonicalName: 'Pole, Wooden', kind: 'bulky' },
  rope: { id: 'rope', canonicalName: "50' rope", kind: 'standard', sixthsPerUnit: 6 },
  torch: { id: 'torch', canonicalName: 'Torch', kind: 'standard', sixthsPerUnit: 1 },
  fiveSixths: { id: 'fiveSixths', canonicalName: '5/6 item', kind: 'standard', sixthsPerUnit: 5 },
}

const mkEntry = (id: string, itemDefId: string, zone: InventoryEntry['zone'], quantity = 1): InventoryEntry => ({
  id,
  actorId: 'a',
  itemDefId,
  quantity,
  zone,
})

const asInput = (entry: InventoryEntry): PackInput => ({ entry, definition: defs[entry.itemDefId] })

describe('deterministic packing', () => {
  it('honors worn->attached->accessible->stowed ordering', () => {
    const items = [
      asInput(mkEntry('c', 'torch', 'stowed', 1)),
      asInput({ ...mkEntry('a', 'armor', 'worn', 1), state: { worn: true } }),
      asInput(mkEntry('b', 'shield', 'attached', 1)),
    ]

    const packed = packDeterministic(items, stoneToSixths(20))
    expect(packed[0].itemDefId).toBe('armor')
    expect(packed[1].itemDefId).toBe('shield')
    expect(packed[2].itemDefId).toBe('torch')
  })

  it('is stable for identical input', () => {
    const items = [
      asInput(mkEntry('a', 'torch', 'stowed', 2)),
      asInput(mkEntry('b', 'torch', 'stowed', 2)),
    ]
    const first = packDeterministic(items, stoneToSixths(20))
    const second = packDeterministic(items, stoneToSixths(20))
    expect(second).toEqual(first)
  })

  it('marks overflow when capacity exceeded', () => {
    const items = [asInput(mkEntry('a', 'armor', 'worn', 1))]
    const packed = packDeterministic(items, stoneToSixths(3))
    expect(packed.some((segment) => segment.isOverflow)).toBe(true)
  })

  it('caps accessible misc items to one stone before overflow', () => {
    const items = [asInput(mkEntry('a', 'torch', 'accessible', 8))]
    const packed = packDeterministic(items, stoneToSixths(20))
    const placed = packed.find((segment) => !segment.isOverflow)
    const overflow = packed.find((segment) => segment.isOverflow)
    expect(placed?.sizeSixths).toBe(stoneToSixths(1))
    expect(overflow?.sizeSixths).toBe(2)
  })

  it('aligns whole-stone items to stone boundaries so 1-stone items do not span 2', () => {
    const items = [
      asInput({ ...mkEntry('a', 'armor', 'worn', 1), state: { worn: true } }),
      asInput(mkEntry('b', 'fiveSixths', 'stowed', 1)),
      asInput(mkEntry('c', 'rope', 'stowed', 1)),
    ]
    const packed = packDeterministic(items, stoneToSixths(20))
    const ropeSegment = packed.find((s) => s.itemDefId === 'rope' && !s.isOverflow)
    expect(ropeSegment).toBeDefined()
    expect(ropeSegment!.startSixth % 6).toBe(0)
    expect(ropeSegment!.sizeSixths).toBe(6)
  })

  it('packs full-stone items first: armor, shields, weapons, poles, other 1-stone; small items last', () => {
    const items = [
      asInput(mkEntry('f', 'torch', 'stowed', 1)),
      asInput(mkEntry('e', 'rope', 'stowed', 1)),
      asInput(mkEntry('d', 'pole', 'stowed', 1)),
      asInput(mkEntry('c', 'sword', 'stowed', 1)),
      asInput(mkEntry('b', 'shield', 'attached', 1)),
      asInput({ ...mkEntry('a', 'armor', 'worn', 1), state: { worn: true } }),
    ]
    const packed = packDeterministic(items, stoneToSixths(20))
    const placed = packed.filter((s) => !s.isOverflow).map((s) => s.itemDefId)
    expect(placed).toEqual(['armor', 'shield', 'sword', 'pole', 'rope', 'torch'])
  })
})
