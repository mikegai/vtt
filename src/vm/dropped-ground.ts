import type { CanonicalState } from '../domain/types'

export const droppedGroupIdForActor = (actorId: string): string => `${actorId}:ground`

export const ensureDroppedGroup = (state: CanonicalState, actorId: string): CanonicalState => {
  const droppedGroupId = droppedGroupIdForActor(actorId)
  if (state.carryGroups[droppedGroupId]) return state
  return {
    ...state,
    carryGroups: {
      ...state.carryGroups,
      [droppedGroupId]: {
        id: droppedGroupId,
        ownerActorId: actorId,
        name: 'Ground',
        dropped: true,
      },
    },
  }
}

/**
 * Outside-node drops should resolve to an actor context that is rendered with
 * dropped rows on the board. Owned actors can be closest to the pointer but
 * their dropped rows are not surfaced as canvas free-segments, so walk to the
 * top-level owner when possible.
 */
export const resolveRenderableDropActorId = (state: CanonicalState, actorId: string): string => {
  if (!state.actors[actorId]) return actorId
  let currentId = actorId
  const visited = new Set<string>()
  while (true) {
    if (visited.has(currentId)) return currentId
    visited.add(currentId)
    const current = state.actors[currentId]
    if (!current) return actorId
    const ownerId = current.ownerActorId
    if (!ownerId || !state.actors[ownerId]) return currentId
    currentId = ownerId
  }
}
