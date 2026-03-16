/// <reference lib="webworker" />

import type { CanonicalState } from '../domain/types'
import { parseNodeId, segmentIdToEntryId } from '../vm/drop-intent'
import { diffSceneVM } from './scene-diff'
import { buildSceneVM, type WorkerLocalState } from './scene-vm'
import type { MainToWorkerMessage, SceneVM, WorkerIntent, WorkerToMainMessage } from './protocol'

let worldState: CanonicalState | null = null
let localState: WorkerLocalState = {
  hoveredSegmentId: null,
  nodePositions: {},
  dropIntent: null,
}
let previousScene: SceneVM | null = null

const post = (message: WorkerToMainMessage): void => {
  self.postMessage(message)
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
        }
      }
    }
    localState = { ...localState, dropIntent: null }
    recompute()
    return
  }

  if (intent.type === 'SET_WORLD_STATE') {
    worldState = intent.worldState
    recompute()
  }
}

self.onmessage = (event: MessageEvent<MainToWorkerMessage>) => {
  const message = event.data
  if (message.type === 'INIT') {
    worldState = message.worldState
    recompute(true)
    return
  }
  if (message.type === 'INTENT') {
    applyIntent(message.intent)
  }
}

