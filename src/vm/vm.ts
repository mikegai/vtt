import {
  COINAGE_MERGED_DEFINITION,
  metalFractionsFromCoinageLines,
  isCoinagePooledDefinition,
  tallyTreasuryForEntries,
} from '../domain/coinage'
import { getItemCategory } from '../domain/item-category'
import { buildLabelLadder } from '../domain/labels'
import { packDeterministic, type PackInput } from '../domain/packing'
import {
  capacitySixthsForActor,
  defaultBaseSpeedProfile,
  encumbranceCostSixths,
  formatSixthsAsStone,
  speedProfileForAnimalOrVehicle,
  speedProfileForSixths,
} from '../domain/rules'
import { BASE_CAPACITY_SIXTHS, SIXTHS_PER_STONE, type Actor, type CanonicalState, type InventoryEntry, type ItemDefinition, type WieldGrip } from '../domain/types'
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


const deriveWieldFromActor = (actor: Actor, entryId: string): { wield?: WieldGrip; heldHands?: 0 | 1 | 2 } => {
  const left = actor.leftWieldingEntryId === entryId
  const right = actor.rightWieldingEntryId === entryId
  if (left && right) return { wield: 'both', heldHands: 2 }
  if (left) return { wield: 'left', heldHands: 1 }
  if (right) return { wield: 'right', heldHands: 1 }
  return {}
}

const segmentIdToBaseEntryId = (segmentId: string): string => {
  const colon = segmentId.indexOf(':')
  return colon >= 0 ? segmentId.slice(0, colon) : segmentId
}

/** When true, pooled coin/gem lines merge into one packed segment (carried inventory). When false, each line stays separate (e.g. dropped on canvas). */
const normalizeEntriesForPacking = (
  entries: readonly InventoryEntry[],
  definitions: CanonicalState['itemDefinitions'],
  mergeCoinagePool = true,
): PackInput[] => {
  const result: PackInput[] = []
  const rationEntries = entries.filter((e) => e.itemDefId === 'ironRationsDay')
  const nonRationEntries = entries.filter((e) => e.itemDefId !== 'ironRationsDay')

  const coinageEntries = nonRationEntries.filter((e) => {
    const d = definitions[e.itemDefId]
    return d != null && isCoinagePooledDefinition(d)
  })
  const nonCoinageEntries = nonRationEntries.filter((e) => {
    const d = definitions[e.itemDefId]
    return d == null || !isCoinagePooledDefinition(d)
  })

  for (const entry of nonCoinageEntries) {
    const definition = definitions[entry.itemDefId]
    if (!definition) continue
    result.push({ entry, definition })
  }

  if (!mergeCoinagePool) {
    for (const entry of coinageEntries) {
      const definition = definitions[entry.itemDefId]
      if (!definition) continue
      result.push({ entry, definition })
    }
  } else if (coinageEntries.length > 0) {
    const sortedCoinage = [...coinageEntries].sort((a, b) => a.id.localeCompare(b.id))
    const anchor = sortedCoinage[0]!
    const totalSixths = sortedCoinage.reduce((sum, e) => {
      const d = definitions[e.itemDefId]
      return sum + (d ? encumbranceCostSixths(d, e.quantity) : 0)
    }, 0)
    const breakdown = sortedCoinage.map((e) => ({
      entryId: e.id,
      itemDefId: e.itemDefId,
      quantity: e.quantity,
    }))
    const anyAccessible = sortedCoinage.some((e) => e.zone === 'accessible')
    const zone = anyAccessible ? 'accessible' : sortedCoinage[0]!.zone
    const mergedEntry: InventoryEntry = {
      ...anchor,
      id: `${anchor.id}:coinageMerged`,
      itemDefId: COINAGE_MERGED_DEFINITION.id,
      quantity: sortedCoinage.reduce((s, e) => s + e.quantity, 0),
      zone,
    }
    result.push({
      entry: mergedEntry,
      definition: COINAGE_MERGED_DEFINITION,
      encumbranceOverrideSixths: totalSixths,
      coinageBreakdown: breakdown,
    })
  }

  const rationDef = definitions.ironRationsDay
  if (!rationDef || rationEntries.length === 0) {
    return result
  }

  const fullGroups = Math.floor(rationEntries.length / 7)
  for (let group = 0; group < fullGroups; group += 1) {
    const start = group * 7
    for (let i = 0; i < 5; i += 1) {
      const entry = rationEntries[start + i]
      if (!entry) continue
      result.push({ entry, definition: rationDef })
    }

    const pairAnchor = rationEntries[start + 5]
    if (pairAnchor) {
      result.push({
        entry: {
          ...pairAnchor,
          id: `${pairAnchor.id}:paired`,
          quantity: 2,
        },
        definition: {
          ...rationDef,
          canonicalName: '2 daily iron rations',
          sixthsPerUnit: 0.5,
        },
      })
    }
  }

  const remainderStart = fullGroups * 7
  for (let i = remainderStart; i < rationEntries.length; i += 1) {
    const entry = rationEntries[i]
    if (!entry) continue
    result.push({ entry, definition: rationDef })
  }

  return result
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
    readonly isWornPill?: boolean
    readonly coinageBreakdown?: readonly { entryId: string; itemDefId: string; quantity: number }[]
  },
  definition: ItemDefinition,
  itemDefinitions: CanonicalState['itemDefinitions'],
): SegmentVM | SegmentVM[] => {
  const actorId = actor.id
  const canonicalName = definition.canonicalName
  const zoneLabel = packedSegment.zone[0].toUpperCase() + packedSegment.zone.slice(1)
  const stoneText = formatSixthsAsStone(packedSegment.sizeSixths)
  const baseEntryId = segmentIdToBaseEntryId(packedSegment.inventoryEntryId)
  const derivedWield = deriveWieldFromActor(actor, baseEntryId)
  const baseState = { ...(packedSegment.state ?? {}), ...derivedWield }

  const breakdown = packedSegment.coinageBreakdown
  const coinageLines =
    breakdown?.map((b) => ({
      definition: itemDefinitions[b.itemDefId] ?? definition,
      quantity: b.quantity,
    })) ?? []
  const metals = breakdown ? metalFractionsFromCoinageLines(coinageLines) : null
  const qtyText =
    breakdown?.map((b) => {
      const n = itemDefinitions[b.itemDefId]?.canonicalName ?? b.itemDefId
      return `${b.quantity}× ${n}`
    }).join('; ') ?? `${packedSegment.quantity}`

  const labels = buildLabelLadder(canonicalName)
  return {
    id: packedSegment.inventoryEntryId,
    actorId,
    itemDefId: packedSegment.itemDefId,
    category: getItemCategory(definition),
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
      quantityText: qtyText,
      encumbranceText: stoneText,
      zoneText: zoneLabel,
    },
    ...(definition.isFungibleVisual != null && { isFungibleVisual: definition.isFungibleVisual }),
    ...(packedSegment.isWornPill ? { isWornPill: true } : {}),
    ...(breakdown ? { isCoinageMerge: true as const, coinageVisual: { metals: metals ?? { cp: 0, bp: 0, sp: 0, ep: 0, gp: 0, pp: 0 } } } : {}),
  }
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
  const normalizedInputs = normalizeEntriesForPacking(entries, state.itemDefinitions, !isDroppedRow)

  const entryMap = new Map(entries.map((entry) => [entry.id, entry]))
  const normalizedDefById = new Map(normalizedInputs.map((input) => [input.entry.id, input.definition]))

  const packed = packDeterministic(normalizedInputs, capacitySixths)
  const segments = packed
    .flatMap((segment) => {
      const normalizedId = segment.inventoryEntryId.replace(/:overflow$/, '')
      const baseId = segmentIdToBaseEntryId(segment.inventoryEntryId)
      const definition = normalizedDefById.get(normalizedId)
      const baseEntry = entryMap.get(baseId)
      if (!baseEntry || !definition) return []
      const vm = toSegmentVM(actor, segment, definition, state.itemDefinitions)
      return Array.isArray(vm) ? vm : [vm]
    })
    .sort((a, b) => {
      const ac = a.isCoinageMerge ? 1 : 0
      const bc = b.isCoinageMerge ? 1 : 0
      if (ac !== bc) return ac - bc
      return a.tooltip.title.localeCompare(b.tooltip.title) || a.id.localeCompare(b.id)
    })
  const encumbranceSixths = entries
    .map((e) => {
      const def = state.itemDefinitions[e.itemDefId]
      return def ? encumbranceCostSixths(def, e.quantity) : 0
    })
    .reduce((sum, value) => sum + value, 0)

  const speed =
    (actor.kind === 'animal' || actor.kind === 'vehicle') && actor.capacityStone != null
      ? speedProfileForAnimalOrVehicle(
          encumbranceSixths,
          capacitySixths,
          actor.baseSpeedProfile ?? defaultBaseSpeedProfile,
        )
      : speedProfileForSixths(encumbranceSixths, actor.stats.hasLoadBearing)
  const overflowSixths = segments.filter((segment) => segment.isOverflow).reduce((sum, segment) => sum + segment.sizeSixths, 0)

  const treasury = tallyTreasuryForEntries(entries, state.itemDefinitions)
  const hasTreasury =
    treasury.cp > 0 ||
    treasury.bp > 0 ||
    treasury.sp > 0 ||
    treasury.ep > 0 ||
    treasury.gp > 0 ||
    treasury.pp > 0

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
    ...(hasTreasury ? { treasury } : {}),
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
