/// <reference lib="webworker" />

import type { Actor, CanonicalState } from '../domain/types'
import { getWieldOptions, isTwoHandedOnly } from '../domain/weapon-metadata'
import { parseNodeId, segmentIdToEntryId } from '../vm/drop-intent'
import { diffSceneVM } from './scene-diff'
import { buildSceneVM, type WorkerLocalState } from './scene-vm'
import type { MainToWorkerMessage, SceneVM, WorkerIntent, WorkerToMainMessage } from './protocol'

let worldState: CanonicalState | null = null
let localState: WorkerLocalState = {
  hoveredSegmentId: null,
  nodePositions: {},
  dropIntent: null,
  stonesPerRow: 25,
}
let previousScene: SceneVM | null = null

const post = (message: WorkerToMainMessage): void => {
  self.postMessage(message)
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

  if (intent.type === 'MOVE_NODE') {
    localState = {
      ...localState,
      nodePositions: {
        ...localState.nodePositions,
        [intent.nodeId]: { x: intent.x, y: intent.y },
      },
    }
    recompute()
    return
  }

  if (intent.type === 'DRAG_SEGMENT_START') {
    localState = {
      ...localState,
      dropIntent: {
        segmentId: intent.segmentId,
        sourceNodeId: intent.sourceNodeId,
        targetNodeId: intent.sourceNodeId,
      },
    }
    recompute()
    return
  }

  if (intent.type === 'DRAG_SEGMENT_UPDATE') {
    if (!localState.dropIntent) return
    localState = {
      ...localState,
      dropIntent: {
        ...localState.dropIntent,
        targetNodeId: intent.targetNodeId ?? localState.dropIntent.sourceNodeId,
      },
    }
    recompute()
    return
  }

  if (intent.type === 'DRAG_SEGMENT_END') {
    if (localState.dropIntent && intent.targetNodeId) {
      const { segmentId, sourceNodeId, targetNodeId } = localState.dropIntent
      const source = parseNodeId(sourceNodeId)
      const target = parseNodeId(targetNodeId)
      if (worldState && (source.actorId !== target.actorId || source.carryGroupId !== target.carryGroupId)) {
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

