import type { CanonicalState, InventoryEntry, ItemDefinition, ItemKind } from '../domain/types'
import { parseNodeId, segmentIdToEntryId } from './drop-intent'
import { droppedGroupIdForActor, ensureDroppedGroup, resolveRenderableDropActorId } from './dropped-ground'
import { createInventoryEntryId } from './inventory-ids'
import { buildSceneVM, type WorkerLocalState } from '../worker/scene-vm'
import type { SceneVM, WorkerIntent } from '../worker/protocol'

export type SpawnItemInstanceIntent = Extract<WorkerIntent, { type: 'SPAWN_ITEM_INSTANCE' }>

/** Same behavior as the worker `SPAWN_ITEM_INSTANCE` intent (for tests and tooling). */
export const applySpawnItemInstance = (
  worldState: CanonicalState,
  localState: WorkerLocalState,
  intent: SpawnItemInstanceIntent,
): { worldState: CanonicalState; localState: WorkerLocalState } => {
  let ws = worldState
  let ls = localState

  let itemDef: ItemDefinition | undefined = ws.itemDefinitions[intent.itemDefId]
  if (!itemDef && intent.itemName) {
    const kind = (intent.itemKind as ItemKind) ?? 'standard'
    itemDef = {
      id: intent.itemDefId,
      canonicalName: intent.itemName,
      kind,
      sixthsPerUnit: intent.sixthsPerUnit ?? 1,
      armorClass: intent.armorClass,
      ...(kind === 'bundled'
        ? {
            bundleSize: intent.bundleSize ?? 20,
            minToCount: intent.minToCount ?? 1,
            sixthsPerBundle: intent.sixthsPerBundle ?? 1,
          }
        : {}),
      ...(kind === 'standard' || kind === 'coins'
        ? {
            ...(intent.coinagePool !== undefined ? { coinagePool: intent.coinagePool } : {}),
            ...(intent.coinDenom !== undefined ? { coinDenom: intent.coinDenom } : {}),
          }
        : {}),
    }
    ws = {
      ...ws,
      itemDefinitions: {
        ...ws.itemDefinitions,
        [intent.itemDefId]: itemDef,
      },
    }
  }

  const quantity = Math.max(1, Math.floor(intent.quantity))
  if (!itemDef || !Number.isFinite(quantity)) {
    return { worldState: ws, localState: ls }
  }

  let targetActorId: string | null = null
  let targetCarryGroupId: string | undefined
  let shouldDropToGround = false

  if (intent.targetNodeId) {
    const parsedTarget = parseNodeId(intent.targetNodeId)
    if (parsedTarget.actorId && ws.actors[parsedTarget.actorId]) {
      targetActorId = parsedTarget.actorId
      targetCarryGroupId = parsedTarget.carryGroupId
      shouldDropToGround = !!parsedTarget.carryGroupId
    }
  }

  if (!targetActorId && intent.x != null && intent.y != null) {
    const dropX = intent.x
    const dropY = intent.y
    const sceneAtDrop = buildSceneVM(ws, ls)
    const nearestNode = Object.values(sceneAtDrop.nodes).reduce<SceneVM['nodes'][string] | null>((best, node) => {
      const centerX = node.x + node.width / 2
      const centerY = node.y + node.height / 2
      const distSq = (centerX - dropX) ** 2 + (centerY - dropY) ** 2
      if (!best) return node
      const bestCenterX = best.x + best.width / 2
      const bestCenterY = best.y + best.height / 2
      const bestDistSq = (bestCenterX - dropX) ** 2 + (bestCenterY - dropY) ** 2
      return distSq < bestDistSq ? node : best
    }, null)
    if (nearestNode && ws.actors[nearestNode.actorId]) {
      targetActorId = resolveRenderableDropActorId(ws, nearestNode.actorId)
      shouldDropToGround = true
    }
  }

  if (!targetActorId) {
    return { worldState: ws, localState: ls }
  }

  if (shouldDropToGround && !targetCarryGroupId) {
    ws = ensureDroppedGroup(ws, targetActorId)
    targetCarryGroupId = droppedGroupIdForActor(targetActorId)
  } else if (targetCarryGroupId && !ws.carryGroups[targetCarryGroupId]) {
    ws = ensureDroppedGroup(ws, targetActorId)
    targetCarryGroupId = droppedGroupIdForActor(targetActorId)
    shouldDropToGround = true
  }

  const preferredZone = intent.wornClothing ? 'worn' : (intent.zoneHint ?? 'stowed')
  const preferredState = intent.wornClothing ? { worn: true as const } : undefined

  const createdEntryIds: string[] = []
  const replayEntryIds = intent.replay?.entryIds ?? []
  for (let i = 0; i < quantity; i += 1) {
    const entryId = replayEntryIds[i] ?? createInventoryEntryId(ws, intent.itemDefId, i)
    createdEntryIds.push(entryId)
    const zone = shouldDropToGround ? 'dropped' : preferredZone
    const state = shouldDropToGround ? { dropped: true } : preferredState
    const nextEntry: InventoryEntry = {
      id: entryId,
      actorId: targetActorId,
      itemDefId: intent.itemDefId,
      quantity: 1,
      zone,
      carryGroupId: targetCarryGroupId,
      state,
    }
    ws = {
      ...ws,
      inventoryEntries: {
        ...ws.inventoryEntries,
        [entryId]: nextEntry,
      },
    }
  }

  if (shouldDropToGround && intent.x != null && intent.y != null) {
    const freeSegmentPositions = { ...ls.freeSegmentPositions }
    if (intent.freeSegmentPositions && intent.segmentIds && intent.segmentIds.length === createdEntryIds.length) {
      for (let i = 0; i < createdEntryIds.length; i += 1) {
        const pos = intent.freeSegmentPositions[intent.segmentIds[i]!]
        if (pos) {
          freeSegmentPositions[createdEntryIds[i]!] = pos
        }
      }
    } else {
      const sceneAtDrop = buildSceneVM(ws, ls)
      const createdEntryIdSet = new Set(createdEntryIds)
      for (const free of Object.values(sceneAtDrop.freeSegments)) {
        if (createdEntryIdSet.has(segmentIdToEntryId(free.id))) {
          freeSegmentPositions[free.id] = { x: intent.x, y: intent.y }
        }
      }
    }
    ls = { ...ls, freeSegmentPositions }
  }

  return { worldState: ws, localState: ls }
}

export type ApplyAddItemsOpIntent = Extract<WorkerIntent, { type: 'APPLY_ADD_ITEMS_OP' }>

/** Same behavior as chaining `SPAWN_ITEM_INSTANCE` for each catalog row (`APPLY_ADD_ITEMS_OP`). */
export const applyAddItemsOp = (
  worldState: CanonicalState,
  localState: WorkerLocalState,
  intent: ApplyAddItemsOpIntent,
): { worldState: CanonicalState; localState: WorkerLocalState } => {
  let ws = worldState
  let ls = localState
  const replayByItem = intent.replay?.spawnEntryIdsByItem ?? []
  for (let i = 0; i < intent.items.length; i += 1) {
    const item = intent.items[i]!
    const r = applySpawnItemInstance(ws, ls, {
      type: 'SPAWN_ITEM_INSTANCE',
      itemDefId: item.itemDefId,
      quantity: item.quantity,
      targetNodeId: intent.targetNodeId,
      itemName: item.itemName,
      sixthsPerUnit: item.sixthsPerUnit,
      itemKind: item.itemKind,
      armorClass: item.armorClass,
      wornClothing: item.wornClothing,
      zoneHint: item.zoneHint,
      coinagePool: item.coinagePool,
      coinDenom: item.coinDenom,
      bundleSize: item.bundleSize,
      minToCount: item.minToCount,
      sixthsPerBundle: item.sixthsPerBundle,
      replay: replayByItem[i] ? { entryIds: replayByItem[i] } : undefined,
    })
    ws = r.worldState
    ls = r.localState
  }
  return { worldState: ws, localState: ls }
}
