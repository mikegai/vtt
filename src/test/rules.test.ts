import { describe, expect, it } from 'vitest'
import {
  armorAcToSixths,
  capacitySixthsForActor,
  capacitySixthsForAnimal,
  capacitySixthsForStrengthMod,
  coinsToSixths,
  defaultBaseSpeedProfile,
  encumbranceCostSixths,
  ironRationEffectiveSixths,
  speedBandForAnimalOrVehicle,
  speedBandForSixths,
  speedProfileForAnimalOrVehicle,
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

  it('converts coin weight: 1000 units per stone (fractional sixths allowed)', () => {
    expect(coinsToSixths(1000)).toBe(6)
    expect(coinsToSixths(730)).toBeCloseTo(4.38, 5)
    expect(coinsToSixths(500)).toBe(3)
  })

  it('uses armor AC as stone cost', () => {
    expect(armorAcToSixths(6)).toBe(stoneToSixths(6))
    const plate: ItemDefinition = { id: 'plate', canonicalName: 'Plate Armor', kind: 'armor', armorClass: 6 }
    expect(encumbranceCostSixths(plate, 1)).toBe(stoneToSixths(6))
  })

  it('bundled items: encumbrance steps by full bundles after minToCount', () => {
    const spikes: ItemDefinition = {
      id: 'spikes',
      canonicalName: 'Iron spike',
      kind: 'bundled',
      bundleSize: 20,
      minToCount: 1,
      sixthsPerBundle: 1,
    }
    expect(encumbranceCostSixths(spikes, 20)).toBe(1)
    expect(encumbranceCostSixths(spikes, 40)).toBe(2)
  })

  it('standard with coinage pool uses coin weight', () => {
    const tradeBars: ItemDefinition = {
      id: 'bars',
      canonicalName: 'Trade bars',
      kind: 'standard',
      coinagePool: true,
    }
    expect(encumbranceCostSixths(tradeBars, 1000)).toBe(coinsToSixths(1000))
  })

  it('coinage pool gem (priceInGp, no coinDenom) is zero encumbrance on its own row (weight in merged coin bar)', () => {
    const gem: ItemDefinition = {
      id: 'ruby',
      canonicalName: 'Ruby',
      kind: 'standard',
      coinagePool: true,
      priceInGp: 500,
    }
    expect(encumbranceCostSixths(gem, 1)).toBe(0)
    expect(encumbranceCostSixths(gem, 2)).toBe(0)
  })

  it('iron rations: every 7, 2 pack into one slot (effective sixths = n - floor(n/7))', () => {
    expect(ironRationEffectiveSixths(5)).toBe(5)
    expect(ironRationEffectiveSixths(6)).toBe(6)
    expect(ironRationEffectiveSixths(7)).toBe(6)
    expect(ironRationEffectiveSixths(8)).toBe(7)
    expect(ironRationEffectiveSixths(14)).toBe(12)
    expect(ironRationEffectiveSixths(15)).toBe(13)
  })

  describe('animal/vehicle encumbrance (50% breakpoint)', () => {
    it('speedBandForAnimalOrVehicle: green at ≤50% capacity, orange above', () => {
      const cap60 = stoneToSixths(60)
      expect(speedBandForAnimalOrVehicle(0, cap60)).toBe('green')
      expect(speedBandForAnimalOrVehicle(stoneToSixths(30), cap60)).toBe('green')
      expect(speedBandForAnimalOrVehicle(stoneToSixths(30) + 1, cap60)).toBe('orange')
      expect(speedBandForAnimalOrVehicle(cap60, cap60)).toBe('orange')
    })

    it('speedProfileForAnimalOrVehicle: full base at ≤50%, halved above', () => {
      const cap60 = stoneToSixths(60)
      const at25 = speedProfileForAnimalOrVehicle(stoneToSixths(15), cap60, defaultBaseSpeedProfile)
      expect(at25.band).toBe('green')
      expect(at25.explorationFeet).toBe(120)
      expect(at25.combatFeet).toBe(40)
      expect(at25.milesPerDay).toBe(24)

      const at75 = speedProfileForAnimalOrVehicle(stoneToSixths(45), cap60, defaultBaseSpeedProfile)
      expect(at75.band).toBe('orange')
      expect(at75.explorationFeet).toBe(60)
      expect(at75.combatFeet).toBe(20)
      expect(at75.milesPerDay).toBe(12)
    })

    it('speedProfileForAnimalOrVehicle: custom base profile halves correctly', () => {
      const cap50 = stoneToSixths(50)
      const muleBase = { explorationFeet: 90, combatFeet: 30, runningFeet: 90, milesPerDay: 18 }
      const encumbered = speedProfileForAnimalOrVehicle(stoneToSixths(30), cap50, muleBase)
      expect(encumbered.band).toBe('orange')
      expect(encumbered.explorationFeet).toBe(45)
      expect(encumbered.combatFeet).toBe(15)
      expect(encumbered.milesPerDay).toBe(9)
    })
  })
})
