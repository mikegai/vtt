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

export function reconstructCanonicalState(conn: DbConnection): CanonicalState {
  const actors: Record<string, Actor> = {}
  for (const row of conn.db.actors.iter()) {
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

    actors[row.id] = {
      id: row.id,
      name: row.name,
      kind: row.kind as ActorKind,
      stats: { strengthMod: row.strengthMod, hasLoadBearing: row.hasLoadBearing },
      movementGroupId: row.movementGroupId,
      active: row.active,
      ownerActorId: row.ownerActorId ?? undefined,
      capacityStone: row.capacityStone ?? undefined,
      baseSpeedProfile,
      leftWieldingEntryId: row.leftWieldingEntryId ?? undefined,
      rightWieldingEntryId: row.rightWieldingEntryId ?? undefined,
    }
  }

  const itemDefinitions: Record<string, ItemDefinition> = {}
  for (const row of conn.db.item_definitions.iter()) {
    itemDefinitions[row.id] = {
      id: row.id,
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
    const state: EquipmentState = {
      ...(row.stateWorn ? { worn: true } : {}),
      ...(row.stateAttached ? { attached: true } : {}),
      ...(row.stateHeldHands != null ? { heldHands: row.stateHeldHands as 0 | 1 | 2 } : {}),
      ...(row.stateDropped ? { dropped: true } : {}),
      ...(row.stateInaccessible ? { inaccessible: true } : {}),
    }

    inventoryEntries[row.id] = {
      id: row.id,
      actorId: row.actorId,
      itemDefId: row.itemDefId,
      quantity: row.quantity,
      zone: row.zone as CarryZone,
      state: Object.keys(state).length > 0 ? state : undefined,
      carryGroupId: row.carryGroupId ?? undefined,
    }
  }

  const carryGroups: Record<string, CarryGroup> = {}
  for (const row of conn.db.carry_groups.iter()) {
    carryGroups[row.id] = {
      id: row.id,
      ownerActorId: row.ownerActorId,
      name: row.name,
      dropped: row.dropped,
    }
  }

  const movementGroups: Record<string, MovementGroup> = {}
  for (const row of conn.db.movement_groups.iter()) {
    movementGroups[row.id] = {
      id: row.id,
      name: row.name,
      active: row.active,
    }
  }

  return { actors, itemDefinitions, inventoryEntries, carryGroups, movementGroups }
}

export function reconstructLayoutState(conn: DbConnection): Partial<PersistedLocalState> {
  const nodePositions: Record<string, { x: number; y: number }> = {}
  for (const row of conn.db.node_positions.iter()) {
    nodePositions[row.nodeId] = { x: row.x, y: row.y }
  }

  const groupPositions: Record<string, { x: number; y: number }> = {}
  for (const row of conn.db.group_positions.iter()) {
    groupPositions[row.groupId] = { x: row.x, y: row.y }
  }

  const groupSizeOverrides: Record<string, { width: number; height: number }> = {}
  for (const row of conn.db.group_size_overrides.iter()) {
    groupSizeOverrides[row.groupId] = { width: row.width, height: row.height }
  }

  const nodeSizeOverrides: Record<string, { slotCols: number; slotRows: number }> = {}
  for (const row of conn.db.node_size_overrides.iter()) {
    nodeSizeOverrides[row.nodeId] = { slotCols: row.slotCols, slotRows: row.slotRows }
  }

  const groupListViewEnabled: Record<string, boolean> = {}
  for (const row of conn.db.group_list_view.iter()) {
    groupListViewEnabled[row.groupId] = row.enabled
  }

  const nodeGroupOverrides: Record<string, string | null> = {}
  for (const row of conn.db.node_group_overrides.iter()) {
    nodeGroupOverrides[row.nodeId] = row.groupId ?? null
  }

  const groupNodePositions: Record<string, Record<string, { x: number; y: number }>> = {}
  for (const row of conn.db.group_node_positions.iter()) {
    if (!groupNodePositions[row.groupId]) groupNodePositions[row.groupId] = {}
    groupNodePositions[row.groupId][row.nodeId] = { x: row.x, y: row.y }
  }

  const freeSegmentPositions: Record<string, { x: number; y: number }> = {}
  for (const row of conn.db.free_segment_positions.iter()) {
    freeSegmentPositions[row.segmentId] = { x: row.x, y: row.y }
  }

  const groupFreeSegmentPositions: Record<string, Record<string, { x: number; y: number }>> = {}
  for (const row of conn.db.group_free_segment_positions.iter()) {
    if (!groupFreeSegmentPositions[row.groupId]) groupFreeSegmentPositions[row.groupId] = {}
    groupFreeSegmentPositions[row.groupId][row.segmentId] = { x: row.x, y: row.y }
  }

  const groupNodeOrders: Record<string, readonly string[]> = {}
  for (const row of conn.db.group_node_orders.iter()) {
    try {
      groupNodeOrders[row.groupId] = JSON.parse(row.nodeIdsJson) as string[]
    } catch {
      groupNodeOrders[row.groupId] = []
    }
  }

  const customGroups: Record<string, { title: string }> = {}
  for (const row of conn.db.custom_groups.iter()) {
    customGroups[row.groupId] = { title: row.title }
  }

  const groupTitleOverrides: Record<string, string> = {}
  for (const row of conn.db.group_title_overrides.iter()) {
    groupTitleOverrides[row.groupId] = row.title
  }

  const nodeTitleOverrides: Record<string, string> = {}
  for (const row of conn.db.node_title_overrides.iter()) {
    nodeTitleOverrides[row.nodeId] = row.title
  }

  const nodeContainment: Record<string, string> = {}
  for (const row of conn.db.node_containment.iter()) {
    nodeContainment[row.nodeId] = row.containerNodeId
  }

  const labels: Record<string, { text: string; x: number; y: number }> = {}
  for (const row of conn.db.labels.iter()) {
    labels[row.labelId] = { text: row.text, x: row.x, y: row.y }
  }

  let stonesPerRow: number | undefined
  for (const row of conn.db.settings.iter()) {
    if (row.key === 'stonesPerRow' && row.valueNum != null) stonesPerRow = row.valueNum
  }

  return {
    nodePositions,
    groupPositions,
    groupSizeOverrides,
    nodeSizeOverrides,
    groupListViewEnabled,
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
