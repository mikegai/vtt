import { describe, expect, it } from 'vitest'
import {
  armorAcToSixths,
  capacitySixthsForStrengthMod,
  coinsToSixths,
  encumbranceCostSixths,
  speedBandForSixths,
  stoneToSixths,
} from '../domain/rules'
import type { ItemDefinition } from '../domain/types'

describe('ACKS rules', () => {
  it('maps base speed breakpoints', () => {
    expect(speedBandForSixths(stoneToSixths(5), false)).toBe('green')
    expect(speedBandForSixths(stoneToSixths(6), false)).toBe('yellow')
    expect(speedBandForSixths(stoneToSixths(8), false)).toBe('orange')
    expect(speedBandForSixths(stoneToSixths(11), false)).toBe('red')
  })

  it('shifts breakpoints with load bearing', () => {
    expect(speedBandForSixths(stoneToSixths(7), true)).toBe('green')
    expect(speedBandForSixths(stoneToSixths(8), true)).toBe('yellow')
    expect(speedBandForSixths(stoneToSixths(10), true)).toBe('orange')
    expect(speedBandForSixths(stoneToSixths(13), true)).toBe('red')
  })

  it('applies strength modifier only to capacity', () => {
    expect(capacitySixthsForStrengthMod(0)).toBe(stoneToSixths(20))
    expect(capacitySixthsForStrengthMod(2)).toBe(stoneToSixths(22))
    expect(capacitySixthsForStrengthMod(-1)).toBe(stoneToSixths(19))
  })

  it('converts coin weight using ACKS coin thresholds', () => {
    expect(coinsToSixths(167)).toBe(1)
    expect(coinsToSixths(1000)).toBe(6)
  })

  it('uses armor AC as stone cost', () => {
    expect(armorAcToSixths(6)).toBe(stoneToSixths(6))
    const plate: ItemDefinition = { id: 'plate', canonicalName: 'Plate Armor', kind: 'armor', armorClass: 6 }
    expect(encumbranceCostSixths(plate, 1)).toBe(stoneToSixths(6))
  })
})
