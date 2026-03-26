/// <reference lib="webworker" />

self.addEventListener('unhandledrejection', (event: PromiseRejectionEvent) => {
  console.error('[worker] unhandled promise rejection:', event.reason)
})

import { COIN_DENOM_CATALOG_ORDER, entryIdsForSegmentMutation } from '../domain/coinage'
import { groupSixthsByStone } from '../domain/segment-sixths-layout'
import type { Actor, CanonicalState, CoinDenom, InventoryEntry, ItemCatalogRow, ItemDefinition, ItemKind } from '../domain/types'
import { getWieldOptions, isTwoHandedOnly } from '../domain/weapon-metadata'
import { parseNodeId, segmentIdToEntryId } from '../vm/drop-intent'
import { droppedGroupIdForActor, ensureDroppedGroup } from '../vm/dropped-ground'
import { createInventoryEntryId } from '../vm/inventory-ids'
import {
  applyMoveNodeInGroup,
  applyMoveNodeToGroupIndex,
  applyMoveNodeToRoot,
  collectActorSubtreeIds,
  collectSceneSubtreeNodeIds,
} from '../vm/scene-node-mutations'
import { applyDuplicateEntryIntent, applyDuplicateNodeIntent } from '../vm/duplicate-intents'
import {
  expandDragSegmentToEntryIds,
  finalizePooledCoinageStacks,
  remapSegmentIdAfterEntryConsolidation,
  removeSegmentsFromGroupPositions,
} from '../vm/drag-segment-commit'
import { buildSegmentIdToSourceNodeId } from '../vm/segment-source-map'
import { applySpawnItemInstance } from '../vm/spawn-item-instance'
import { diffSceneVM, freeSegmentsLayoutKey } from './scene-diff'
import { addInventoryNodeToState, createInventoryActorId } from './inventory-node'
import { buildSceneVM, type WorkerLocalState } from './scene-vm'
import { parseNodeClipboardPayload, serializeNodeClipboard } from './node-clipboard'
import { canonicalizeIntentForReplay } from './replay-canonicalize'
import {
  effectiveDropIntentForDragSegmentEnd,
  type DropIntent,
  type DragSegmentEndIntent,
  type MainToWorkerMessage,
  type SceneVM,
  type WorkerIntent,
  type WorkerToMainMessage,
} from './protocol'
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
  cloneCanonicalState,
  canonicalWorldEquals,
  mergeServerLayoutWithEphemeral,
  serverPersistedFingerprint,
  stripEphemeralLocalState,
  ZERO_EPHEMERAL_LOCAL,
} from './vm-worker-rebase'
import {
  NODE_VM_TOP_BAND_H as TOP_BAND_H,
  SLOT_START_X,
  STONE_GAP,
  STONE_H,
  STONE_ROW_GAP,
  STONE_W,
} from '../shared/node-layout'
import { dropDebug, setDropDebugFromWorker } from '../shared/drop-debug'

/** Stable key for canvas-scoped room (SpacetimeDB world + canvas). */
const roomKeyForContext = (ctx: WorldCanvasContext): string => `${ctx.worldId}::${ctx.canvasId}`
const createFallbackReplayToken = (prefix: string): string =>
  `${prefix}:${Date.now().toString(36)}:${Math.random().toString(36).slice(2, 7)}`

let worldState: CanonicalState | null = null
/** Authoritative snapshot from SpacetimeDB reconstruct only (never overwritten by intents). */
let serverWorldState: CanonicalState | null = null
let serverPersistedLayout: Partial<PersistedLocalState> = {}
/** Reducer ops not yet acknowledged as reflected in serverWorldState / serverPersistedLayout. */
let pendingSyncIntents: WorkerIntent[] = []
let inReplay = false
let recomputeSuppressDepth = 0
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
  layoutExpanded: {},
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
  pasteTargetNodeId: null,
  nodeContainment: {},
  labels: {},
  selectedLabelId: null,
}
let previousScene: SceneVM | null = null
let batchDepth = 0
let pendingRecomputeAfterBatch = false
/** When set, next `recompute` that posts patches will attach snap ids for newly added inventory entries (APPLY_ADD_ITEMS_OP). */
let pendingSnapFromInventoryBeforeIntent: Set<string> | null = null
/** When set, next `recompute` that posts patches will attach snap ids for nodes pasted from node clipboard. */
let pendingSnapNodeIdsAfterPaste: string[] | null = null

const collectSnapSegmentIdsForNewEntries = (scene: SceneVM, newEntryIds: Set<string>): string[] => {
  const snap: string[] = []
  for (const node of Object.values(scene.nodes)) {
    for (const seg of node.segments) {
      if (newEntryIds.has(segmentIdToEntryId(seg.id)) || newEntryIds.has(seg.id)) {
        snap.push(seg.id)
      }
    }
  }
  for (const free of Object.values(scene.freeSegments)) {
    const id = free.id
    if (newEntryIds.has(segmentIdToEntryId(id)) || newEntryIds.has(id)) {
      snap.push(id)
    }
  }
  return snap
}

// ─── IndexedDB persistence is DISABLED ─────────────────────────────────────
// SpacetimeDB is the sole source of truth. Loading from IndexedDB on startup
// caused a flash of stale state before the server data arrived, and saving to
// it created a divergent local copy that masked sync bugs. The implementation
// is kept intact so it can be re-enabled as an offline fallback later.
const persistence: PersistenceBackend = new IndexedDBBackend()
let saveTimer: ReturnType<typeof setTimeout> | null = null
const SAVE_DEBOUNCE_MS = 500
const INDEXEDDB_ENABLED = false

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

function isSyncIntent(intent: WorkerIntent): boolean {
  switch (intent.type) {
    case 'HOVER_SEGMENT':
    case 'SET_FILTER_CATEGORY':
    case 'SET_SELECTED_SEGMENTS':
    case 'SELECT_SEGMENTS_ADD':
    case 'SELECT_SEGMENTS_REMOVE':
    case 'SET_MARQUEE_SELECTION':
    case 'SET_PASTE_TARGET_NODE':
    case 'SELECT_ALL_OF_TYPE':
    case 'SELECT_LABEL':
    case 'DRAG_SEGMENT_START':
    case 'DRAG_SEGMENT_UPDATE':
    /** Not a sync intent itself — emits APPLY_DROP_RESULT (which IS sync) after computing the drop. */
    case 'DRAG_SEGMENT_END':
    case 'DRAG_START':
    case 'DRAG_END':
      return false
    default:
      return true
  }
}

/** Rebuild working world/local from server mirrors + pending reducer intents (replay). */
function deriveWorkingFromServerAndPending(): void {
  if (!serverWorldState) return
  recomputeSuppressDepth += 1
  inReplay = true
  try {
    worldState = cloneCanonicalState(serverWorldState)
    localState = mergeServerLayoutWithEphemeral(serverPersistedLayout, localState)
    for (const intent of pendingSyncIntents) {
      applyIntent(intent)
    }
  } finally {
    inReplay = false
    recomputeSuppressDepth -= 1
  }
}

/** Clear pending when server snapshot already matches full replay (reducers echoed). */
function tryAckPendingSyncIntents(): void {
  if (pendingSyncIntents.length === 0 || !serverWorldState) return
  let replayWorld: CanonicalState | null = null
  let replayPersisted: PersistedLocalState | null = null
  recomputeSuppressDepth += 1
  inReplay = true
  const savedW = worldState
  const savedL = localState
  try {
    worldState = cloneCanonicalState(serverWorldState)
    localState = mergeServerLayoutWithEphemeral(serverPersistedLayout, savedL)
    for (const intent of pendingSyncIntents) {
      applyIntent(intent)
    }
    replayWorld = worldState
    replayPersisted = stripEphemeralLocalState(localState)
  } finally {
    worldState = savedW
    localState = savedL
    inReplay = false
    recomputeSuppressDepth -= 1
  }
  if (
    replayWorld &&
    replayPersisted &&
    canonicalWorldEquals(replayWorld, serverWorldState) &&
    serverPersistedFingerprint(serverPersistedLayout) === serverPersistedFingerprint(replayPersisted)
  ) {
    pendingSyncIntents = []
  }
}

let dragActive = false
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
    serverWorldState = migrateWieldToActor(initialWorldTemplate)
    serverPersistedLayout = {}
    pendingSyncIntents = []
    localState = {
      ...localState,
      nodePositions: {},
      groupPositions: {},
      groupSizeOverrides: {},
      nodeSizeOverrides: {},
      groupListViewEnabled: {},
      layoutExpanded: {},
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
    deriveWorkingFromServerAndPending()
    recompute()
    syncToSpacetimeDB(null, localState)
    return
  }

  serverWorldState = newWorldState
  serverPersistedLayout = { ...newLayoutState }
  tryAckPendingSyncIntents()
  deriveWorkingFromServerAndPending()
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
    // Drop server echoes that arrive mid-drag; they predate local drag changes
    // and would cause snap-back.  The next echo after the drag will be applied normally.
    return
  }
  applyServerState(newWorldState, newLayoutState)
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

const SELF_WEIGHT_TOKEN_PREFIX = '__self_weight__:'
const isSelfWeightTokenId = (segmentId: string): boolean => segmentId.startsWith(SELF_WEIGHT_TOKEN_PREFIX)

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
  readonly coinagePool?: boolean
  readonly coinDenom?: CoinDenom | ''
  readonly bundleSize?: number
  readonly minToCount?: number
  readonly sixthsPerBundle?: number
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
  const bundleSize = toOptionalPositiveNumber(patch.bundleSize)
  const minToCount =
    patch.minToCount != null && Number.isFinite(patch.minToCount) && patch.minToCount >= 1
      ? Math.floor(patch.minToCount)
      : undefined
  const sixthsPerBundle = toOptionalPositiveNumber(patch.sixthsPerBundle)
  const common: ItemDefinition = {
    ...source,
    canonicalName: trimmedName.length > 0 ? trimmedName : source.canonicalName,
    kind,
    ...(sixthsPerUnit != null ? { sixthsPerUnit } : { sixthsPerUnit: undefined }),
    ...(kind === 'armor' && armorClass != null ? { armorClass } : { armorClass: undefined }),
    ...(priceInGp != null ? { priceInGp } : { priceInGp: undefined }),
    isFungibleVisual: !!patch.isFungibleVisual,
  }
  if (kind === 'bundled') {
    return {
      ...common,
      bundleSize: bundleSize ?? 20,
      minToCount: minToCount ?? 1,
      sixthsPerBundle: sixthsPerBundle ?? 1,
      coinagePool: undefined,
      coinDenom: undefined,
    }
  }
  const resolvedCoinDenom =
    patch.coinDenom === undefined
      ? source.coinDenom
      : patch.coinDenom === ''
        ? undefined
        : patch.coinDenom
  return {
    ...common,
    bundleSize: undefined,
    minToCount: undefined,
    sixthsPerBundle: undefined,
    ...(kind === 'standard' || kind === 'coins'
      ? {
          coinagePool: patch.coinagePool !== undefined ? patch.coinagePool : source.coinagePool,
          coinDenom: resolvedCoinDenom,
        }
      : { coinagePool: undefined, coinDenom: undefined }),
  }
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
  segment: { startSixth: number; sizeSixths: number; isCoinageMerge?: boolean },
  stonesPerRow: number,
): { x: number; y: number; w: number; h: number } => {
  const { startStone, endStone } = segmentStoneSpan(segment.startSixth, segment.sizeSixths)
  if (isMultiStone(segment.sizeSixths) && !segment.isCoinageMerge) {
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
    maxY = Math.max(maxY, y + g.heightSixths * CELL_H)
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

function normalizeFreeDropPositionKeys(
  raw: Readonly<Record<string, { x: number; y: number }>>,
  originalSegmentIds: readonly string[],
  entryRemap: ReadonlyMap<string, string>,
): Record<string, { x: number; y: number }> {
  const out: Record<string, { x: number; y: number }> = {}

  for (const sid of originalSegmentIds) {
    const ns = remapSegmentIdAfterEntryConsolidation(sid, entryRemap)
    let p = raw[sid] ?? raw[ns]
    if (p == null) {
      for (const [k, v] of Object.entries(raw)) {
        if (remapSegmentIdAfterEntryConsolidation(k, entryRemap) === ns) {
          p = v
          break
        }
      }
    }
    if (p != null) out[ns] = { x: p.x, y: p.y }
  }

  return out
}

const resolveFreeDropLayoutFromIntent = (
  intent: { readonly freeSegmentPositions?: Readonly<Record<string, { x: number; y: number }>> | null },
  segmentIds: readonly string[],
  scene: SceneVM,
  anchorX: number,
  anchorY: number,
  stonesPerRow: number,
): Record<string, { x: number; y: number }> => {
  const raw = intent.freeSegmentPositions
  const complete =
    raw != null &&
    segmentIds.length > 0 &&
    segmentIds.every((id) => raw[id] != null)
  if (complete) {
    const out: Record<string, { x: number; y: number }> = {}
    for (const id of segmentIds) {
      const p = raw[id]!
      out[id] = { x: p.x, y: p.y }
    }
    dropDebug('worker:resolve:layout', {
      complete: true,
      layoutSegmentIds: segmentIds,
      missingIds: [],
      receivedKeyCount: raw ? Object.keys(raw).length : 0,
      receivedKeys: raw ? Object.keys(raw) : [],
    })
    return out
  }
  const missingIds = segmentIds.filter((id) => raw?.[id] == null)
  dropDebug('worker:resolve:layout', {
    complete: false,
    layoutSegmentIds: segmentIds,
    missingIds,
    receivedKeyCount: raw ? Object.keys(raw).length : 0,
    receivedKeys: raw != null ? Object.keys(raw) : [],
    rawWasNullish: raw == null,
    fallbackPack: true,
  })
  debugDrag('free drop layout: missing or incomplete freeSegmentPositions from renderer; using fallback packer', {
    segmentIds,
    receivedKeys: raw != null ? Object.keys(raw) : [],
    rawWasNullish: raw == null,
  })
  console.warn('[vm-worker] unexpected missing freeSegmentPositions for free drop; using fallback packer', {
    segmentIds,
    receivedKeys: raw != null ? Object.keys(raw) : [],
  })
  return computeDroppedFreeSegmentPositions(scene, segmentIds, anchorX, anchorY, stonesPerRow)
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

const defToCatalogRow = (d: ItemDefinition): ItemCatalogRow => ({
  id: d.id,
  canonicalName: d.canonicalName,
  kind: d.kind,
  ...(d.sixthsPerUnit !== undefined ? { sixthsPerUnit: d.sixthsPerUnit } : {}),
  ...(d.armorClass !== undefined ? { armorClass: d.armorClass } : {}),
  ...(d.priceInGp !== undefined ? { priceInGp: d.priceInGp } : {}),
  ...(d.coinagePool !== undefined ? { coinagePool: d.coinagePool } : {}),
  ...(d.coinDenom !== undefined ? { coinDenom: d.coinDenom } : {}),
  ...(d.bundleSize !== undefined ? { bundleSize: d.bundleSize } : {}),
  ...(d.minToCount !== undefined ? { minToCount: d.minToCount } : {}),
  ...(d.sixthsPerBundle !== undefined ? { sixthsPerBundle: d.sixthsPerBundle } : {}),
})

const buildItemCatalogRows = (state: CanonicalState | null): readonly ItemCatalogRow[] => {
  if (!state) return []
  const denomSet = new Set(COIN_DENOM_CATALOG_ORDER)
  const denomRows = COIN_DENOM_CATALOG_ORDER.map((id) => state.itemDefinitions[id])
    .filter((d): d is ItemDefinition => d != null)
    .map(defToCatalogRow)
  const defs = Object.values(state.itemDefinitions).filter((d) => !denomSet.has(d.id))
  defs.sort((a, b) => {
    const byName = a.canonicalName.localeCompare(b.canonicalName)
    if (byName !== 0) return byName
    return a.id.localeCompare(b.id)
  })
  const restRows = defs.map(defToCatalogRow)
  return [...denomRows, ...restRows]
}

const recompute = (sendInitIfFirst = false): void => {
  if (recomputeSuppressDepth > 0) return
  if (!worldState) return
  if (!sendInitIfFirst && batchDepth > 0) {
    pendingRecomputeAfterBatch = true
    return
  }
  const nextScene = buildSceneVM(worldState, localState)

  if (sendInitIfFirst || !previousScene) {
    previousScene = nextScene
    pendingSnapFromInventoryBeforeIntent = null
    pendingSnapNodeIdsAfterPaste = null
    post({ type: 'SCENE_INIT', scene: nextScene })
    scheduleSave()
    return
  }

  const patches = diffSceneVM(previousScene, nextScene)
  previousScene = nextScene
  let snapSegmentIds: string[] | undefined
  if (pendingSnapFromInventoryBeforeIntent) {
    const beforeIds = pendingSnapFromInventoryBeforeIntent
    pendingSnapFromInventoryBeforeIntent = null
    const newEntryIds = new Set(Object.keys(worldState.inventoryEntries).filter((id) => !beforeIds.has(id)))
    snapSegmentIds = collectSnapSegmentIdsForNewEntries(nextScene, newEntryIds)
    if (snapSegmentIds.length === 0) snapSegmentIds = undefined
  }
  let snapNodeIds: string[] | undefined
  if (pendingSnapNodeIdsAfterPaste) {
    snapNodeIds = pendingSnapNodeIdsAfterPaste
    pendingSnapNodeIdsAfterPaste = null
    if (snapNodeIds.length === 0) snapNodeIds = undefined
  }
  const hasSnap = (snapSegmentIds?.length ?? 0) > 0 || (snapNodeIds?.length ?? 0) > 0
  const postedPatches = patches.length > 0 || hasSnap
  if (postedPatches) {
    dropDebug('worker:recompute:emit', {
      patchCount: patches.length,
      patchTypes: patches.map((p) => p.type),
      hasSnap,
      freeLayoutKey: freeSegmentsLayoutKey(nextScene),
    })
    post({
      type: 'SCENE_PATCHES',
      patches: patches.length > 0 ? patches : [],
      scene: nextScene,
      ...(snapSegmentIds?.length ? { snapSegmentIds } : {}),
      ...(snapNodeIds?.length ? { snapNodeIds } : {}),
    })
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

const withReplayBaseState = <T>(fn: (state: CanonicalState, ls: WorkerLocalState) => T): T | null => {
  if (!serverWorldState) return null
  recomputeSuppressDepth += 1
  inReplay = true
  const savedW = worldState
  const savedL = localState
  try {
    worldState = cloneCanonicalState(serverWorldState)
    localState = mergeServerLayoutWithEphemeral(serverPersistedLayout, savedL)
    for (const pending of pendingSyncIntents) {
      applyIntent(pending)
    }
    return fn(worldState, localState)
  } finally {
    worldState = savedW
    localState = savedL
    inReplay = false
    recomputeSuppressDepth -= 1
  }
}

/**
 * Compute the APPLY_DROP_RESULT payload from a DRAG_SEGMENT_END.
 *
 * Runs the complex drop logic (source resolution, entry moves, coinage
 * consolidation, layout computation) on a temporary copy of worldState,
 * then extracts the minimal idempotent result.  The caller emits this
 * as a sync intent so the mutations survive replay.
 */
function computeDropResult(
  ws: CanonicalState,
  ls: WorkerLocalState,
  dropIntent: DropIntent,
  hoverTargetNodeId: string | null,
  hoverTargetGroupId: string | null,
  intent: DragSegmentEndIntent,
): Extract<WorkerIntent, { type: 'APPLY_DROP_RESULT' }> | null {
  const { segmentIds, sourceNodeIds } = dropIntent

  // Payload accumulators
  const entryUpdates: Record<string, { actorId: string; carryGroupId?: string; zone: import('../domain/types').CarryZone; state?: import('../domain/types').EquipmentState }> = {}
  const deleteEntryIds: string[] = []
  const quantityUpdates: Record<string, number> = {}
  const clearWields: { actorId: string; entryId: string }[] = []
  const ensureGroups: { id: string; ownerActorId: string }[] = []
  let freeSegmentPositions: Record<string, { x: number; y: number }> = {}
  let groupFreeSegmentPositions: Record<string, Record<string, { x: number; y: number }>> = {}

  // ── Node drop path ───────────────────────────────────────────────
  if (hoverTargetNodeId) {
    const target = parseNodeId(hoverTargetNodeId)
    let tmpWs = ws
    for (const segmentId of segmentIds) {
      const sourceNodeId = sourceNodeIds[segmentId]
      if (!sourceNodeId) continue
      const source = parseNodeId(sourceNodeId)
      if (source.actorId === target.actorId && source.carryGroupId === target.carryGroupId) continue
      const entryIds = expandDragSegmentToEntryIds(tmpWs, segmentId, sourceNodeId)
      for (const entryId of entryIds) {
        const entry: InventoryEntry | undefined = tmpWs.inventoryEntries[entryId]
        if (!entry) continue
        const zone = target.carryGroupId ? 'dropped' as const : 'stowed' as const
        const state = target.carryGroupId
          ? { ...(entry.state ?? {}), dropped: true }
          : (() => {
              const next = { ...(entry.state ?? {}) }
              delete next.dropped
              return Object.keys(next).length > 0 ? next : undefined
            })()
        if (target.carryGroupId) {
          const gid = target.carryGroupId
          if (!tmpWs.carryGroups[gid]) {
            ensureGroups.push({ id: gid, ownerActorId: target.actorId })
            tmpWs = { ...tmpWs, carryGroups: { ...tmpWs.carryGroups, [gid]: { id: gid, ownerActorId: target.actorId, name: 'Ground', dropped: true } } }
          }
        }
        entryUpdates[entryId] = { actorId: target.actorId, carryGroupId: target.carryGroupId, zone, state }
        tmpWs = { ...tmpWs, inventoryEntries: { ...tmpWs.inventoryEntries, [entryId]: { ...entry, actorId: target.actorId, carryGroupId: target.carryGroupId, zone, state } } }
        // Clear wield if entry was wielded
        const actor: Actor | undefined = tmpWs.actors[source.actorId]
        if (actor && (actor.leftWieldingEntryId === entryId || actor.rightWieldingEntryId === entryId)) {
          clearWields.push({ actorId: source.actorId, entryId })
        }
      }
    }
    // Coinage consolidation after node drop
    const finDrop = finalizePooledCoinageStacks(tmpWs, ls)
    collectCoinageConsolidation(ws, finDrop.worldState, finDrop.entryRemapToKeeper, deleteEntryIds, quantityUpdates)
    debugDrag('handled as node drop → APPLY_DROP_RESULT', { hoverTargetNodeId, segmentIds })
    return {
      type: 'APPLY_DROP_RESULT',
      entryUpdates,
      deleteEntryIds,
      quantityUpdates,
      clearWields,
      ensureGroups,
      freeSegmentPositions,
      groupFreeSegmentPositions,
      removeFromFreePositions: [...segmentIds],
    }
  }

  // ── Canvas / absolute drop path ──────────────────────────────────
  if (intent.x == null || intent.y == null) return null

  const firstSourceNodeId = segmentIds[0] ? sourceNodeIds[segmentIds[0]] : null
  const source = firstSourceNodeId ? parseNodeId(firstSourceNodeId) : null

  if (source) {
    let tmpWs = ws
    for (const segmentId of segmentIds) {
      const sourceNodeId = sourceNodeIds[segmentId]
      if (!sourceNodeId) continue
      const parsedSource = parseNodeId(sourceNodeId)
      const entryIds = expandDragSegmentToEntryIds(tmpWs, segmentId, sourceNodeId)
      for (const entryId of entryIds) {
        const entry: InventoryEntry | undefined = tmpWs.inventoryEntries[entryId]
        if (!entry) continue
        const gid = droppedGroupIdForActor(parsedSource.actorId)
        if (!tmpWs.carryGroups[gid]) {
          ensureGroups.push({ id: gid, ownerActorId: parsedSource.actorId })
          tmpWs = ensureDroppedGroup(tmpWs, parsedSource.actorId)
        }
        const movedState = { ...(entry.state ?? {}), dropped: true }
        entryUpdates[entryId] = { actorId: parsedSource.actorId, carryGroupId: gid, zone: 'dropped', state: movedState }
        tmpWs = { ...tmpWs, inventoryEntries: { ...tmpWs.inventoryEntries, [entryId]: { ...entry, actorId: parsedSource.actorId, carryGroupId: gid, zone: 'dropped', state: movedState } } }
        const actor: Actor | undefined = tmpWs.actors[parsedSource.actorId]
        if (actor && (actor.leftWieldingEntryId === entryId || actor.rightWieldingEntryId === entryId)) {
          clearWields.push({ actorId: parsedSource.actorId, entryId })
        }
      }
    }

    // Coinage consolidation
    const finDrop = finalizePooledCoinageStacks(tmpWs, ls)
    collectCoinageConsolidation(ws, finDrop.worldState, finDrop.entryRemapToKeeper, deleteEntryIds, quantityUpdates)
    tmpWs = finDrop.worldState
    const tmpLs = finDrop.localState
    const layoutSegmentIds = segmentIds.map((sid) =>
      remapSegmentIdAfterEntryConsolidation(sid, finDrop.entryRemapToKeeper),
    )

    // Compute layout positions
    const sceneAfterDrop = buildSceneVM(tmpWs, tmpLs)
    const normalizedFreePositions =
      intent.freeSegmentPositions != null
        ? normalizeFreeDropPositionKeys(intent.freeSegmentPositions, segmentIds, finDrop.entryRemapToKeeper)
        : undefined

    const sceneAtDrop = buildSceneVM(ws, ls)
    const targetGroup = hoverTargetGroupId ? sceneAtDrop.groups[hoverTargetGroupId] : null
    const groupCanAcceptSegments = !!targetGroup

    dropDebug('worker:drag_end:absolute', {
      segmentIds,
      layoutSegmentIds,
      intentXY: { x: intent.x, y: intent.y },
      hoverTargetGroupId,
      groupCanAcceptSegments,
    })

    const layoutIntentForResolve =
      normalizedFreePositions != null
        ? { ...intent, freeSegmentPositions: normalizedFreePositions }
        : intent
    const droppedLayout = resolveFreeDropLayoutFromIntent(
      layoutIntentForResolve,
      layoutSegmentIds,
      sceneAfterDrop,
      intent.x,
      intent.y,
      ls.stonesPerRow,
    )

    if (groupCanAcceptSegments && targetGroup && hoverTargetGroupId) {
      const gfsp: Record<string, { x: number; y: number }> = {}
      for (const segmentId of layoutSegmentIds) {
        const nextPos = droppedLayout[segmentId] ?? { x: intent.x, y: intent.y }
        gfsp[segmentId] = { x: nextPos.x - targetGroup.x, y: nextPos.y - targetGroup.y }
      }
      groupFreeSegmentPositions = { [hoverTargetGroupId]: gfsp }
    } else {
      for (const segmentId of layoutSegmentIds) {
        const nextPos = droppedLayout[segmentId] ?? { x: intent.x, y: intent.y }
        freeSegmentPositions[segmentId] = nextPos
      }
    }

    debugDrag('handled as absolute drop → APPLY_DROP_RESULT', {
      sourceActorId: source.actorId,
      segmentIds,
    })
  } else if (intent.freeSegmentPositions) {
    // Source unresolved (free segment already in absolute space) — just persist positions
    for (const segmentId of segmentIds) {
      const nextPos = intent.freeSegmentPositions[segmentId]
      if (nextPos) freeSegmentPositions[segmentId] = nextPos
    }
    debugDrag('handled as absolute drop with source fallback → APPLY_DROP_RESULT', { segmentIds })
  } else {
    debugDrag('absolute drop path reached but nothing persisted', { segmentIds })
    return null
  }

  return {
    type: 'APPLY_DROP_RESULT',
    entryUpdates,
    deleteEntryIds,
    quantityUpdates,
    clearWields,
    ensureGroups,
    freeSegmentPositions,
    groupFreeSegmentPositions,
    removeFromFreePositions: [...segmentIds],
  }
}

/** Extract coinage consolidation diffs (deleted entries, quantity changes). */
function collectCoinageConsolidation(
  wsBefore: CanonicalState,
  wsAfter: CanonicalState,
  entryRemap: ReadonlyMap<string, string>,
  deleteEntryIds: string[],
  quantityUpdates: Record<string, number>,
): void {
  for (const [removedId, keeperId] of entryRemap) {
    if (!wsAfter.inventoryEntries[removedId] && wsBefore.inventoryEntries[removedId]) {
      deleteEntryIds.push(removedId)
    }
    const keeper = wsAfter.inventoryEntries[keeperId]
    const keeperBefore = wsBefore.inventoryEntries[keeperId]
    if (keeper && keeperBefore && keeper.quantity !== keeperBefore.quantity) {
      quantityUpdates[keeperId] = keeper.quantity
    }
  }
}

const applyIntent = (intent: WorkerIntent): void => {
  if (!inReplay && isSyncIntent(intent)) {
    if (intent.type === 'SET_WORLD_STATE') {
      pendingSyncIntents = []
    }
    const stored: WorkerIntent = canonicalizeIntentForReplay(intent, {
      localDropIntent: localState.dropIntent,
      deriveReplayBase: () =>
        withReplayBaseState((state, ls) => ({
          worldState: state,
          localState: ls,
        })),
    })
    pendingSyncIntents.push(stored)
    deriveWorkingFromServerAndPending()
    recompute()
    return
  }

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
      const empty =
        intent.selection.segmentIds.length === 0 &&
        intent.selection.nodeIds.length === 0 &&
        intent.selection.groupIds.length === 0 &&
        intent.selection.labelIds.length === 0
      let nextPasteTarget = localState.pasteTargetNodeId
      if (empty) {
        nextPasteTarget = null
      } else if (
        intent.selection.segmentIds.length === 0 &&
        intent.selection.nodeIds.length === 1 &&
        intent.selection.groupIds.length === 0 &&
        intent.selection.labelIds.length === 0
      ) {
        nextPasteTarget = intent.selection.nodeIds[0] ?? null
      }
      localState = {
        ...localState,
        selectedSegmentIds: [...intent.selection.segmentIds],
        selectedNodeIds: [...intent.selection.nodeIds],
        selectedGroupIds: [...intent.selection.groupIds],
        selectedLabelIds: [...intent.selection.labelIds],
        selectedLabelId: intent.selection.labelIds[0] ?? null,
        pasteTargetNodeId: nextPasteTarget,
      }
    }
    recompute()
    return
  }

  if (intent.type === 'SET_PASTE_TARGET_NODE') {
    localState = { ...localState, pasteTargetNodeId: intent.nodeId }
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

  if (intent.type === 'SET_LAYOUT_EXPANDED') {
    const nextLayoutExpanded = { ...localState.layoutExpanded }
    if (intent.expanded) nextLayoutExpanded[intent.containerId] = true
    else delete nextLayoutExpanded[intent.containerId]
    localState = { ...localState, layoutExpanded: nextLayoutExpanded }
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
    const groupId = intent.replay?.groupId ?? createFallbackReplayToken('custom-group')
    const title = intent.replay?.groupTitle ?? `Group ${Object.keys(localState.customGroups).length + 1}`
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
    const nextLayoutExpanded = { ...localState.layoutExpanded }
    delete nextLayoutExpanded[groupId]
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
      layoutExpanded: nextLayoutExpanded,
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
      replayActorId: intent.replay?.actorId ?? intent.replayActorId,
      replayActorName: intent.replay?.actorName ?? intent.replayActorName,
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
    const applied = applyMoveNodeToGroupIndex(worldState, localState, intent)
    worldState = applied.worldState
    localState = applied.localState
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
    const applied = applyMoveNodeInGroup(worldState, localState, intent)
    worldState = applied.worldState
    localState = applied.localState
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
    const applied = applyMoveNodeToRoot(worldState, localState, intent)
    worldState = applied.worldState
    localState = applied.localState
    debugDrag('MOVE_NODE_TO_ROOT applied', {
      nodeId: intent.nodeId,
      persistedPosition: localState.nodePositions[intent.nodeId],
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
    const segToNode = buildSegmentIdToSourceNodeId(worldState)
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
        targetNodeId: firstSource ?? null,
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

  // ── DRAG_SEGMENT_END ──────────────────────────────────────────────
  // Complex, non-idempotent: resolves drop context, computes layout, then
  // emits an APPLY_DROP_RESULT sync intent that captures the minimal,
  // idempotent result.  This way the worldState mutations survive replay.
  //
  // TODO: long-term the renderer should send a high-level "move items to
  // location" intent instead of DRAG_SEGMENT_END.  This intermediate
  // APPLY_DROP_RESULT bridges the gap.
  if (intent.type === 'DRAG_SEGMENT_END') {
    const effectiveDropIntent = effectiveDropIntentForDragSegmentEnd(localState.dropIntent, intent)
    const hoverTargetNodeId = effectiveDropIntent ? intent.targetNodeId : null
    const hoverTargetGroupId = effectiveDropIntent ? intent.targetGroupId ?? null : null
    debugDrag('DRAG_SEGMENT_END received', {
      targetNodeId: intent.targetNodeId,
      targetGroupId: intent.targetGroupId,
      hoverTargetNodeId,
      hoverTargetGroupId,
      x: intent.x,
      y: intent.y,
      hasFreeSegmentPositions: !!intent.freeSegmentPositions,
      freeSegmentPositionCount: intent.freeSegmentPositions ? Object.keys(intent.freeSegmentPositions).length : 0,
      segmentIds: effectiveDropIntent?.segmentIds ?? [],
    })

    // Compute drop result on a temporary copy of worldState so we can
    // extract the APPLY_DROP_RESULT payload without relying on inline
    // mutations that would be lost after derive.
    const dropResult = effectiveDropIntent && worldState
      ? computeDropResult(worldState, localState, effectiveDropIntent, hoverTargetNodeId, hoverTargetGroupId, intent)
      : null

    // Clear ephemeral drop state before emitting the sync intent
    localState = { ...localState, dropIntent: null }
    debugDrag('dropIntent cleared after drag end')

    if (dropResult) {
      // Emit the replayable sync intent — applyIntent handles derive + recompute
      applyIntent(dropResult)
    } else {
      recompute()
    }
    return
  }

  // ── APPLY_DROP_RESULT ────────────────────────────────────────────
  // Idempotent sync intent: applies the resolved entry moves, wield
  // clears, coinage consolidation, and free-segment positions that were
  // computed by DRAG_SEGMENT_END.  Safe to replay N times.
  if (intent.type === 'APPLY_DROP_RESULT') {
    if (!worldState) { recompute(); return }

    // 1. Ensure dropped carry groups exist
    for (const g of intent.ensureGroups) {
      if (!worldState.carryGroups[g.id]) {
        worldState = {
          ...worldState,
          carryGroups: {
            ...worldState.carryGroups,
            [g.id]: { id: g.id, ownerActorId: g.ownerActorId, name: 'Ground', dropped: true },
          },
        }
      }
    }

    // 2. Apply entry zone/actor/group moves
    let entries = worldState.inventoryEntries
    for (const [entryId, update] of Object.entries(intent.entryUpdates)) {
      const entry = entries[entryId]
      if (!entry) continue
      entries = {
        ...entries,
        [entryId]: {
          ...entry,
          actorId: update.actorId,
          carryGroupId: update.carryGroupId,
          zone: update.zone,
          state: update.state,
        },
      }
    }

    // 3. Apply quantity updates (coinage keeper entries after consolidation)
    for (const [entryId, qty] of Object.entries(intent.quantityUpdates)) {
      const entry = entries[entryId]
      if (entry) entries = { ...entries, [entryId]: { ...entry, quantity: qty } }
    }

    // 4. Delete entries removed by coinage consolidation
    for (const entryId of intent.deleteEntryIds) {
      if (entries[entryId]) {
        const { [entryId]: _, ...rest } = entries
        entries = rest
      }
    }
    worldState = { ...worldState, inventoryEntries: entries }

    // 5. Clear wield slots
    for (const { actorId, entryId } of intent.clearWields) {
      const actor: Actor | undefined = worldState.actors[actorId]
      if (!actor) continue
      if (actor.leftWieldingEntryId === entryId || actor.rightWieldingEntryId === entryId) {
        worldState = {
          ...worldState,
          actors: {
            ...worldState.actors,
            [actorId]: {
              ...actor,
              leftWieldingEntryId: actor.leftWieldingEntryId === entryId ? undefined : actor.leftWieldingEntryId,
              rightWieldingEntryId: actor.rightWieldingEntryId === entryId ? undefined : actor.rightWieldingEntryId,
            },
          },
        }
      }
    }

    // 6. Update localState free-segment positions
    const freePos = { ...localState.freeSegmentPositions }
    const groupFreePos: Record<string, Record<string, { x: number; y: number }>> = {
      ...localState.groupFreeSegmentPositions,
    }
    for (const segId of intent.removeFromFreePositions) {
      delete freePos[segId]
      for (const gid of Object.keys(groupFreePos)) {
        if (groupFreePos[gid]?.[segId]) {
          const { [segId]: _, ...rest } = groupFreePos[gid]!
          groupFreePos[gid] = rest
        }
      }
    }
    Object.assign(freePos, intent.freeSegmentPositions)
    for (const [gid, inner] of Object.entries(intent.groupFreeSegmentPositions)) {
      groupFreePos[gid] = { ...(groupFreePos[gid] ?? {}), ...inner }
    }
    localState = { ...localState, freeSegmentPositions: freePos, groupFreeSegmentPositions: groupFreePos }

    recompute()
    return
  }

  if (intent.type === 'SPAWN_ITEM_INSTANCE') {
    if (!worldState) {
      recompute()
      return
    }
    const applied = applySpawnItemInstance(worldState, localState, intent)
    worldState = applied.worldState
    localState = applied.localState
    recompute()
    return
  }

  if (intent.type === 'APPLY_ADD_ITEMS_OP') {
    if (worldState) {
      pendingSnapFromInventoryBeforeIntent = new Set(Object.keys(worldState.inventoryEntries))
    }
    const replayByItem = intent.replay?.spawnEntryIdsByItem ?? []
    runIntentBatch(intent.items.map((item, idx) => ({
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
      coinagePool: item.coinagePool,
      coinDenom: item.coinDenom,
      bundleSize: item.bundleSize,
      minToCount: item.minToCount,
      sixthsPerBundle: item.sixthsPerBundle,
      replay: replayByItem[idx] ? { entryIds: replayByItem[idx] } : undefined,
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
    const finMove = finalizePooledCoinageStacks(worldState, localState)
    worldState = finMove.worldState
    localState = finMove.localState
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
      layoutExpanded: Object.fromEntries(
        Object.entries(localState.layoutExpanded).filter(([id]) => id !== actorId),
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
    const r = applyDuplicateNodeIntent(worldState, localState, intent)
    worldState = r.worldState
    localState = r.localState
    recompute()
    return
  }

  if (intent.type === 'DUPLICATE_ENTRY') {
    if (!worldState) return
    const r = applyDuplicateEntryIntent(worldState, localState, intent)
    worldState = r.worldState
    localState = r.localState
    recompute()
    return
  }

  if (intent.type === 'DELETE_ENTRY') {
    if (!worldState) return
    const entryIdsToRemove = new Set<string>()
    for (const segmentId of intent.segmentIds.filter((id) => !isSelfWeightTokenId(id))) {
      for (const entryId of entryIdsForSegmentMutation(worldState, segmentId)) {
        if (worldState.inventoryEntries[entryId]) entryIdsToRemove.add(entryId)
      }
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
    const labelId = intent.replay?.labelId ?? createFallbackReplayToken('label')
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

  if (intent.type === 'PASTE_NODE_CLIPBOARD') {
    if (!worldState) return
    const doc = parseNodeClipboardPayload(intent.payload)
    if (!doc) {
      recompute()
      return
    }
    const sceneBefore = buildSceneVM(worldState, localState)
    let ws: CanonicalState = {
      ...worldState,
      itemDefinitions: { ...worldState.itemDefinitions, ...doc.itemDefinitions },
    }
    const actorIdMap = new Map<string, string>()
    for (const oldId of Object.keys(doc.actors)) {
      actorIdMap.set(oldId, createInventoryActorId(ws, Date.now, Math.random))
    }
    const carryGroupIdMap = new Map<string, string>()
    for (const cg of Object.values(doc.carryGroups)) {
      const newOwner = actorIdMap.get(cg.ownerActorId)
      if (!newOwner) continue
      const newCgId = droppedGroupIdForActor(newOwner)
      const oldCgId = cg.id
      carryGroupIdMap.set(oldCgId, newCgId)
    }
    const nextActors = { ...ws.actors }
    for (const [oldId, actor] of Object.entries(doc.actors)) {
      const newId = actorIdMap.get(oldId)
      if (!newId) continue
      const owner = actor.ownerActorId ? actorIdMap.get(actor.ownerActorId) : undefined
      nextActors[newId] = {
        ...actor,
        id: newId,
        ownerActorId: owner,
        leftWieldingEntryId: undefined,
        rightWieldingEntryId: undefined,
      }
      ws = ensureDroppedGroup(ws, newId)
    }
    ws = { ...ws, actors: { ...ws.actors, ...nextActors } }
    const nextCarry = { ...ws.carryGroups }
    for (const [oldCgId, cg] of Object.entries(doc.carryGroups)) {
      const newCgId = carryGroupIdMap.get(oldCgId)
      if (!newCgId) continue
      const newOwner = actorIdMap.get(cg.ownerActorId)
      if (!newOwner) continue
      nextCarry[newCgId] = { ...cg, id: newCgId, ownerActorId: newOwner }
    }
    ws = { ...ws, carryGroups: nextCarry }
    const entryIdMap = new Map<string, string>()
    let nextEntries = { ...ws.inventoryEntries }
    for (const entry of Object.values(doc.inventoryEntries)) {
      const newActorId = actorIdMap.get(entry.actorId)
      if (!newActorId) continue
      const newEntryId = createInventoryEntryId(ws, entry.itemDefId)
      entryIdMap.set(entry.id, newEntryId)
      let cgId = entry.carryGroupId
      if (cgId) {
        cgId = carryGroupIdMap.get(cgId) ?? cgId
      }
      nextEntries = {
        ...nextEntries,
        [newEntryId]: {
          ...entry,
          id: newEntryId,
          actorId: newActorId,
          carryGroupId: cgId,
        },
      }
    }
    ws = { ...ws, inventoryEntries: nextEntries }
    for (const [oldId, actor] of Object.entries(doc.actors)) {
      const newId = actorIdMap.get(oldId)
      if (!newId) continue
      const a = ws.actors[newId]
      if (!a) continue
      const lw = actor.leftWieldingEntryId ? entryIdMap.get(actor.leftWieldingEntryId) : undefined
      const rw = actor.rightWieldingEntryId ? entryIdMap.get(actor.rightWieldingEntryId) : undefined
      if (lw !== undefined || rw !== undefined) {
        ws = {
          ...ws,
          actors: {
            ...ws.actors,
            [newId]: { ...a, ...(lw !== undefined ? { leftWieldingEntryId: lw } : {}), ...(rw !== undefined ? { rightWieldingEntryId: rw } : {}) },
          },
        }
      }
    }
    let nextLocal: WorkerLocalState = { ...localState }
    const remapKey = (id: string): string | undefined => actorIdMap.get(id)
    for (const [k, v] of Object.entries(doc.local.nodeGroupOverrides)) {
      const nk = remapKey(k)
      if (nk) nextLocal = { ...nextLocal, nodeGroupOverrides: { ...nextLocal.nodeGroupOverrides, [nk]: v } }
    }
    for (const [k, v] of Object.entries(doc.local.nodePositions)) {
      const nk = remapKey(k)
      if (nk) nextLocal = { ...nextLocal, nodePositions: { ...nextLocal.nodePositions, [nk]: v } }
    }
    for (const [k, v] of Object.entries(doc.local.nodeSizeOverrides)) {
      const nk = remapKey(k)
      if (nk) nextLocal = { ...nextLocal, nodeSizeOverrides: { ...nextLocal.nodeSizeOverrides, [nk]: v } }
    }
    for (const [k, v] of Object.entries(doc.local.layoutExpanded)) {
      const nk = remapKey(k)
      if (nk) nextLocal = { ...nextLocal, layoutExpanded: { ...nextLocal.layoutExpanded, [nk]: v } }
    }
    for (const [k, v] of Object.entries(doc.local.nodeTitleOverrides)) {
      const nk = remapKey(k)
      if (nk) nextLocal = { ...nextLocal, nodeTitleOverrides: { ...nextLocal.nodeTitleOverrides, [nk]: v } }
    }
    const nextContain: Record<string, string> = { ...nextLocal.nodeContainment }
    for (const [c, t] of Object.entries(doc.local.nodeContainment)) {
      const nc = remapKey(c)
      const nt = remapKey(t)
      if (nc && nt) nextContain[nc] = nt
    }
    nextLocal = { ...nextLocal, nodeContainment: nextContain }
    for (const [gid, pos] of Object.entries(doc.local.groupNodePositions)) {
      const nextPos: Record<string, { x: number; y: number }> = { ...(nextLocal.groupNodePositions[gid] ?? {}) }
      for (const [aid, p] of Object.entries(pos)) {
        const na = remapKey(aid)
        if (na) nextPos[na] = p
      }
      nextLocal = { ...nextLocal, groupNodePositions: { ...nextLocal.groupNodePositions, [gid]: nextPos } }
    }
    const newRoots = doc.rootNodeIds.map((r) => actorIdMap.get(r)).filter((x): x is string => !!x)
    const targetNode = intent.targetNodeId ? sceneBefore.nodes[intent.targetNodeId] : null
    const groupId = targetNode?.groupId ?? null
    const pasteWorldX = typeof intent.worldX === 'number' ? intent.worldX : 120
    const pasteWorldY = typeof intent.worldY === 'number' ? intent.worldY : 120
    const hasPastePoint = typeof intent.worldX === 'number' && typeof intent.worldY === 'number'
    if (groupId && targetNode && newRoots.length > 0) {
      const groupScene = sceneBefore.groups[groupId]
      const listViewEnabled = groupScene?.listViewEnabled === true
      const tActor = targetNode.actorId
      const sourceGroupPositions = nextLocal.groupNodePositions[groupId] ?? {}
      const sourceRelativePos = sourceGroupPositions[tActor] ?? { x: 40, y: 60 }
      const gPos = { ...sourceGroupPositions }
      const useMouseInGroup = hasPastePoint && groupScene && !listViewEnabled
      if (useMouseInGroup) {
        newRoots.forEach((rid, i) => {
          gPos[rid] = {
            x: pasteWorldX - groupScene!.x + i * 28,
            y: pasteWorldY - groupScene!.y + i * 16,
          }
        })
      } else {
        newRoots.forEach((rid, i) => {
          gPos[rid] = { x: sourceRelativePos.x + 40 + i * 28, y: sourceRelativePos.y + 50 + i * 16 }
        })
      }
      const order = [...(nextLocal.groupNodeOrders[groupId] ?? [])]
      newRoots.forEach((rid) => {
        if (!order.includes(rid)) order.push(rid)
      })
      nextLocal = {
        ...nextLocal,
        nodeGroupOverrides: { ...nextLocal.nodeGroupOverrides, ...Object.fromEntries(newRoots.map((r) => [r, groupId])) },
        groupNodePositions: { ...nextLocal.groupNodePositions, [groupId]: gPos },
        groupNodeOrders: { ...nextLocal.groupNodeOrders, [groupId]: order },
        selectedSegmentIds: newRoots.length > 0 ? [] : nextLocal.selectedSegmentIds,
      }
    } else if (newRoots.length > 0) {
      const np = { ...nextLocal.nodePositions }
      newRoots.forEach((rid, i) => {
        np[rid] = { x: pasteWorldX + i * 40, y: pasteWorldY + i * 24 }
      })
      nextLocal = {
        ...nextLocal,
        nodePositions: np,
        nodeGroupOverrides: { ...nextLocal.nodeGroupOverrides, ...Object.fromEntries(newRoots.map((r) => [r, null])) },
      }
    }
    worldState = ws
    localState = nextLocal
    pendingSnapNodeIdsAfterPaste = newRoots.length > 0 ? [...newRoots] : null
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
    serverWorldState = worldState
    serverPersistedLayout = stripEphemeralLocalState(localState)
    pendingSyncIntents = []
    recompute(true)
  } else {
    worldState = migrateWieldToActor(fallbackWorldState)
    if (stonesPerRow != null) {
      localState = { ...localState, stonesPerRow }
    }
    serverWorldState = worldState
    serverPersistedLayout = stripEphemeralLocalState(localState)
    pendingSyncIntents = []
  }

  initSpacetimeDB(token)
}

self.onmessage = (event: MessageEvent<MainToWorkerMessage>) => {
  const message = event.data
  if (message.type === 'INIT') {
    setRoomIdDebugFromWorker(message.debugRoomIds ?? false)
    setDropDebugFromWorker(message.debugDrop ?? false)
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
    if (message.debugDrop != null) setDropDebugFromWorker(message.debugDrop)
    const previousContext = currentContext
    appRoute = message.appRoute
    currentContext = message.context
    logRoomDebug('worker SET_APP_ROUTE', {
      worldId: message.context.worldId,
      canvasId: message.context.canvasId,
      routeMode: message.appRoute.mode,
    })
    // Canvas-scoped board data must not leak across rooms: until SpacetimeDB sends the new snapshot,
    // clear domain + layout so a new/empty canvas is not painted with the previous canvas's groups.
    if (message.appRoute.mode === 'canvas' && worldState) {
      const prevKey = roomKeyForContext(previousContext)
      const nextKey = roomKeyForContext(message.context)
      if (prevKey !== nextKey) {
        pendingSyncIntents = []
        worldState = {
          ...worldState,
          actors: {},
          inventoryEntries: {},
          carryGroups: {},
          movementGroups: {},
        }
        localState = mergeServerLayoutWithEphemeral(
          {},
          { ...ZERO_EPHEMERAL_LOCAL, stonesPerRow: localState.stonesPerRow },
        )
        recompute()
      }
    }
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
    )
    return
  }
  if (message.type === 'RESET') {
    persistence.clear().catch((err) => console.warn('[persistence] clear failed', err))
    const oldWorld = worldState
    const oldLocal = localState
    worldState = migrateWieldToActor(message.worldState)
    serverWorldState = worldState
    serverPersistedLayout = {}
    pendingSyncIntents = []
    localState = {
      hoveredSegmentId: null,
      groupPositions: {},
      groupSizeOverrides: {},
      groupListViewEnabled: {},
      layoutExpanded: {},
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
      pasteTargetNodeId: null,
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
    serverPersistedLayout = { ...serverPersistedLayout, stonesPerRow: message.stonesPerRow }
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
  if (message.type === 'CLIPBOARD_EXPORT') {
    if (!worldState) {
      post({ type: 'CLIPBOARD_EXPORT_RESULT', requestId: message.requestId, payload: '' })
      return
    }
    const scene = buildSceneVM(worldState, localState)
    const payload = serializeNodeClipboard(worldState, localState, scene, localState.selectedNodeIds)
    post({ type: 'CLIPBOARD_EXPORT_RESULT', requestId: message.requestId, payload: payload ?? '' })
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


