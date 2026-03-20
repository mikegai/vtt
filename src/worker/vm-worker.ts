/// <reference lib="webworker" />

self.addEventListener('unhandledrejection', (event: PromiseRejectionEvent) => {
  console.error('[worker] unhandled promise rejection:', event.reason)
})

import type { Actor, CanonicalState, InventoryEntry, ItemCatalogRow, ItemDefinition, ItemKind } from '../domain/types'
import { getWieldOptions, isTwoHandedOnly } from '../domain/weapon-metadata'
import { parseNodeId, segmentIdToEntryId } from '../vm/drop-intent'
import type { ActorRowVM } from '../vm/vm-types'
import { buildBoardVM } from '../vm/vm'
import { diffSceneVM } from './scene-diff'
import { addInventoryNodeToState, createInventoryActorId, nextInventoryName } from './inventory-node'
import { buildSceneVM, type WorkerLocalState } from './scene-vm'
import type { MainToWorkerMessage, SceneVM, WorkerIntent, WorkerToMainMessage } from './protocol'
import type { PersistenceBackend, PersistedLocalState } from '../persistence/backend'
import { IndexedDBBackend } from '../persistence/indexeddb-backend'
import {
  connect as stdbConnect,
  getConnection,
  isConnected,
  isReducerTransportReady,
  updateMyCursor,
  updateMyCamera,
  setMyDisplayName,
  refreshPresence,
  setAppSubscriptionRoute,
  getMyIdentityHex,
} from '../spacetimedb/client'
import type { ConnectedUser, RemoteCursor } from '../spacetimedb/client'
import { syncWorldState, syncLocalState } from '../spacetimedb/sync'
import type { AppRoute, WorldCanvasContext } from '../spacetimedb/context'
import { STABLE_DEFAULT_MAIN_CANVAS_ID, STABLE_DEFAULT_WORLD_ID } from '../spacetimedb/context'
import { logRoomDebug, setRoomIdDebugFromWorker } from '../spacetimedb/debug-room-ids'
import { buildWorldHubSnapshot } from '../spacetimedb/world-hub-snapshot'
import {
  NODE_VM_TOP_BAND_H as TOP_BAND_H,
  SLOT_START_X,
  STONE_GAP,
  STONE_H,
  STONE_ROW_GAP,
  STONE_W,
} from '../shared/node-layout'

let worldState: CanonicalState | null = null
let currentContext: WorldCanvasContext = {
  worldId: STABLE_DEFAULT_WORLD_ID,
  canvasId: STABLE_DEFAULT_MAIN_CANVAS_ID,
  worldSlug: 'default-world',
  canvasSlug: 'main',
}
let appRoute: AppRoute = { mode: 'canvas', worldSlug: 'default-world', canvasSlug: 'main' }
let localState: WorkerLocalState = {
  hoveredSegmentId: null,
  groupPositions: {},
  groupSizeOverrides: {},
  groupListViewEnabled: {},
  nodeGroupOverrides: {},
  nodePositions: {},
  groupNodePositions: {},
  nodeSizeOverrides: {},
  freeSegmentPositions: {},
  groupFreeSegmentPositions: {},
  groupNodeOrders: {},
  customGroups: {},
  groupTitleOverrides: {},
  nodeTitleOverrides: {},
  dropIntent: null,
  stonesPerRow: 25,
  filterCategory: null,
  selectedSegmentIds: [],
  selectedNodeIds: [],
  selectedGroupIds: [],
  selectedLabelIds: [],
  nodeContainment: {},
  labels: {},
  selectedLabelId: null,
}
let previousScene: SceneVM | null = null
let batchDepth = 0
let pendingRecomputeAfterBatch = false

// ─── IndexedDB persistence is DISABLED ─────────────────────────────────────
// SpacetimeDB is the sole source of truth. Loading from IndexedDB on startup
// caused a flash of stale state before the server data arrived, and saving to
// it created a divergent local copy that masked sync bugs. The implementation
// is kept intact so it can be re-enabled as an offline fallback later.
const persistence: PersistenceBackend = new IndexedDBBackend()
let saveTimer: ReturnType<typeof setTimeout> | null = null
const SAVE_DEBOUNCE_MS = 500
const INDEXEDDB_ENABLED = false

function stripEphemeralLocalState(state: WorkerLocalState): PersistedLocalState {
  const {
    hoveredSegmentId: _1,
    dropIntent: _2,
    filterCategory: _3,
    selectedSegmentIds: _4,
    selectedNodeIds: _5,
    selectedGroupIds: _6,
    selectedLabelIds: _7,
    selectedLabelId: _8,
    ...persisted
  } = state
  return persisted
}

function scheduleSave(): void {
  if (!INDEXEDDB_ENABLED) return
  if (isReducerTransportReady()) return
  if (saveTimer != null) clearTimeout(saveTimer)
  saveTimer = setTimeout(() => {
    saveTimer = null
    if (worldState) {
      persistence.saveWorldState(worldState).catch((err) => console.warn('[persistence] saveWorldState failed', err))
    }
    persistence
      .saveLocalState(stripEphemeralLocalState(localState))
      .catch((err) => console.warn('[persistence] saveLocalState failed', err))
  }, SAVE_DEBOUNCE_MS)
}

const post = (message: WorkerToMainMessage): void => {
  self.postMessage(message)
}

let dragActive = false
let deferredServerState: { world: CanonicalState; layout: Partial<PersistedLocalState> } | null = null
let initialWorldTemplate: CanonicalState | null = null
let hasBootstrappedCurrentContext = false

function applyServerState(
  newWorldState: CanonicalState,
  newLayoutState: Partial<PersistedLocalState>,
): void {
  if (
    !hasBootstrappedCurrentContext &&
    initialWorldTemplate &&
    Object.keys(newWorldState.actors).length === 0 &&
    Object.keys(newWorldState.inventoryEntries).length === 0
  ) {
    hasBootstrappedCurrentContext = true
    worldState = migrateWieldToActor(initialWorldTemplate)
    localState = {
      ...localState,
      nodePositions: {},
      groupPositions: {},
      groupSizeOverrides: {},
      nodeSizeOverrides: {},
      groupListViewEnabled: {},
      nodeGroupOverrides: {},
      groupNodePositions: {},
      freeSegmentPositions: {},
      groupFreeSegmentPositions: {},
      groupNodeOrders: {},
      customGroups: {},
      groupTitleOverrides: {},
      nodeTitleOverrides: {},
      nodeContainment: {},
      labels: {},
    }
    recompute()
    syncToSpacetimeDB(null, localState)
    return
  }

  worldState = newWorldState
  localState = {
    hoveredSegmentId: localState.hoveredSegmentId,
    dropIntent: localState.dropIntent,
    filterCategory: localState.filterCategory,
    selectedSegmentIds: localState.selectedSegmentIds,
    selectedNodeIds: localState.selectedNodeIds,
    selectedGroupIds: localState.selectedGroupIds,
    selectedLabelIds: localState.selectedLabelIds,
    selectedLabelId: localState.selectedLabelId,
    nodePositions: newLayoutState.nodePositions ?? {},
    groupPositions: newLayoutState.groupPositions ?? {},
    groupSizeOverrides: newLayoutState.groupSizeOverrides ?? {},
    nodeSizeOverrides: newLayoutState.nodeSizeOverrides ?? {},
    groupListViewEnabled: newLayoutState.groupListViewEnabled ?? {},
    nodeGroupOverrides: newLayoutState.nodeGroupOverrides ?? {},
    groupNodePositions: newLayoutState.groupNodePositions ?? {},
    freeSegmentPositions: newLayoutState.freeSegmentPositions ?? {},
    groupFreeSegmentPositions: newLayoutState.groupFreeSegmentPositions ?? {},
    groupNodeOrders: newLayoutState.groupNodeOrders ?? {},
    customGroups: newLayoutState.customGroups ?? {},
    groupTitleOverrides: newLayoutState.groupTitleOverrides ?? {},
    nodeTitleOverrides: newLayoutState.nodeTitleOverrides ?? {},
    nodeContainment: newLayoutState.nodeContainment ?? {},
    labels: newLayoutState.labels ?? {},
    stonesPerRow: newLayoutState.stonesPerRow ?? localState.stonesPerRow,
  }
  recompute()
  scheduleSave()
}

function maybePushWorldHub(): void {
  if (appRoute.mode !== 'hub') return
  const conn = getConnection()
  // Snapshots only need a live client handle; do not gate on `isConnected()` which
  // also requires `initialApplied` — hub data never loads if we wait for that.
  if (!conn) return
  try {
    const snapshot = buildWorldHubSnapshot(conn, currentContext, getMyIdentityHex())
    post({ type: 'WORLD_HUB', requestId: null, snapshot })
  } catch (err) {
    console.warn('[world-hub] snapshot failed', err)
  }
}

function onServerState(
  newWorldState: CanonicalState,
  newLayoutState: Partial<PersistedLocalState>,
): void {
  if (dragActive) {
    deferredServerState = { world: newWorldState, layout: newLayoutState }
    return
  }
  applyServerState(newWorldState, newLayoutState)
}

function flushDeferredServerState(): void {
  if (!deferredServerState) return
  const { world, layout } = deferredServerState
  deferredServerState = null
  applyServerState(world, layout)
}

function onPresenceUpdate(
  users: ConnectedUser[],
  cursors: RemoteCursor[],
  myIdentityHex: string,
): void {
  post({ type: 'PRESENCE_UPDATE', users, cursors, myIdentityHex })
}

function initSpacetimeDB(token?: string): void {
  stdbConnect(
    onServerState,
    (status) => {
      post({ type: 'CONNECTION_STATUS', status })
    },
    (newToken) => {
      post({ type: 'STORE_TOKEN', token: newToken })
    },
    onPresenceUpdate,
    (panX, panY, zoom) => {
      post({ type: 'CAMERA_RESTORE', panX, panY, zoom })
    },
    currentContext,
    appRoute,
    (adjust) => post({ type: 'REGISTRY_RECONCILE', adjust }),
    token,
    appRoute.mode === 'hub' ? 'hub' : 'canvas',
    maybePushWorldHub,
  )
}

const debugDrag = (...args: unknown[]): void => {
  const serialized = args
    .map((arg) => {
      if (typeof arg === 'string') return arg
      try {
        return JSON.stringify(arg)
      } catch {
        return String(arg)
      }
    })
    .join(' ')
  console.info('[vm-worker drag]', ...args)
  post({ type: 'LOG', message: `[vm-worker drag] ${serialized}` })
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
const SELF_WEIGHT_TOKEN_PREFIX = '__self_weight__:'
const isSelfWeightTokenId = (segmentId: string): boolean => segmentId.startsWith(SELF_WEIGHT_TOKEN_PREFIX)

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

/**
 * Outside-node drops should resolve to an actor context that is rendered with
 * dropped rows on the board. Owned actors can be closest to the pointer but
 * their dropped rows are not surfaced as canvas free-segments, so walk to the
 * top-level owner when possible.
 */
const resolveRenderableDropActorId = (state: CanonicalState, actorId: string): string => {
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

const createInventoryEntryId = (state: CanonicalState, itemDefId: string, index?: number): string => {
  const safeDefId = itemDefId.replace(/:/g, '_')
  const base = `spawn_${safeDefId}`
  let attempt = 0
  while (attempt < 1000) {
    const suffix =
      attempt === 0
        ? `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}${index != null ? `_${index}` : ''}`
        : `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}_${attempt}${index != null ? `_${index}` : ''}`
    const nextId = `${base}_${suffix}`
    if (!state.inventoryEntries[nextId]) return nextId
    attempt += 1
  }
  return `${base}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}_fallback`
}

const INSTANCE_OVERRIDE_PREFIX = 'instance:'
const instanceOverridePrefixForEntry = (entryId: string): string => `${INSTANCE_OVERRIDE_PREFIX}${entryId}:`
const parseInstanceOverrideBaseId = (entryId: string, itemDefId: string): string | null => {
  const prefix = instanceOverridePrefixForEntry(entryId)
  return itemDefId.startsWith(prefix) ? itemDefId.slice(prefix.length) : null
}
const createInstanceOverrideItemDefId = (state: CanonicalState, entryId: string, basePrototypeId: string): string => {
  const prefix = instanceOverridePrefixForEntry(entryId)
  const preferred = `${prefix}${basePrototypeId}`
  if (!state.itemDefinitions[preferred]) return preferred
  let n = 1
  while (state.itemDefinitions[`${preferred}:${n}`]) n += 1
  return `${preferred}:${n}`
}

const toOptionalPositiveNumber = (value: number | undefined): number | undefined => {
  if (value == null || !Number.isFinite(value)) return undefined
  return value > 0 ? value : undefined
}

type ItemPrototypePatch = {
  readonly canonicalName: string
  readonly kind: ItemKind
  readonly sixthsPerUnit?: number
  readonly armorClass?: number
  readonly priceInGp?: number
  readonly isFungibleVisual?: boolean
}

const applyPrototypePatch = (
  source: ItemDefinition,
  patch: ItemPrototypePatch,
): ItemDefinition => {
  const trimmedName = patch.canonicalName.trim()
  const kind = patch.kind
  const sixthsPerUnit = toOptionalPositiveNumber(patch.sixthsPerUnit)
  const armorClass = toOptionalPositiveNumber(patch.armorClass)
  const priceInGp = toOptionalPositiveNumber(patch.priceInGp)
  return {
    ...source,
    canonicalName: trimmedName.length > 0 ? trimmedName : source.canonicalName,
    kind,
    ...(sixthsPerUnit != null ? { sixthsPerUnit } : { sixthsPerUnit: undefined }),
    ...(kind === 'armor' && armorClass != null ? { armorClass } : { armorClass: undefined }),
    ...(priceInGp != null ? { priceInGp } : { priceInGp: undefined }),
    isFungibleVisual: !!patch.isFungibleVisual,
  }
}

const removeSegmentsFromGroupPositions = (
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
    const groupOffset = free.groupId && scene.groups[free.groupId]
      ? { x: scene.groups[free.groupId]!.x, y: scene.groups[free.groupId]!.y }
      : { x: 0, y: 0 }
    rects.push({
      id: segmentId,
      x: groupOffset.x + free.x + b.x - SLOT_START_X,
      y: groupOffset.y + free.y + b.y - TOP_BAND_H,
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

const buildItemCatalogRows = (state: CanonicalState | null): readonly ItemCatalogRow[] => {
  if (!state) return []
  const defs = Object.values(state.itemDefinitions)
  defs.sort((a, b) => {
    const byName = a.canonicalName.localeCompare(b.canonicalName)
    if (byName !== 0) return byName
    return a.id.localeCompare(b.id)
  })
  return defs.map((d) => ({
    id: d.id,
    canonicalName: d.canonicalName,
    kind: d.kind,
    ...(d.sixthsPerUnit !== undefined ? { sixthsPerUnit: d.sixthsPerUnit } : {}),
    ...(d.armorClass !== undefined ? { armorClass: d.armorClass } : {}),
    ...(d.priceInGp !== undefined ? { priceInGp: d.priceInGp } : {}),
  }))
}

const recompute = (sendInitIfFirst = false): void => {
  if (!worldState) return
  if (!sendInitIfFirst && batchDepth > 0) {
    pendingRecomputeAfterBatch = true
    return
  }
  const nextScene = buildSceneVM(worldState, localState)

  if (sendInitIfFirst || !previousScene) {
    previousScene = nextScene
    post({ type: 'SCENE_INIT', scene: nextScene })
    scheduleSave()
    return
  }

  const patches = diffSceneVM(previousScene, nextScene)
  previousScene = nextScene
  if (patches.length > 0) {
    post({ type: 'SCENE_PATCHES', patches, scene: nextScene })
  }
  scheduleSave()
}

const runIntentBatch = (intents: readonly WorkerIntent[]): void => {
  if (intents.length === 0) return
  batchDepth += 1
  try {
    intents.forEach((intent) => applyIntent(intent))
  } finally {
    batchDepth -= 1
    if (batchDepth === 0 && pendingRecomputeAfterBatch) {
      pendingRecomputeAfterBatch = false
      recompute()
    }
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
    localState = { ...localState, selectedSegmentIds: intent.segmentIds, selectedNodeIds: [], selectedGroupIds: [], selectedLabelIds: [] }
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

  if (intent.type === 'SET_MARQUEE_SELECTION') {
    if (intent.addToSelection) {
      const seg = new Set(localState.selectedSegmentIds)
      const node = new Set(localState.selectedNodeIds)
      const group = new Set(localState.selectedGroupIds)
      const label = new Set(localState.selectedLabelIds)
      intent.selection.segmentIds.forEach((id) => seg.add(id))
      intent.selection.nodeIds.forEach((id) => node.add(id))
      intent.selection.groupIds.forEach((id) => group.add(id))
      intent.selection.labelIds.forEach((id) => label.add(id))
      localState = {
        ...localState,
        selectedSegmentIds: [...seg],
        selectedNodeIds: [...node],
        selectedGroupIds: [...group],
        selectedLabelIds: [...label],
        selectedLabelId: [...label][0] ?? localState.selectedLabelId,
      }
    } else {
      localState = {
        ...localState,
        selectedSegmentIds: [...intent.selection.segmentIds],
        selectedNodeIds: [...intent.selection.nodeIds],
        selectedGroupIds: [...intent.selection.groupIds],
        selectedLabelIds: [...intent.selection.labelIds],
        selectedLabelId: intent.selection.labelIds[0] ?? null,
      }
    }
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

  if (intent.type === 'RESIZE_GROUP') {
    localState = {
      ...localState,
      groupSizeOverrides: {
        ...localState.groupSizeOverrides,
        [intent.groupId]: {
          width: Math.max(1, intent.width),
          height: Math.max(1, intent.height),
        },
      },
    }
    recompute()
    return
  }

  if (intent.type === 'SET_GROUP_LIST_VIEW') {
    localState = {
      ...localState,
      groupListViewEnabled: {
        ...localState.groupListViewEnabled,
        [intent.groupId]: intent.enabled,
      },
    }
    recompute()
    return
  }

  if (intent.type === 'RESIZE_NODE') {
    localState = {
      ...localState,
      nodeSizeOverrides: {
        ...localState.nodeSizeOverrides,
        [intent.nodeId]: {
          slotCols: Math.max(1, Math.floor(intent.slotCols)),
          slotRows: Math.max(1, Math.floor(intent.slotRows)),
        },
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
      groupListViewEnabled: {
        ...localState.groupListViewEnabled,
        [groupId]: false,
      },
    }
    recompute()
    return
  }

  if (intent.type === 'DELETE_GROUP') {
    const groupId = intent.groupId
    if (!groupId.startsWith('custom-group:')) {
      recompute()
      return
    }
    const scene = buildSceneVM(worldState ?? { actors: {}, itemDefinitions: {}, inventoryEntries: {}, carryGroups: {}, movementGroups: {} }, localState)
    const group = scene.groups?.[groupId]
    if (!group) {
      recompute()
      return
    }
    const groupPos = localState.groupPositions[groupId] ?? { x: 0, y: 0 }
    const nextNodeGroupOverrides = { ...localState.nodeGroupOverrides }
    const nextNodePositions = { ...localState.nodePositions }
    group.nodeIds.forEach((nodeId, i) => {
      nextNodeGroupOverrides[nodeId] = null
      nextNodePositions[nodeId] = { x: groupPos.x + 40, y: groupPos.y + 60 + i * 80 }
    })
    const nextFreeSegmentPositions = { ...localState.freeSegmentPositions }
    const groupSegPositions = localState.groupFreeSegmentPositions[groupId] ?? {}
    for (const [segmentId, pos] of Object.entries(groupSegPositions)) {
      nextFreeSegmentPositions[segmentId] = { x: groupPos.x + pos.x, y: groupPos.y + pos.y }
    }
    const nextGroupFreeSegmentPositions = { ...localState.groupFreeSegmentPositions }
    delete nextGroupFreeSegmentPositions[groupId]
    const nextGroupNodeOrders = { ...localState.groupNodeOrders }
    delete nextGroupNodeOrders[groupId]
    const nextCustomGroups = { ...localState.customGroups }
    delete nextCustomGroups[groupId]
    const nextGroupPositions = { ...localState.groupPositions }
    delete nextGroupPositions[groupId]
    const nextGroupSizeOverrides = { ...localState.groupSizeOverrides }
    delete nextGroupSizeOverrides[groupId]
    const nextGroupListViewEnabled = { ...localState.groupListViewEnabled }
    delete nextGroupListViewEnabled[groupId]
    const nextGroupNodePositions = { ...localState.groupNodePositions }
    delete nextGroupNodePositions[groupId]
    const nextGroupTitleOverrides = { ...localState.groupTitleOverrides }
    delete nextGroupTitleOverrides[groupId]
    localState = {
      ...localState,
      nodeGroupOverrides: nextNodeGroupOverrides,
      nodePositions: nextNodePositions,
      freeSegmentPositions: nextFreeSegmentPositions,
      groupFreeSegmentPositions: nextGroupFreeSegmentPositions,
      groupNodeOrders: nextGroupNodeOrders,
      customGroups: nextCustomGroups,
      groupPositions: nextGroupPositions,
      groupSizeOverrides: nextGroupSizeOverrides,
      groupListViewEnabled: nextGroupListViewEnabled,
      groupNodePositions: nextGroupNodePositions,
      groupTitleOverrides: nextGroupTitleOverrides,
    }
    recompute()
    return
  }

  if (intent.type === 'ADD_INVENTORY_NODE') {
    if (!worldState) {
      recompute()
      return
    }
    const groupId = intent.groupId ?? null
    let x = intent.x
    let y = intent.y
    // Canvas clicks are in world space; grouped node layout stores offsets from the group origin
    // (see buildSceneVM: node.x = pos.x + relPos.x). Same adjustment as MOVE_NODE_IN_GROUP.
    if (groupId) {
      const scene = buildSceneVM(worldState, localState)
      const g = scene.groups?.[groupId]
      if (g) {
        x = intent.x - g.x
        y = intent.y - g.y
      }
    }
    const result = addInventoryNodeToState({
      worldState,
      localState,
      x,
      y,
      groupId,
    })
    worldState = result.worldState
    localState = result.localState
    recompute()
    return
  }

  if (intent.type === 'UPDATE_GROUP_TITLE') {
    const nextTitle = intent.title.trim()
    if (nextTitle.length === 0) {
      recompute()
      return
    }
    localState = {
      ...localState,
      groupTitleOverrides: {
        ...localState.groupTitleOverrides,
        [intent.groupId]: nextTitle,
      },
      customGroups: localState.customGroups[intent.groupId]
        ? {
            ...localState.customGroups,
            [intent.groupId]: {
              ...localState.customGroups[intent.groupId],
              title: nextTitle,
            },
          }
        : localState.customGroups,
    }
    // TODO(spacetimedb): persist group title edits when board state is backed by SpacetimeDB.
    recompute()
    return
  }

  if (intent.type === 'MOVE_NODES_TO_GROUP_INDEX') {
    runIntentBatch(intent.moves.map((move) => ({
      type: 'MOVE_NODE_TO_GROUP_INDEX' as const,
      nodeId: move.nodeId,
      groupId: move.groupId,
      index: move.index,
    })))
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
      const worldPos = sceneNode
        ? { x: sceneNode.x, y: sceneNode.y }
        : nodePositions[nid]
      if (!worldPos) continue
      targetGroupPositionMap[nid] = {
        x: worldPos.x - targetGroupWorld.x,
        y: worldPos.y - targetGroupWorld.y,
      }
    }
    for (const nid of nodeIdsToMove) delete nodePositions[nid]
    groupNodePositions[intent.groupId] = targetGroupPositionMap
    localState = { ...localState, nodeGroupOverrides: overrides, nodePositions, groupNodeOrders: nextOrders, groupNodePositions }
    recompute()
    return
  }

  if (intent.type === 'MOVE_NODES_IN_GROUP') {
    runIntentBatch(intent.moves.map((move) => ({
      type: 'MOVE_NODE_IN_GROUP' as const,
      nodeId: move.nodeId,
      groupId: move.groupId,
      x: move.x,
      y: move.y,
    })))
    return
  }

  if (intent.type === 'MOVE_NODE_IN_GROUP') {
    if (!worldState) {
      recompute()
      return
    }
    const scene = buildSceneVM(worldState, localState)
    const targetGroup = scene.groups[intent.groupId]
    if (!targetGroup) {
      recompute()
      return
    }
    const nodeIdsToMove = collectSceneSubtreeNodeIds(scene, intent.nodeId)
    const primaryNode = scene.nodes[intent.nodeId]
    if (!primaryNode) {
      recompute()
      return
    }

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

    for (const nid of nodeIdsToMove) {
      const actor: Actor | undefined = worldState.actors[nid]
      if (!actor) continue
      worldState = {
        ...worldState,
        actors: {
          ...worldState.actors,
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

    localState = {
      ...localState,
      nodeGroupOverrides: overrides,
      nodePositions,
      groupNodePositions,
      groupNodeOrders: nextOrders,
    }
    recompute()
    return
  }

  if (intent.type === 'DROP_NODES_INTO_NODE') {
    runIntentBatch(intent.nodeIds.map((nodeId) => ({
      type: 'DROP_NODE_INTO_NODE' as const,
      nodeId,
      targetNodeId: intent.targetNodeId,
    })))
    return
  }

  if (intent.type === 'DROP_NODE_INTO_NODE') {
    if (!worldState) {
      recompute()
      return
    }
    if (intent.nodeId === intent.targetNodeId) {
      recompute()
      return
    }
    localState = {
      ...localState,
      nodeContainment: {
        ...localState.nodeContainment,
        [intent.nodeId]: intent.targetNodeId,
      },
    }
    recompute()
    return
  }

  if (intent.type === 'CONNECT_NODE_PARENT') {
    if (!worldState) {
      recompute()
      return
    }
    const childActor = worldState.actors[intent.nodeId]
    const parentActor = worldState.actors[intent.parentNodeId]
    if (!childActor || !parentActor || intent.nodeId === intent.parentNodeId) {
      recompute()
      return
    }
    worldState = {
      ...worldState,
      actors: {
        ...worldState.actors,
        [intent.nodeId]: {
          ...childActor,
          ownerActorId: intent.parentNodeId,
        },
      },
    }
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
    const parentNode = scene.nodes[intent.parentNodeId]
    const parentIsUngrouped = parentNode?.groupId == null

    const baseOrders: Record<string, readonly string[]> = {}
    for (const [gid, g] of Object.entries(scene.groups ?? {})) {
      baseOrders[gid] = [...g.nodeIds]
    }
    const nextOrders: Record<string, readonly string[]> = { ...baseOrders }
    for (const [gid, order] of Object.entries(nextOrders)) {
      nextOrders[gid] = order.filter((id) => !subtreeNodeIds.includes(id))
    }

    const nextOverrides = { ...localState.nodeGroupOverrides }
    const nextNodePositions = { ...localState.nodePositions }
    subtreeNodeIds.forEach((nodeId) => {
      delete nextNodePositions[nodeId]
    })

    if (parentIsUngrouped) {
      subtreeNodeIds.forEach((nodeId) => {
        nextOverrides[nodeId] = null
      })
    } else {
      const targetGroupId = parentActor.movementGroupId
      const target = [...(nextOrders[targetGroupId] ?? [])]
      const parentIndex = target.indexOf(intent.parentNodeId)
      const insertIndex = parentIndex >= 0 ? parentIndex + 1 : target.length
      target.splice(insertIndex, 0, ...subtreeNodeIds)
      nextOrders[targetGroupId] = target
      subtreeNodeIds.forEach((nodeId) => {
        nextOverrides[nodeId] = parentActor.movementGroupId
      })
    }
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
    debugDrag('MOVE_NODE_TO_ROOT received', {
      nodeId: intent.nodeId,
      x: intent.x,
      y: intent.y,
      hasWorldState: !!worldState,
    })
    if (!worldState) {
      recompute()
      return
    }
    const actor = worldState.actors[intent.nodeId]
    debugDrag('MOVE_NODE_TO_ROOT actor lookup', {
      nodeId: intent.nodeId,
      actorFound: !!actor,
    })
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
      nodeContainment: Object.fromEntries(
        Object.entries(localState.nodeContainment).filter(([id]) => !subtreeNodeIds.includes(id)),
      ),
    }
    debugDrag('MOVE_NODE_TO_ROOT applied', {
      nodeId: intent.nodeId,
      persistedPosition: nextNodePositions[intent.nodeId],
      subtreeNodeIds,
    })
    recompute()
    return
  }

  if (intent.type === 'MOVE_NODES_TO_ROOT') {
    runIntentBatch(intent.moves.map((move) => ({
      type: 'MOVE_NODE_TO_ROOT' as const,
      nodeId: move.nodeId,
      x: move.x,
      y: move.y,
    })))
    return
  }

  if (intent.type === 'UPDATE_NODE_TITLE') {
    if (!worldState?.actors[intent.nodeId]) {
      recompute()
      return
    }
    const nextTitle = intent.title.trim()
    if (nextTitle.length === 0) {
      recompute()
      return
    }
    localState = {
      ...localState,
      nodeTitleOverrides: {
        ...localState.nodeTitleOverrides,
        [intent.nodeId]: nextTitle,
      },
    }
    // TODO(spacetimedb): persist node title edits when board state is backed by SpacetimeDB.
    recompute()
    return
  }

  if (intent.type === 'DRAG_SEGMENT_START') {
    const movableSegmentIds = intent.segmentIds.filter((id) => !isSelfWeightTokenId(id))
    if (!worldState || movableSegmentIds.length === 0) {
      recompute()
      return
    }
    const segToNode = buildSegmentIdToNodeId(worldState)
    const firstSource = segToNode[movableSegmentIds[0]]
    const sourceNodeIds: Record<string, string> = {}
    for (const id of movableSegmentIds) {
      const nodeId = segToNode[id]
      if (nodeId) sourceNodeIds[id] = nodeId
    }
    localState = {
      ...localState,
      dropIntent: {
        segmentIds: movableSegmentIds,
        sourceNodeIds,
        targetNodeId: firstSource ?? movableSegmentIds[0],
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
      ? intent.targetNodeId
      : null
    const hoverTargetGroupId = localState.dropIntent
      ? intent.targetGroupId ?? null
      : null
    debugDrag('DRAG_SEGMENT_END received', {
      targetNodeId: intent.targetNodeId,
      targetGroupId: intent.targetGroupId,
      hoverTargetNodeId,
      hoverTargetGroupId,
      x: intent.x,
      y: intent.y,
      hasFreeSegmentPositions: !!intent.freeSegmentPositions,
      freeSegmentPositionCount: intent.freeSegmentPositions ? Object.keys(intent.freeSegmentPositions).length : 0,
      segmentIds: localState.dropIntent?.segmentIds ?? [],
    })
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
        localState = {
          ...localState,
          freeSegmentPositions,
          groupFreeSegmentPositions: removeSegmentsFromGroupPositions(localState.groupFreeSegmentPositions, segmentIds),
        }
      }
      debugDrag('handled as node drop', {
        hoverTargetNodeId,
        movedAny,
        clearedFreeSegmentPositionsFor: movedAny ? segmentIds : [],
      })
    } else if (localState.dropIntent && worldState && intent.x != null && intent.y != null) {
      const { segmentIds, sourceNodeIds } = localState.dropIntent
      const firstSourceNodeId = segmentIds[0] ? sourceNodeIds[segmentIds[0]] : null
      const source = firstSourceNodeId ? parseNodeId(firstSourceNodeId) : null
      const sceneAtDrop = buildSceneVM(worldState, localState)
      const targetGroup = hoverTargetGroupId ? sceneAtDrop.groups[hoverTargetGroupId] : null
      const groupCanAcceptSegments = !!targetGroup
      if (source) {
        for (const segmentId of segmentIds) {
          const sourceNodeId = sourceNodeIds[segmentId]
          if (!sourceNodeId) continue
          const parsedSource = parseNodeId(sourceNodeId)
          const entryId = segmentIdToEntryId(segmentId)
          const entry: InventoryEntry | undefined = worldState.inventoryEntries[entryId]
          if (!entry) continue
          const segmentDroppedGroupId = droppedGroupIdForActor(parsedSource.actorId)
          worldState = ensureDroppedGroup(worldState, parsedSource.actorId)
          const movedEntry: InventoryEntry = {
            ...entry,
            actorId: parsedSource.actorId,
            carryGroupId: segmentDroppedGroupId,
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

        const droppedLayout =
          intent.freeSegmentPositions ??
          computeDroppedFreeSegmentPositions(
            sceneAtDrop,
            segmentIds,
            intent.x,
            intent.y,
            localState.stonesPerRow,
          )
        const cleanedGroups = removeSegmentsFromGroupPositions(localState.groupFreeSegmentPositions, segmentIds)

        if (groupCanAcceptSegments && targetGroup && hoverTargetGroupId) {
          const nextGroupPositions = {
            ...cleanedGroups,
            [hoverTargetGroupId]: {
              ...(cleanedGroups[hoverTargetGroupId] ?? {}),
            },
          }
          const freeSegmentPositions = { ...localState.freeSegmentPositions }
          for (const segmentId of segmentIds) {
            const nextPos = droppedLayout[segmentId] ?? { x: intent.x, y: intent.y }
            nextGroupPositions[hoverTargetGroupId]![segmentId] = {
              x: nextPos.x - targetGroup.x,
              y: nextPos.y - targetGroup.y,
            }
            delete freeSegmentPositions[segmentId]
          }
          localState = {
            ...localState,
            freeSegmentPositions,
            groupFreeSegmentPositions: nextGroupPositions,
          }
        } else {
          const freeSegmentPositions = { ...localState.freeSegmentPositions }
          for (const segmentId of segmentIds) {
            const nextPos = droppedLayout[segmentId] ?? { x: intent.x, y: intent.y }
            freeSegmentPositions[segmentId] = nextPos
          }
          localState = {
            ...localState,
            freeSegmentPositions,
            groupFreeSegmentPositions: cleanedGroups,
          }
        }
        debugDrag('handled as absolute drop with resolved source', {
          sourceActorId: source.actorId,
          sourceCarryGroupId: source.carryGroupId ?? null,
          persistedCount: segmentIds.length,
          segmentIds,
          targetGroupId: groupCanAcceptSegments ? hoverTargetGroupId : null,
        })
      } else if (intent.freeSegmentPositions) {
        // If source resolution fails (e.g. free segment already in absolute space),
        // still persist explicit absolute drop coordinates from the renderer.
        const freeSegmentPositions = { ...localState.freeSegmentPositions }
        for (const segmentId of segmentIds) {
          const nextPos = intent.freeSegmentPositions[segmentId]
          if (nextPos) freeSegmentPositions[segmentId] = nextPos
        }
        localState = {
          ...localState,
          freeSegmentPositions,
          groupFreeSegmentPositions: removeSegmentsFromGroupPositions(localState.groupFreeSegmentPositions, segmentIds),
        }
        debugDrag('handled as absolute drop with source fallback', {
          persistedCount: Object.keys(intent.freeSegmentPositions).length,
          segmentIds,
        })
      } else {
        debugDrag('absolute drop path reached but nothing persisted', {
          reason: 'source unresolved and freeSegmentPositions missing',
          segmentIds,
        })
      }
    }
    localState = { ...localState, dropIntent: null }
    debugDrag('dropIntent cleared after drag end')
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
        armorClass: intent.armorClass,
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
        targetActorId = resolveRenderableDropActorId(worldState, nearestNode.actorId)
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

    const preferredZone = intent.wornClothing ? 'worn' : (intent.zoneHint ?? 'stowed')
    const preferredState = intent.wornClothing ? { worn: true as const } : undefined

    const createdEntryIds: string[] = []
    for (let i = 0; i < quantity; i++) {
      const entryId = createInventoryEntryId(worldState, intent.itemDefId, i)
      createdEntryIds.push(entryId)
      const zone = shouldDropToGround ? 'dropped' : preferredZone
      const state = shouldDropToGround ? { dropped: true } : preferredState
      const nextEntry: InventoryEntry = {
        id: entryId,
        actorId: targetActorId,
        itemDefId: intent.itemDefId,
        quantity: 1,
        zone,
        carryGroupId: targetCarryGroupId,
        state,
      }
      worldState = {
        ...worldState,
        inventoryEntries: {
          ...worldState.inventoryEntries,
          [entryId]: nextEntry,
        },
      }
    }

    if (shouldDropToGround && intent.x != null && intent.y != null) {
      const freeSegmentPositions = { ...localState.freeSegmentPositions }
      if (intent.freeSegmentPositions && intent.segmentIds && intent.segmentIds.length === createdEntryIds.length) {
        for (let i = 0; i < createdEntryIds.length; i++) {
          const pos = intent.freeSegmentPositions[intent.segmentIds[i]]
          if (pos) {
            freeSegmentPositions[createdEntryIds[i]] = pos
          }
        }
      } else {
        const sceneAtDrop = buildSceneVM(worldState, localState)
        const createdEntryIdSet = new Set(createdEntryIds)
        for (const free of Object.values(sceneAtDrop.freeSegments)) {
          if (createdEntryIdSet.has(segmentIdToEntryId(free.id))) {
            freeSegmentPositions[free.id] = { x: intent.x, y: intent.y }
          }
        }
      }
      localState = { ...localState, freeSegmentPositions }
    }

    recompute()
    return
  }

  if (intent.type === 'APPLY_ADD_ITEMS_OP') {
    runIntentBatch(intent.items.map((item) => ({
      type: 'SPAWN_ITEM_INSTANCE' as const,
      itemDefId: item.itemDefId,
      quantity: item.quantity,
      targetNodeId: intent.targetNodeId,
      itemName: item.itemName,
      sixthsPerUnit: item.sixthsPerUnit,
      itemKind: item.itemKind,
      armorClass: item.armorClass,
      wornClothing: item.wornClothing,
      zoneHint: item.zoneHint,
    })))
    return
  }

  if (intent.type === 'SAVE_ITEM_EDITOR') {
    if (!worldState) return
    if (isSelfWeightTokenId(intent.segmentId)) {
      recompute()
      return
    }
    const entryId = segmentIdToEntryId(intent.segmentId)
    const existingEntry = worldState.inventoryEntries[entryId]
    if (!existingEntry) {
      recompute()
      return
    }

    const cleanedState = { ...(intent.state ?? {}) }
    if (intent.zone === 'dropped') cleanedState.dropped = true
    else delete cleanedState.dropped
    const nextState = Object.keys(cleanedState).length > 0 ? cleanedState : undefined
    const quantity = Math.max(1, Math.floor(intent.quantity || 1))
    const dropped = intent.zone === 'dropped'

    let nextCarryGroupId = existingEntry.carryGroupId
    if (dropped) {
      worldState = ensureDroppedGroup(worldState, existingEntry.actorId)
      nextCarryGroupId = droppedGroupIdForActor(existingEntry.actorId)
    } else {
      nextCarryGroupId = undefined
    }

    let nextItemDefId = existingEntry.itemDefId
    const currentDef = worldState.itemDefinitions[existingEntry.itemDefId]
    const currentOverrideBase = parseInstanceOverrideBaseId(existingEntry.id, existingEntry.itemDefId)
    const basePrototypeId = intent.basePrototypeId || currentOverrideBase || existingEntry.itemDefId
    const basePrototype = worldState.itemDefinitions[basePrototypeId] ?? currentDef

    if (intent.target === 'prototype') {
      if (!currentDef) {
        recompute()
        return
      }
      const patched = applyPrototypePatch(currentDef, intent.prototypePatch)
      worldState = {
        ...worldState,
        itemDefinitions: {
          ...worldState.itemDefinitions,
          [patched.id]: patched,
        },
      }
    } else {
      if (!basePrototype) {
        recompute()
        return
      }
      if (intent.instanceOverrideEnabled) {
        const canReuseCurrentOverride =
          currentOverrideBase != null &&
          currentOverrideBase === basePrototypeId &&
          !!worldState.itemDefinitions[existingEntry.itemDefId]
        const overrideItemDefId = canReuseCurrentOverride
          ? existingEntry.itemDefId
          : createInstanceOverrideItemDefId(worldState, existingEntry.id, basePrototypeId)
        const sourceForOverride = worldState.itemDefinitions[overrideItemDefId] ?? {
          ...basePrototype,
          id: overrideItemDefId,
        }
        const patchedOverride = applyPrototypePatch(sourceForOverride, intent.prototypePatch)
        worldState = {
          ...worldState,
          itemDefinitions: {
            ...worldState.itemDefinitions,
            [overrideItemDefId]: patchedOverride,
          },
        }
        nextItemDefId = overrideItemDefId
      } else {
        nextItemDefId = basePrototype.id
      }
    }

    const nextEntry: InventoryEntry = {
      ...existingEntry,
      itemDefId: nextItemDefId,
      quantity,
      zone: intent.zone,
      carryGroupId: nextCarryGroupId,
      state: nextState,
    }
    worldState = {
      ...worldState,
      inventoryEntries: {
        ...worldState.inventoryEntries,
        [entryId]: nextEntry,
      },
    }

    if (dropped) {
      const actor = worldState.actors[existingEntry.actorId]
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

    recompute()
    return
  }

  const applyMoveEntryTo = (
    segmentId: string,
    sourceNodeId: string,
    targetNodeId: string,
  ): void => {
    if (!worldState) return
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
      groupFreeSegmentPositions: removeSegmentsFromGroupPositions(localState.groupFreeSegmentPositions, [segmentId]),
    }
  }

  if (intent.type === 'MOVE_ENTRY_TO') {
    if (!worldState) return
    if (isSelfWeightTokenId(intent.segmentId)) {
      recompute()
      return
    }
    applyMoveEntryTo(intent.segmentId, intent.sourceNodeId, intent.targetNodeId)
    recompute()
    return
  }

  if (intent.type === 'MOVE_ENTRIES_TO') {
    if (!worldState) return
    for (const { segmentId, sourceNodeId } of intent.moves.filter((m) => !isSelfWeightTokenId(m.segmentId))) {
      applyMoveEntryTo(segmentId, sourceNodeId, intent.targetNodeId)
    }
    recompute()
    return
  }

  if (intent.type === 'DELETE_NODE') {
    if (!worldState) return
    const actorId = parseNodeId(intent.nodeId).actorId
    const actor = worldState.actors[actorId]
    if (!actor) {
      recompute()
      return
    }
    const entryIdsToRemove = Object.values(worldState.inventoryEntries)
      .filter((e) => e.actorId === actorId)
      .map((e) => e.id)
    let nextEntries = worldState.inventoryEntries
    for (const entryId of entryIdsToRemove) {
      const { [entryId]: _, ...rest } = nextEntries
      nextEntries = rest
      worldState = { ...worldState, inventoryEntries: nextEntries }
    }
    const { [actorId]: _, ...nextActors } = worldState.actors
    worldState = { ...worldState, actors: nextActors, inventoryEntries: nextEntries }
    const carryGroupIdsToRemove = Object.values(worldState.carryGroups)
      .filter((cg) => cg.ownerActorId === actorId)
      .map((cg) => cg.id)
    let nextCarryGroups = worldState.carryGroups
    for (const cgId of carryGroupIdsToRemove) {
      const { [cgId]: __, ...rest } = nextCarryGroups
      nextCarryGroups = rest
    }
    worldState = { ...worldState, carryGroups: nextCarryGroups }
    const entryIdSet = new Set(entryIdsToRemove)
    localState = {
      ...localState,
      selectedSegmentIds: [],
      nodeGroupOverrides: Object.fromEntries(
        Object.entries(localState.nodeGroupOverrides).filter(([id]) => id !== actorId),
      ),
      nodePositions: Object.fromEntries(
        Object.entries(localState.nodePositions).filter(([id]) => id !== actorId),
      ),
      freeSegmentPositions: Object.fromEntries(
        Object.entries(localState.freeSegmentPositions).filter(([id]) => !entryIdSet.has(segmentIdToEntryId(id))),
      ),
      groupFreeSegmentPositions: removeSegmentsFromGroupPositions(localState.groupFreeSegmentPositions, entryIdsToRemove),
      nodeSizeOverrides: Object.fromEntries(
        Object.entries(localState.nodeSizeOverrides).filter(([id]) => id !== actorId),
      ),
      nodeContainment: Object.fromEntries(
        Object.entries(localState.nodeContainment).filter(([id, targetId]) => id !== actorId && targetId !== actorId),
      ),
    }
    const nextGroupNodeOrders = { ...localState.groupNodeOrders }
    const nextGroupNodePositions = { ...localState.groupNodePositions }
    for (const [gid, order] of Object.entries(nextGroupNodeOrders)) {
      if (order.includes(actorId)) {
        nextGroupNodeOrders[gid] = order.filter((id) => id !== actorId)
      }
      const positions = nextGroupNodePositions[gid]
      if (positions?.[actorId]) {
        const nextPositions = { ...positions }
        delete nextPositions[actorId]
        nextGroupNodePositions[gid] = nextPositions
      }
    }
    localState = { ...localState, groupNodeOrders: nextGroupNodeOrders, groupNodePositions: nextGroupNodePositions }
    recompute()
    return
  }

  if (intent.type === 'DUPLICATE_NODE') {
    if (!worldState) return
    const actorId = parseNodeId(intent.nodeId).actorId
    const actor = worldState.actors[actorId]
    if (!actor) {
      recompute()
      return
    }
    const scene = buildSceneVM(worldState, localState)
    const sourceEntries = Object.values(worldState.inventoryEntries).filter((e) => e.actorId === actorId)
    const newActorId = createInventoryActorId(worldState, Date.now, Math.random)
    const newName = actor.name.match(/^Inventory (\d+)$/)
      ? nextInventoryName(worldState)
      : `${actor.name} (copy)`
    const newActor: Actor = {
      ...actor,
      id: newActorId,
      name: newName,
      leftWieldingEntryId: undefined,
      rightWieldingEntryId: undefined,
    }
    worldState = {
      ...worldState,
      actors: {
        ...worldState.actors,
        [newActorId]: newActor,
      },
    }
    worldState = ensureDroppedGroup(worldState, newActorId)
    const newCarryGroupId = droppedGroupIdForActor(newActorId)
    const entryIdMap = new Map<string, string>()
    let nextFreeSegmentPositions = { ...localState.freeSegmentPositions }
    const nextGroupFreeSegmentPositions = { ...localState.groupFreeSegmentPositions }
    for (const entry of sourceEntries) {
      const newEntryId = createInventoryEntryId(worldState, entry.itemDefId)
      entryIdMap.set(entry.id, newEntryId)
      const isDropped = !!entry.carryGroupId || entry.zone === 'dropped' || !!entry.state?.dropped
      const nextEntry: InventoryEntry = {
        id: newEntryId,
        actorId: newActorId,
        itemDefId: entry.itemDefId,
        quantity: entry.quantity,
        zone: isDropped ? 'dropped' : entry.zone,
        carryGroupId: isDropped ? newCarryGroupId : undefined,
        state: isDropped ? { dropped: true } : undefined,
      }
      worldState = {
        ...worldState,
        inventoryEntries: {
          ...worldState.inventoryEntries,
          [newEntryId]: nextEntry,
        },
      }
      if (isDropped) {
        const freeSeg = Object.values(scene.freeSegments ?? {}).find((f) => segmentIdToEntryId(f.id) === entry.id)
        const offsetX = 40
        const offsetY = 60
        const srcX = freeSeg?.x ?? 120
        const srcY = freeSeg?.y ?? 120
        const newPos = { x: srcX + offsetX, y: srcY + offsetY }
        if (freeSeg?.groupId) {
          const groupPos = nextGroupFreeSegmentPositions[freeSeg.groupId] ?? {}
          nextGroupFreeSegmentPositions[freeSeg.groupId] = { ...groupPos, [newEntryId]: newPos }
        } else {
          nextFreeSegmentPositions = { ...nextFreeSegmentPositions, [newEntryId]: newPos }
        }
      }
    }
    const node = scene.nodes[intent.nodeId] ?? Object.values(scene.nodes).find((n) => n.actorId === actorId)
    const groupId = node?.groupId ?? null
    const sourceSizeOverride = localState.nodeSizeOverrides[actorId]
    if (groupId) {
      const sourceGroupPositions = localState.groupNodePositions[groupId] ?? {}
      const sourceRelativePos = sourceGroupPositions[actorId] ?? { x: 40, y: 60 }
      localState = {
        ...localState,
        freeSegmentPositions: nextFreeSegmentPositions,
        groupFreeSegmentPositions: nextGroupFreeSegmentPositions,
        nodeGroupOverrides: { ...localState.nodeGroupOverrides, [newActorId]: groupId },
        groupNodePositions: {
          ...localState.groupNodePositions,
          [groupId]: {
            ...sourceGroupPositions,
            [newActorId]: { x: sourceRelativePos.x + 40, y: sourceRelativePos.y + 60 },
          },
        },
        nodeSizeOverrides: sourceSizeOverride
          ? { ...localState.nodeSizeOverrides, [newActorId]: sourceSizeOverride }
          : localState.nodeSizeOverrides,
        groupNodeOrders: {
          ...localState.groupNodeOrders,
          [groupId]: [...(localState.groupNodeOrders[groupId] ?? []), newActorId],
        },
        selectedSegmentIds: Array.from(entryIdMap.values()),
      }
    } else {
      const pos = localState.nodePositions[actorId] ?? { x: 120, y: 120 }
      localState = {
        ...localState,
        freeSegmentPositions: nextFreeSegmentPositions,
        groupFreeSegmentPositions: nextGroupFreeSegmentPositions,
        nodeGroupOverrides: { ...localState.nodeGroupOverrides, [newActorId]: null },
        nodePositions: {
          ...localState.nodePositions,
          [newActorId]: { x: pos.x + 40, y: pos.y + 60 },
        },
        nodeSizeOverrides: sourceSizeOverride
          ? { ...localState.nodeSizeOverrides, [newActorId]: sourceSizeOverride }
          : localState.nodeSizeOverrides,
        selectedSegmentIds: Array.from(entryIdMap.values()),
      }
    }
    recompute()
    return
  }

  if (intent.type === 'DUPLICATE_ENTRY') {
    if (!worldState) return
    const scene = buildSceneVM(worldState, localState)
    const newSegmentIds: string[] = []
    for (const segmentId of intent.segmentIds.filter((id) => !isSelfWeightTokenId(id))) {
      const entryId = segmentIdToEntryId(segmentId)
      const entry = worldState.inventoryEntries[entryId]
      if (!entry) continue
      const itemDef = worldState.itemDefinitions[entry.itemDefId]
      if (!itemDef) continue

      const newEntryId = createInventoryEntryId(worldState, entry.itemDefId)
      const isDropped = !!entry.carryGroupId || entry.zone === 'dropped' || !!entry.state?.dropped
      const freeSeg = scene.freeSegments?.[segmentId]

      const nextEntry: InventoryEntry = {
        id: newEntryId,
        actorId: entry.actorId,
        itemDefId: entry.itemDefId,
        quantity: 1,
        zone: isDropped ? 'dropped' : entry.zone,
        carryGroupId: isDropped ? entry.carryGroupId : undefined,
        state: isDropped ? { dropped: true } : undefined,
      }
      worldState = {
        ...worldState,
        inventoryEntries: {
          ...worldState.inventoryEntries,
          [newEntryId]: nextEntry,
        },
      }
      newSegmentIds.push(newEntryId)

      if (isDropped && freeSeg) {
        const offsetX = 40
        const offsetY = 60
        const srcX = freeSeg.x
        const srcY = freeSeg.y
        const newPos = { x: srcX + offsetX, y: srcY + offsetY }
        if (freeSeg.groupId) {
          const groupPos = localState.groupFreeSegmentPositions[freeSeg.groupId] ?? {}
          localState = {
            ...localState,
            groupFreeSegmentPositions: {
              ...localState.groupFreeSegmentPositions,
              [freeSeg.groupId]: { ...groupPos, [newEntryId]: newPos },
            },
          }
        } else {
          localState = {
            ...localState,
            freeSegmentPositions: {
              ...localState.freeSegmentPositions,
              [newEntryId]: newPos,
            },
          }
        }
      }
    }
    localState = {
      ...localState,
      selectedSegmentIds: newSegmentIds,
    }
    recompute()
    return
  }

  if (intent.type === 'DELETE_ENTRY') {
    if (!worldState) return
    const entryIdsToRemove = new Set<string>()
    for (const segmentId of intent.segmentIds.filter((id) => !isSelfWeightTokenId(id))) {
      const entryId = segmentIdToEntryId(segmentId)
      if (worldState.inventoryEntries[entryId]) entryIdsToRemove.add(entryId)
    }
    let nextEntries = worldState.inventoryEntries
    for (const entryId of entryIdsToRemove) {
      const { [entryId]: entry, ...rest } = nextEntries
      nextEntries = rest
      if (entry) {
        worldState = { ...worldState, inventoryEntries: nextEntries }
        const actor: Actor | undefined = worldState.actors[entry.actorId]
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
    worldState = { ...worldState, inventoryEntries: nextEntries }
    localState = {
      ...localState,
      selectedSegmentIds: [],
      freeSegmentPositions: Object.fromEntries(
        Object.entries(localState.freeSegmentPositions).filter(([id]) => !entryIdsToRemove.has(segmentIdToEntryId(id))),
      ),
      groupFreeSegmentPositions: removeSegmentsFromGroupPositions(localState.groupFreeSegmentPositions, [...entryIdsToRemove]),
    }
    recompute()
    return
  }

  if (intent.type === 'SET_WIELD') {
    if (!worldState) return
    if (isSelfWeightTokenId(intent.segmentId)) {
      recompute()
      return
    }
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
    if (isSelfWeightTokenId(intent.segmentId)) {
      recompute()
      return
    }
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
      selectedLabelIds: [labelId],
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
      selectedLabelIds: localState.selectedLabelIds.filter((id) => id !== intent.labelId),
      selectedLabelId: localState.selectedLabelId === intent.labelId ? null : localState.selectedLabelId,
    }
    recompute()
    return
  }

  if (intent.type === 'SELECT_LABEL') {
    localState = {
      ...localState,
      selectedLabelId: intent.labelId,
      selectedLabelIds: intent.labelId ? [intent.labelId] : [],
    }
    recompute()
    return
  }

  if (intent.type === 'CATALOG_UPSERT_DEFINITION') {
    if (!worldState) return
    const d = intent.definition
    worldState = {
      ...worldState,
      itemDefinitions: {
        ...worldState.itemDefinitions,
        [d.id]: { ...d },
      },
    }
    recompute()
    return
  }

  if (intent.type === 'CATALOG_REMOVE_DEFINITION') {
    if (!worldState) return
    const stillUsed = Object.values(worldState.inventoryEntries).some((e) => e.itemDefId === intent.id)
    if (stillUsed) {
      post({ type: 'LOG', message: `[catalog] cannot remove "${intent.id}": in use on board` })
      return
    }
    const { [intent.id]: _removed, ...rest } = worldState.itemDefinitions
    worldState = { ...worldState, itemDefinitions: rest }
    recompute()
    return
  }

  if (intent.type === 'SET_WORLD_STATE') {
    worldState = migrateWieldToActor(intent.worldState)
    recompute()
    return
  }

  if (intent.type === 'DRAG_START') {
    dragActive = true
    return
  }

  if (intent.type === 'DRAG_END') {
    dragActive = false
    if (dragSyncTimer) {
      clearTimeout(dragSyncTimer)
      dragSyncTimer = null
    }
    if (pendingSyncSnapshot) {
      const { oldWorld, oldLocal } = pendingSyncSnapshot
      pendingSyncSnapshot = null
      doSync(oldWorld, oldLocal)
    }
    flushDeferredServerState()
    return
  }
}

async function initFromPersistence(fallbackWorldState: CanonicalState, stonesPerRow?: number, token?: string): Promise<void> {
  initialWorldTemplate = fallbackWorldState
  hasBootstrappedCurrentContext = false
  if (INDEXEDDB_ENABLED) {
    try {
      const [savedWorld, savedLocal] = await Promise.all([
        persistence.loadWorldState(),
        persistence.loadLocalState(),
      ])
      if (savedWorld) {
        worldState = migrateWieldToActor(savedWorld)
      } else {
        worldState = migrateWieldToActor(fallbackWorldState)
      }
      if (savedLocal) {
        localState = { ...localState, ...savedLocal }
      }
    } catch (err) {
      console.warn('[persistence] load failed, using fallback state', err)
      worldState = migrateWieldToActor(fallbackWorldState)
    }
    if (stonesPerRow != null) {
      localState = { ...localState, stonesPerRow }
    }
    recompute(true)
  } else {
    worldState = migrateWieldToActor(fallbackWorldState)
    if (stonesPerRow != null) {
      localState = { ...localState, stonesPerRow }
    }
  }

  initSpacetimeDB(token)
}

self.onmessage = (event: MessageEvent<MainToWorkerMessage>) => {
  const message = event.data
  if (message.type === 'INIT') {
    setRoomIdDebugFromWorker(message.debugRoomIds ?? false)
    appRoute = message.appRoute
    currentContext = message.context
    logRoomDebug('worker INIT (context before SpacetimeDB)', {
      worldId: message.context.worldId,
      canvasId: message.context.canvasId,
      routeMode: message.appRoute.mode,
    })
    void initFromPersistence(message.worldState, message.stonesPerRow, message.token)
    return
  }
  if (message.type === 'SET_APP_ROUTE') {
    if (message.debugRoomIds != null) setRoomIdDebugFromWorker(message.debugRoomIds)
    appRoute = message.appRoute
    currentContext = message.context
    logRoomDebug('worker SET_APP_ROUTE', {
      worldId: message.context.worldId,
      canvasId: message.context.canvasId,
      routeMode: message.appRoute.mode,
    })
    setAppSubscriptionRoute(currentContext, message.appRoute.mode === 'hub' ? 'hub' : 'canvas', message.appRoute)
    refreshPresence()
    maybePushWorldHub()
    return
  }
  if (message.type === 'GET_WORLD_HUB') {
    const conn = getConnection()
    if (!conn) return
    try {
      const snapshot = buildWorldHubSnapshot(conn, currentContext, getMyIdentityHex())
      post({ type: 'WORLD_HUB', requestId: message.requestId, snapshot })
    } catch (err) {
      console.warn('[world-hub] GET_WORLD_HUB failed', err)
    }
    return
  }
  if (message.type === 'SET_WORLD_DISPLAY_NAME') {
    const conn = getConnection()
    if (!conn || !isConnected()) return
    const name = message.displayName.trim()
    if (!name) return
    void Promise.resolve(
      conn.reducers.renameWorld({
        worldId: currentContext.worldId,
        newSlug: currentContext.worldSlug,
        displayName: name,
        description: undefined,
      }),
    ).catch((err) => console.warn('[vm-worker] renameWorld failed (publish a module that includes rename_world):', err))
    return
  }
  if (message.type === 'RESET') {
    persistence.clear().catch((err) => console.warn('[persistence] clear failed', err))
    const oldWorld = worldState
    const oldLocal = localState
    worldState = migrateWieldToActor(message.worldState)
    localState = {
      hoveredSegmentId: null,
      groupPositions: {},
      groupSizeOverrides: {},
      groupListViewEnabled: {},
      nodeGroupOverrides: {},
      nodePositions: {},
      groupNodePositions: {},
      nodeSizeOverrides: {},
      freeSegmentPositions: {},
      groupFreeSegmentPositions: {},
      groupNodeOrders: {},
      customGroups: {},
      groupTitleOverrides: {},
      nodeTitleOverrides: {},
      dropIntent: null,
      stonesPerRow: message.stonesPerRow ?? 25,
      filterCategory: null,
      selectedSegmentIds: [],
      selectedNodeIds: [],
      selectedGroupIds: [],
      selectedLabelIds: [],
      nodeContainment: {},
      labels: {},
      selectedLabelId: null,
    }
    previousScene = null
    recompute(true)
    syncToSpacetimeDB(oldWorld, oldLocal)
    return
  }
  if (message.type === 'SET_STONES_PER_ROW') {
    localState = { ...localState, stonesPerRow: message.stonesPerRow }
    recompute(true)
    return
  }
  if (message.type === 'SET_SPACETIMEDB_TOKEN') {
    (globalThis as unknown as { __spacetimedb_token?: string }).__spacetimedb_token = message.token
    return
  }
  if (message.type === 'UPDATE_CURSOR') {
    updateMyCursor(message.x, message.y)
    return
  }
  if (message.type === 'SET_DISPLAY_NAME') {
    setMyDisplayName(message.name)
    return
  }
  if (message.type === 'UPDATE_CAMERA') {
    updateMyCamera(message.panX, message.panY, message.zoom)
    return
  }
  if (message.type === 'GET_ITEM_CATALOG') {
    post({
      type: 'ITEM_CATALOG',
      requestId: message.requestId,
      definitions: buildItemCatalogRows(worldState),
    })
    return
  }
  if (message.type === 'INTENT') {
    const oldWorld = worldState
    const oldLocal = localState
    applyIntent(message.intent)
    syncToSpacetimeDB(oldWorld, oldLocal)
  }
}

const DRAG_SYNC_INTERVAL_MS = 80
let dragSyncTimer: ReturnType<typeof setTimeout> | null = null
let pendingSyncSnapshot: { oldWorld: CanonicalState | null; oldLocal: WorkerLocalState } | null = null

function syncToSpacetimeDB(
  oldWorld: CanonicalState | null,
  oldLocal: WorkerLocalState,
): void {
  if (!isReducerTransportReady()) return
  if (dragActive) {
    if (!pendingSyncSnapshot) {
      pendingSyncSnapshot = { oldWorld, oldLocal }
    }
    if (!dragSyncTimer) {
      dragSyncTimer = setTimeout(flushDragSync, DRAG_SYNC_INTERVAL_MS)
    }
    return
  }
  doSync(oldWorld, oldLocal)
}

function doSync(
  oldWorld: CanonicalState | null,
  oldLocal: WorkerLocalState,
): void {
  const conn = getConnection()
  if (!conn || !worldState) return
  syncWorldState(conn, oldWorld, worldState, currentContext)
  syncLocalState(conn, oldLocal, localState, currentContext)
}

function flushDragSync(): void {
  dragSyncTimer = null
  if (!pendingSyncSnapshot) return
  const { oldWorld, oldLocal } = pendingSyncSnapshot
  pendingSyncSnapshot = null
  doSync(oldWorld, oldLocal)
}


