import { stoneToSixths } from './rules'

export type EncumbranceExpr =
  | { readonly kind: 'fixed'; readonly sixths: number }
  | { readonly kind: 'range'; readonly minSixths: number; readonly maxSixths: number }
  | { readonly kind: 'at-least'; readonly minSixths: number }
  | { readonly kind: 'by-weight' }
  | { readonly kind: 'varies' }
  | { readonly kind: 'not-carried' }

export type SourceItemGroup = 'armor-and-barding' | 'weapons' | 'adventuring-equipment'

export type SourceItem = {
  readonly id: string
  readonly name: string
  readonly group: SourceItemGroup
  readonly encumbrance: EncumbranceExpr
  readonly tags?: readonly string[]
  readonly notes?: string
}

const slugify = (name: string): string =>
  name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')

const fractionToSixths = (numerator: number, denominator: number): number => {
  const sixths = (numerator * 6) / denominator
  if (!Number.isInteger(sixths)) {
    throw new Error(`Fraction ${numerator}/${denominator} cannot map to sixth-stones exactly`)
  }
  return sixths
}

export const parseSourceEncumbrance = (value: string): EncumbranceExpr => {
  const normalized = value.trim().toLowerCase()

  if (normalized === '-') return { kind: 'not-carried' }
  if (normalized.includes('by weight')) return { kind: 'by-weight' }
  if (normalized.includes('varies')) return { kind: 'varies' }

  const rangeMatch = normalized.match(/^(\d+)\s*-\s*(\d+)$/)
  if (rangeMatch) {
    return {
      kind: 'range',
      minSixths: stoneToSixths(Number(rangeMatch[1])),
      maxSixths: stoneToSixths(Number(rangeMatch[2])),
    }
  }

  const atLeastMatch = normalized.match(/^(\d+)\+$/)
  if (atLeastMatch) {
    return {
      kind: 'at-least',
      minSixths: stoneToSixths(Number(atLeastMatch[1])),
    }
  }

  const fractionMatch = normalized.match(/^(\d+)\/(\d+)$/)
  if (fractionMatch) {
    return {
      kind: 'fixed',
      sixths: fractionToSixths(Number(fractionMatch[1]), Number(fractionMatch[2])),
    }
  }

  const wholeMatch = normalized.match(/^(\d+)$/)
  if (wholeMatch) {
    return {
      kind: 'fixed',
      sixths: stoneToSixths(Number(wholeMatch[1])),
    }
  }

  throw new Error(`Unsupported source encumbrance value: ${value}`)
}

const mk = (
  group: SourceItemGroup,
  name: string,
  enc: string,
  extra?: { readonly tags?: readonly string[]; readonly notes?: string },
): SourceItem => ({
  id: `${group}:${slugify(name)}`,
  name,
  group,
  encumbrance: parseSourceEncumbrance(enc),
  tags: extra?.tags,
  notes: extra?.notes,
})

export const armorAndBardingSourceItems: readonly SourceItem[] = [
  mk('armor-and-barding', 'Hide and Fur Armor', '1'),
  mk('armor-and-barding', 'Padded Armor', '1'),
  mk('armor-and-barding', 'Leather Armor', '2'),
  mk('armor-and-barding', 'Arena Armor, Light', '2', { notes: 'Revealing' }),
  mk('armor-and-barding', 'Ring Mail', '3'),
  mk('armor-and-barding', 'Scale Armor', '3'),
  mk('armor-and-barding', 'Chain Mail Armor', '4'),
  mk('armor-and-barding', 'Laminated Linen Armor', '4'),
  mk('armor-and-barding', 'Arena Armor, Heavy', '4', { notes: 'Revealing' }),
  mk('armor-and-barding', 'Banded Plate Armor', '5'),
  mk('armor-and-barding', 'Lamellar Armor', '5'),
  mk('armor-and-barding', 'Plate Armor', '6', { notes: 'Scarce' }),
  mk('armor-and-barding', 'Shield', '1'),
  mk('armor-and-barding', 'Shield, Mirror', '1'),
  mk('armor-and-barding', 'Helmet, Heavy', '1/6', {
    tags: ['optional-helmet', 'not-included-in-suit-default'],
    notes: 'Extra helmet only; standard helmet is already factored into full armor encumbrance.',
  }),
  mk('armor-and-barding', 'Helmet, Light', '1/6', {
    tags: ['optional-helmet', 'not-included-in-suit-default'],
    notes: 'Extra helmet only; standard helmet is already factored into full armor encumbrance.',
  }),
  mk('armor-and-barding', 'Barding, Leather', 'varies'),
  mk('armor-and-barding', 'Barding, Scale', 'varies'),
  mk('armor-and-barding', 'Barding, Chain', 'varies'),
  mk('armor-and-barding', 'Barding, Lamellar', 'varies'),
  mk('armor-and-barding', 'Barding, Plate', 'varies', { notes: 'Scarce' }),
  mk('armor-and-barding', 'Barding, Spiked', '-', { notes: 'Spiked modifier, no direct encumbrance listed' }),
]

export const weaponsSourceItems: readonly SourceItem[] = [
  mk('weapons', 'Arbalest', '1'),
  mk('weapons', 'Crossbow', '1/6'),
  mk('weapons', 'Case, 20 Bolts', '1/6'),
  mk('weapons', 'Composite Bow', '1'),
  mk('weapons', 'Long Bow', '1'),
  mk('weapons', 'Short Bow', '1/6'),
  mk('weapons', 'Quiver, 20 Arrows', '1/6'),
  mk('weapons', '1 Silver Arrow', '0'),
  mk('weapons', 'Battle Axe', '1/6'),
  mk('weapons', 'Great Axe', '1'),
  mk('weapons', 'Hand Axe', '1/6'),
  mk('weapons', 'Club', '1/6'),
  mk('weapons', 'Flail', '1/6'),
  mk('weapons', 'Mace', '1/6'),
  mk('weapons', 'Morning Star', '1'),
  mk('weapons', 'Warhammer', '1/6'),
  mk('weapons', 'Knife', '1/6'),
  mk('weapons', 'Dagger', '1/6'),
  mk('weapons', 'Silver Dagger', '1/6'),
  mk('weapons', 'Short Sword', '1/6'),
  mk('weapons', 'Sword', '1/6'),
  mk('weapons', 'Two-Handed Sword', '1'),
  mk('weapons', 'Dart (5)', '1/6'),
  mk('weapons', 'Javelin', '1/6'),
  mk('weapons', 'Lance', '1'),
  mk('weapons', 'Polearm', '1'),
  mk('weapons', 'Spear', '1'),
  mk('weapons', 'Bola', '1/6'),
  mk('weapons', 'Military Oil', '1/6'),
  mk('weapons', 'Cestus', '1/6'),
  mk('weapons', 'Net', '1'),
  mk('weapons', 'Rock', '1/6'),
  mk('weapons', 'Sap', '1/6'),
  mk('weapons', 'Sling', '1/6'),
  mk('weapons', 'Staff Sling', '1'),
  mk('weapons', '30 Sling Stones', '1/6'),
  mk('weapons', 'Staff', '1'),
  mk('weapons', 'Whip', '1/6'),
]

export const adventuringSourceItems: readonly SourceItem[] = [
  mk('adventuring-equipment', "Adventurer's Harness", '1/6'),
  mk('adventuring-equipment', 'Archery Target', '2'),
  mk('adventuring-equipment', 'Army Emblem, Silver (1 lb)', '1/6'),
  mk('adventuring-equipment', 'Army Emblem, Gold (1 lb)', '1/6'),
  mk('adventuring-equipment', 'Backpack (holds 4 stone)', '1/6'),
  mk('adventuring-equipment', 'Barrel (20 gallon)', '15'),
  mk('adventuring-equipment', 'Blanket', '1'),
  mk('adventuring-equipment', 'Boardgame', '1'),
  mk('adventuring-equipment', 'Bowquiver', '1/6'),
  mk('adventuring-equipment', 'Candle (tallow, 1 lb)', '1/6'),
  mk('adventuring-equipment', 'Candle (wax, 1 lb)', '1/6'),
  mk('adventuring-equipment', 'Chest, Ironbound (holds 20 st.)', '5'),
  mk('adventuring-equipment', "Craftsman's Tools (any)", '1'),
  mk('adventuring-equipment', "Craftsman's Workshop (any)", '15+'),
  mk('adventuring-equipment', 'Crowbar', '1'),
  mk('adventuring-equipment', 'Crutch', '1'),
  mk('adventuring-equipment', 'Dice', '1/6'),
  mk('adventuring-equipment', 'Disguise Kit', '1'),
  mk('adventuring-equipment', 'Ear Trumpet', '1/6'),
  mk('adventuring-equipment', 'Earplugs', '1/6'),
  mk('adventuring-equipment', 'Firewood Bundle (4 logs)', '2'),
  mk('adventuring-equipment', "Flag, Pennant (3' x 1')", '1/6'),
  mk('adventuring-equipment', "Flag, Banner (6' x 2')", '1'),
  mk('adventuring-equipment', "Flag, Standard (12' x 4')", '4'),
  mk('adventuring-equipment', 'Grappling Hook', '1/6'),
  mk('adventuring-equipment', 'Hammer (small)', '1/6'),
  mk('adventuring-equipment', 'Herb, Aloe (1 lb)', '1/6'),
  mk('adventuring-equipment', 'Herb, Belladonna (1 lb)', '1/6'),
  mk('adventuring-equipment', 'Herb, Birthwort (1 lb)', '1/6'),
  mk('adventuring-equipment', 'Herb, Bitterwood (1 lb)', '1/6'),
  mk('adventuring-equipment', 'Herb, Blessed Thistle (1 lb)', '1/6'),
  mk('adventuring-equipment', 'Herb, Comfrey (1 lb)', '1/6'),
  mk('adventuring-equipment', 'Herb, Garlic (1 lb)', '1/6'),
  mk('adventuring-equipment', 'Herb, Goldenrod (1 lb)', '1/6'),
  mk('adventuring-equipment', 'Herb, Horsetail (1 lb)', '1/6'),
  mk('adventuring-equipment', 'Herb, Lungwort (1 lb)', '1/6'),
  mk('adventuring-equipment', 'Herb, Willow-bark (1 lb)', '1/6'),
  mk('adventuring-equipment', 'Herb, Wolfsbane (1 lb)', '1/6'),
  mk('adventuring-equipment', 'Herb, Woundwort (1 lb)', '1/6'),
  mk('adventuring-equipment', 'Holy Book', '1/2'),
  mk('adventuring-equipment', 'Holy Symbol', '1/6'),
  mk('adventuring-equipment', 'Holy Water (1 pint)', '1/6'),
  mk('adventuring-equipment', 'Ink (1 pint)', '1/6'),
  mk('adventuring-equipment', 'Iron Spikes (6)', '1/6'),
  mk('adventuring-equipment', 'Journal', '1/6'),
  mk('adventuring-equipment', "Laborer's Tools", '1'),
  mk('adventuring-equipment', 'Lantern', '1'),
  mk('adventuring-equipment', 'Lock', '1/6'),
  mk('adventuring-equipment', 'Manacles', '1/6'),
  mk('adventuring-equipment', 'Mess Kit', '1/6'),
  mk('adventuring-equipment', 'Metamphora', 'By Weight'),
  mk('adventuring-equipment', 'Mirror (hand-sized, steel)', '1/6'),
  mk('adventuring-equipment', 'Musical Instrument', '1+'),
  mk('adventuring-equipment', 'Oil, Common (1 pint)', '1/6'),
  mk('adventuring-equipment', 'Oil, Military (1 pint)', '1/6'),
  mk('adventuring-equipment', 'Pavilion (20 men)', '72'),
  mk('adventuring-equipment', 'Pell', '15 - 30'),
  mk('adventuring-equipment', 'Pouch/Purse (holds 1/2 stone)', '1/6'),
  mk('adventuring-equipment', 'Pole, Wooden', '1'),
  mk('adventuring-equipment', 'Prosthesis, Arm', '-'),
  mk('adventuring-equipment', 'Prosthesis, Foot', '-'),
  mk('adventuring-equipment', 'Prosthesis, Hand', '-'),
  mk('adventuring-equipment', 'Prosthesis, Leg', '-'),
  mk('adventuring-equipment', 'Quill, writing', '-'),
  mk('adventuring-equipment', 'Quintain', '20'),
  mk('adventuring-equipment', 'Rations, Iron (one day)', '1/6'),
  mk('adventuring-equipment', 'Rations, Iron (one week)', '1'),
  mk('adventuring-equipment', 'Rations, Standard (one week)', '1'),
  mk('adventuring-equipment', "Rope, 50'", '1'),
  mk('adventuring-equipment', 'Rucksack (holds 2 stone)', '1/6'),
  mk('adventuring-equipment', 'Sack, Large (holds 6 stone)', '1/6'),
  mk('adventuring-equipment', 'Sack, Small (holds 2 stone)', '1/6'),
  mk('adventuring-equipment', 'Saddle and Tack, Draft', '1'),
  mk('adventuring-equipment', 'Saddle and Tack, Riding', '1'),
  mk('adventuring-equipment', 'Saddle and Tack, Military', '1'),
  mk('adventuring-equipment', 'Saddlebag (holds 3 stone)', '1/6'),
  mk('adventuring-equipment', 'Scabbard', '-'),
  mk('adventuring-equipment', 'Special Components, Miscellaneous', 'By Weight'),
  mk('adventuring-equipment', 'Spell Book (blank)', '1/2'),
  mk('adventuring-equipment', 'Stakes (6) and Mallet', '1/6'),
  mk('adventuring-equipment', 'Surgical Saw, Large', '1'),
  mk('adventuring-equipment', 'Surgical Saw, Small', '1/6'),
  mk('adventuring-equipment', 'Tent, Large', '4'),
  mk('adventuring-equipment', 'Tent, Small', '1'),
  mk('adventuring-equipment', "Thieves' Tools", '1/6'),
  mk('adventuring-equipment', "Thieves' Tools, Expanded", '1/6'),
  mk('adventuring-equipment', "Thieves' Tools, Superior", '1/6'),
  mk('adventuring-equipment', 'Tinderbox (flint & steel)', '1/6'),
  mk('adventuring-equipment', 'Torch', '1/6'),
  mk('adventuring-equipment', 'Treatise, Apprentice', '5'),
  mk('adventuring-equipment', 'Treatise, Journeyman', '5'),
  mk('adventuring-equipment', 'Treatise, Master', '5'),
  mk('adventuring-equipment', 'Treatise, Grandmaster', '5'),
  mk('adventuring-equipment', 'Waterskin', '1/6'),
  mk('adventuring-equipment', 'Whistle', '1/6'),
]

export const itemSourceCatalog = {
  armorAndBarding: armorAndBardingSourceItems,
  weapons: weaponsSourceItems,
  adventuringEquipment: adventuringSourceItems,
} as const

export const allSourceItems: readonly SourceItem[] = [
  ...armorAndBardingSourceItems,
  ...weaponsSourceItems,
  ...adventuringSourceItems,
]
