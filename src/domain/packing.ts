import type { CarryZone, EquipmentState, InventoryEntry, ItemDefinition } from './types'
import { getItemCategory } from './item-category'
import { ACCESSIBLE_MISC_LIMIT_SIXTHS, encumbranceCostSixths } from './rules'
import { SIXTHS_PER_STONE } from './types'

export type PackInput = {
  readonly entry: InventoryEntry
  readonly definition: ItemDefinition
}

export type PackedSegment = {
  readonly inventoryEntryId: string
  readonly itemDefId: string
  readonly quantity: number
  readonly zone: CarryZone
  readonly state: EquipmentState
  readonly startSixth: number
  readonly endSixth: number
  readonly sizeSixths: number
  readonly isOverflow: boolean
}

const isOneOrMoreStone = (sixths: number): boolean => sixths >= SIXTHS_PER_STONE

/** Category priority for 1+ stone items: armor, shield, weapons, other. */
const categoryPriorityFullStone = (input: PackInput): number => {
  const cat = getItemCategory(input.definition)
  const name = input.definition.canonicalName.toLowerCase()
  if (cat === 'armor-and-barding') return name.includes('shield') ? 1 : 0
  if (cat === 'weapons') return 2
  return 3
}

/** Category priority for < 1 stone items: weapons first, then other. */
const categoryPriorityPartialStone = (input: PackInput): number =>
  getItemCategory(input.definition) === 'weapons' ? 0 : 1

const sortPackInputs = (items: readonly PackInput[]): PackInput[] =>
  [...items].sort((a, b) => {
    const costA = encumbranceCostSixths(a.definition, a.entry.quantity)
    const costB = encumbranceCostSixths(b.definition, b.entry.quantity)
    const tierA = isOneOrMoreStone(costA) ? 0 : 1
    const tierB = isOneOrMoreStone(costB) ? 0 : 1
    if (tierA !== tierB) return tierA - tierB

    const catA = tierA === 0 ? categoryPriorityFullStone(a) : categoryPriorityPartialStone(a)
    const catB = tierB === 0 ? categoryPriorityFullStone(b) : categoryPriorityPartialStone(b)
    if (catA !== catB) return catA - catB

    const nameA = a.definition.canonicalName
    const nameB = b.definition.canonicalName
    if (nameA !== nameB) return nameA.localeCompare(nameB)

    return a.entry.id.localeCompare(b.entry.id)
  })

export const packDeterministic = (items: readonly PackInput[], capacitySixths: number): PackedSegment[] => {
  const sorted = sortPackInputs(items)
  const result: PackedSegment[] = []

  let cursor = 0
  let accessibleMiscUsed = 0

  for (const input of sorted) {
    const rawCost = encumbranceCostSixths(input.definition, input.entry.quantity)
    const countsAgainstAccessibleLimit = input.entry.zone === 'accessible' && input.definition.kind !== 'bulky'

    const allowedCost = (() => {
      if (!countsAgainstAccessibleLimit) return rawCost
      const remainingAccessible = Math.max(0, ACCESSIBLE_MISC_LIMIT_SIXTHS - accessibleMiscUsed)
      return Math.min(rawCost, remainingAccessible)
    })()

    if (countsAgainstAccessibleLimit) {
      accessibleMiscUsed += allowedCost
    }

    const placeableCost = Math.max(0, Math.min(allowedCost, capacitySixths - cursor))
    if (placeableCost > 0) {
      let start = cursor
      if (placeableCost >= SIXTHS_PER_STONE && placeableCost % SIXTHS_PER_STONE === 0) {
        const alignedStart = Math.ceil(cursor / SIXTHS_PER_STONE) * SIXTHS_PER_STONE
        if (alignedStart + placeableCost <= capacitySixths) {
          start = alignedStart
        }
      }
      const end = start + placeableCost
      result.push({
        inventoryEntryId: input.entry.id,
        itemDefId: input.definition.id,
        quantity: input.entry.quantity,
        zone: input.entry.zone,
        state: input.entry.state ?? {},
        startSixth: start,
        endSixth: end,
        sizeSixths: placeableCost,
        isOverflow: false,
      })
      cursor = end
    }

    const overflowSize = rawCost - placeableCost
    if (overflowSize > 0) {
      result.push({
        inventoryEntryId: `${input.entry.id}:overflow`,
        itemDefId: input.definition.id,
        quantity: input.entry.quantity,
        zone: input.entry.zone,
        state: { ...(input.entry.state ?? {}), inaccessible: true },
        startSixth: capacitySixths,
        endSixth: capacitySixths + overflowSize,
        sizeSixths: overflowSize,
        isOverflow: true,
      })
    }
  }

  return result
}
