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

function stripEphemeral(state: WorkerLocalState): PersistedLocalState {
  const {
    hoveredSegmentId: _1,
    dropIntent: _2,
    filterCategory: _3,
    selectedSegmentIds: _4,
    selectedNodeIds: _5,
    selectedGroupIds: _6,
    selectedLabelIds: _7,
    selectedLabelId: _8,
    ...persisted
  } = state
  return persisted
}

export function syncWorldState(
  conn: DbConnection,
  oldWorld: CanonicalState | null,
  newWorld: CanonicalState,
): void {
  diffMap(oldWorld?.actors ?? {}, newWorld.actors,
    (a) => syncActor(conn, a), (id) => conn.reducers.deleteActor({ id }))
  diffMap(oldWorld?.itemDefinitions ?? {}, newWorld.itemDefinitions,
    (d) => syncItemDef(conn, d), (id) => conn.reducers.deleteItemDefinition({ id }))
  diffMap(oldWorld?.inventoryEntries ?? {}, newWorld.inventoryEntries,
    (e) => syncEntry(conn, e), (id) => conn.reducers.deleteInventoryEntry({ id }))
  diffMap(oldWorld?.carryGroups ?? {}, newWorld.carryGroups,
    (cg) => syncCarryGroup(conn, cg), (id) => conn.reducers.deleteCarryGroup({ id }))
  diffMap(oldWorld?.movementGroups ?? {}, newWorld.movementGroups,
    (mg) => syncMovementGroup(conn, mg), (id) => conn.reducers.deleteMovementGroup({ id }))
}

export function syncLocalState(
  conn: DbConnection,
  oldLocal: WorkerLocalState,
  newLocal: WorkerLocalState,
): void {
  const oldP = stripEphemeral(oldLocal)
  const newP = stripEphemeral(newLocal)

  diffPosMap(oldP.nodePositions, newP.nodePositions,
    (id, pos) => conn.reducers.upsertNodePosition({ nodeId: id, x: pos.x, y: pos.y }),
    (id) => conn.reducers.deleteNodePosition({ nodeId: id }))

  diffPosMap(oldP.groupPositions, newP.groupPositions,
    (id, pos) => conn.reducers.upsertGroupPosition({ groupId: id, x: pos.x, y: pos.y }),
    (id) => conn.reducers.deleteGroupPosition({ groupId: id }))

  diffGenericMap(oldP.groupSizeOverrides, newP.groupSizeOverrides,
    (id, v) => conn.reducers.upsertGroupSizeOverride({ groupId: id, width: v.width, height: v.height }),
    (id) => conn.reducers.deleteGroupSizeOverride({ groupId: id }))

  diffGenericMap(oldP.nodeSizeOverrides, newP.nodeSizeOverrides,
    (id, v) => conn.reducers.upsertNodeSizeOverride({ nodeId: id, slotCols: v.slotCols, slotRows: v.slotRows }),
    (id) => conn.reducers.deleteNodeSizeOverride({ nodeId: id }))

  diffScalarMap(oldP.groupListViewEnabled, newP.groupListViewEnabled,
    (id, v) => conn.reducers.upsertGroupListView({ groupId: id, enabled: v }),
    (id) => conn.reducers.deleteGroupListView({ groupId: id }))

  diffScalarMap(oldP.nodeGroupOverrides, newP.nodeGroupOverrides,
    (id, v) => conn.reducers.upsertNodeGroupOverride({ nodeId: id, groupId: v ?? undefined }),
    (id) => conn.reducers.deleteNodeGroupOverride({ nodeId: id }))

  diffNestedPosMap(oldP.groupNodePositions, newP.groupNodePositions,
    (gid, nid, pos) => conn.reducers.upsertGroupNodePosition({ groupId: gid, nodeId: nid, x: pos.x, y: pos.y }),
    (gid, nid) => conn.reducers.deleteGroupNodePosition({ groupId: gid, nodeId: nid }),
    (gid) => conn.reducers.deleteGroupNodePositionsByGroup({ groupId: gid }))

  diffPosMap(oldP.freeSegmentPositions, newP.freeSegmentPositions,
    (id, pos) => conn.reducers.upsertFreeSegmentPosition({ segmentId: id, x: pos.x, y: pos.y }),
    (id) => conn.reducers.deleteFreeSegmentPosition({ segmentId: id }))

  diffNestedPosMap(oldP.groupFreeSegmentPositions, newP.groupFreeSegmentPositions,
    (gid, sid, pos) => conn.reducers.upsertGroupFreeSegmentPosition({ groupId: gid, segmentId: sid, x: pos.x, y: pos.y }),
    (gid, sid) => conn.reducers.deleteGroupFreeSegmentPosition({ groupId: gid, segmentId: sid }),
    (gid) => conn.reducers.deleteGroupFreeSegmentPositionsByGroup({ groupId: gid }))

  diffGenericMap(oldP.groupNodeOrders, newP.groupNodeOrders,
    (id, v) => conn.reducers.upsertGroupNodeOrder({ groupId: id, nodeIdsJson: JSON.stringify(v) }),
    (id) => conn.reducers.deleteGroupNodeOrder({ groupId: id }))

  diffGenericMap(oldP.customGroups, newP.customGroups,
    (id, v) => conn.reducers.upsertCustomGroup({ groupId: id, title: v.title }),
    (id) => conn.reducers.deleteCustomGroup({ groupId: id }))

  diffScalarMap(oldP.groupTitleOverrides, newP.groupTitleOverrides,
    (id, v) => conn.reducers.upsertGroupTitleOverride({ groupId: id, title: v }),
    (id) => conn.reducers.deleteGroupTitleOverride({ groupId: id }))

  diffScalarMap(oldP.nodeTitleOverrides, newP.nodeTitleOverrides,
    (id, v) => conn.reducers.upsertNodeTitleOverride({ nodeId: id, title: v }),
    (id) => conn.reducers.deleteNodeTitleOverride({ nodeId: id }))

  diffScalarMap(oldP.nodeContainment, newP.nodeContainment,
    (id, v) => conn.reducers.upsertNodeContainment({ nodeId: id, containerNodeId: v }),
    (id) => conn.reducers.deleteNodeContainment({ nodeId: id }))

  diffGenericMap(oldP.labels, newP.labels,
    (id, v) => conn.reducers.upsertLabel({ labelId: id, text: v.text, x: v.x, y: v.y }),
    (id) => conn.reducers.deleteLabel({ labelId: id }))

  if (oldP.stonesPerRow !== newP.stonesPerRow) {
    conn.reducers.upsertSetting({ key: 'stonesPerRow', valueNum: newP.stonesPerRow })
  }
}

// ─── Domain entity sync helpers ───────────────────────────────────────────────

function syncActor(conn: DbConnection, a: Actor): void {
  conn.reducers.upsertActor({
    id: a.id,
    name: a.name,
    kind: a.kind,
    strengthMod: a.stats.strengthMod,
    hasLoadBearing: a.stats.hasLoadBearing,
    movementGroupId: a.movementGroupId,
    active: a.active,
    ownerActorId: a.ownerActorId,
    capacityStone: a.capacityStone,
    baseExplorationFeet: a.baseSpeedProfile?.explorationFeet,
    baseCombatFeet: a.baseSpeedProfile?.combatFeet,
    baseRunningFeet: a.baseSpeedProfile?.runningFeet,
    baseMilesPerDay: a.baseSpeedProfile?.milesPerDay,
    leftWieldingEntryId: a.leftWieldingEntryId,
    rightWieldingEntryId: a.rightWieldingEntryId,
  })
}

function syncItemDef(conn: DbConnection, d: ItemDefinition): void {
  conn.reducers.upsertItemDefinition({
    id: d.id,
    canonicalName: d.canonicalName,
    kind: d.kind,
    sixthsPerUnit: d.sixthsPerUnit,
    armorClass: d.armorClass,
    priceInGp: d.priceInGp,
    isFungibleVisual: d.isFungibleVisual,
  })
}

function syncEntry(conn: DbConnection, e: InventoryEntry): void {
  conn.reducers.upsertInventoryEntry({
    id: e.id,
    actorId: e.actorId,
    itemDefId: e.itemDefId,
    quantity: e.quantity,
    zone: e.zone,
    stateWorn: e.state?.worn,
    stateAttached: e.state?.attached,
    stateHeldHands: e.state?.heldHands,
    stateDropped: e.state?.dropped,
    stateInaccessible: e.state?.inaccessible,
    carryGroupId: e.carryGroupId,
  })
}

function syncCarryGroup(conn: DbConnection, cg: CarryGroup): void {
  conn.reducers.upsertCarryGroup({
    id: cg.id,
    ownerActorId: cg.ownerActorId,
    name: cg.name,
    dropped: cg.dropped,
  })
}

function syncMovementGroup(conn: DbConnection, mg: MovementGroup): void {
  conn.reducers.upsertMovementGroup({
    id: mg.id,
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
