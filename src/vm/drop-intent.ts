import type { CanonicalState, InventoryEntry } from '../domain/types'
import type { DropIntent } from '../worker/protocol'

/** Extract base inventory entry id from segment id (handles "entryId:0", "entryId:overflow"). */
export const segmentIdToEntryId = (segmentId: string): string => {
  const colon = segmentId.indexOf(':')
  return colon >= 0 ? segmentId.slice(0, colon) : segmentId
}

/** Parse nodeId to (actorId, carryGroupId). Main row: actorId. Dropped: "actorId:dropped:groupId". */
export const parseNodeId = (nodeId: string): { actorId: string; carryGroupId?: string } => {
  const parts = nodeId.split(':')
  if (parts[0] === 'dropped' || parts.length === 1) {
    return { actorId: parts[0] ?? nodeId }
  }
  if (parts[1] === 'dropped' && parts[2]) {
    return { actorId: parts[0] ?? '', carryGroupId: parts.slice(2).join(':') }
  }
  return { actorId: parts[0] ?? nodeId }
}

/** Create a pseudo CanonicalState with the dragged entry moved to the target. */
export const applyDropIntentToState = (
  state: CanonicalState,
  dropIntent: DropIntent,
): CanonicalState => {
  const entryId = segmentIdToEntryId(dropIntent.segmentId)
  const entry = state.inventoryEntries[entryId]
  if (!entry) return state

  const target = parseNodeId(dropIntent.targetNodeId)
  const source = parseNodeId(dropIntent.sourceNodeId)

  if (target.actorId === source.actorId && target.carryGroupId === source.carryGroupId) {
    return state
  }

  const movedEntry: InventoryEntry = {
    ...entry,
    actorId: target.actorId,
    carryGroupId: target.carryGroupId,
  }

  const inventoryEntries: Record<string, InventoryEntry> = { ...state.inventoryEntries }
  inventoryEntries[entryId] = movedEntry

  return {
    ...state,
    inventoryEntries,
  }
}
