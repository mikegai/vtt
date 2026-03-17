import type { Actor, CanonicalState } from '../domain/types'
import type { WorkerLocalState } from './scene-vm'

type AddInventoryNodeArgs = {
  readonly worldState: CanonicalState
  readonly localState: WorkerLocalState
  readonly x: number
  readonly y: number
  readonly groupId?: string | null
  readonly now?: () => number
  readonly random?: () => number
}

type AddInventoryNodeResult = {
  readonly worldState: CanonicalState
  readonly localState: WorkerLocalState
  readonly newActorId: string
}

const defaultMovementGroupId = (state: CanonicalState): string => {
  const firstMovementGroupId = Object.keys(state.movementGroups)[0]
  if (firstMovementGroupId) return firstMovementGroupId
  const firstActorGroupId = Object.values(state.actors)[0]?.movementGroupId
  if (firstActorGroupId) return firstActorGroupId
  return 'party'
}

export const createInventoryActorId = (state: CanonicalState, now: () => number, random: () => number): string => {
  let attempt = 0
  while (attempt < 1000) {
    const id = `inventory_${now().toString(36)}_${Math.floor(random() * 1_000_000).toString(36)}${attempt > 0 ? `_${attempt}` : ''}`
    if (!state.actors[id]) return id
    attempt += 1
  }
  return `inventory_${now().toString(36)}_${Math.floor(random() * 1_000_000).toString(36)}_fallback`
}

export const nextInventoryName = (state: CanonicalState): string => {
  let maxN = 0
  for (const actor of Object.values(state.actors)) {
    const m = actor.name.match(/^Inventory (\d+)$/)
    if (!m) continue
    const n = Number(m[1])
    if (Number.isFinite(n) && n > maxN) maxN = n
  }
  return `Inventory ${maxN + 1}`
}

export const addInventoryNodeToState = ({
  worldState,
  localState,
  x,
  y,
  groupId,
  now = Date.now,
  random = Math.random,
}: AddInventoryNodeArgs): AddInventoryNodeResult => {
  const actorId = createInventoryActorId(worldState, now, random)
  const resolvedGroupId = groupId ?? null
  const movementGroupId = resolvedGroupId ?? defaultMovementGroupId(worldState)
  const actor: Actor = {
    id: actorId,
    name: nextInventoryName(worldState),
    kind: 'pc',
    stats: { strengthMod: 0, hasLoadBearing: false },
    movementGroupId,
    active: true,
  }

  const nextWorldState: CanonicalState = {
    ...worldState,
    actors: {
      ...worldState.actors,
      [actorId]: actor,
    },
  }

  const nextNodeGroupOverrides = { ...localState.nodeGroupOverrides }
  const nextNodePositions = { ...localState.nodePositions }
  const nextGroupNodeOrders = { ...localState.groupNodeOrders }

  if (resolvedGroupId) {
    nextNodeGroupOverrides[actorId] = resolvedGroupId
    delete nextNodePositions[actorId]
    const currentOrder = nextGroupNodeOrders[resolvedGroupId] ?? []
    nextGroupNodeOrders[resolvedGroupId] = [...currentOrder, actorId]
  } else {
    nextNodeGroupOverrides[actorId] = null
    nextNodePositions[actorId] = { x, y }
  }

  const nextLocalState: WorkerLocalState = {
    ...localState,
    nodeGroupOverrides: nextNodeGroupOverrides,
    nodePositions: nextNodePositions,
    groupNodeOrders: nextGroupNodeOrders,
  }

  return {
    worldState: nextWorldState,
    localState: nextLocalState,
    newActorId: actorId,
  }
}
