import { buildLabelLadder } from '../domain/labels'
import { packDeterministic, type PackInput } from '../domain/packing'
import {
  capacitySixthsForActor,
  encumbranceCostSixths,
  formatSixthsAsStone,
  speedProfileForSixths,
} from '../domain/rules'
import { BASE_CAPACITY_SIXTHS, SIXTHS_PER_STONE, type Actor, type CanonicalState, type InventoryEntry, type WieldGrip } from '../domain/types'
import type { ActorRowVM, BoardVM, PartyPaceVM, SegmentVM, StoneSlotVM } from './vm-types'

const byName = <T extends { name: string }>(left: T, right: T): number => left.name.localeCompare(right.name)

const entriesForActor = (
  state: CanonicalState,
  actorId: string,
  includeDropped: boolean,
  carryGroupId?: string,
): InventoryEntry[] => {
  return Object.values(state.inventoryEntries)
    .filter((entry) => {
      if (entry.actorId !== actorId) return false
      if (carryGroupId && entry.carryGroupId !== carryGroupId) return false
      if (!carryGroupId && entry.carryGroupId) return false
      const dropped = entry.zone === 'dropped' || !!entry.state?.dropped
      return includeDropped ? dropped : !dropped
    })
    .sort((a, b) => a.id.localeCompare(b.id))
}

const buildSlots = (capacitySixths: number, packedSegments: readonly SegmentVM[]): StoneSlotVM[] => {
  const totalStoneSlots = Math.ceil(capacitySixths / SIXTHS_PER_STONE)
  const slots: StoneSlotVM[] = []

  for (let stoneIndex = 0; stoneIndex < totalStoneSlots; stoneIndex += 1) {
    const slotStart = stoneIndex * SIXTHS_PER_STONE
    const slotEnd = slotStart + SIXTHS_PER_STONE
    const filled = packedSegments
      .filter((segment) => !segment.isOverflow)
      .map((segment) => {
        const start = Math.max(segment.startSixth, slotStart)
        const end = Math.min(segment.endSixth, slotEnd)
        return Math.max(0, end - start)
      })
      .reduce((sum, value) => sum + value, 0)

    slots.push({
      stoneIndex,
      startSixth: slotStart,
      endSixth: slotEnd,
      isExtension: slotStart >= BASE_CAPACITY_SIXTHS,
      filledSixths: filled,
    })
  }

  return slots
}

/** Returns display quantities per slot for iron rations: [1,1,1,1,1,2] for 7, etc. */
const ironRationDisplaySlots = (quantity: number): number[] => {
  const result: number[] = []
  const pairs = Math.floor(quantity / 7)
  const remainder = quantity % 7
  for (let i = 0; i < pairs; i += 1) {
    result.push(1, 1, 1, 1, 1, 2)
  }
  for (let i = 0; i < remainder; i += 1) {
    result.push(1)
  }
  return result
}

const deriveWieldFromActor = (actor: Actor, entryId: string): { wield?: WieldGrip; heldHands?: 0 | 1 | 2 } => {
  const left = actor.leftWieldingEntryId === entryId
  const right = actor.rightWieldingEntryId === entryId
  if (left && right) return { wield: 'both', heldHands: 2 }
  if (left) return { wield: 'left', heldHands: 1 }
  if (right) return { wield: 'right', heldHands: 1 }
  return {}
}

const toSegmentVM = (
  actor: Actor,
  packedSegment: {
    readonly inventoryEntryId: string
    readonly itemDefId: string
    readonly quantity: number
    readonly zone: InventoryEntry['zone']
    readonly state: InventoryEntry['state']
    readonly startSixth: number
    readonly endSixth: number
    readonly sizeSixths: number
    readonly isOverflow: boolean
  },
  canonicalName: string,
): SegmentVM | SegmentVM[] => {
  const actorId = actor.id
  const zoneLabel = packedSegment.zone[0].toUpperCase() + packedSegment.zone.slice(1)
  const stoneText = formatSixthsAsStone(packedSegment.sizeSixths)
  const baseEntryId = packedSegment.inventoryEntryId.replace(':overflow', '')
  const derivedWield = deriveWieldFromActor(actor, baseEntryId)
  const baseState = { ...(packedSegment.state ?? {}), ...derivedWield }

  if (packedSegment.itemDefId === 'ironRationsDay' && packedSegment.quantity > 0) {
    const displaySlots = ironRationDisplaySlots(packedSegment.quantity)
    return displaySlots.map((displayQty, i) => {
      const startSixth = packedSegment.startSixth + i
      const endSixth = startSixth + 1
      const title = displayQty === 2 ? '2 iron rations' : canonicalName
      const labels = buildLabelLadder(title)
      return {
        id: `${baseEntryId}:${i}`,
        actorId,
        itemDefId: packedSegment.itemDefId,
        quantity: displayQty,
        zone: packedSegment.zone,
        state: baseState,
        startSixth,
        endSixth,
        sizeSixths: 1,
        isOverflow: packedSegment.isOverflow,
        labels,
        tooltip: {
          title,
          quantityText: `${displayQty}`,
          encumbranceText: formatSixthsAsStone(1),
          zoneText: zoneLabel,
        },
      }
    })
  }

  const labels = buildLabelLadder(canonicalName)
  return {
    id: packedSegment.inventoryEntryId,
    actorId,
    itemDefId: packedSegment.itemDefId,
    quantity: packedSegment.quantity,
    zone: packedSegment.zone,
    state: baseState,
    startSixth: packedSegment.startSixth,
    endSixth: packedSegment.endSixth,
    sizeSixths: packedSegment.sizeSixths,
    isOverflow: packedSegment.isOverflow,
    labels,
    tooltip: {
      title: canonicalName,
      quantityText: `${packedSegment.quantity}`,
      encumbranceText: stoneText,
      zoneText: zoneLabel,
    },
  }
}

/** Coalesce iron rations entries into one so the doubling rule applies. */
const coalesceIronRations = (entries: readonly InventoryEntry[]): InventoryEntry[] => {
  const ironRationEntries = entries.filter((e) => e.itemDefId === 'ironRationsDay')
  const others = entries.filter((e) => e.itemDefId !== 'ironRationsDay')
  if (ironRationEntries.length <= 1) return [...entries]
  const totalQty = ironRationEntries.reduce((sum, e) => sum + e.quantity, 0)
  const first = ironRationEntries[0]
  const coalesced: InventoryEntry = {
    ...first,
    id: first.id,
    quantity: totalQty,
  }
  return [coalesced, ...others]
}

const buildRow = (
  state: CanonicalState,
  actor: Actor,
  rowId: string,
  entries: readonly InventoryEntry[],
  parentActorId?: string,
  isDroppedRow = false,
): ActorRowVM => {
  const capacitySixths = capacitySixthsForActor(actor)
  const coalescedEntries = coalesceIronRations(entries)
  const packInputs: PackInput[] = coalescedEntries
    .map((entry) => {
      const definition = state.itemDefinitions[entry.itemDefId]
      if (!definition) return null
      return { entry, definition }
    })
    .filter((value): value is PackInput => value !== null)

  const entryMap = new Map(coalescedEntries.map((entry) => [entry.id, entry]))

  const packed = packDeterministic(packInputs, capacitySixths)
  const segments = packed.flatMap((segment) => {
    const definition = state.itemDefinitions[segment.itemDefId]
    const baseId = segment.inventoryEntryId.replace(':overflow', '')
    const baseEntry = entryMap.get(baseId)
    if (!baseEntry || !definition) return []
    const vm = toSegmentVM(actor, segment, definition.canonicalName)
    return Array.isArray(vm) ? vm : [vm]
  })

  const encumbranceSixths = coalescedEntries
    .map((entry) => {
      const definition = state.itemDefinitions[entry.itemDefId]
      return definition ? encumbranceCostSixths(definition, entry.quantity) : 0
    })
    .reduce((sum, value) => sum + value, 0)

  const speed = speedProfileForSixths(encumbranceSixths, actor.stats.hasLoadBearing)
  const overflowSixths = segments.filter((segment) => segment.isOverflow).reduce((sum, segment) => sum + segment.sizeSixths, 0)

  return {
    id: rowId,
    actorId: actor.id,
    parentActorId,
    title: isDroppedRow ? `${actor.name} Dropped` : actor.name,
    kind: actor.kind,
    isDroppedRow,
    encumbranceSixths,
    capacitySixths,
    baseCapacitySixths: BASE_CAPACITY_SIXTHS,
    speed,
    speedBand: {
      band: speed.band,
      speed,
    },
    slots: buildSlots(capacitySixths, segments),
    segments,
    summary: {
      usedStoneText: formatSixthsAsStone(encumbranceSixths),
      capacityStoneText: formatSixthsAsStone(capacitySixths),
      overflowSixths,
    },
    childRows: [],
  }
}

const buildDroppedRows = (state: CanonicalState, actor: Actor): ActorRowVM[] => {
  const droppedGroups = Object.values(state.carryGroups)
    .filter((group) => group.ownerActorId === actor.id && group.dropped)
    .sort((a, b) => a.id.localeCompare(b.id))

  return droppedGroups
    .map((group) => {
      const entries = entriesForActor(state, actor.id, true, group.id)
      if (entries.length === 0) return null
      return buildRow(state, actor, `${actor.id}:dropped:${group.id}`, entries, actor.id, true)
    })
    .filter((row): row is ActorRowVM => row !== null)
}

const buildPartyPace = (rows: readonly ActorRowVM[]): PartyPaceVM => {
  const activeRows = rows.filter((row) => !row.isDroppedRow)
  if (activeRows.length === 0) {
    return {
      explorationFeet: 120,
      combatFeet: 40,
      runningFeet: 120,
      milesPerDay: 24,
      limitedByActorId: null,
    }
  }

  const slowest = activeRows.reduce((lowest, row) =>
    row.speed.explorationFeet < lowest.speed.explorationFeet ? row : lowest,
  )

  return {
    explorationFeet: slowest.speed.explorationFeet,
    combatFeet: slowest.speed.combatFeet,
    runningFeet: slowest.speed.runningFeet,
    milesPerDay: slowest.speed.milesPerDay,
    limitedByActorId: slowest.actorId,
  }
}

export const buildBoardVM = (state: CanonicalState): BoardVM => {
  const allActors = Object.values(state.actors).sort(byName)
  const topLevelActors = allActors.filter((a) => !a.ownerActorId || !state.actors[a.ownerActorId])

  const rows = topLevelActors.map((owner) => {
    const carriedEntries = entriesForActor(state, owner.id, false)
    const row = buildRow(state, owner, owner.id, carriedEntries)
    const ownedActors = allActors.filter((a) => a.ownerActorId === owner.id)
    const ownedRows = ownedActors.map((animal) => {
      const entries = entriesForActor(state, animal.id, false)
      return buildRow(state, animal, animal.id, entries, owner.id)
    })
    const droppedRows = buildDroppedRows(state, owner)
    return {
      ...row,
      childRows: [...ownedRows, ...droppedRows],
    }
  })

  return {
    meta: {
      generatedAtIso: new Date().toISOString(),
      zoomDetailThresholds: {
        far: 0.3,
        medium: 1,
        close: 2.2,
      },
    },
    partyPace: buildPartyPace(rows),
    rows,
  }
}
