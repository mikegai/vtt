import { expandSegmentIdsForCoinageMerge } from '../domain/coinage'
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

/** Create a pseudo CanonicalState with the dragged entries moved to the target. */
export const applyDropIntentToState = (
  state: CanonicalState,
  dropIntent: DropIntent,
): CanonicalState => {
  let result = state
  for (const segmentId of dropIntent.segmentIds) {
    const sourceNodeId = dropIntent.sourceNodeIds[segmentId]
    if (!sourceNodeId) continue

    const source = parseNodeId(sourceNodeId)
    const includeDropped = source.carryGroupId != null
    const entryIds = expandSegmentIdsForCoinageMerge(
      result,
      [segmentId],
      source.actorId,
      source.carryGroupId,
      includeDropped,
    )

    for (const entryId of entryIds) {
    const entry = result.inventoryEntries[entryId]
    if (!entry) continue
    if (!dropIntent.targetNodeId) {
      // While hovering outside any node, hide the source entries from normal rows.
      // We move them into a synthetic dropped group id that has no carry-group record.
      const movedEntry: InventoryEntry = {
        ...entry,
        actorId: source.actorId,
        carryGroupId: `__drag-preview__:${source.actorId}`,
        zone: 'dropped',
        state: { ...(entry.state ?? {}), dropped: true },
      }
      result = {
        ...result,
        inventoryEntries: {
          ...result.inventoryEntries,
          [entryId]: movedEntry,
        },
      }
      continue
    }

    const target = parseNodeId(dropIntent.targetNodeId)

    if (target.actorId === source.actorId && target.carryGroupId === source.carryGroupId) {
      continue
    }

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

    result = {
      ...result,
      inventoryEntries: {
        ...result.inventoryEntries,
        [entryId]: movedEntry,
      },
    }
    }
  }
  return result
}
