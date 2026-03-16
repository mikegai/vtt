/// <reference lib="webworker" />

import type { Actor, CanonicalState, InventoryEntry } from '../domain/types'
import { getWieldOptions, isTwoHandedOnly } from '../domain/weapon-metadata'
import { parseNodeId, segmentIdToEntryId } from '../vm/drop-intent'
import type { ActorRowVM } from '../vm/vm-types'
import { buildBoardVM } from '../vm/vm'
import { diffSceneVM } from './scene-diff'
import { buildSceneVM, type WorkerLocalState } from './scene-vm'
import type { MainToWorkerMessage, SceneVM, WorkerIntent, WorkerToMainMessage } from './protocol'

let worldState: CanonicalState | null = null
let localState: WorkerLocalState = {
  hoveredSegmentId: null,
  groupPositions: {},
  nodeGroupOverrides: {},
  groupNodeOrders: {},
  dropIntent: null,
  stonesPerRow: 25,
  filterCategory: null,
  selectedSegmentIds: [],
}
let previousScene: SceneVM | null = null

const post = (message: WorkerToMainMessage): void => {
  self.postMessage(message)
}

const buildSegmentIdToNodeId = (state: CanonicalState): Record<string, string> => {
  const board = buildBoardVM(state)
  const sourceNodeIds: Record<string, string> = {}
  const visit = (row: ActorRowVM): void => {
    for (const seg of row.segments) sourceNodeIds[seg.id] = row.id
    for (const child of row.childRows) visit(child)
  }
  for (const row of board.rows) visit(row)
  return sourceNodeIds
}

/** Migrate legacy entry.state.wield to actor.leftWieldingEntryId/rightWieldingEntryId. */
const migrateWieldToActor = (state: CanonicalState): CanonicalState => {
  const actors = { ...state.actors }
  const inventoryEntries = { ...state.inventoryEntries }
  let changed = false

  for (const entry of Object.values(state.inventoryEntries)) {
    const wield = entry.state?.wield
    if (!wield || entry.carryGroupId) continue

    const actor = actors[entry.actorId]
    if (!actor) continue

    const nextActor: Actor = {
      ...actor,
      leftWieldingEntryId: wield === 'left' || wield === 'both' ? entry.id : actor.leftWieldingEntryId,
      rightWieldingEntryId: wield === 'right' || wield === 'both' ? entry.id : actor.rightWieldingEntryId,
    }
    if (nextActor.leftWieldingEntryId !== actor.leftWieldingEntryId || nextActor.rightWieldingEntryId !== actor.rightWieldingEntryId) {
      actors[actor.id] = nextActor
      changed = true
    }

    const { wield: _w, heldHands: _h, ...restState } = entry.state ?? {}
    if (_w !== undefined || _h !== undefined) {
      inventoryEntries[entry.id] = { ...entry, state: Object.keys(restState).length ? restState : undefined }
      changed = true
    }
  }

  if (!changed) return state
  return { ...state, actors, inventoryEntries }
}

const recompute = (sendInitIfFirst = false): void => {
  if (!worldState) return
  const nextScene = buildSceneVM(worldState, localState)

  if (sendInitIfFirst || !previousScene) {
    previousScene = nextScene
    post({ type: 'SCENE_INIT', scene: nextScene })
    return
  }

  const patches = diffSceneVM(previousScene, nextScene)
  previousScene = nextScene
  if (patches.length > 0) {
    post({ type: 'SCENE_PATCHES', patches, scene: nextScene })
  }
}

const applyIntent = (intent: WorkerIntent): void => {
  if (intent.type === 'HOVER_SEGMENT') {
    localState = {
      ...localState,
      hoveredSegmentId: intent.segmentId,
    }
    recompute()
    return
  }

  if (intent.type === 'SET_FILTER_CATEGORY') {
    localState = { ...localState, filterCategory: intent.category }
    recompute()
    return
  }

  if (intent.type === 'SET_SELECTED_SEGMENTS') {
    localState = { ...localState, selectedSegmentIds: intent.segmentIds }
    recompute()
    return
  }

  if (intent.type === 'SELECT_SEGMENTS_ADD') {
    const next = new Set(localState.selectedSegmentIds)
    intent.segmentIds.forEach((id) => next.add(id))
    localState = { ...localState, selectedSegmentIds: [...next] }
    recompute()
    return
  }

  if (intent.type === 'SELECT_SEGMENTS_REMOVE') {
    const toRemove = new Set(intent.segmentIds)
    const next = localState.selectedSegmentIds.filter((id) => !toRemove.has(id))
    localState = { ...localState, selectedSegmentIds: next }
    recompute()
    return
  }

  if (intent.type === 'SELECT_ALL_OF_TYPE') {
    if (!worldState) {
      recompute()
      return
    }
    const scene = buildSceneVM(worldState, localState)
    const allOfType: string[] = []
    const nodes = intent.nodeId
      ? [scene.nodes[intent.nodeId]].filter(Boolean)
      : Object.values(scene.nodes)
    for (const node of nodes) {
      for (const seg of node.segments) {
        if (seg.itemDefId === intent.itemDefId) allOfType.push(seg.id)
      }
    }
    localState = { ...localState, selectedSegmentIds: allOfType }
    recompute()
    return
  }

  if (intent.type === 'MOVE_GROUP') {
    localState = {
      ...localState,
      groupPositions: {
        ...localState.groupPositions,
        [intent.groupId]: { x: intent.x, y: intent.y },
      },
    }
    recompute()
    return
  }

  if (intent.type === 'MOVE_NODE_TO_GROUP_INDEX') {
    const nextOrders: Record<string, readonly string[]> = { ...localState.groupNodeOrders }
    for (const [gid, order] of Object.entries(nextOrders)) {
      nextOrders[gid] = order.filter((id) => id !== intent.nodeId)
    }
    const target = [...(nextOrders[intent.groupId] ?? [])]
    const clamped = Math.max(0, Math.min(intent.index, target.length))
    target.splice(clamped, 0, intent.nodeId)
    nextOrders[intent.groupId] = target

    if (worldState && worldState.actors[intent.nodeId]) {
      const actor = worldState.actors[intent.nodeId]
      worldState = {
        ...worldState,
        actors: {
          ...worldState.actors,
          [intent.nodeId]: {
            ...actor,
            movementGroupId: intent.groupId,
          },
        },
      }
    }

    localState = {
      ...localState,
      nodeGroupOverrides: {
        ...localState.nodeGroupOverrides,
        [intent.nodeId]: intent.groupId,
      },
      groupNodeOrders: nextOrders,
    }
    recompute()
    return
  }

  if (intent.type === 'DRAG_SEGMENT_START') {
    if (!worldState || intent.segmentIds.length === 0) {
      recompute()
      return
    }
    const segToNode = buildSegmentIdToNodeId(worldState)
    const firstSource = segToNode[intent.segmentIds[0]]
    const sourceNodeIds: Record<string, string> = {}
    for (const id of intent.segmentIds) {
      const nodeId = segToNode[id]
      if (nodeId) sourceNodeIds[id] = nodeId
    }
    localState = {
      ...localState,
      dropIntent: {
        segmentIds: intent.segmentIds,
        sourceNodeIds,
        targetNodeId: firstSource ?? intent.segmentIds[0],
      },
    }
    recompute()
    return
  }

  if (intent.type === 'DRAG_SEGMENT_UPDATE') {
    if (!localState.dropIntent) return
    const firstSource = localState.dropIntent.segmentIds[0]
      ? localState.dropIntent.sourceNodeIds[localState.dropIntent.segmentIds[0]]
      : null
    localState = {
      ...localState,
      dropIntent: {
        ...localState.dropIntent,
        targetNodeId: intent.targetNodeId ?? firstSource ?? localState.dropIntent.targetNodeId,
      },
    }
    recompute()
    return
  }

  if (intent.type === 'DRAG_SEGMENT_END') {
    if (localState.dropIntent && intent.targetNodeId) {
      const { segmentIds, sourceNodeIds, targetNodeId } = localState.dropIntent
      const target = parseNodeId(targetNodeId)
      if (worldState) {
        for (const segmentId of segmentIds) {
          const sourceNodeId = sourceNodeIds[segmentId]
          if (!sourceNodeId) continue
          const source = parseNodeId(sourceNodeId)
          if (source.actorId === target.actorId && source.carryGroupId === target.carryGroupId) continue
          const entryId = segmentIdToEntryId(segmentId)
          const entry: InventoryEntry | undefined = worldState.inventoryEntries[entryId]
          if (entry) {
            const movedEntry: InventoryEntry = {
              ...entry,
              actorId: target.actorId,
              carryGroupId: target.carryGroupId,
            }
            worldState = {
              ...worldState,
              inventoryEntries: {
                ...worldState.inventoryEntries,
                [entryId]: movedEntry,
              },
            }
            const actor: Actor | undefined = worldState.actors[source.actorId]
            if (actor && (actor.leftWieldingEntryId === entryId || actor.rightWieldingEntryId === entryId)) {
              const nextActor: Actor = {
                ...actor,
                leftWieldingEntryId: actor.leftWieldingEntryId === entryId ? undefined : actor.leftWieldingEntryId,
                rightWieldingEntryId: actor.rightWieldingEntryId === entryId ? undefined : actor.rightWieldingEntryId,
              }
              worldState = {
                ...worldState,
                actors: { ...worldState.actors, [actor.id]: nextActor },
              }
            }
          }
        }
      }
    }
    localState = { ...localState, dropIntent: null }
    recompute()
    return
  }

  if (intent.type === 'MOVE_ENTRY_TO') {
    if (!worldState) return
    const { segmentId, sourceNodeId, targetNodeId } = intent
    const source = parseNodeId(sourceNodeId)
    const target = parseNodeId(targetNodeId)
    if (source.actorId !== target.actorId || source.carryGroupId !== target.carryGroupId) {
      const entryId = segmentIdToEntryId(segmentId)
      const entry = worldState.inventoryEntries[entryId]
      if (entry) {
        const movedEntry = {
          ...entry,
          actorId: target.actorId,
          carryGroupId: target.carryGroupId,
        }
        worldState = {
          ...worldState,
          inventoryEntries: {
            ...worldState.inventoryEntries,
            [entryId]: movedEntry,
          },
        }
        const actor = worldState.actors[source.actorId]
        if (actor && (actor.leftWieldingEntryId === entryId || actor.rightWieldingEntryId === entryId)) {
          const nextActor: Actor = {
            ...actor,
            leftWieldingEntryId: actor.leftWieldingEntryId === entryId ? undefined : actor.leftWieldingEntryId,
            rightWieldingEntryId: actor.rightWieldingEntryId === entryId ? undefined : actor.rightWieldingEntryId,
          }
          worldState = {
            ...worldState,
            actors: { ...worldState.actors, [actor.id]: nextActor },
          }
        }
      }
    }
    recompute()
    return
  }

  if (intent.type === 'SET_WIELD') {
    if (!worldState) return
    const entryId = segmentIdToEntryId(intent.segmentId)
    const entry = worldState.inventoryEntries[entryId]
    const itemDef = entry ? worldState.itemDefinitions[entry.itemDefId] : null
    if (!entry || !itemDef || !getWieldOptions(itemDef)?.includes(intent.wield)) {
      recompute()
      return
    }

    const actor = worldState.actors[entry.actorId]
    if (!actor || entry.carryGroupId) {
      recompute()
      return
    }

    let left = actor.leftWieldingEntryId
    let right = actor.rightWieldingEntryId

    if (intent.wield === 'both') {
      left = entryId
      right = entryId
    } else if (intent.wield === 'left') {
      if (right === entryId) right = undefined
      else if (right) {
        const rightEntry = worldState.inventoryEntries[right]
        const rightDef = rightEntry ? worldState.itemDefinitions[rightEntry.itemDefId] : null
        if (rightDef && isTwoHandedOnly(rightDef)) right = undefined
      }
      left = entryId
    } else {
      if (left === entryId) left = undefined
      else if (left) {
        const leftEntry = worldState.inventoryEntries[left]
        const leftDef = leftEntry ? worldState.itemDefinitions[leftEntry.itemDefId] : null
        if (leftDef && isTwoHandedOnly(leftDef)) left = undefined
      }
      right = entryId
    }

    const nextActor: Actor = { ...actor, leftWieldingEntryId: left, rightWieldingEntryId: right }
    worldState = {
      ...worldState,
      actors: { ...worldState.actors, [actor.id]: nextActor },
    }
    recompute()
    return
  }

  if (intent.type === 'UNWIELD') {
    if (!worldState) return
    const entryId = segmentIdToEntryId(intent.segmentId)
    const entry = worldState.inventoryEntries[entryId]
    if (!entry) {
      recompute()
      return
    }

    const actor = worldState.actors[entry.actorId]
    if (actor && (actor.leftWieldingEntryId === entryId || actor.rightWieldingEntryId === entryId)) {
      const nextActor: Actor = {
        ...actor,
        leftWieldingEntryId: actor.leftWieldingEntryId === entryId ? undefined : actor.leftWieldingEntryId,
        rightWieldingEntryId: actor.rightWieldingEntryId === entryId ? undefined : actor.rightWieldingEntryId,
      }
      worldState = {
        ...worldState,
        actors: { ...worldState.actors, [actor.id]: nextActor },
      }
    }
    recompute()
    return
  }

  if (intent.type === 'SET_WORLD_STATE') {
    worldState = migrateWieldToActor(intent.worldState)
    recompute()
  }
}

self.onmessage = (event: MessageEvent<MainToWorkerMessage>) => {
  const message = event.data
  if (message.type === 'INIT') {
    worldState = migrateWieldToActor(message.worldState)
    if (message.stonesPerRow != null) {
      localState = { ...localState, stonesPerRow: message.stonesPerRow }
    }
    recompute(true)
    return
  }
  if (message.type === 'SET_STONES_PER_ROW') {
    localState = { ...localState, stonesPerRow: message.stonesPerRow }
    recompute(true)
    return
  }
  if (message.type === 'INTENT') {
    applyIntent(message.intent)
  }
}

