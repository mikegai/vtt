import { SIXTHS_PER_STONE } from './types'
import { encumbranceCostSixths } from './rules'
import type { ItemDefinition } from './types'
import type { WieldGrip } from './types'

export type WeaponHandedness = 'twoHandedOnly' | 'handy' | 'versatile' | 'oneHanded'

/** Match canonicalName (or itemDefId) to weapon handedness. */
const WEAPON_MAP: { pattern: RegExp | string; handedness: WeaponHandedness }[] = [
  // Shields (one-handed, left or right)
  { pattern: /shield/i, handedness: 'oneHanded' },
  // Two-handed only (bows, great weapons, polearms, etc.)
  { pattern: /arbalest/i, handedness: 'twoHandedOnly' },
  { pattern: /crossbow/i, handedness: 'twoHandedOnly' },
  { pattern: /long bow|longbow/i, handedness: 'twoHandedOnly' },
  { pattern: /composite bow|compositebow/i, handedness: 'twoHandedOnly' },
  { pattern: /great axe|greataxe|long bearded axe/i, handedness: 'twoHandedOnly' },
  { pattern: /two-handed sword|twohanded sword/i, handedness: 'twoHandedOnly' },
  { pattern: /polearm/i, handedness: 'twoHandedOnly' },
  { pattern: /^lance$/i, handedness: 'twoHandedOnly' },
  { pattern: /^spear$/i, handedness: 'twoHandedOnly' },
  { pattern: /morning star|morningstar/i, handedness: 'twoHandedOnly' },
  { pattern: /^staff$/i, handedness: 'twoHandedOnly' },
  { pattern: /staff sling|staffsling/i, handedness: 'twoHandedOnly' },
  { pattern: /^net$/i, handedness: 'twoHandedOnly' },
  // Handy (missile, can use 1-handed with shield)
  { pattern: /short bow|shortbow/i, handedness: 'handy' },
  { pattern: /dart/i, handedness: 'handy' },
  { pattern: /javelin/i, handedness: 'handy' },
  { pattern: /^sling$/i, handedness: 'handy' },
  // Versatile (can be 1H or 2H - swords, battle axe, etc.)
  { pattern: /short sword|shortsword|scimitar/i, handedness: 'oneHanded' },
  { pattern: /sword/i, handedness: 'versatile' },
  { pattern: /battle axe|battleaxe/i, handedness: 'versatile' },
  { pattern: /flail/i, handedness: 'versatile' },
  { pattern: /^mace$/i, handedness: 'versatile' },
  { pattern: /warhammer|war hammer/i, handedness: 'versatile' },
  // One-handed only
  { pattern: /dagger|knife/i, handedness: 'oneHanded' },
  { pattern: /hand axe|handaxe/i, handedness: 'oneHanded' },
  { pattern: /^club$/i, handedness: 'oneHanded' },
  { pattern: /bola/i, handedness: 'oneHanded' },
  { pattern: /cestus/i, handedness: 'oneHanded' },
  { pattern: /^sap$/i, handedness: 'oneHanded' },
  { pattern: /whip/i, handedness: 'oneHanded' },
  { pattern: /^rock$/i, handedness: 'oneHanded' },
]

const matchHandedness = (name: string): WeaponHandedness | null => {
  const normalized = name.trim().toLowerCase()
  for (const { pattern, handedness } of WEAPON_MAP) {
    const regex = typeof pattern === 'string' ? new RegExp(pattern, 'i') : pattern
    if (regex.test(normalized)) return handedness
  }
  return null
}

/**
 * Returns wield options for an item.
 * - Weapons/shields: use handedness (twoHandedOnly, handy, versatile, oneHanded).
 * - Other items 1 stone or above (standard, bulky): "Wield left", "Wield right", "Wield 2-handed".
 * - Armor and sub-1-stone items: null.
 */
export const getWieldOptions = (itemDef: ItemDefinition): WieldGrip[] | null => {
  const handedness = matchHandedness(itemDef.canonicalName)
  if (handedness) {
    switch (handedness) {
      case 'twoHandedOnly':
        return ['both']
      case 'handy':
      case 'versatile':
        return ['left', 'right', 'both']
      case 'oneHanded':
        return ['left', 'right']
      default:
        return null
    }
  }

  // Generic: anything 1 stone or above (except armor) is wieldable
  if (itemDef.kind === 'armor') return null
  const sixthsPerUnit = encumbranceCostSixths(itemDef, 1)
  if (sixthsPerUnit >= SIXTHS_PER_STONE) return ['left', 'right', 'both']
  return null
}

/** Check if an item supports wield options. */
export const isWieldableWeapon = (itemDef: ItemDefinition): boolean =>
  getWieldOptions(itemDef) !== null

/** True if item can only be wielded 2-handed (bows, polearms, etc). Loses both hands if either is reassigned. */
export const isTwoHandedOnly = (itemDef: ItemDefinition): boolean => {
  const opts = getWieldOptions(itemDef)
  return opts !== null && opts.length === 1 && opts[0] === 'both'
}
