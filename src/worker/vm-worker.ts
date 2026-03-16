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
  nodePositions: {},
  freeSegmentPositions: {},
  groupNodeOrders: {},
  customGroups: {},
  dropIntent: null,
  stonesPerRow: 25,
  filterCategory: null,
  selectedSegmentIds: [],
  labels: {},
  selectedLabelId: null,
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

const droppedGroupIdForActor = (actorId: string): string => `${actorId}:ground`

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
    if (!intent.nodeId) {
      for (const free of Object.values(scene.freeSegments ?? {})) {
        if (free.segment.itemDefId === intent.itemDefId) allOfType.push(free.segment.id)
      }
    } else if (!scene.nodes[intent.nodeId]) {
      for (const free of Object.values(scene.freeSegments ?? {})) {
        if (free.nodeId === intent.nodeId && free.segment.itemDefId === intent.itemDefId) allOfType.push(free.segment.id)
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

  if (intent.type === 'ADD_GROUP') {
    const groupId = `custom-group:${Date.now().toString(36)}:${Math.random().toString(36).slice(2, 7)}`
    const title = `Group ${Object.keys(localState.customGroups).length + 1}`
    localState = {
      ...localState,
      customGroups: {
        ...localState.customGroups,
        [groupId]: { title },
      },
      groupPositions: {
        ...localState.groupPositions,
        [groupId]: { x: intent.x, y: intent.y },
      },
      groupNodeOrders: {
        ...localState.groupNodeOrders,
        [groupId]: [],
      },
    }
    recompute()
    return
  }

  if (intent.type === 'MOVE_NODE_TO_GROUP_INDEX') {
    if (!worldState) {
      recompute()
      return
    }
    const scene = buildSceneVM(worldState, localState)
    const nodeIdsToMove: string[] = [intent.nodeId]
    for (const n of Object.values(scene.nodes)) {
      if (n.parentNodeId === intent.nodeId) nodeIdsToMove.push(n.id)
    }
    const baseOrders: Record<string, readonly string[]> = {}
    for (const [gid, g] of Object.entries(scene.groups ?? {})) {
      baseOrders[gid] = [...g.nodeIds]
    }
    const nextOrders: Record<string, readonly string[]> = { ...baseOrders }
    for (const [gid, order] of Object.entries(nextOrders)) {
      nextOrders[gid] = order.filter((id) => !nodeIdsToMove.includes(id))
    }
    const target = [...(nextOrders[intent.groupId] ?? [])]
    const clamped = Math.max(0, Math.min(intent.index, target.length))
    target.splice(clamped, 0, ...nodeIdsToMove)
    nextOrders[intent.groupId] = target

    for (const nid of nodeIdsToMove) {
      const actor: Actor | undefined = worldState.actors[nid]
      if (actor) {
        worldState = {
          ...worldState,
          actors: {
            ...worldState.actors,
            [nid]: { ...actor, movementGroupId: intent.groupId },
          },
        }
      }
    }

    const overrides = { ...localState.nodeGroupOverrides }
    const nodePositions = { ...localState.nodePositions }
    for (const nid of nodeIdsToMove) overrides[nid] = intent.groupId
    for (const nid of nodeIdsToMove) delete nodePositions[nid]
    localState = { ...localState, nodeGroupOverrides: overrides, nodePositions, groupNodeOrders: nextOrders }
    recompute()
    return
  }

  if (intent.type === 'NEST_NODE_UNDER') {
    if (!worldState) {
      recompute()
      return
    }
    const parentActor = worldState.actors[intent.parentNodeId]
    const childActor = worldState.actors[intent.nodeId]
    if (!parentActor || !childActor) {
      recompute()
      return
    }
    if (parentActor.ownerActorId) {
      recompute()
      return
    }
    worldState = {
      ...worldState,
      actors: {
        ...worldState.actors,
        [intent.nodeId]: {
          ...childActor,
          ownerActorId: intent.parentNodeId,
          movementGroupId: parentActor.movementGroupId,
        },
      },
    }
    const scene = buildSceneVM(worldState, localState)
    const baseOrders: Record<string, readonly string[]> = {}
    for (const [gid, g] of Object.entries(scene.groups ?? {})) {
      baseOrders[gid] = [...g.nodeIds]
    }
    const nextOrders: Record<string, readonly string[]> = { ...baseOrders }
    for (const [gid, order] of Object.entries(nextOrders)) {
      nextOrders[gid] = order.filter((id) => id !== intent.nodeId)
    }
    const targetGroupId = parentActor.movementGroupId
    const target = [...(nextOrders[targetGroupId] ?? [])]
    const parentIndex = target.indexOf(intent.parentNodeId)
    const insertIndex = parentIndex >= 0 ? parentIndex + 1 : target.length
    target.splice(insertIndex, 0, intent.nodeId)
    nextOrders[targetGroupId] = target
    localState = {
      ...localState,
      nodeGroupOverrides: { ...localState.nodeGroupOverrides, [intent.nodeId]: parentActor.movementGroupId },
      groupNodeOrders: nextOrders,
      nodePositions: Object.fromEntries(Object.entries(localState.nodePositions).filter(([id]) => id !== intent.nodeId)),
    }
    recompute()
    return
  }

  if (intent.type === 'MOVE_NODE_TO_ROOT') {
    if (!worldState) {
      recompute()
      return
    }
    const actor = worldState.actors[intent.nodeId]
    if (!actor) {
      recompute()
      return
    }
    worldState = {
      ...worldState,
      actors: {
        ...worldState.actors,
        [intent.nodeId]: { ...actor, ownerActorId: undefined },
      },
    }
    localState = {
      ...localState,
      nodeGroupOverrides: { ...localState.nodeGroupOverrides, [intent.nodeId]: null },
      nodePositions: { ...localState.nodePositions, [intent.nodeId]: { x: intent.x, y: intent.y } },
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
              zone: target.carryGroupId ? 'dropped' : 'stowed',
              state: target.carryGroupId
                ? { ...(entry.state ?? {}), dropped: true }
                : (() => {
                    const next = { ...(entry.state ?? {}) }
                    delete next.dropped
                    return Object.keys(next).length > 0 ? next : undefined
                  })(),
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
      const freeSegmentPositions = { ...localState.freeSegmentPositions }
      for (const segmentId of segmentIds) delete freeSegmentPositions[segmentId]
      localState = { ...localState, freeSegmentPositions }
    } else if (localState.dropIntent && worldState && intent.x != null && intent.y != null) {
      const { segmentIds, sourceNodeIds } = localState.dropIntent
      const firstSourceNodeId = segmentIds[0] ? sourceNodeIds[segmentIds[0]] : null
      const source = firstSourceNodeId ? parseNodeId(firstSourceNodeId) : null
      if (source) {
        const droppedGroupId = droppedGroupIdForActor(source.actorId)
        if (!worldState.carryGroups[droppedGroupId]) {
          worldState = {
            ...worldState,
            carryGroups: {
              ...worldState.carryGroups,
              [droppedGroupId]: {
                id: droppedGroupId,
                ownerActorId: source.actorId,
                name: 'Ground',
                dropped: true,
              },
            },
          }
        }

        for (const segmentId of segmentIds) {
          const sourceNodeId = sourceNodeIds[segmentId]
          if (!sourceNodeId) continue
          const parsedSource = parseNodeId(sourceNodeId)
          const entryId = segmentIdToEntryId(segmentId)
          const entry: InventoryEntry | undefined = worldState.inventoryEntries[entryId]
          if (!entry) continue
          const movedEntry: InventoryEntry = {
            ...entry,
            actorId: parsedSource.actorId,
            carryGroupId: droppedGroupId,
            zone: 'dropped',
            state: { ...(entry.state ?? {}), dropped: true },
          }
          worldState = {
            ...worldState,
            inventoryEntries: {
              ...worldState.inventoryEntries,
              [entryId]: movedEntry,
            },
          }
          const actor: Actor | undefined = worldState.actors[parsedSource.actorId]
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

        const freeSegmentPositions = { ...localState.freeSegmentPositions }
        let yOffset = 0
        for (const segmentId of segmentIds) {
          freeSegmentPositions[segmentId] = { x: intent.x, y: intent.y + yOffset }
          yOffset += 14
        }
        localState = {
          ...localState,
          freeSegmentPositions,
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
        const movedEntry: InventoryEntry = {
          ...entry,
          actorId: target.actorId,
          carryGroupId: target.carryGroupId,
          zone: target.carryGroupId ? 'dropped' : 'stowed',
          state: target.carryGroupId
            ? { ...(entry.state ?? {}), dropped: true }
            : (() => {
                const next = { ...(entry.state ?? {}) }
                delete next.dropped
                return Object.keys(next).length > 0 ? next : undefined
              })(),
        }
        worldState = {
          ...worldState,
          inventoryEntries: {
            ...worldState!.inventoryEntries,
            [entryId]: movedEntry,
          },
        }
        const actor = worldState!.actors[source.actorId]
        if (actor && (actor.leftWieldingEntryId === entryId || actor.rightWieldingEntryId === entryId)) {
          const nextActor: Actor = {
            ...actor,
            leftWieldingEntryId: actor.leftWieldingEntryId === entryId ? undefined : actor.leftWieldingEntryId,
            rightWieldingEntryId: actor.rightWieldingEntryId === entryId ? undefined : actor.rightWieldingEntryId,
          }
          worldState = {
            ...worldState,
            actors: { ...worldState!.actors, [actor.id]: nextActor },
          }
        }
      }
    }
    localState = {
      ...localState,
      freeSegmentPositions: Object.fromEntries(
        Object.entries(localState.freeSegmentPositions).filter(([id]) => segmentIdToEntryId(id) !== segmentIdToEntryId(segmentId)),
      ),
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

  if (intent.type === 'ADD_LABEL') {
    const text = intent.text.trim()
    if (text.length === 0) {
      recompute()
      return
    }
    const labelId = `label:${Date.now().toString(36)}:${Math.random().toString(36).slice(2, 7)}`
    localState = {
      ...localState,
      labels: {
        ...localState.labels,
        [labelId]: { text, x: intent.x, y: intent.y },
      },
      selectedLabelId: labelId,
    }
    recompute()
    return
  }

  if (intent.type === 'UPDATE_LABEL_TEXT') {
    const existing = localState.labels[intent.labelId]
    if (!existing) {
      recompute()
      return
    }
    localState = {
      ...localState,
      labels: {
        ...localState.labels,
        [intent.labelId]: {
          ...existing,
          text: intent.text.trim().length > 0 ? intent.text.trim() : existing.text,
        },
      },
    }
    recompute()
    return
  }

  if (intent.type === 'MOVE_LABEL') {
    const existing = localState.labels[intent.labelId]
    if (!existing) return
    localState = {
      ...localState,
      labels: {
        ...localState.labels,
        [intent.labelId]: { ...existing, x: intent.x, y: intent.y },
      },
    }
    recompute()
    return
  }

  if (intent.type === 'DELETE_LABEL') {
    if (!localState.labels[intent.labelId]) {
      recompute()
      return
    }
    const labels = { ...localState.labels }
    delete labels[intent.labelId]
    localState = {
      ...localState,
      labels,
      selectedLabelId: localState.selectedLabelId === intent.labelId ? null : localState.selectedLabelId,
    }
    recompute()
    return
  }

  if (intent.type === 'SELECT_LABEL') {
    localState = { ...localState, selectedLabelId: intent.labelId }
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

