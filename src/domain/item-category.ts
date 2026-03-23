import type { ItemDefinition } from './types'
import { matchHandedness } from './weapon-metadata'

export type ItemCategory = 'armor-and-barding' | 'weapons' | 'adventuring-equipment'

/** Derive display category from item definition. */
export const getItemCategory = (itemDef: ItemDefinition): ItemCategory => {
  if (itemDef.kind === 'armor') return 'armor-and-barding'
  if (itemDef.kind === 'bundled') return 'adventuring-equipment'
  const name = itemDef.canonicalName.toLowerCase()
  if (/shield|barding/.test(name)) return 'armor-and-barding'
  if (matchHandedness(itemDef.canonicalName) !== null) return 'weapons'
  return 'adventuring-equipment'
}
