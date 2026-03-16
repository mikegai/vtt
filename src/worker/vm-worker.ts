/// <reference lib="webworker" />

import type { Actor, CanonicalState, InventoryEntry, ItemDefinition, ItemKind } from '../domain/types'
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

const collectActorSubtreeIds = (state: CanonicalState, rootActorId: string): string[] => {
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

const collectSceneSubtreeNodeIds = (scene: SceneVM, rootNodeId: string): string[] => {
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

const droppedGroupIdForActor = (actorId: string): string => `${actorId}:ground`

const ensureDroppedGroup = (state: CanonicalState, actorId: string): CanonicalState => {
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

const createInventoryEntryId = (state: CanonicalState, itemDefId: string): string => {
  const base = `spawn:${itemDefId}`
  let attempt = 0
  while (attempt < 1000) {
    const suffix =
      attempt === 0
        ? `${Date.now().toString(36)}:${Math.random().toString(36).slice(2, 7)}`
        : `${Date.now().toString(36)}:${Math.random().toString(36).slice(2, 7)}:${attempt}`
    const nextId = `${base}:${suffix}`
    if (!state.inventoryEntries[nextId]) return nextId
    attempt += 1
  }
  return `${base}:${Date.now().toString(36)}:${Math.random().toString(36).slice(2, 7)}:fallback`
}

const STONE_W = 36
const STONE_H = 54
const STONE_GAP = 3
const STONE_ROW_GAP = 3
const SLOT_START_X = 10
const TOP_BAND_H = 34

const stoneToX = (stoneIndex: number, stonesPerRow: number): number =>
  (stoneIndex % stonesPerRow) * (STONE_W + STONE_GAP)
const stoneToY = (stoneIndex: number, stonesPerRow: number): number =>
  Math.floor(stoneIndex / stonesPerRow) * (STONE_H + STONE_ROW_GAP)
const segmentStoneSpan = (startSixth: number, sizeSixths: number): { startStone: number; endStone: number } => {
  const startStone = Math.floor(startSixth / 6)
  const endStone = Math.max(startStone + 1, Math.ceil((startSixth + sizeSixths) / 6))
  return { startStone, endStone }
}
const isMultiStone = (sizeSixths: number): boolean => sizeSixths >= 6 && sizeSixths % 6 === 0

const groupSixthsByStone = (
  startSixth: number,
  sizeSixths: number,
): { stone: number; startRow: number; count: number }[] => {
  const groups: { stone: number; startRow: number; count: number }[] = []
  for (let i = 0; i < sizeSixths; i += 1) {
    const sixth = startSixth + i
    const stone = Math.floor(sixth / 6)
    const row = sixth % 6
    const last = groups[groups.length - 1]
    if (last && last.stone === stone) {
      last.count += 1
    } else {
      groups.push({ stone, startRow: row, count: 1 })
    }
  }
  return groups
}

const splitStonesAtWrap = (
  startStone: number,
  endStone: number,
  stonesPerRow: number,
): { start: number; end: number }[] => {
  const chunks: { start: number; end: number }[] = []
  let s = startStone
  while (s < endStone) {
    const rowStart = Math.floor(s / stonesPerRow) * stonesPerRow
    const rowEnd = rowStart + stonesPerRow
    const chunkEnd = Math.min(endStone, rowEnd)
    chunks.push({ start: s, end: chunkEnd })
    s = chunkEnd
  }
  return chunks
}

const segmentBoundsInNodeLocal = (
  segment: { startSixth: number; sizeSixths: number },
  stonesPerRow: number,
): { x: number; y: number; w: number; h: number } => {
  const { startStone, endStone } = segmentStoneSpan(segment.startSixth, segment.sizeSixths)
  if (isMultiStone(segment.sizeSixths)) {
    const chunks = splitStonesAtWrap(startStone, endStone, stonesPerRow)
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
    chunks.forEach((chunk) => {
      const cx = SLOT_START_X + stoneToX(chunk.start, stonesPerRow)
      const cy = TOP_BAND_H + stoneToY(chunk.start, stonesPerRow)
      const cw = (chunk.end - chunk.start) * (STONE_W + STONE_GAP) - STONE_GAP
      minX = Math.min(minX, cx)
      minY = Math.min(minY, cy)
      maxX = Math.max(maxX, cx + cw)
      maxY = Math.max(maxY, cy + STONE_H)
    })
    return { x: minX, y: minY, w: maxX - minX, h: maxY - minY }
  }
  const CELL_H = STONE_H / 6
  const groups = groupSixthsByStone(segment.startSixth, segment.sizeSixths)
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  groups.forEach((g) => {
    const x = stoneToX(g.stone, stonesPerRow)
    const y = stoneToY(g.stone, stonesPerRow) + g.startRow * CELL_H
    minX = Math.min(minX, x)
    minY = Math.min(minY, y)
    maxX = Math.max(maxX, x + STONE_W)
    maxY = Math.max(maxY, y + g.count * CELL_H)
  })
  return {
    x: SLOT_START_X + minX,
    y: TOP_BAND_H + minY,
    w: maxX - minX,
    h: maxY - minY,
  }
}

type DragSourceRect = {
  readonly id: string
  readonly x: number
  readonly y: number
  readonly w: number
  readonly h: number
}

const computeDroppedFreeSegmentPositions = (
  scene: SceneVM,
  segmentIds: readonly string[],
  anchorX: number,
  anchorY: number,
  stonesPerRow: number,
): Record<string, { x: number; y: number }> => {
  const rects: DragSourceRect[] = []
  for (const segmentId of segmentIds) {
    let found = false
    for (const node of Object.values(scene.nodes)) {
      const seg = node.segments.find((s) => s.id === segmentId)
      if (!seg) continue
      const b = segmentBoundsInNodeLocal(seg, stonesPerRow)
      rects.push({ id: segmentId, x: node.x + b.x, y: node.y + b.y, w: Math.max(8, b.w), h: Math.max(8, b.h) })
      found = true
      break
    }
    if (found) continue
    const free = scene.freeSegments[segmentId]
    if (!free) continue
    const b = segmentBoundsInNodeLocal(free.segment, stonesPerRow)
    rects.push({
      id: segmentId,
      x: free.x + b.x - SLOT_START_X,
      y: free.y + b.y - TOP_BAND_H,
      w: Math.max(8, b.w),
      h: Math.max(8, b.h),
    })
  }
  if (rects.length === 0) return {}

  rects.sort((a, b) => (a.y === b.y ? a.x - b.x : a.y - b.y))
  const totalArea = rects.reduce((sum, r) => sum + r.w * r.h, 0)
  const targetRowW = Math.max(220, Math.round(Math.sqrt(totalArea) * 1.8))
  const GAP = 6
  const packedById: Record<string, { x: number; y: number }> = {}
  let xCursor = 0
  let yCursor = 0
  let rowH = 0
  for (const r of rects) {
    if (xCursor > 0 && xCursor + r.w > targetRowW) {
      xCursor = 0
      yCursor += rowH + GAP
      rowH = 0
    }
    packedById[r.id] = { x: xCursor, y: yCursor }
    xCursor += r.w + GAP
    rowH = Math.max(rowH, r.h)
  }
  const anchorPacked = packedById[segmentIds[0] ?? ''] ?? { x: 0, y: 0 }
  const out: Record<string, { x: number; y: number }> = {}
  for (const segmentId of segmentIds) {
    const packed = packedById[segmentId]
    if (!packed) continue
    out[segmentId] = {
      x: anchorX + (packed.x - anchorPacked.x),
      y: anchorY + (packed.y - anchorPacked.y),
    }
  }
  return out
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

    for (const nid of nodeIdsToMove) {
      const actor: Actor | undefined = worldState.actors[nid]
      if (actor) {
        worldState = {
          ...worldState,
          actors: {
            ...worldState.actors,
            [nid]: {
              ...actor,
              movementGroupId: intent.groupId,
              // Moving a child as the primary dragged node detaches it from its previous parent.
              ownerActorId: nid === intent.nodeId ? undefined : actor.ownerActorId,
            },
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
    const subtreeActorIds = collectActorSubtreeIds(worldState, intent.nodeId)
    const nextActors = { ...worldState.actors }
    subtreeActorIds.forEach((actorId) => {
      const actor = nextActors[actorId]
      if (!actor) return
      nextActors[actorId] = {
        ...actor,
        ownerActorId: actorId === intent.nodeId ? intent.parentNodeId : actor.ownerActorId,
        movementGroupId: parentActor.movementGroupId,
      }
    })
    worldState = { ...worldState, actors: nextActors }
    const scene = buildSceneVM(worldState, localState)
    const subtreeNodeIds = collectSceneSubtreeNodeIds(scene, intent.nodeId)
    const baseOrders: Record<string, readonly string[]> = {}
    for (const [gid, g] of Object.entries(scene.groups ?? {})) {
      baseOrders[gid] = [...g.nodeIds]
    }
    const nextOrders: Record<string, readonly string[]> = { ...baseOrders }
    for (const [gid, order] of Object.entries(nextOrders)) {
      nextOrders[gid] = order.filter((id) => !subtreeNodeIds.includes(id))
    }
    const targetGroupId = parentActor.movementGroupId
    const target = [...(nextOrders[targetGroupId] ?? [])]
    const parentIndex = target.indexOf(intent.parentNodeId)
    const insertIndex = parentIndex >= 0 ? parentIndex + 1 : target.length
    target.splice(insertIndex, 0, ...subtreeNodeIds)
    nextOrders[targetGroupId] = target
    const nextOverrides = { ...localState.nodeGroupOverrides }
    const nextNodePositions = { ...localState.nodePositions }
    subtreeNodeIds.forEach((nodeId) => {
      nextOverrides[nodeId] = parentActor.movementGroupId
      delete nextNodePositions[nodeId]
    })
    localState = {
      ...localState,
      nodeGroupOverrides: nextOverrides,
      groupNodeOrders: nextOrders,
      nodePositions: nextNodePositions,
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
    const subtreeNodeIds = collectActorSubtreeIds(worldState, intent.nodeId)
    worldState = {
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
    localState = {
      ...localState,
      nodeGroupOverrides: nextNodeGroupOverrides,
      nodePositions: nextNodePositions,
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
    localState = {
      ...localState,
      dropIntent: {
        ...localState.dropIntent,
        targetNodeId: intent.targetNodeId,
      },
    }
    recompute()
    return
  }

  if (intent.type === 'DRAG_SEGMENT_END') {
    const hoverTargetNodeId = localState.dropIntent
      ? (intent.targetNodeId ?? localState.dropIntent.targetNodeId)
      : null
    if (localState.dropIntent && hoverTargetNodeId) {
      const { segmentIds, sourceNodeIds } = localState.dropIntent
      const target = parseNodeId(hoverTargetNodeId)
      let movedAny = false
      if (worldState) {
        for (const segmentId of segmentIds) {
          const sourceNodeId = sourceNodeIds[segmentId]
          if (!sourceNodeId) continue
          const source = parseNodeId(sourceNodeId)
          if (source.actorId === target.actorId && source.carryGroupId === target.carryGroupId) continue
          const entryId = segmentIdToEntryId(segmentId)
          const entry: InventoryEntry | undefined = worldState.inventoryEntries[entryId]
          if (entry) {
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
      if (movedAny) {
        const freeSegmentPositions = { ...localState.freeSegmentPositions }
        for (const segmentId of segmentIds) delete freeSegmentPositions[segmentId]
        localState = { ...localState, freeSegmentPositions }
      }
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

        const sceneAtDrop = buildSceneVM(worldState, localState)
        const droppedLayout =
          intent.freeSegmentPositions ??
          computeDroppedFreeSegmentPositions(
            sceneAtDrop,
            segmentIds,
            intent.x,
            intent.y,
            localState.stonesPerRow,
          )
        const freeSegmentPositions = { ...localState.freeSegmentPositions }
        for (const segmentId of segmentIds) {
          const nextPos = droppedLayout[segmentId] ?? { x: intent.x, y: intent.y }
          freeSegmentPositions[segmentId] = nextPos
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

  if (intent.type === 'SPAWN_ITEM_INSTANCE') {
    if (!worldState) return
    let itemDef: ItemDefinition | undefined = worldState.itemDefinitions[intent.itemDefId]
    if (!itemDef && intent.itemName) {
      itemDef = {
        id: intent.itemDefId,
        canonicalName: intent.itemName,
        kind: (intent.itemKind as ItemKind) ?? 'standard',
        sixthsPerUnit: intent.sixthsPerUnit ?? 1,
      }
      worldState = {
        ...worldState,
        itemDefinitions: {
          ...worldState.itemDefinitions,
          [intent.itemDefId]: itemDef,
        },
      }
    }
    const quantity = Math.max(1, Math.floor(intent.quantity))
    if (!itemDef || !Number.isFinite(quantity)) {
      recompute()
      return
    }

    let targetActorId: string | null = null
    let targetCarryGroupId: string | undefined
    let shouldDropToGround = false

    if (intent.targetNodeId) {
      const parsedTarget = parseNodeId(intent.targetNodeId)
      if (parsedTarget.actorId && worldState.actors[parsedTarget.actorId]) {
        targetActorId = parsedTarget.actorId
        targetCarryGroupId = parsedTarget.carryGroupId
        shouldDropToGround = !!parsedTarget.carryGroupId
      }
    }

    if (!targetActorId && intent.x != null && intent.y != null) {
      const dropX = intent.x
      const dropY = intent.y
      const sceneAtDrop = buildSceneVM(worldState, localState)
      const nearestNode = Object.values(sceneAtDrop.nodes).reduce<SceneVM['nodes'][string] | null>((best, node) => {
        const centerX = node.x + node.width / 2
        const centerY = node.y + node.height / 2
        const distSq = (centerX - dropX) ** 2 + (centerY - dropY) ** 2
        if (!best) return node
        const bestCenterX = best.x + best.width / 2
        const bestCenterY = best.y + best.height / 2
        const bestDistSq = (bestCenterX - dropX) ** 2 + (bestCenterY - dropY) ** 2
        return distSq < bestDistSq ? node : best
      }, null)
      if (nearestNode && worldState.actors[nearestNode.actorId]) {
        targetActorId = nearestNode.actorId
        shouldDropToGround = true
      }
    }

    if (!targetActorId) {
      recompute()
      return
    }

    if (shouldDropToGround && !targetCarryGroupId) {
      worldState = ensureDroppedGroup(worldState, targetActorId)
      targetCarryGroupId = droppedGroupIdForActor(targetActorId)
    } else if (targetCarryGroupId && !worldState.carryGroups[targetCarryGroupId]) {
      worldState = ensureDroppedGroup(worldState, targetActorId)
      targetCarryGroupId = droppedGroupIdForActor(targetActorId)
      shouldDropToGround = true
    }

    const entryId = createInventoryEntryId(worldState, intent.itemDefId)
    const nextEntry: InventoryEntry = {
      id: entryId,
      actorId: targetActorId,
      itemDefId: intent.itemDefId,
      quantity,
      zone: shouldDropToGround ? 'dropped' : 'stowed',
      carryGroupId: targetCarryGroupId,
      state: shouldDropToGround ? { dropped: true } : undefined,
    }

    worldState = {
      ...worldState,
      inventoryEntries: {
        ...worldState.inventoryEntries,
        [entryId]: nextEntry,
      },
    }

    if (shouldDropToGround && intent.x != null && intent.y != null) {
      const sceneAtDrop = buildSceneVM(worldState, localState)
      const createdSegId = Object.values(sceneAtDrop.freeSegments).find((free) => segmentIdToEntryId(free.id) === entryId)?.id
      if (createdSegId) {
        localState = {
          ...localState,
          freeSegmentPositions: {
            ...localState.freeSegmentPositions,
            [createdSegId]: { x: intent.x, y: intent.y },
          },
        }
      }
    }

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

