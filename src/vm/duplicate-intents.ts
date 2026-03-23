import { entryIdsForSegmentMutation } from '../domain/coinage'
import type { Actor, CanonicalState, InventoryEntry } from '../domain/types'
import { parseNodeId, segmentIdToEntryId } from './drop-intent'
import { droppedGroupIdForActor, ensureDroppedGroup } from './dropped-ground'
import { createInventoryEntryId } from './inventory-ids'
import { createInventoryActorId, nextInventoryName } from '../worker/inventory-node'
import { buildSceneVM, type WorkerLocalState } from '../worker/scene-vm'
import type { WorkerIntent } from '../worker/protocol'

const SELF_WEIGHT_TOKEN_PREFIX = '__self_weight__:'
const isSelfWeightTokenId = (segmentId: string): boolean => segmentId.startsWith(SELF_WEIGHT_TOKEN_PREFIX)

type DupNodeIntent = Extract<WorkerIntent, { type: 'DUPLICATE_NODE' }>
type DupEntryIntent = Extract<WorkerIntent, { type: 'DUPLICATE_ENTRY' }>

/**
 * Precomputes replay ids for `DUPLICATE_NODE` from a replay base (server + pending),
 * matching apply order so sync replay is deterministic.
 */
export const snapshotDuplicateNodeReplay = (
  worldState: CanonicalState,
  intent: DupNodeIntent,
  now: () => number,
  random: () => number,
): NonNullable<DupNodeIntent['replay']> | null => {
  const actorId = parseNodeId(intent.nodeId).actorId
  const actor = worldState.actors[actorId]
  if (!actor) return null
  const sourceEntries = Object.values(worldState.inventoryEntries).filter((e) => e.actorId === actorId)
  const newActorId = createInventoryActorId(worldState, now, random)
  const newName = actor.name.match(/^Inventory (\d+)$/)
    ? nextInventoryName(worldState)
    : `${actor.name} (copy)`
  const newActor: Actor = {
    ...actor,
    id: newActorId,
    name: newName,
    leftWieldingEntryId: undefined,
    rightWieldingEntryId: undefined,
  }
  let ws: CanonicalState = {
    ...worldState,
    actors: {
      ...worldState.actors,
      [newActorId]: newActor,
    },
  }
  ws = ensureDroppedGroup(ws, newActorId)
  const newCarryGroupId = droppedGroupIdForActor(newActorId)
  const entryIdsBySourceEntryId: Record<string, string> = {}
  for (const entry of sourceEntries) {
    const newEntryId = createInventoryEntryId(ws, entry.itemDefId)
    entryIdsBySourceEntryId[entry.id] = newEntryId
    const isDropped = !!entry.carryGroupId || entry.zone === 'dropped' || !!entry.state?.dropped
    const nextEntry: InventoryEntry = {
      id: newEntryId,
      actorId: newActorId,
      itemDefId: entry.itemDefId,
      quantity: entry.quantity,
      zone: isDropped ? 'dropped' : entry.zone,
      carryGroupId: isDropped ? newCarryGroupId : undefined,
      state: isDropped ? { dropped: true } : undefined,
    }
    ws = {
      ...ws,
      inventoryEntries: {
        ...ws.inventoryEntries,
        [newEntryId]: nextEntry,
      },
    }
  }
  return { newActorId, newActorName: newName, entryIdsBySourceEntryId }
}

/** Precomputes replay entry ids for `DUPLICATE_ENTRY` in apply loop order. */
export const snapshotDuplicateEntryReplay = (
  worldState: CanonicalState,
  intent: DupEntryIntent,
): readonly string[] | null => {
  let ws = worldState
  const newEntryIds: string[] = []
  for (const segmentId of intent.segmentIds.filter((id) => !isSelfWeightTokenId(id))) {
    for (const entryId of entryIdsForSegmentMutation(ws, segmentId)) {
      const entry = ws.inventoryEntries[entryId]
      if (!entry) continue
      const itemDef = ws.itemDefinitions[entry.itemDefId]
      if (!itemDef) continue
      const newEntryId = createInventoryEntryId(ws, entry.itemDefId)
      newEntryIds.push(newEntryId)
      const isDropped = !!entry.carryGroupId || entry.zone === 'dropped' || !!entry.state?.dropped
      const nextEntry: InventoryEntry = {
        id: newEntryId,
        actorId: entry.actorId,
        itemDefId: entry.itemDefId,
        quantity: Math.max(1, entry.quantity),
        zone: isDropped ? 'dropped' : entry.zone,
        carryGroupId: isDropped ? entry.carryGroupId : undefined,
        state: isDropped ? { dropped: true } : undefined,
      }
      ws = {
        ...ws,
        inventoryEntries: {
          ...ws.inventoryEntries,
          [newEntryId]: nextEntry,
        },
      }
    }
  }
  return newEntryIds
}

/**
 * Duplicate an inventory node (actor + entries). When `intent.replay` is set (sync replay),
 * uses fixed ids so pending-intent replay matches server echo.
 */
export const applyDuplicateNodeIntent = (
  worldState: CanonicalState,
  localState: WorkerLocalState,
  intent: DupNodeIntent,
): { worldState: CanonicalState; localState: WorkerLocalState } => {
  /** Sync replay applies pending on top of server state that may already include this op. */
  if (intent.replay?.newActorId && worldState.actors[intent.replay.newActorId]) {
    return { worldState, localState }
  }

  const actorId = parseNodeId(intent.nodeId).actorId
  const actor = worldState.actors[actorId]
  if (!actor) return { worldState, localState }

  const scene = buildSceneVM(worldState, localState)
  const sourceEntries = Object.values(worldState.inventoryEntries).filter((e) => e.actorId === actorId)
  const replay = intent.replay

  const newActorId =
    replay?.newActorId ?? createInventoryActorId(worldState, Date.now, Math.random)
  const newName =
    replay?.newActorName ??
    (actor.name.match(/^Inventory (\d+)$/) ? nextInventoryName(worldState) : `${actor.name} (copy)`)

  const newActor: Actor = {
    ...actor,
    id: newActorId,
    name: newName,
    leftWieldingEntryId: undefined,
    rightWieldingEntryId: undefined,
  }
  let nextWorld: CanonicalState = {
    ...worldState,
    actors: {
      ...worldState.actors,
      [newActorId]: newActor,
    },
  }
  nextWorld = ensureDroppedGroup(nextWorld, newActorId)
  const newCarryGroupId = droppedGroupIdForActor(newActorId)
  const entryIdMap = new Map<string, string>()
  let nextFreeSegmentPositions = { ...localState.freeSegmentPositions }
  const nextGroupFreeSegmentPositions = { ...localState.groupFreeSegmentPositions }

  for (const entry of sourceEntries) {
    const newEntryId =
      replay?.entryIdsBySourceEntryId?.[entry.id] ?? createInventoryEntryId(nextWorld, entry.itemDefId)
    entryIdMap.set(entry.id, newEntryId)
    const isDropped = !!entry.carryGroupId || entry.zone === 'dropped' || !!entry.state?.dropped
    const nextEntry: InventoryEntry = {
      id: newEntryId,
      actorId: newActorId,
      itemDefId: entry.itemDefId,
      quantity: entry.quantity,
      zone: isDropped ? 'dropped' : entry.zone,
      carryGroupId: isDropped ? newCarryGroupId : undefined,
      state: isDropped ? { dropped: true } : undefined,
    }
    nextWorld = {
      ...nextWorld,
      inventoryEntries: {
        ...nextWorld.inventoryEntries,
        [newEntryId]: nextEntry,
      },
    }
    if (isDropped) {
      const freeSeg = Object.values(scene.freeSegments ?? {}).find((f) => segmentIdToEntryId(f.id) === entry.id)
      const offsetX = 40
      const offsetY = 60
      const srcX = freeSeg?.x ?? 120
      const srcY = freeSeg?.y ?? 120
      const newPos = { x: srcX + offsetX, y: srcY + offsetY }
      if (freeSeg?.groupId) {
        const groupPos = nextGroupFreeSegmentPositions[freeSeg.groupId] ?? {}
        nextGroupFreeSegmentPositions[freeSeg.groupId] = { ...groupPos, [newEntryId]: newPos }
      } else {
        nextFreeSegmentPositions = { ...nextFreeSegmentPositions, [newEntryId]: newPos }
      }
    }
  }

  const node = scene.nodes[intent.nodeId] ?? Object.values(scene.nodes).find((n) => n.actorId === actorId)
  const groupId = node?.groupId ?? null
  const sourceSizeOverride = localState.nodeSizeOverrides[actorId]

  if (groupId) {
    const sourceGroupPositions = localState.groupNodePositions[groupId] ?? {}
    const sourceRelativePos = sourceGroupPositions[actorId] ?? { x: 40, y: 60 }
    return {
      worldState: nextWorld,
      localState: {
        ...localState,
        freeSegmentPositions: nextFreeSegmentPositions,
        groupFreeSegmentPositions: nextGroupFreeSegmentPositions,
        nodeGroupOverrides: { ...localState.nodeGroupOverrides, [newActorId]: groupId },
        groupNodePositions: {
          ...localState.groupNodePositions,
          [groupId]: {
            ...sourceGroupPositions,
            [newActorId]: { x: sourceRelativePos.x + 40, y: sourceRelativePos.y + 60 },
          },
        },
        nodeSizeOverrides: sourceSizeOverride
          ? { ...localState.nodeSizeOverrides, [newActorId]: sourceSizeOverride }
          : localState.nodeSizeOverrides,
        groupNodeOrders: {
          ...localState.groupNodeOrders,
          [groupId]: [...(localState.groupNodeOrders[groupId] ?? []), newActorId],
        },
        selectedSegmentIds: Array.from(entryIdMap.values()),
      },
    }
  }

  const pos = localState.nodePositions[actorId] ?? { x: 120, y: 120 }
  return {
    worldState: nextWorld,
    localState: {
      ...localState,
      freeSegmentPositions: nextFreeSegmentPositions,
      groupFreeSegmentPositions: nextGroupFreeSegmentPositions,
      nodeGroupOverrides: { ...localState.nodeGroupOverrides, [newActorId]: null },
      nodePositions: {
        ...localState.nodePositions,
        [newActorId]: { x: pos.x + 40, y: pos.y + 60 },
      },
      nodeSizeOverrides: sourceSizeOverride
        ? { ...localState.nodeSizeOverrides, [newActorId]: sourceSizeOverride }
        : localState.nodeSizeOverrides,
      selectedSegmentIds: Array.from(entryIdMap.values()),
    },
  }
}

/**
 * Duplicate inventory entries from segment ids. When `intent.replay.newEntryIds` is set,
 * consumes ids in loop order (same as apply without replay).
 */
export const applyDuplicateEntryIntent = (
  worldState: CanonicalState,
  localState: WorkerLocalState,
  intent: DupEntryIntent,
): { worldState: CanonicalState; localState: WorkerLocalState } => {
  const scene = buildSceneVM(worldState, localState)
  const newSegmentIds: string[] = []
  const replayIds = intent.replay?.newEntryIds
  let replayIdx = 0

  let nextWorld = worldState
  let nextLocal = localState

  for (const segmentId of intent.segmentIds.filter((id) => !isSelfWeightTokenId(id))) {
    const entryIds = entryIdsForSegmentMutation(nextWorld, segmentId)
    for (const entryId of entryIds) {
      const entry = nextWorld.inventoryEntries[entryId]
      if (!entry) continue
      const itemDef = nextWorld.itemDefinitions[entry.itemDefId]
      if (!itemDef) continue

      const newEntryId =
        replayIds !== undefined ? replayIds[replayIdx++]! : createInventoryEntryId(nextWorld, entry.itemDefId)
      if (nextWorld.inventoryEntries[newEntryId]) {
        newSegmentIds.push(newEntryId)
        continue
      }
      const isDropped = !!entry.carryGroupId || entry.zone === 'dropped' || !!entry.state?.dropped
      const freeSeg = scene.freeSegments?.[segmentId]

      const nextEntry: InventoryEntry = {
        id: newEntryId,
        actorId: entry.actorId,
        itemDefId: entry.itemDefId,
        quantity: Math.max(1, entry.quantity),
        zone: isDropped ? 'dropped' : entry.zone,
        carryGroupId: isDropped ? entry.carryGroupId : undefined,
        state: isDropped ? { dropped: true } : undefined,
      }
      nextWorld = {
        ...nextWorld,
        inventoryEntries: {
          ...nextWorld.inventoryEntries,
          [newEntryId]: nextEntry,
        },
      }
      newSegmentIds.push(newEntryId)

      if (isDropped && freeSeg) {
        const offsetX = 40
        const offsetY = 60
        const srcX = freeSeg.x
        const srcY = freeSeg.y
        const newPos = { x: srcX + offsetX, y: srcY + offsetY }
        if (freeSeg.groupId) {
          const groupPos = nextLocal.groupFreeSegmentPositions[freeSeg.groupId] ?? {}
          nextLocal = {
            ...nextLocal,
            groupFreeSegmentPositions: {
              ...nextLocal.groupFreeSegmentPositions,
              [freeSeg.groupId]: { ...groupPos, [newEntryId]: newPos },
            },
          }
        } else {
          nextLocal = {
            ...nextLocal,
            freeSegmentPositions: {
              ...nextLocal.freeSegmentPositions,
              [newEntryId]: newPos,
            },
          }
        }
      }
    }
  }

  return {
    worldState: nextWorld,
    localState: {
      ...nextLocal,
      selectedSegmentIds: newSegmentIds,
    },
  }
}
