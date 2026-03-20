import { getItemCategory } from '../domain/item-category'
import { buildLabelLadder } from '../domain/labels'
import { packDeterministic, type PackInput, type PackOptions } from '../domain/packing'
import { rcToLinearStone, type MeterCell, type MeterSlotLayout } from '../shared/meter-grid'

/** True when a definition represents a small fungible item eligible for serpentine coalescing. */
const isCoalesceEligible = (def: ItemDefinition): boolean => {
  if (def.isFungibleVisual === true) return true
  if (def.isFungibleVisual === false) return false
  const costPerUnit = encumbranceCostSixths(def, 1)
  return costPerUnit > 0 && costPerUnit <= 1
}

/** Serpentine: merge fungible lines so linear tape is not split by sort order. */
const coalesceFungiblePackInputsForSerpentine = (
  inputs: PackInput[],
  _definitions: CanonicalState['itemDefinitions'],
  layout: MeterSlotLayout,
): { inputs: PackInput[]; syntheticEntries: InventoryEntry[] } => {
  if (layout !== 'serpentine') {
    return { inputs, syntheticEntries: [] }
  }
  const buckets = new Map<string, PackInput[]>()
  const pass: PackInput[] = []

  for (const pi of inputs) {
    if (!isCoalesceEligible(pi.definition)) {
      pass.push(pi)
      continue
    }
    const key = `${pi.entry.itemDefId}\0${pi.entry.zone}`
    const list = buckets.get(key) ?? []
    list.push(pi)
    buckets.set(key, list)
  }

  const syntheticEntries: InventoryEntry[] = []
  const merged: PackInput[] = []

  for (const group of buckets.values()) {
    if (group.length === 0) continue
    if (group.length === 1) {
      merged.push(group[0]!)
      continue
    }
    const sorted = [...group].sort((a, b) => a.entry.id.localeCompare(b.entry.id))
    const anchor = sorted[0]!
    const canonicalDef = sorted.find((p) => p.definition.sixthsPerUnit === 1)?.definition ?? anchor.definition
    const totalQty = sorted.reduce((s, p) => s + p.entry.quantity, 0)
    const totalSixths = sorted.reduce(
      (s, p) => s + encumbranceCostSixths(p.definition, p.entry.quantity),
      0,
    )
    const mergeId = `vf-coalesce+${sorted.map((p) => p.entry.id).join('+')}`
    const synthetic: InventoryEntry = {
      ...anchor.entry,
      id: mergeId,
      quantity: totalQty,
    }
    const coalescedDef: ItemDefinition =
      totalQty !== totalSixths
        ? { ...canonicalDef, sixthsPerUnit: totalSixths / totalQty }
        : canonicalDef
    syntheticEntries.push(synthetic)
    merged.push({ entry: synthetic, definition: coalescedDef })
  }

  return { inputs: [...pass, ...merged], syntheticEntries }
}
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

const buildSlots = (
  capacitySixths: number,
  packedSegments: readonly SegmentVM[],
  slotCols: number,
): StoneSlotVM[] => {
  const totalStoneSlots = Math.ceil(capacitySixths / SIXTHS_PER_STONE)
  const slots: StoneSlotVM[] = []
  const W = Math.max(1, slotCols)

  for (let stoneIndex = 0; stoneIndex < totalStoneSlots; stoneIndex += 1) {
    const slotStart = stoneIndex * SIXTHS_PER_STONE
    const slotEnd = slotStart + SIXTHS_PER_STONE
    const filled = packedSegments
      .filter((segment) => !segment.isOverflow)
      .map((segment) => {
        const cells = segment.meterCells
        if (cells && cells.length > 0 && segment.sizeSixths === cells.length * SIXTHS_PER_STONE) {
          let sub = 0
          for (let i = 0; i < cells.length; i += 1) {
            if (rcToLinearStone(cells[i].row, cells[i].col, W) === stoneIndex) sub += SIXTHS_PER_STONE
          }
          return sub
        }
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
  const clean = segmentId.replace(/:overflow$/, '')
  if (clean.startsWith('vf-coalesce+')) return clean
  const colon = clean.indexOf(':')
  return colon >= 0 ? clean.slice(0, colon) : clean
}

const isIronRationDef = (def: ItemDefinition): boolean =>
  def.canonicalName.toLowerCase().includes('iron ration') ||
  def.id === 'ironRationsDay'

const findRationDef = (definitions: CanonicalState['itemDefinitions']): ItemDefinition | null => {
  if (definitions.ironRationsDay) return definitions.ironRationsDay
  for (const def of Object.values(definitions)) {
    if (isIronRationDef(def)) return def
  }
  return null
}

const normalizeEntriesForPacking = (
  entries: readonly InventoryEntry[],
  definitions: CanonicalState['itemDefinitions'],
  _layout: MeterSlotLayout = 'row-major',
): PackInput[] => {
  const result: PackInput[] = []
  const rationDef = findRationDef(definitions)
  const rationDefIds = rationDef
    ? new Set(Object.values(definitions).filter((d) => isIronRationDef(d)).map((d) => d.id))
    : new Set<string>()
  const rationEntries = entries.filter((e) => rationDefIds.has(e.itemDefId))
  const nonRationEntries = entries.filter((e) => !rationDefIds.has(e.itemDefId))

  for (const entry of nonRationEntries) {
    const definition = definitions[entry.itemDefId]
    if (!definition) continue
    result.push({ entry, definition })
  }

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
    readonly meterCells?: readonly MeterCell[]
  },
  definition: ItemDefinition,
): SegmentVM | SegmentVM[] => {
  const actorId = actor.id
  const canonicalName = definition.canonicalName
  const zoneLabel = packedSegment.zone[0].toUpperCase() + packedSegment.zone.slice(1)
  const stoneText = formatSixthsAsStone(packedSegment.sizeSixths)
  const baseEntryId = segmentIdToBaseEntryId(packedSegment.inventoryEntryId)
  const derivedWield = deriveWieldFromActor(actor, baseEntryId)
  const baseState = { ...(packedSegment.state ?? {}), ...derivedWield }

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
      quantityText: `${packedSegment.quantity}`,
      encumbranceText: stoneText,
      zoneText: zoneLabel,
    },
    ...(definition.isFungibleVisual != null && { isFungibleVisual: definition.isFungibleVisual }),
    ...(packedSegment.isWornPill ? { isWornPill: true } : {}),
    ...(packedSegment.meterCells && packedSegment.meterCells.length > 0 ? { meterCells: packedSegment.meterCells } : {}),
  }
}

export type BoardPackOptions = {
  readonly meterSlotLayout: MeterSlotLayout
  readonly stonesPerRow: number
  readonly nodeSizeOverrides: Readonly<Record<string, { slotCols: number; slotRows: number }>>
}

const defaultBoardPackOptions = (): BoardPackOptions => ({
  meterSlotLayout: 'row-major',
  stonesPerRow: 25,
  nodeSizeOverrides: {},
})

const slotColsForRow = (
  rowId: string,
  capacitySixths: number,
  pack: BoardPackOptions,
): number => {
  const baseStoneSlots = Math.ceil(capacitySixths / SIXTHS_PER_STONE)
  const fromOverride = pack.nodeSizeOverrides[rowId]?.slotCols
  const defaultCols = Math.max(1, Math.min(baseStoneSlots, pack.stonesPerRow))
  return Math.max(1, fromOverride ?? defaultCols)
}

const buildRow = (
  state: CanonicalState,
  actor: Actor,
  rowId: string,
  entries: readonly InventoryEntry[],
  parentActorId: string | undefined,
  isDroppedRow: boolean,
  pack: BoardPackOptions,
): ActorRowVM => {
  const capacitySixths = capacitySixthsForActor(actor)
  const normalizedInputs = normalizeEntriesForPacking(entries, state.itemDefinitions, pack.meterSlotLayout)
  const normalizeSyntheticEntries = normalizedInputs
    .filter((p) => p.entry.id.startsWith('vf-coalesce+'))
    .map((p) => p.entry)
  const { inputs: packInputs, syntheticEntries } = coalesceFungiblePackInputsForSerpentine(
    normalizedInputs,
    state.itemDefinitions,
    pack.meterSlotLayout,
  )

  const entryMap = new Map(
    [...entries, ...normalizeSyntheticEntries, ...syntheticEntries].map((entry) => [entry.id, entry]),
  )
  const normalizedDefById = new Map(packInputs.map((input) => [input.entry.id, input.definition]))

  const slotCols = slotColsForRow(rowId, capacitySixths, pack)
  const packOpts: PackOptions = { meterSlotLayout: pack.meterSlotLayout, slotCols }
  const packed = packDeterministic(packInputs, capacitySixths, packOpts)

  if ((globalThis as any).__VTT_DEBUG_PACKING) {
    const dbg = (globalThis as any).__VTT_DEBUG_ROWS ??= []
    dbg.push({
      actor: actor.name,
      layout: pack.meterSlotLayout,
      slotCols,
      normalizedInputs: normalizedInputs.map(p => ({
        id: p.entry.id, itemDefId: p.entry.itemDefId, qty: p.entry.quantity, zone: p.entry.zone,
        defName: p.definition.canonicalName, sixthsPerUnit: p.definition.sixthsPerUnit,
        fungible: p.definition.isFungibleVisual,
      })),
      packInputs: packInputs.map(p => ({
        id: p.entry.id, itemDefId: p.entry.itemDefId, qty: p.entry.quantity, zone: p.entry.zone,
        defName: p.definition.canonicalName, sixthsPerUnit: p.definition.sixthsPerUnit,
      })),
      packed: packed.map(s => ({
        id: s.inventoryEntryId, itemDefId: s.itemDefId, start: s.startSixth, size: s.sizeSixths,
        qty: s.quantity, overflow: s.isOverflow, pill: s.isWornPill,
      })),
    })
  }

  const segments = packed.flatMap((segment) => {
    const normalizedId = segment.inventoryEntryId.replace(':overflow', '')
    const baseId = segmentIdToBaseEntryId(segment.inventoryEntryId)
    const definition = normalizedDefById.get(normalizedId)
    const baseEntry = entryMap.get(baseId)
    if (!baseEntry || !definition) return []
    const vm = toSegmentVM(actor, segment, definition)
    return Array.isArray(vm) ? vm : [vm]
  }).sort((a, b) => a.tooltip.title.localeCompare(b.tooltip.title) || a.id.localeCompare(b.id))
  const encumbranceSixths = normalizedInputs
    .map((input) => encumbranceCostSixths(input.definition, input.entry.quantity))
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
    slots: buildSlots(capacitySixths, segments, slotCols),
    segments,
    summary: {
      usedStoneText: formatSixthsAsStone(encumbranceSixths),
      capacityStoneText: formatSixthsAsStone(capacitySixths),
      overflowSixths,
    },
    childRows: [],
  }
}

const buildDroppedRows = (state: CanonicalState, actor: Actor, pack: BoardPackOptions): ActorRowVM[] => {
  const droppedGroups = Object.values(state.carryGroups)
    .filter((group) => group.ownerActorId === actor.id && group.dropped)
    .sort((a, b) => a.id.localeCompare(b.id))

  return droppedGroups
    .map((group) => {
      const entries = entriesForActor(state, actor.id, true, group.id)
      if (entries.length === 0) return null
      return buildRow(state, actor, `${actor.id}:dropped:${group.id}`, entries, actor.id, true, pack)
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

export const buildBoardVM = (state: CanonicalState, packOptions?: BoardPackOptions): BoardVM => {
  const pack = packOptions ?? defaultBoardPackOptions()
  const allActors = Object.values(state.actors).sort(byName)
  const topLevelActors = allActors.filter((a) => !a.ownerActorId || !state.actors[a.ownerActorId])

  const rows = topLevelActors.map((owner) => {
    const carriedEntries = entriesForActor(state, owner.id, false)
    const row = buildRow(state, owner, owner.id, carriedEntries, undefined, false, pack)
    const ownedActors = allActors.filter((a) => a.ownerActorId === owner.id)
    const ownedRows = ownedActors.map((animal) => {
      const entries = entriesForActor(state, animal.id, false)
      return buildRow(state, animal, animal.id, entries, owner.id, false, pack)
    })
    const droppedRows = buildDroppedRows(state, owner, pack)
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
