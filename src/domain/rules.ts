import { BASE_CAPACITY_SIXTHS, SIXTHS_PER_STONE, type Actor, type ItemDefinition } from './types'

export type SpeedBand = 'green' | 'yellow' | 'orange' | 'red'

export type SpeedProfile = {
  readonly explorationFeet: number
  readonly combatFeet: number
  readonly runningFeet: number
  readonly milesPerDay: number
  readonly band: SpeedBand
}

export type BaseSpeedProfile = Omit<SpeedProfile, 'band'>

export const defaultBaseSpeedProfile: BaseSpeedProfile = {
  explorationFeet: 120,
  combatFeet: 40,
  runningFeet: 120,
  milesPerDay: 24,
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

/** For animals/vehicles: green at ≤50% capacity, orange above. */
export const speedBandForAnimalOrVehicle = (
  encumbranceSixths: number,
  capacitySixths: number,
): SpeedBand =>
  encumbranceSixths <= capacitySixths / 2 ? 'green' : 'orange'

/** For animals/vehicles: 100% base speed at ≤50% capacity, 50% base speed above. */
export const speedProfileForAnimalOrVehicle = (
  encumbranceSixths: number,
  capacitySixths: number,
  baseProfile: BaseSpeedProfile,
): SpeedProfile => {
  const band = speedBandForAnimalOrVehicle(encumbranceSixths, capacitySixths)
  if (band === 'green') {
    return { ...baseProfile, band }
  }
  return {
    explorationFeet: Math.round(baseProfile.explorationFeet / 2),
    combatFeet: Math.round(baseProfile.combatFeet / 2),
    runningFeet: Math.round(baseProfile.runningFeet / 2),
    milesPerDay: Math.round(baseProfile.milesPerDay / 2),
    band: 'orange',
  }
}

/** Every 7 daily iron rations, 2 pack into one slot. Effective encumbrance = n - floor(n/7). */
export const ironRationEffectiveSixths = (count: number): number => count - Math.floor(count / 7)

export const encumbranceCostSixths = (item: ItemDefinition, quantity: number): number => {
  switch (item.kind) {
    case 'armor':
      return armorAcToSixths(item.armorClass ?? 0) * quantity
    case 'bulky':
      return stoneToSixths(1) * quantity
    case 'coins':
      return coinsToSixths(quantity)
    case 'standard': {
      if (item.coinagePool) return coinsToSixths(quantity)
      return (item.sixthsPerUnit ?? 1) * quantity
    }
    case 'bundled': {
      const bundle = Math.max(1, item.bundleSize ?? 20)
      const minC = Math.max(1, item.minToCount ?? 1)
      const effective = Math.max(0, quantity - (minC - 1))
      const bundles = Math.ceil(effective / bundle)
      const per = item.sixthsPerBundle ?? 1
      return bundles * per
    }
    default: {
      const _never: never = item.kind
      return _never
    }
  }
}

export const isAccessibleMiscWithinLimit = (totalMiscAccessibleSixths: number): boolean =>
  totalMiscAccessibleSixths <= ACCESSIBLE_MISC_LIMIT_SIXTHS
