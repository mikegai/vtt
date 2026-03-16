import { describe, expect, it } from 'vitest'
import {
  armorAcToSixths,
  capacitySixthsForActor,
  capacitySixthsForAnimal,
  capacitySixthsForStrengthMod,
  coinsToSixths,
  encumbranceCostSixths,
  formatSixthsAsStone,
  ironRationEffectiveSixths,
  speedBandForSixths,
  stoneToSixths,
} from '../domain/rules'
import type { Actor, ItemDefinition } from '../domain/types'

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

  it('uses capacityStone for animals', () => {
    expect(capacitySixthsForAnimal(50)).toBe(stoneToSixths(50))
    expect(capacitySixthsForAnimal(60)).toBe(stoneToSixths(60))
  })

  it('capacitySixthsForActor uses capacityStone for animals, strength for PCs', () => {
    const pc: Actor = {
      id: 'pc',
      name: 'PC',
      kind: 'pc',
      stats: { strengthMod: 2, hasLoadBearing: false },
      movementGroupId: 'party',
      active: true,
    }
    const mule: Actor = {
      id: 'mule',
      name: 'Mule',
      kind: 'animal',
      stats: { strengthMod: 0, hasLoadBearing: false },
      movementGroupId: 'party',
      active: true,
      ownerActorId: 'pc',
      capacityStone: 50,
    }
    expect(capacitySixthsForActor(pc)).toBe(stoneToSixths(22))
    expect(capacitySixthsForActor(mule)).toBe(stoneToSixths(50))
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

  it('iron rations: every 7, 2 pack into one slot (effective sixths = n - floor(n/7))', () => {
    expect(ironRationEffectiveSixths(5)).toBe(5)
    expect(ironRationEffectiveSixths(6)).toBe(6)
    expect(ironRationEffectiveSixths(7)).toBe(6)
    expect(ironRationEffectiveSixths(8)).toBe(7)
    expect(ironRationEffectiveSixths(14)).toBe(12)
    expect(ironRationEffectiveSixths(15)).toBe(13)
  })

})
