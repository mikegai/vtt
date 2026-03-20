import type { CarryZone, EquipmentState, InventoryEntry, ItemDefinition } from './types'
import { getItemCategory } from './item-category'
import {
  buildColumnMajorDownPackOrder,
  buildSerpentinePackOrder,
  DEFAULT_PACK_STONES_PER_ROW,
  findAlignedPackStart,
} from './pack-trajectory'
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
  readonly isWornPill?: boolean
  /** Row-major sixth indices this segment occupies (sorted ascending). Omitted for worn pills / overflow. */
  readonly occupiedSixths?: readonly number[]
  /** Start index in serpentine pack order (0..capacity-1). */
  readonly packStart?: number
  /** First sixth in serpentine fill order (packOrder[packStart]). */
  readonly primarySixth?: number
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

export type PackDeterministicOptions = {
  readonly stonesPerRow?: number
  /** When true, uses alternating up/down columns (legacy). Default false fills only downward per column. */
  readonly serpentineInventoryPacking?: boolean
}

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

export const packDeterministic = (
  items: readonly PackInput[],
  capacitySixths: number,
  third: number | PackDeterministicOptions = DEFAULT_PACK_STONES_PER_ROW,
): PackedSegment[] => {
  const sorted = sortPackInputs(items)
  const result: PackedSegment[] = []
  let stonesPerRow = DEFAULT_PACK_STONES_PER_ROW
  let serpentine = false
  if (typeof third === 'number') {
    stonesPerRow = third
  } else {
    stonesPerRow = third.stonesPerRow ?? DEFAULT_PACK_STONES_PER_ROW
    serpentine = third.serpentineInventoryPacking ?? false
  }
  const packOrder = serpentine
    ? buildSerpentinePackOrder(capacitySixths, stonesPerRow)
    : buildColumnMajorDownPackOrder(capacitySixths, stonesPerRow)

  let cursor = 0
  let accessibleMiscUsed = 0

  for (const input of sorted) {
    const rawCost = encumbranceCostSixths(input.definition, input.entry.quantity)
    // Zero-encumbrance entries are rendered as pill-strip items, never in slot meter.
    const isWornPill = rawCost <= 0
    if (isWornPill) {
      result.push({
        inventoryEntryId: input.entry.id,
        itemDefId: input.definition.id,
        quantity: input.entry.quantity,
        zone: input.entry.zone,
        state: input.entry.state ?? {},
        startSixth: 0,
        endSixth: 1,
        sizeSixths: 1,
        isOverflow: false,
        isWornPill: true,
      })
      continue
    }
    const countsAgainstAccessibleLimit = input.entry.zone === 'accessible' && input.definition.kind !== 'bulky'

    const allowedCost = (() => {
      if (!countsAgainstAccessibleLimit) return rawCost
      const remainingAccessible = Math.max(0, ACCESSIBLE_MISC_LIMIT_SIXTHS - accessibleMiscUsed)
      return Math.min(rawCost, remainingAccessible)
    })()

    if (countsAgainstAccessibleLimit) {
      accessibleMiscUsed += allowedCost
    }

    const remainingPack = packOrder.length - cursor
    const placeableCost = Math.max(0, Math.min(allowedCost, remainingPack))
    if (placeableCost > 0) {
      const needWhole =
        placeableCost >= SIXTHS_PER_STONE && placeableCost % SIXTHS_PER_STONE === 0
      let startPack =
        findAlignedPackStart(packOrder, cursor, placeableCost, needWhole) ??
        findAlignedPackStart(packOrder, cursor, placeableCost, false)
      if (startPack == null) startPack = cursor
      const occupiedRaw = packOrder.slice(startPack, startPack + placeableCost)
      const occupiedSorted = [...occupiedRaw].sort((a, b) => a - b)
      const startSixth = occupiedSorted[0]!
      const endSixth = occupiedSorted[occupiedSorted.length - 1]! + 1
      result.push({
        inventoryEntryId: input.entry.id,
        itemDefId: input.definition.id,
        quantity: input.entry.quantity,
        zone: input.entry.zone,
        state: input.entry.state ?? {},
        startSixth,
        endSixth,
        sizeSixths: placeableCost,
        isOverflow: false,
        occupiedSixths: occupiedSorted,
        packStart: startPack,
        primarySixth: occupiedRaw[0],
      })
      cursor = startPack + placeableCost
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
