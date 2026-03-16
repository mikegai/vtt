import type { ItemDefinition } from './types'
import type { WieldGrip } from './types'

export type WeaponHandedness = 'twoHandedOnly' | 'handy' | 'versatile' | 'oneHanded'

/** Match canonicalName (or itemDefId) to weapon handedness. */
const WEAPON_MAP: { pattern: RegExp | string; handedness: WeaponHandedness }[] = [
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
 * Returns wield options for a weapon item. Non-weapons return null.
 * - twoHandedOnly: only "Wield 2-handed"
 * - handy or versatile: "Wield left", "Wield right", "Wield 2-handed"
 * - oneHanded: "Wield left", "Wield right"
 */
export const getWieldOptions = (itemDef: ItemDefinition): WieldGrip[] | null => {
  const handedness = matchHandedness(itemDef.canonicalName)
  if (!handedness) return null

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

/** Check if an item is a weapon that supports wield options. */
export const isWieldableWeapon = (itemDef: ItemDefinition): boolean =>
  getWieldOptions(itemDef) !== null
