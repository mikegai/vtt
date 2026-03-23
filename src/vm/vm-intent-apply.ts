import type { CanonicalState } from '../domain/types'
import type { WorkerIntent } from '../worker/protocol'
import { effectiveDropIntentForDragSegmentEnd } from '../worker/protocol'
import { addInventoryNodeToState } from '../worker/inventory-node'
import type { WorkerLocalState } from '../worker/scene-vm'
import { applyDuplicateEntryIntent, applyDuplicateNodeIntent } from './duplicate-intents'
import { commitDragSegmentOntoNode } from './drag-segment-commit'
import {
  applyMoveNodeInGroup,
  applyMoveNodeToGroupIndex,
  applyMoveNodeToRoot,
} from './scene-node-mutations'
import { buildSegmentIdToSourceNodeId } from './segment-source-map'
import { applyAddItemsOp, applySpawnItemInstance } from './spawn-item-instance'

const isSelfWeightTokenId = (segmentId: string): boolean => segmentId.startsWith('__self_weight__:')

/**
 * Applies one worker intent to world + local state (same primitives as `vm-worker` sync intents).
 * Use in integration tests so flows match the app without assuming shortcuts.
 */
export const applyVmIntent = (
  worldState: CanonicalState,
  localState: WorkerLocalState,
  intent: WorkerIntent,
): { worldState: CanonicalState; localState: WorkerLocalState } => {
  switch (intent.type) {
    case 'ADD_INVENTORY_NODE': {
      const result = addInventoryNodeToState({
        worldState,
        localState,
        x: intent.x,
        y: intent.y,
        groupId: intent.groupId,
        replayActorId: intent.replay?.actorId ?? intent.replayActorId,
        replayActorName: intent.replay?.actorName ?? intent.replayActorName,
      })
      return { worldState: result.worldState, localState: result.localState }
    }
    case 'MOVE_NODE_TO_GROUP_INDEX':
      return applyMoveNodeToGroupIndex(worldState, localState, intent)
    case 'MOVE_NODE_TO_ROOT':
      return applyMoveNodeToRoot(worldState, localState, intent)
    case 'MOVE_NODE_IN_GROUP':
      return applyMoveNodeInGroup(worldState, localState, intent)
    case 'SPAWN_ITEM_INSTANCE':
      return applySpawnItemInstance(worldState, localState, intent)
    case 'APPLY_ADD_ITEMS_OP':
      return applyAddItemsOp(worldState, localState, intent)
    case 'DRAG_SEGMENT_START': {
      const movableSegmentIds = intent.segmentIds.filter((id) => !isSelfWeightTokenId(id))
      if (movableSegmentIds.length === 0) return { worldState, localState }
      const segToNode = buildSegmentIdToSourceNodeId(worldState)
      const firstSource = segToNode[movableSegmentIds[0]!]
      const sourceNodeIds: Record<string, string> = {}
      for (const id of movableSegmentIds) {
        const nodeId = segToNode[id]
        if (nodeId) sourceNodeIds[id] = nodeId
      }
      return {
        worldState,
        localState: {
          ...localState,
          dropIntent: {
            segmentIds: movableSegmentIds,
            sourceNodeIds,
            targetNodeId: firstSource ?? null,
          },
        },
      }
    }
    case 'DRAG_SEGMENT_UPDATE':
      if (!localState.dropIntent) return { worldState, localState }
      return {
        worldState,
        localState: {
          ...localState,
          dropIntent: {
            ...localState.dropIntent,
            targetNodeId: intent.targetNodeId,
          },
        },
      }
    case 'DRAG_SEGMENT_END': {
      const effectiveDropIntent = effectiveDropIntentForDragSegmentEnd(localState.dropIntent, intent)
      const hoverTargetNodeId = intent.targetNodeId
      if (effectiveDropIntent && hoverTargetNodeId) {
        const { segmentIds, sourceNodeIds } = effectiveDropIntent
        const committed = commitDragSegmentOntoNode(
          worldState,
          localState,
          segmentIds,
          sourceNodeIds,
          hoverTargetNodeId,
        )
        return {
          worldState: committed.worldState,
          localState: { ...committed.localState, dropIntent: null },
        }
      }
      return { worldState, localState: { ...localState, dropIntent: null } }
    }
    case 'DUPLICATE_NODE':
      return applyDuplicateNodeIntent(worldState, localState, intent)
    case 'DUPLICATE_ENTRY':
      return applyDuplicateEntryIntent(worldState, localState, intent)
    default:
      return { worldState, localState }
  }
}
