import { expandSegmentIdsForCoinageMerge } from '../domain/coinage'
import type { Actor, CanonicalState, InventoryEntry } from '../domain/types'
import { parseNodeId, segmentIdToEntryId } from './drop-intent'
import type { WorkerLocalState } from '../worker/scene-vm'

export const expandDragSegmentToEntryIds = (
  worldState: CanonicalState,
  segmentId: string,
  sourceNodeId: string,
): string[] => {
  const source = parseNodeId(sourceNodeId)
  return expandSegmentIdsForCoinageMerge(
    worldState,
    [segmentId],
    source.actorId,
    source.carryGroupId,
    source.carryGroupId != null,
  )
}

export const removeSegmentsFromGroupPositions = (
  groupFreeSegmentPositions: WorkerLocalState['groupFreeSegmentPositions'],
  segmentIds: readonly string[],
): WorkerLocalState['groupFreeSegmentPositions'] => {
  if (segmentIds.length === 0) return groupFreeSegmentPositions
  const removeEntryIds = new Set(segmentIds.map((id) => segmentIdToEntryId(id)))
  const next: WorkerLocalState['groupFreeSegmentPositions'] = {}
  for (const [groupId, positions] of Object.entries(groupFreeSegmentPositions)) {
    const kept = Object.fromEntries(
      Object.entries(positions).filter(([segmentId]) => !removeEntryIds.has(segmentIdToEntryId(segmentId))),
    )
    if (Object.keys(kept).length > 0) next[groupId] = kept
  }
  return next
}

/** Worker-equivalent: drop dragged segments onto a target node (inventory row). */
export const commitDragSegmentOntoNode = (
  worldState: CanonicalState,
  localState: WorkerLocalState,
  segmentIds: readonly string[],
  sourceNodeIds: Readonly<Record<string, string>>,
  targetNodeId: string,
): { worldState: CanonicalState; localState: WorkerLocalState } => {
  const target = parseNodeId(targetNodeId)
  let ws = worldState
  let movedAny = false
  for (const segmentId of segmentIds) {
    const sourceNodeId = sourceNodeIds[segmentId]
    if (!sourceNodeId) continue
    const source = parseNodeId(sourceNodeId)
    if (source.actorId === target.actorId && source.carryGroupId === target.carryGroupId) continue
    const entryIds = expandDragSegmentToEntryIds(ws, segmentId, sourceNodeId)
    for (const entryId of entryIds) {
      const entry: InventoryEntry | undefined = ws.inventoryEntries[entryId]
      if (!entry) continue
      movedAny = true
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
      ws = {
        ...ws,
        inventoryEntries: {
          ...ws.inventoryEntries,
          [entryId]: movedEntry,
        },
      }
      const actor: Actor | undefined = ws.actors[source.actorId]
      if (actor && (actor.leftWieldingEntryId === entryId || actor.rightWieldingEntryId === entryId)) {
        const nextActor: Actor = {
          ...actor,
          leftWieldingEntryId: actor.leftWieldingEntryId === entryId ? undefined : actor.leftWieldingEntryId,
          rightWieldingEntryId: actor.rightWieldingEntryId === entryId ? undefined : actor.rightWieldingEntryId,
        }
        ws = {
          ...ws,
          actors: { ...ws.actors, [actor.id]: nextActor },
        }
      }
    }
  }

  let ls = localState
  if (movedAny) {
    const freeSegmentPositions = { ...ls.freeSegmentPositions }
    for (const segmentId of segmentIds) delete freeSegmentPositions[segmentId]
    ls = {
      ...ls,
      freeSegmentPositions,
      groupFreeSegmentPositions: removeSegmentsFromGroupPositions(ls.groupFreeSegmentPositions, segmentIds),
    }
  }
  return { worldState: ws, localState: ls }
}
