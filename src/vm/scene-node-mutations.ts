import type { Actor, CanonicalState } from '../domain/types'
import { buildSceneVM, type WorkerLocalState } from '../worker/scene-vm'
import type { SceneVM } from '../worker/protocol'

export const collectActorSubtreeIds = (state: CanonicalState, rootActorId: string): string[] => {
  const byOwner = new Map<string, string[]>()
  Object.values(state.actors).forEach((actor) => {
    if (!actor.ownerActorId) return
    const owned = byOwner.get(actor.ownerActorId) ?? []
    owned.push(actor.id)
    byOwner.set(actor.ownerActorId, owned)
  })
  const out: string[] = []
  const stack: string[] = [rootActorId]
  while (stack.length > 0) {
    const actorId = stack.pop()
    if (!actorId || out.includes(actorId)) continue
    out.push(actorId)
    const children = byOwner.get(actorId) ?? []
    for (let i = children.length - 1; i >= 0; i -= 1) stack.push(children[i])
  }
  return out
}

export const collectSceneSubtreeNodeIds = (scene: SceneVM, rootNodeId: string): string[] => {
  const byParent = new Map<string, string[]>()
  Object.values(scene.nodes).forEach((node) => {
    if (!node.parentNodeId) return
    const children = byParent.get(node.parentNodeId) ?? []
    children.push(node.id)
    byParent.set(node.parentNodeId, children)
  })
  const out: string[] = []
  const stack: string[] = [rootNodeId]
  while (stack.length > 0) {
    const nodeId = stack.pop()
    if (!nodeId || out.includes(nodeId)) continue
    out.push(nodeId)
    const children = byParent.get(nodeId) ?? []
    for (let i = children.length - 1; i >= 0; i -= 1) stack.push(children[i])
  }
  return out
}

export const applyMoveNodeToGroupIndex = (
  worldState: CanonicalState,
  localState: WorkerLocalState,
  intent: { nodeId: string; groupId: string; index: number },
): { worldState: CanonicalState; localState: WorkerLocalState } => {
  const scene = buildSceneVM(worldState, localState)
  const nodeIdsToMove = collectSceneSubtreeNodeIds(scene, intent.nodeId)
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

  let nextWorld = worldState
  for (const nid of nodeIdsToMove) {
    const actor: Actor | undefined = nextWorld.actors[nid]
    if (actor) {
      nextWorld = {
        ...nextWorld,
        actors: {
          ...nextWorld.actors,
          [nid]: {
            ...actor,
            movementGroupId: intent.groupId,
            ownerActorId: nid === intent.nodeId ? undefined : actor.ownerActorId,
          },
        },
      }
    }
  }

  const overrides = { ...localState.nodeGroupOverrides }
  const nodePositions = { ...localState.nodePositions }
  const groupNodePositions = { ...localState.groupNodePositions }
  const targetGroupPositionMap = { ...(groupNodePositions[intent.groupId] ?? {}) }
  const targetGroup = scene.groups[intent.groupId]
  const targetGroupWorld = targetGroup
    ? { x: targetGroup.x, y: targetGroup.y }
    : (localState.groupPositions[intent.groupId] ?? { x: 0, y: 0 })
  for (const nid of nodeIdsToMove) overrides[nid] = intent.groupId
  for (const nid of nodeIdsToMove) {
    if (targetGroupPositionMap[nid]) continue
    const sceneNode = scene.nodes[nid]
    const worldPos = sceneNode ? { x: sceneNode.x, y: sceneNode.y } : nodePositions[nid]
    if (!worldPos) continue
    targetGroupPositionMap[nid] = {
      x: worldPos.x - targetGroupWorld.x,
      y: worldPos.y - targetGroupWorld.y,
    }
  }
  for (const nid of nodeIdsToMove) delete nodePositions[nid]
  groupNodePositions[intent.groupId] = targetGroupPositionMap

  return {
    worldState: nextWorld,
    localState: {
      ...localState,
      nodeGroupOverrides: overrides,
      nodePositions,
      groupNodeOrders: nextOrders,
      groupNodePositions,
    },
  }
}

export const applyMoveNodeToRoot = (
  worldState: CanonicalState,
  localState: WorkerLocalState,
  intent: { nodeId: string; x: number; y: number },
): { worldState: CanonicalState; localState: WorkerLocalState } => {
  const actor = worldState.actors[intent.nodeId]
  if (!actor) {
    return { worldState, localState }
  }
  const subtreeNodeIds = collectActorSubtreeIds(worldState, intent.nodeId)
  const nextWorld: CanonicalState = {
    ...worldState,
    actors: {
      ...worldState.actors,
      [intent.nodeId]: { ...actor, ownerActorId: undefined },
    },
  }
  const nextNodeGroupOverrides = { ...localState.nodeGroupOverrides }
  const nextNodePositions = { ...localState.nodePositions }
  subtreeNodeIds.forEach((nodeId) => {
    nextNodeGroupOverrides[nodeId] = null
    delete nextNodePositions[nodeId]
  })
  nextNodePositions[intent.nodeId] = { x: intent.x, y: intent.y }
  return {
    worldState: nextWorld,
    localState: {
      ...localState,
      nodeGroupOverrides: nextNodeGroupOverrides,
      nodePositions: nextNodePositions,
      nodeContainment: Object.fromEntries(
        Object.entries(localState.nodeContainment).filter(([id]) => !subtreeNodeIds.includes(id)),
      ),
    },
  }
}

/** `MOVE_NODE_IN_GROUP`: primary ends at world `(intent.x, intent.y)`; subtree follows the same delta. */
export const applyMoveNodeInGroup = (
  worldState: CanonicalState,
  localState: WorkerLocalState,
  intent: { nodeId: string; groupId: string; x: number; y: number },
): { worldState: CanonicalState; localState: WorkerLocalState } => {
  const scene = buildSceneVM(worldState, localState)
  const targetGroup = scene.groups[intent.groupId]
  const primaryNode = scene.nodes[intent.nodeId]
  if (!targetGroup || !primaryNode) {
    return { worldState, localState }
  }

  const nodeIdsToMove = collectSceneSubtreeNodeIds(scene, intent.nodeId)

  const baseOrders: Record<string, readonly string[]> = {}
  for (const [gid, g] of Object.entries(scene.groups ?? {})) {
    baseOrders[gid] = [...g.nodeIds]
  }
  const nextOrders: Record<string, readonly string[]> = { ...baseOrders }
  for (const [gid, order] of Object.entries(nextOrders)) {
    nextOrders[gid] = order.filter((id) => !nodeIdsToMove.includes(id))
  }
  const targetOrder = [...(nextOrders[intent.groupId] ?? [])]
  nodeIdsToMove.forEach((id) => {
    if (!targetOrder.includes(id)) targetOrder.push(id)
  })
  nextOrders[intent.groupId] = targetOrder

  let nextWorld = worldState
  for (const nid of nodeIdsToMove) {
    const actor: Actor | undefined = nextWorld.actors[nid]
    if (!actor) continue
    nextWorld = {
      ...nextWorld,
      actors: {
        ...nextWorld.actors,
        [nid]: {
          ...actor,
          movementGroupId: intent.groupId,
          ownerActorId: nid === intent.nodeId ? undefined : actor.ownerActorId,
        },
      },
    }
  }

  const overrides = { ...localState.nodeGroupOverrides }
  const nodePositions = { ...localState.nodePositions }
  const groupNodePositions = { ...localState.groupNodePositions }
  const targetGroupPositions = { ...(groupNodePositions[intent.groupId] ?? {}) }
  const primaryOffsetX = intent.x - primaryNode.x
  const primaryOffsetY = intent.y - primaryNode.y
  for (const nid of nodeIdsToMove) {
    overrides[nid] = intent.groupId
    delete nodePositions[nid]
    const sceneNode = scene.nodes[nid]
    if (!sceneNode) continue
    const worldX = sceneNode.x + primaryOffsetX
    const worldY = sceneNode.y + primaryOffsetY
    targetGroupPositions[nid] = {
      x: worldX - targetGroup.x,
      y: worldY - targetGroup.y,
    }
  }
  groupNodePositions[intent.groupId] = targetGroupPositions

  return {
    worldState: nextWorld,
    localState: {
      ...localState,
      nodeGroupOverrides: overrides,
      nodePositions,
      groupNodePositions,
      groupNodeOrders: nextOrders,
    },
  }
}
