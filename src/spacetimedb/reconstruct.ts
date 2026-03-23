/**
 * Layer 2 — Server State Mirror
 *
 * The ONLY code that reads SpacetimeDB client cache tables.
 * Iterates cache rows and materializes clean domain snapshots:
 *   - CanonicalState (actors, itemDefinitions, inventoryEntries, carryGroups, movementGroups)
 *   - PersistedLocalState (all shared layout fields)
 */

import type { CanonicalState, Actor, ItemDefinition, InventoryEntry, CarryGroup, MovementGroup, EquipmentState, ActorKind, ItemKind, CarryZone } from '../domain/types'
import type { PersistedLocalState } from '../persistence/backend'
import type { DbConnection } from '../module_bindings'
import type { WorldCanvasContext } from './context'
import { canvasPrefix, withoutPrefix, worldPrefix } from './context'
import { sampleState } from '../sample-data'

export function reconstructCanonicalState(conn: DbConnection, context: WorldCanvasContext): CanonicalState {
  const wp = worldPrefix(context)
  const cp = canvasPrefix(context)
  const actors: Record<string, Actor> = {}
  for (const row of conn.db.actors.iter()) {
    if (row.worldId !== context.worldId) continue
    if (row.canvasId !== context.canvasId) continue
    const localActorId = withoutPrefix(row.id, cp)
    if (!localActorId) continue
    const baseSpeedProfile =
      row.baseExplorationFeet != null &&
      row.baseCombatFeet != null &&
      row.baseRunningFeet != null &&
      row.baseMilesPerDay != null
        ? {
            explorationFeet: row.baseExplorationFeet,
            combatFeet: row.baseCombatFeet,
            runningFeet: row.baseRunningFeet,
            milesPerDay: row.baseMilesPerDay,
          }
        : undefined

    actors[localActorId] = {
      id: localActorId,
      name: row.name,
      kind: row.kind as ActorKind,
      stats: { strengthMod: row.strengthMod, hasLoadBearing: row.hasLoadBearing },
      movementGroupId: withoutPrefix(row.movementGroupId, cp) ?? row.movementGroupId,
      active: row.active,
      ownerActorId: row.ownerActorId ? (withoutPrefix(row.ownerActorId, cp) ?? undefined) : undefined,
      capacityStone: row.capacityStone ?? undefined,
      baseSpeedProfile,
      leftWieldingEntryId: row.leftWieldingEntryId ? (withoutPrefix(row.leftWieldingEntryId, cp) ?? undefined) : undefined,
      rightWieldingEntryId: row.rightWieldingEntryId ? (withoutPrefix(row.rightWieldingEntryId, cp) ?? undefined) : undefined,
    }
  }

  const itemDefinitions: Record<string, ItemDefinition> = { ...sampleState.itemDefinitions }
  for (const row of conn.db.item_definitions.iter()) {
    if (row.worldId !== context.worldId) continue
    const localItemId = withoutPrefix(row.id, wp)
    if (!localItemId) continue
    if (row.kind === '__deleted__') {
      delete itemDefinitions[localItemId]
      continue
    }
    itemDefinitions[localItemId] = {
      id: localItemId,
      canonicalName: row.canonicalName,
      kind: row.kind as ItemKind,
      sixthsPerUnit: row.sixthsPerUnit ?? undefined,
      armorClass: row.armorClass ?? undefined,
      priceInGp: row.priceInGp ?? undefined,
      isFungibleVisual: row.isFungibleVisual ?? undefined,
    }
  }

  const inventoryEntries: Record<string, InventoryEntry> = {}
  for (const row of conn.db.inventory_entries.iter()) {
    if (row.worldId !== context.worldId) continue
    if (row.canvasId !== context.canvasId) continue
    const localEntryId = withoutPrefix(row.id, cp)
    const localActorId = withoutPrefix(row.actorId, cp)
    const localItemDefId = withoutPrefix(row.itemDefId, wp)
    if (!localEntryId || !localActorId || !localItemDefId) continue
    const state: EquipmentState = {
      ...(row.stateWorn ? { worn: true } : {}),
      ...(row.stateAttached ? { attached: true } : {}),
      ...(row.stateHeldHands != null ? { heldHands: row.stateHeldHands as 0 | 1 | 2 } : {}),
      ...(row.stateDropped ? { dropped: true } : {}),
      ...(row.stateInaccessible ? { inaccessible: true } : {}),
    }

    inventoryEntries[localEntryId] = {
      id: localEntryId,
      actorId: localActorId,
      itemDefId: localItemDefId,
      quantity: row.quantity,
      zone: row.zone as CarryZone,
      state: Object.keys(state).length > 0 ? state : undefined,
      carryGroupId: row.carryGroupId ? (withoutPrefix(row.carryGroupId, cp) ?? undefined) : undefined,
    }
  }

  const carryGroups: Record<string, CarryGroup> = {}
  for (const row of conn.db.carry_groups.iter()) {
    if (row.worldId !== context.worldId) continue
    if (row.canvasId !== context.canvasId) continue
    const localCarryGroupId = withoutPrefix(row.id, cp)
    const localOwnerActorId = withoutPrefix(row.ownerActorId, cp)
    if (!localCarryGroupId || !localOwnerActorId) continue
    carryGroups[localCarryGroupId] = {
      id: localCarryGroupId,
      ownerActorId: localOwnerActorId,
      name: row.name,
      dropped: row.dropped,
    }
  }

  const movementGroups: Record<string, MovementGroup> = {}
  for (const row of conn.db.movement_groups.iter()) {
    if (row.worldId !== context.worldId) continue
    if (row.canvasId !== context.canvasId) continue
    const localMovementGroupId = withoutPrefix(row.id, cp)
    if (!localMovementGroupId) continue
    movementGroups[localMovementGroupId] = {
      id: localMovementGroupId,
      name: row.name,
      active: row.active,
    }
  }

  return { actors, itemDefinitions, inventoryEntries, carryGroups, movementGroups }
}

export function reconstructLayoutState(conn: DbConnection, context: WorldCanvasContext): Partial<PersistedLocalState> {
  const cp = canvasPrefix(context)
  const nodePositions: Record<string, { x: number; y: number }> = {}
  for (const row of conn.db.node_positions.iter()) {
    if (row.worldId !== context.worldId || row.canvasId !== context.canvasId) continue
    const nodeId = withoutPrefix(row.nodeId, cp)
    if (!nodeId) continue
    nodePositions[nodeId] = { x: row.x, y: row.y }
  }

  const groupPositions: Record<string, { x: number; y: number }> = {}
  for (const row of conn.db.group_positions.iter()) {
    if (row.worldId !== context.worldId || row.canvasId !== context.canvasId) continue
    const groupId = withoutPrefix(row.groupId, cp)
    if (!groupId) continue
    groupPositions[groupId] = { x: row.x, y: row.y }
  }

  const groupSizeOverrides: Record<string, { width: number; height: number }> = {}
  for (const row of conn.db.group_size_overrides.iter()) {
    if (row.worldId !== context.worldId || row.canvasId !== context.canvasId) continue
    const groupId = withoutPrefix(row.groupId, cp)
    if (!groupId) continue
    groupSizeOverrides[groupId] = { width: row.width, height: row.height }
  }

  const nodeSizeOverrides: Record<string, { slotCols: number; slotRows: number }> = {}
  for (const row of conn.db.node_size_overrides.iter()) {
    if (row.worldId !== context.worldId || row.canvasId !== context.canvasId) continue
    const nodeId = withoutPrefix(row.nodeId, cp)
    if (!nodeId) continue
    nodeSizeOverrides[nodeId] = { slotCols: row.slotCols, slotRows: row.slotRows }
  }

  const groupListViewEnabled: Record<string, boolean> = {}
  for (const row of conn.db.group_list_view.iter()) {
    if (row.worldId !== context.worldId || row.canvasId !== context.canvasId) continue
    const groupId = withoutPrefix(row.groupId, cp)
    if (!groupId) continue
    groupListViewEnabled[groupId] = row.enabled
  }

  const layoutExpanded: Record<string, boolean> = {}
  for (const row of conn.db.layout_expanded.iter()) {
    if (row.worldId !== context.worldId || row.canvasId !== context.canvasId) continue
    const containerId = withoutPrefix(row.containerId, cp)
    if (!containerId) continue
    layoutExpanded[containerId] = row.expanded
  }

  const nodeGroupOverrides: Record<string, string | null> = {}
  for (const row of conn.db.node_group_overrides.iter()) {
    if (row.worldId !== context.worldId || row.canvasId !== context.canvasId) continue
    const nodeId = withoutPrefix(row.nodeId, cp)
    if (!nodeId) continue
    nodeGroupOverrides[nodeId] = row.groupId ? (withoutPrefix(row.groupId, cp) ?? null) : null
  }

  const groupNodePositions: Record<string, Record<string, { x: number; y: number }>> = {}
  for (const row of conn.db.group_node_positions.iter()) {
    if (row.worldId !== context.worldId || row.canvasId !== context.canvasId) continue
    const groupId = withoutPrefix(row.groupId, cp)
    const nodeId = withoutPrefix(row.nodeId, cp)
    if (!groupId || !nodeId) continue
    if (!groupNodePositions[groupId]) groupNodePositions[groupId] = {}
    groupNodePositions[groupId][nodeId] = { x: row.x, y: row.y }
  }

  const freeSegmentPositions: Record<string, { x: number; y: number }> = {}
  for (const row of conn.db.free_segment_positions.iter()) {
    if (row.worldId !== context.worldId || row.canvasId !== context.canvasId) continue
    const segmentId = withoutPrefix(row.segmentId, cp)
    if (!segmentId) continue
    freeSegmentPositions[segmentId] = { x: row.x, y: row.y }
  }

  const groupFreeSegmentPositions: Record<string, Record<string, { x: number; y: number }>> = {}
  for (const row of conn.db.group_free_segment_positions.iter()) {
    if (row.worldId !== context.worldId || row.canvasId !== context.canvasId) continue
    const groupId = withoutPrefix(row.groupId, cp)
    const segmentId = withoutPrefix(row.segmentId, cp)
    if (!groupId || !segmentId) continue
    if (!groupFreeSegmentPositions[groupId]) groupFreeSegmentPositions[groupId] = {}
    groupFreeSegmentPositions[groupId][segmentId] = { x: row.x, y: row.y }
  }

  const groupNodeOrders: Record<string, readonly string[]> = {}
  for (const row of conn.db.group_node_orders.iter()) {
    if (row.worldId !== context.worldId || row.canvasId !== context.canvasId) continue
    const groupId = withoutPrefix(row.groupId, cp)
    if (!groupId) continue
    try {
      const ids = JSON.parse(row.nodeIdsJson) as string[]
      groupNodeOrders[groupId] = ids
        .map((id) => withoutPrefix(id, cp))
        .filter((id): id is string => id != null)
    } catch {
      groupNodeOrders[groupId] = []
    }
  }

  const customGroups: Record<string, { title: string }> = {}
  for (const row of conn.db.custom_groups.iter()) {
    if (row.worldId !== context.worldId || row.canvasId !== context.canvasId) continue
    const groupId = withoutPrefix(row.groupId, cp)
    if (!groupId) continue
    customGroups[groupId] = { title: row.title }
  }

  const groupTitleOverrides: Record<string, string> = {}
  for (const row of conn.db.group_title_overrides.iter()) {
    if (row.worldId !== context.worldId || row.canvasId !== context.canvasId) continue
    const groupId = withoutPrefix(row.groupId, cp)
    if (!groupId) continue
    groupTitleOverrides[groupId] = row.title
  }

  const nodeTitleOverrides: Record<string, string> = {}
  for (const row of conn.db.node_title_overrides.iter()) {
    if (row.worldId !== context.worldId || row.canvasId !== context.canvasId) continue
    const nodeId = withoutPrefix(row.nodeId, cp)
    if (!nodeId) continue
    nodeTitleOverrides[nodeId] = row.title
  }

  const nodeContainment: Record<string, string> = {}
  for (const row of conn.db.node_containment.iter()) {
    if (row.worldId !== context.worldId || row.canvasId !== context.canvasId) continue
    const nodeId = withoutPrefix(row.nodeId, cp)
    const containerNodeId = withoutPrefix(row.containerNodeId, cp)
    if (!nodeId || !containerNodeId) continue
    nodeContainment[nodeId] = containerNodeId
  }

  const labels: Record<string, { text: string; x: number; y: number }> = {}
  for (const row of conn.db.labels.iter()) {
    if (row.worldId !== context.worldId || row.canvasId !== context.canvasId) continue
    const labelId = withoutPrefix(row.labelId, cp)
    if (!labelId) continue
    labels[labelId] = { text: row.text, x: row.x, y: row.y }
  }

  let stonesPerRow: number | undefined
  for (const row of conn.db.settings.iter()) {
    if (row.worldId !== context.worldId || row.canvasId !== context.canvasId) continue
    if (row.key === `${cp}settings:stonesPerRow` && row.valueNum != null) stonesPerRow = row.valueNum
  }

  return {
    nodePositions,
    groupPositions,
    groupSizeOverrides,
    nodeSizeOverrides,
    groupListViewEnabled,
    layoutExpanded,
    nodeGroupOverrides,
    groupNodePositions,
    freeSegmentPositions,
    groupFreeSegmentPositions,
    groupNodeOrders,
    customGroups,
    groupTitleOverrides,
    nodeTitleOverrides,
    nodeContainment,
    labels,
    ...(stonesPerRow != null ? { stonesPerRow } : {}),
  }
}
