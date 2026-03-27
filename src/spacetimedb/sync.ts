/**
 * Layer 3 → Layer 1 bridge
 *
 * After the worker applies an intent and updates worldState + localState,
 * this module diffs the old and new state and calls the appropriate
 * SpacetimeDB reducers via the generated typed bindings.
 */

import type { DbConnection } from '../module_bindings'
import type { CanonicalState, Actor, ItemDefinition, InventoryEntry, CarryGroup, MovementGroup } from '../domain/types'
import type { PersistedLocalState } from '../persistence/backend'
import type { WorkerLocalState } from '../worker/scene-vm'
import type { WorldCanvasContext } from './context'
import { withCanvasPrefix, withWorldPrefix } from './context'
import { sampleState } from '../sample-data'

function safe(label: string, fn: () => void | Promise<void>): void {
  let out: void | Promise<void>
  try {
    out = fn()
  } catch (e) {
    console.error(`[sync] ${label} call threw:`, e)
    throw e
  }
  void Promise.resolve(out)
}

function stripEphemeral(state: WorkerLocalState): PersistedLocalState {
  const {
    hoveredSegmentId: _1,
    dropIntent: _2,
    filterCategory: _3,
    selectedSegmentIds: _4,
    selectedNodeIds: _5,
    selectedGroupIds: _6,
    selectedLabelIds: _7,
    pasteTargetNodeId: _pt,
    selectedCanvasObjectIds: _9,
    selectedLabelId: _8,
    ...persisted
  } = state
  return persisted
}

export function syncWorldState(
  conn: DbConnection,
  oldWorld: CanonicalState | null,
  newWorld: CanonicalState,
  context: WorldCanvasContext,
): void {
  const w = (id: string) => withWorldPrefix(context, id)
  const c = (id: string) => withCanvasPrefix(context, id)
  const oldItemOverlay = buildSparseItemCatalogOverlay(oldWorld?.itemDefinitions ?? null)
  const newItemOverlay = buildSparseItemCatalogOverlay(newWorld.itemDefinitions)
  diffMap(oldWorld?.actors ?? {}, newWorld.actors,
    (a) => safe(`upsertActor(${a.id})`, () => syncActor(conn, a, c)),
    (id) => safe(`deleteActor(${id})`, () => conn.reducers.deleteActor({ id: c(id) })))
  diffGenericMap(oldItemOverlay, newItemOverlay,
    (id, d) => safe(`upsertItemDef(${id})`, () => syncItemDefOverlay(conn, id, d, w)),
    (id) => safe(`deleteItemDef(${id})`, () => conn.reducers.deleteItemDefinition({ id: w(id) })))
  diffMap(oldWorld?.inventoryEntries ?? {}, newWorld.inventoryEntries,
    (e) => safe(`upsertEntry(${e.id})`, () => syncEntry(conn, e, w, c)),
    (id) => safe(`deleteEntry(${id})`, () => conn.reducers.deleteInventoryEntry({ id: c(id) })))
  diffMap(oldWorld?.carryGroups ?? {}, newWorld.carryGroups,
    (cg) => safe(`upsertCarryGroup(${cg.id})`, () => syncCarryGroup(conn, cg, c)),
    (id) => safe(`deleteCarryGroup(${id})`, () => conn.reducers.deleteCarryGroup({ id: c(id) })))
  diffMap(oldWorld?.movementGroups ?? {}, newWorld.movementGroups,
    (mg) => safe(`upsertMovementGroup(${mg.id})`, () => syncMovementGroup(conn, mg, c)),
    (id) => safe(`deleteMovementGroup(${id})`, () => conn.reducers.deleteMovementGroup({ id: c(id) })))
}

export function syncLocalState(
  conn: DbConnection,
  oldLocal: WorkerLocalState,
  newLocal: WorkerLocalState,
  context: WorldCanvasContext,
): void {
  const c = (id: string) => withCanvasPrefix(context, id)
  const oldP = stripEphemeral(oldLocal)
  const newP = stripEphemeral(newLocal)

  diffPosMap(oldP.nodePositions, newP.nodePositions,
    (id, pos) => safe(`upsertNodePos(${id})`, () => conn.reducers.upsertNodePosition({ nodeId: c(id), x: pos.x, y: pos.y })),
    (id) => safe(`deleteNodePos(${id})`, () => conn.reducers.deleteNodePosition({ nodeId: c(id) })))

  diffPosMap(oldP.groupPositions, newP.groupPositions,
    (id, pos) => safe(`upsertGroupPos(${id})`, () => conn.reducers.upsertGroupPosition({ groupId: c(id), x: pos.x, y: pos.y })),
    (id) => safe(`deleteGroupPos(${id})`, () => conn.reducers.deleteGroupPosition({ groupId: c(id) })))

  diffGenericMap(oldP.groupSizeOverrides, newP.groupSizeOverrides,
    (id, v) => safe(`upsertGroupSize(${id})`, () => conn.reducers.upsertGroupSizeOverride({ groupId: c(id), width: v.width, height: v.height })),
    (id) => safe(`deleteGroupSize(${id})`, () => conn.reducers.deleteGroupSizeOverride({ groupId: c(id) })))

  diffGenericMap(oldP.nodeSizeOverrides, newP.nodeSizeOverrides,
    (id, v) => safe(`upsertNodeSize(${id})`, () => conn.reducers.upsertNodeSizeOverride({ nodeId: c(id), slotCols: v.slotCols, slotRows: v.slotRows })),
    (id) => safe(`deleteNodeSize(${id})`, () => conn.reducers.deleteNodeSizeOverride({ nodeId: c(id) })))

  diffScalarMap(oldP.groupListViewEnabled, newP.groupListViewEnabled,
    (id, v) => safe(`upsertGroupListView(${id})`, () => conn.reducers.upsertGroupListView({ groupId: c(id), enabled: v })),
    (id) => safe(`deleteGroupListView(${id})`, () => conn.reducers.deleteGroupListView({ groupId: c(id) })))

  diffScalarMap(oldP.layoutExpanded ?? {}, newP.layoutExpanded ?? {},
    (id, v) => safe(`upsertLayoutExpanded(${id})`, () => conn.reducers.upsertLayoutExpanded({ containerId: c(id), expanded: v })),
    (id) => safe(`deleteLayoutExpanded(${id})`, () => conn.reducers.deleteLayoutExpanded({ containerId: c(id) })))

  diffScalarMap(oldP.nodeGroupOverrides, newP.nodeGroupOverrides,
    (id, v) => safe(`upsertNodeGroupOverride(${id})`, () => conn.reducers.upsertNodeGroupOverride({ nodeId: c(id), groupId: v != null ? c(v) : undefined })),
    (id) => safe(`deleteNodeGroupOverride(${id})`, () => conn.reducers.deleteNodeGroupOverride({ nodeId: c(id) })))

  diffNestedPosMap(oldP.groupNodePositions, newP.groupNodePositions,
    (gid, nid, pos) => safe(`upsertGroupNodePos(${gid}/${nid})`, () => conn.reducers.upsertGroupNodePosition({ groupId: c(gid), nodeId: c(nid), x: pos.x, y: pos.y })),
    (gid, nid) => safe(`deleteGroupNodePos(${gid}/${nid})`, () => conn.reducers.deleteGroupNodePosition({ groupId: c(gid), nodeId: c(nid) })),
    (gid) => safe(`deleteGroupNodePosByGroup(${gid})`, () => conn.reducers.deleteGroupNodePositionsByGroup({ groupId: c(gid) })))

  diffPosMap(oldP.freeSegmentPositions, newP.freeSegmentPositions,
    (id, pos) => safe(`upsertFreeSegPos(${id})`, () => conn.reducers.upsertFreeSegmentPosition({ segmentId: c(id), x: pos.x, y: pos.y })),
    (id) => safe(`deleteFreeSegPos(${id})`, () => conn.reducers.deleteFreeSegmentPosition({ segmentId: c(id) })))

  diffNestedPosMap(oldP.groupFreeSegmentPositions, newP.groupFreeSegmentPositions,
    (gid, sid, pos) => safe(`upsertGroupFreeSegPos(${gid}/${sid})`, () => conn.reducers.upsertGroupFreeSegmentPosition({ groupId: c(gid), segmentId: c(sid), x: pos.x, y: pos.y })),
    (gid, sid) => safe(`deleteGroupFreeSegPos(${gid}/${sid})`, () => conn.reducers.deleteGroupFreeSegmentPosition({ groupId: c(gid), segmentId: c(sid) })),
    (gid) => safe(`deleteGroupFreeSegPosByGroup(${gid})`, () => conn.reducers.deleteGroupFreeSegmentPositionsByGroup({ groupId: c(gid) })))

  diffGenericMap(oldP.groupNodeOrders, newP.groupNodeOrders,
    (id, v) => safe(`upsertGroupNodeOrder(${id})`, () => conn.reducers.upsertGroupNodeOrder({ groupId: c(id), nodeIdsJson: JSON.stringify(v.map(c)) })),
    (id) => safe(`deleteGroupNodeOrder(${id})`, () => conn.reducers.deleteGroupNodeOrder({ groupId: c(id) })))

  diffGenericMap(oldP.customGroups, newP.customGroups,
    (id, v) => safe(`upsertCustomGroup(${id})`, () => conn.reducers.upsertCustomGroup({ groupId: c(id), title: v.title })),
    (id) => safe(`deleteCustomGroup(${id})`, () => conn.reducers.deleteCustomGroup({ groupId: c(id) })))

  diffScalarMap(oldP.groupTitleOverrides, newP.groupTitleOverrides,
    (id, v) => safe(`upsertGroupTitle(${id})`, () => conn.reducers.upsertGroupTitleOverride({ groupId: c(id), title: v })),
    (id) => safe(`deleteGroupTitle(${id})`, () => conn.reducers.deleteGroupTitleOverride({ groupId: c(id) })))

  diffScalarMap(oldP.nodeTitleOverrides, newP.nodeTitleOverrides,
    (id, v) => safe(`upsertNodeTitle(${id})`, () => conn.reducers.upsertNodeTitleOverride({ nodeId: c(id), title: v })),
    (id) => safe(`deleteNodeTitle(${id})`, () => conn.reducers.deleteNodeTitleOverride({ nodeId: c(id) })))

  diffScalarMap(oldP.nodeContainment, newP.nodeContainment,
    (id, v) => safe(`upsertNodeContainment(${id})`, () => conn.reducers.upsertNodeContainment({ nodeId: c(id), containerNodeId: c(v) })),
    (id) => safe(`deleteNodeContainment(${id})`, () => conn.reducers.deleteNodeContainment({ nodeId: c(id) })))

  diffGenericMap(oldP.labels, newP.labels,
    (id, v) => safe(`upsertLabel(${id})`, () => conn.reducers.upsertLabel({ labelId: c(id), text: v.text, x: v.x, y: v.y })),
    (id) => safe(`deleteLabel(${id})`, () => conn.reducers.deleteLabel({ labelId: c(id) })))

  diffGenericMap(oldP.canvasObjects, newP.canvasObjects,
    (id, v) => safe(`upsertCanvasObject(${id})`, () => conn.reducers.upsertCanvasObject({
      objectId: c(id), objectType: v.objectType, x: v.x, y: v.y,
      width: v.width, height: v.height, zIndex: v.zIndex, locked: v.locked,
      dataJson: JSON.stringify(v.data),
    })),
    (id) => safe(`deleteCanvasObject(${id})`, () => conn.reducers.deleteCanvasObject({ objectId: c(id) })))

  if (oldP.stonesPerRow !== newP.stonesPerRow) {
    safe('upsertStonesPerRow', () =>
      conn.reducers.upsertSetting({ key: `${c('settings:stonesPerRow')}`, valueNum: newP.stonesPerRow, valueText: undefined }),
    )
  }
}

// ─── Domain entity sync helpers ───────────────────────────────────────────────

/** Canvas-scoped board entities (inventories, movement groups); item catalog uses `w` in syncEntry. */
function syncActor(conn: DbConnection, a: Actor, c: (id: string) => string): void {
  conn.reducers.upsertActor({
    id: c(a.id),
    name: a.name,
    kind: a.kind,
    strengthMod: a.stats.strengthMod,
    hasLoadBearing: a.stats.hasLoadBearing,
    movementGroupId: c(a.movementGroupId),
    active: a.active,
    ownerActorId: a.ownerActorId ? c(a.ownerActorId) : undefined,
    capacityStone: a.capacityStone,
    baseExplorationFeet: a.baseSpeedProfile?.explorationFeet,
    baseCombatFeet: a.baseSpeedProfile?.combatFeet,
    baseRunningFeet: a.baseSpeedProfile?.runningFeet,
    baseMilesPerDay: a.baseSpeedProfile?.milesPerDay,
    leftWieldingEntryId: a.leftWieldingEntryId ? c(a.leftWieldingEntryId) : undefined,
    rightWieldingEntryId: a.rightWieldingEntryId ? c(a.rightWieldingEntryId) : undefined,
  })
}

function syncItemDef(conn: DbConnection, d: ItemDefinition, w: (id: string) => string): void {
  conn.reducers.upsertItemDefinition({
    id: w(d.id),
    canonicalName: d.canonicalName,
    kind: d.kind,
    sixthsPerUnit: d.sixthsPerUnit,
    armorClass: d.armorClass,
    priceInGp: d.priceInGp,
    isFungibleVisual: d.isFungibleVisual,
  })
}

type ItemCatalogOverlayEntry =
  | { deleted: true }
  | { deleted?: false; definition: ItemDefinition }

function buildSparseItemCatalogOverlay(
  defs: Record<string, ItemDefinition> | null,
): Record<string, ItemCatalogOverlayEntry> {
  const baseDefs = sampleState.itemDefinitions
  const resolved = defs ?? {}
  const out: Record<string, ItemCatalogOverlayEntry> = {}

  for (const [id, baseDef] of Object.entries(baseDefs)) {
    const cur = resolved[id]
    if (!cur) {
      out[id] = { deleted: true }
      continue
    }
    if (JSON.stringify(cur) !== JSON.stringify(baseDef)) {
      out[id] = { definition: cur }
    }
  }

  for (const [id, def] of Object.entries(resolved)) {
    if (!(id in baseDefs)) {
      out[id] = { definition: def }
    }
  }

  return out
}

function syncItemDefOverlay(
  conn: DbConnection,
  id: string,
  overlay: ItemCatalogOverlayEntry,
  w: (id: string) => string,
): void {
  if (overlay.deleted) {
    conn.reducers.upsertItemDefinition({
      id: w(id),
      canonicalName: id,
      kind: '__deleted__',
      sixthsPerUnit: undefined,
      armorClass: undefined,
      priceInGp: undefined,
      isFungibleVisual: undefined,
    })
    return
  }
  syncItemDef(conn, overlay.definition, w)
}

function syncEntry(
  conn: DbConnection,
  e: InventoryEntry,
  w: (id: string) => string,
  c: (id: string) => string,
): void {
  conn.reducers.upsertInventoryEntry({
    id: c(e.id),
    actorId: c(e.actorId),
    itemDefId: w(e.itemDefId),
    quantity: e.quantity,
    zone: e.zone,
    stateWorn: e.state?.worn,
    stateAttached: e.state?.attached,
    stateHeldHands: e.state?.heldHands,
    stateDropped: e.state?.dropped,
    stateInaccessible: e.state?.inaccessible,
    carryGroupId: e.carryGroupId ? c(e.carryGroupId) : undefined,
  })
}

function syncCarryGroup(conn: DbConnection, cg: CarryGroup, c: (id: string) => string): void {
  conn.reducers.upsertCarryGroup({
    id: c(cg.id),
    ownerActorId: c(cg.ownerActorId),
    name: cg.name,
    dropped: cg.dropped,
  })
}

function syncMovementGroup(conn: DbConnection, mg: MovementGroup, c: (id: string) => string): void {
  conn.reducers.upsertMovementGroup({
    id: c(mg.id),
    name: mg.name,
    active: mg.active,
  })
}

// ─── Generic diff utilities ──────────────────────────────────────────────────

function diffMap<T extends { id: string }>(
  oldMap: Record<string, T>,
  newMap: Record<string, T>,
  upsert: (entity: T) => void,
  remove: (id: string) => void,
): void {
  for (const [id, newEntity] of Object.entries(newMap)) {
    const oldEntity = oldMap[id]
    if (!oldEntity || JSON.stringify(oldEntity) !== JSON.stringify(newEntity)) {
      upsert(newEntity)
    }
  }
  for (const id of Object.keys(oldMap)) {
    if (!(id in newMap)) remove(id)
  }
}

function diffPosMap(
  oldMap: Record<string, { x: number; y: number }>,
  newMap: Record<string, { x: number; y: number }>,
  upsert: (id: string, pos: { x: number; y: number }) => void,
  remove: (id: string) => void,
): void {
  for (const [id, pos] of Object.entries(newMap)) {
    const old = oldMap[id]
    if (!old || old.x !== pos.x || old.y !== pos.y) upsert(id, pos)
  }
  for (const id of Object.keys(oldMap)) {
    if (!(id in newMap)) remove(id)
  }
}

function diffScalarMap<V>(
  oldMap: Record<string, V>,
  newMap: Record<string, V>,
  upsert: (id: string, v: V) => void,
  remove: (id: string) => void,
): void {
  for (const [id, v] of Object.entries(newMap)) {
    if (oldMap[id] !== v) upsert(id, v)
  }
  for (const id of Object.keys(oldMap)) {
    if (!(id in newMap)) remove(id)
  }
}

function diffGenericMap<V>(
  oldMap: Record<string, V>,
  newMap: Record<string, V>,
  upsert: (id: string, v: V) => void,
  remove: (id: string) => void,
): void {
  for (const [id, v] of Object.entries(newMap)) {
    if (!oldMap[id] || JSON.stringify(oldMap[id]) !== JSON.stringify(v)) upsert(id, v)
  }
  for (const id of Object.keys(oldMap)) {
    if (!(id in newMap)) remove(id)
  }
}

function diffNestedPosMap(
  oldMap: Record<string, Record<string, { x: number; y: number }>>,
  newMap: Record<string, Record<string, { x: number; y: number }>>,
  upsert: (outerKey: string, innerKey: string, pos: { x: number; y: number }) => void,
  remove: (outerKey: string, innerKey: string) => void,
  removeGroup: (outerKey: string) => void,
): void {
  for (const [outerKey, innerMap] of Object.entries(newMap)) {
    const oldInner = oldMap[outerKey] ?? {}
    for (const [innerKey, pos] of Object.entries(innerMap)) {
      const old = oldInner[innerKey]
      if (!old || old.x !== pos.x || old.y !== pos.y) upsert(outerKey, innerKey, pos)
    }
    for (const innerKey of Object.keys(oldInner)) {
      if (!(innerKey in innerMap)) remove(outerKey, innerKey)
    }
  }
  for (const outerKey of Object.keys(oldMap)) {
    if (!(outerKey in newMap)) removeGroup(outerKey)
  }
}
