import type { CarryZone, EquipmentState, InventoryEntry, ItemDefinition } from './types'
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

const zonePriority = (zone: CarryZone): number => {
  switch (zone) {
    case 'worn':
      return 0
    case 'attached':
      return 1
    case 'accessible':
      return 2
    case 'stowed':
      return 3
    case 'dropped':
      return 4
    default: {
      const _never: never = zone
      return _never
    }
  }
}

const isFullStone = (sixths: number): boolean =>
  sixths >= SIXTHS_PER_STONE && sixths % SIXTHS_PER_STONE === 0

const fullStoneCategory = (input: PackInput): number => {
  const { definition } = input
  const name = definition.canonicalName.toLowerCase()
  if (definition.kind === 'armor') return 0
  if (definition.kind === 'bulky' && name.includes('shield')) return 1
  if (definition.kind === 'bulky' && !name.includes('pole') && !name.includes('shield')) return 2
  if (definition.kind === 'bulky' && name.includes('pole')) return 3
  return 4
}

const packingPriority = (input: PackInput, rawCost: number): number => {
  const fullStone = isFullStone(rawCost)
  if (fullStone) {
    return fullStoneCategory(input)
  }
  return 1000 + zonePriority(input.entry.zone)
}

const sortPackInputs = (items: readonly PackInput[]): PackInput[] =>
  [...items].sort((a, b) => {
    const costA = encumbranceCostSixths(a.definition, a.entry.quantity)
    const costB = encumbranceCostSixths(b.definition, b.entry.quantity)
    const priorityA = packingPriority(a, costA)
    const priorityB = packingPriority(b, costB)
    if (priorityA !== priorityB) return priorityA - priorityB
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
