import { BASE_CAPACITY_SIXTHS, SIXTHS_PER_STONE, type Actor, type ItemDefinition } from './types'

export type SpeedBand = 'green' | 'yellow' | 'orange' | 'red'

export type SpeedProfile = {
  readonly explorationFeet: 120 | 90 | 60 | 30
  readonly combatFeet: 40 | 30 | 20 | 10
  readonly runningFeet: 120 | 90 | 60 | 30
  readonly milesPerDay: 24 | 18 | 12 | 6
  readonly band: SpeedBand
}

export const ACCESSIBLE_MISC_LIMIT_SIXTHS = SIXTHS_PER_STONE

export const sixthsToStone = (sixths: number): number => sixths / SIXTHS_PER_STONE

export const stoneToSixths = (stone: number): number => stone * SIXTHS_PER_STONE

/** Format sixths as "X stone" or "X Y/6 stone" (e.g. "9 4/6 stone") to avoid decimal display. */
export const formatSixthsAsStone = (sixths: number): string => {
  const n = Math.round(sixths)
  const whole = Math.floor(n / SIXTHS_PER_STONE)
  const frac = n % SIXTHS_PER_STONE
  if (frac === 0) return `${whole} stone`
  return `${whole} ${frac}/6 stone`
}

export const armorAcToSixths = (armorClass: number): number => stoneToSixths(armorClass)

export const coinsToSixths = (coins: number): number => Math.ceil(coins / 167)

export const capacitySixthsForStrengthMod = (strengthMod: number): number => {
  const capacity = BASE_CAPACITY_SIXTHS + stoneToSixths(strengthMod)
  return Math.max(0, capacity)
}

/** For animals with capacityStone (e.g. mule 50, medium riding horse 60). */
export const capacitySixthsForAnimal = (capacityStone: number): number =>
  stoneToSixths(capacityStone)

/** Capacity in sixths for any actor (PC uses strength, animal uses capacityStone). */
export const capacitySixthsForActor = (actor: Actor): number =>
  actor.capacityStone != null
    ? capacitySixthsForAnimal(actor.capacityStone)
    : capacitySixthsForStrengthMod(actor.stats.strengthMod)

const speedTable: Record<SpeedBand, Omit<SpeedProfile, 'band'>> = {
  green: { explorationFeet: 120, combatFeet: 40, runningFeet: 120, milesPerDay: 24 },
  yellow: { explorationFeet: 90, combatFeet: 30, runningFeet: 90, milesPerDay: 18 },
  orange: { explorationFeet: 60, combatFeet: 20, runningFeet: 60, milesPerDay: 12 },
  red: { explorationFeet: 30, combatFeet: 10, runningFeet: 30, milesPerDay: 6 },
}

export const speedBandForSixths = (encumbranceSixths: number, hasLoadBearing: boolean): SpeedBand => {
  const shift = hasLoadBearing ? stoneToSixths(2) : 0
  if (encumbranceSixths <= stoneToSixths(5) + shift) return 'green'
  if (encumbranceSixths <= stoneToSixths(7) + shift) return 'yellow'
  if (encumbranceSixths <= stoneToSixths(10) + shift) return 'orange'
  return 'red'
}

export const speedProfileForSixths = (encumbranceSixths: number, hasLoadBearing: boolean): SpeedProfile => {
  const band = speedBandForSixths(encumbranceSixths, hasLoadBearing)
  return { ...speedTable[band], band }
}

export const encumbranceCostSixths = (item: ItemDefinition, quantity: number): number => {
  switch (item.kind) {
    case 'armor':
      return armorAcToSixths(item.armorClass ?? 0) * quantity
    case 'bulky':
      return stoneToSixths(1) * quantity
    case 'coins':
      return coinsToSixths(quantity)
    case 'standard':
      return (item.sixthsPerUnit ?? 1) * quantity
    default: {
      const _never: never = item.kind
      return _never
    }
  }
}

export const isAccessibleMiscWithinLimit = (totalMiscAccessibleSixths: number): boolean =>
  totalMiscAccessibleSixths <= ACCESSIBLE_MISC_LIMIT_SIXTHS
