/**
 * Layer 1 — Network
 *
 * SpacetimeDB connection manager for the Web Worker.
 * Owns the DbConnection, manages subscriptions, and exposes
 * a callback for Layer 2 (reconstructFromCache) to consume.
 *
 * Handles reconnection with exponential backoff and falls back
 * to IndexedDB persistence when offline.
 */

import { DbConnection, type ErrorContext } from '../module_bindings'
import type { Identity } from 'spacetimedb'
import type { CanonicalState } from '../domain/types'
import type { PersistedLocalState } from '../persistence/backend'
import { reconstructCanonicalState, reconstructLayoutState } from './reconstruct'
import type { WorldCanvasContext } from './context'

export interface ConnectedUser {
  identityHex: string
  displayName: string
  role: 'gm' | 'player'
  online: boolean
}

export interface RemoteCursor {
  identityHex: string
  x: number
  y: number
}

export type PresenceCallback = (users: ConnectedUser[], cursors: RemoteCursor[], myIdentityHex: string) => void
export type CameraRestoreCallback = (panX: number, panY: number, zoom: number) => void

const STDB_HOST = 'wss://maincloud.spacetimedb.com'
const STDB_DATABASE = 'vtt'
const RECONNECT_BASE_MS = 1000
const RECONNECT_MAX_MS = 30000

export type ServerStateCallback = (
  worldState: CanonicalState,
  layoutState: Partial<PersistedLocalState>,
) => void

export type ConnectionStatusCallback = (status: 'connected' | 'disconnected' | 'error') => void
export type TokenCallback = (token: string) => void

let conn: DbConnection | null = null
let onServerState: ServerStateCallback | null = null
let onConnectionStatus: ConnectionStatusCallback | null = null
let onToken: TokenCallback | null = null
let onPresence: PresenceCallback | null = null
let onCameraRestore: CameraRestoreCallback | null = null
let initialApplied = false
let reconnectTimer: ReturnType<typeof setTimeout> | null = null
let reconnectAttempt = 0
let shouldReconnect = true
let myIdentityHex = ''
let currentContext: WorldCanvasContext = { worldSlug: 'default-world', canvasSlug: 'main' }

export type AppSubscriptionMode = 'hub' | 'canvas'
let appSubscriptionMode: AppSubscriptionMode = 'canvas'
let onWorldHubRefresh: (() => void) | null = null

/** Escape a string for use as a single-quoted SQL literal. */
function sqlStringLiteral(value: string): string {
  return `'${value.replace(/'/g, "''")}'`
}

/**
 * Subscription queries scoped to the active world/canvas (and global `users`).
 *
 * Column identifiers MUST match the module schema’s product field names (camelCase),
 * e.g. "worldSlug", not the generated client binding rename (world_slug). Spacetime
 * SQL is case-sensitive; wrong names yield empty subscriptions after refresh.
 */
function subscriptionQueriesForContext(ctx: WorldCanvasContext): string[] {
  const w = sqlStringLiteral(ctx.worldSlug)
  const c = sqlStringLiteral(ctx.canvasSlug)
  const room = `"worldSlug" = ${w} AND "canvasSlug" = ${c}`
  return [
    `SELECT * FROM actors WHERE "worldSlug" = ${w}`,
    `SELECT * FROM item_definitions WHERE "worldSlug" = ${w}`,
    `SELECT * FROM inventory_entries WHERE "worldSlug" = ${w}`,
    `SELECT * FROM carry_groups WHERE "worldSlug" = ${w}`,
    `SELECT * FROM movement_groups WHERE "worldSlug" = ${w}`,
    `SELECT * FROM node_positions WHERE ${room}`,
    `SELECT * FROM group_positions WHERE ${room}`,
    `SELECT * FROM group_size_overrides WHERE ${room}`,
    `SELECT * FROM node_size_overrides WHERE ${room}`,
    `SELECT * FROM group_list_view WHERE ${room}`,
    `SELECT * FROM node_group_overrides WHERE ${room}`,
    `SELECT * FROM group_node_positions WHERE ${room}`,
    `SELECT * FROM free_segment_positions WHERE ${room}`,
    `SELECT * FROM group_free_segment_positions WHERE ${room}`,
    `SELECT * FROM group_node_orders WHERE ${room}`,
    `SELECT * FROM custom_groups WHERE ${room}`,
    `SELECT * FROM group_title_overrides WHERE ${room}`,
    `SELECT * FROM node_title_overrides WHERE ${room}`,
    `SELECT * FROM node_containment WHERE ${room}`,
    `SELECT * FROM labels WHERE ${room}`,
    `SELECT * FROM settings WHERE ${room}`,
    'SELECT * FROM users',
    `SELECT * FROM user_presences WHERE ${room}`,
    `SELECT * FROM user_cursors WHERE ${room}`,
    `SELECT * FROM user_cameras WHERE ${room}`,
  ]
}

/** World hub: all layout + presence rows for the world (any canvas). Domain still world-scoped. */
export function subscriptionQueriesForHubWorld(worldSlug: string): string[] {
  const w = sqlStringLiteral(worldSlug)
  const worldOnly = `"worldSlug" = ${w}`
  return [
    `SELECT * FROM actors WHERE ${worldOnly}`,
    `SELECT * FROM item_definitions WHERE ${worldOnly}`,
    `SELECT * FROM inventory_entries WHERE ${worldOnly}`,
    `SELECT * FROM carry_groups WHERE ${worldOnly}`,
    `SELECT * FROM movement_groups WHERE ${worldOnly}`,
    `SELECT * FROM node_positions WHERE ${worldOnly}`,
    `SELECT * FROM group_positions WHERE ${worldOnly}`,
    `SELECT * FROM group_size_overrides WHERE ${worldOnly}`,
    `SELECT * FROM node_size_overrides WHERE ${worldOnly}`,
    `SELECT * FROM group_list_view WHERE ${worldOnly}`,
    `SELECT * FROM node_group_overrides WHERE ${worldOnly}`,
    `SELECT * FROM group_node_positions WHERE ${worldOnly}`,
    `SELECT * FROM free_segment_positions WHERE ${worldOnly}`,
    `SELECT * FROM group_free_segment_positions WHERE ${worldOnly}`,
    `SELECT * FROM group_node_orders WHERE ${worldOnly}`,
    `SELECT * FROM custom_groups WHERE ${worldOnly}`,
    `SELECT * FROM group_title_overrides WHERE ${worldOnly}`,
    `SELECT * FROM node_title_overrides WHERE ${worldOnly}`,
    `SELECT * FROM node_containment WHERE ${worldOnly}`,
    `SELECT * FROM labels WHERE ${worldOnly}`,
    `SELECT * FROM settings WHERE ${worldOnly}`,
    'SELECT * FROM users',
    `SELECT * FROM user_presences WHERE ${worldOnly}`,
    `SELECT * FROM user_cursors WHERE ${worldOnly}`,
    `SELECT * FROM user_cameras WHERE ${worldOnly}`,
  ]
}

function activeSubscriptionQueries(): string[] {
  return appSubscriptionMode === 'hub'
    ? subscriptionQueriesForHubWorld(currentContext.worldSlug)
    : subscriptionQueriesForContext(currentContext)
}

function canvasPresenceKey(identityHex: string): string {
  return `${currentContext.worldSlug}::${currentContext.canvasSlug}::${identityHex}`
}

function markPresence(): void {
  if (!conn) return
  conn.reducers.setPresence({
    worldSlug: currentContext.worldSlug,
    canvasSlug: currentContext.canvasSlug,
  })
}

/** Re-send room presence after switching world/canvas route. */
export function refreshPresence(): void {
  markPresence()
}

function getStoredToken(): string | undefined {
  try {
    return (globalThis as unknown as { __spacetimedb_token?: string }).__spacetimedb_token ?? undefined
  } catch {
    return undefined
  }
}

function storeToken(token: string): void {
  try {
    (globalThis as unknown as { __spacetimedb_token?: string }).__spacetimedb_token = token
  } catch { /* worker can't access localStorage */ }
  if (onToken) onToken(token)
}

function handleSubscriptionApplied(): void {
  if (!conn || !onServerState) return
  const worldState = reconstructCanonicalState(conn, currentContext)
  const layoutState = reconstructLayoutState(conn, currentContext)
  initialApplied = true
  onServerState(worldState, layoutState)
  rebuildPresence()
  restoreCamera()
}

function tickWorldHubIfNeeded(): void {
  if (appSubscriptionMode === 'hub' && onWorldHubRefresh) onWorldHubRefresh()
}

function rebuildPresence(): void {
  if (!conn || !onPresence) return
  const presentIdentityHexes = new Set<string>()
  for (const row of conn.db.user_presences.iter()) {
    if (row.worldSlug === currentContext.worldSlug && row.canvasSlug === currentContext.canvasSlug) {
      presentIdentityHexes.add(row.identityHex)
    }
  }
  const users: ConnectedUser[] = []
  for (const identityHex of presentIdentityHexes) {
    const row = conn.db.users.identityHex.find(identityHex)
    if (!row) continue
    users.push({
      identityHex: row.identityHex,
      displayName: row.displayName,
      role: row.role as 'gm' | 'player',
      online: true,
    })
  }
  const cursors: RemoteCursor[] = []
  for (const row of conn.db.user_cursors.iter()) {
    if (row.worldSlug !== currentContext.worldSlug || row.canvasSlug !== currentContext.canvasSlug) continue
    if (row.identityHex === myIdentityHex) continue
    cursors.push({ identityHex: row.identityHex, x: row.x, y: row.y })
  }
  onPresence(users, cursors, myIdentityHex)
  tickWorldHubIfNeeded()
}

function restoreCamera(): void {
  if (!conn || !onCameraRestore) return
  const row = conn.db.user_cameras.id.find(canvasPresenceKey(myIdentityHex))
  if (row) {
    onCameraRestore(row.panX, row.panY, row.zoom)
  }
}

function subscribeToAllTables(): void {
  if (!conn) return
  conn.subscriptionBuilder()
    .onApplied(() => handleSubscriptionApplied())
    .subscribe(activeSubscriptionQueries())
}

/**
 * Switch hub vs canvas cache scope and re-subscribe (connected state only).
 */
export function setAppSubscriptionRoute(context: WorldCanvasContext, mode: AppSubscriptionMode): void {
  currentContext = context
  appSubscriptionMode = mode
  if (conn && initialApplied) subscribeToAllTables()
}

export function getAppSubscriptionMode(): AppSubscriptionMode {
  return appSubscriptionMode
}

function registerTableCallbacks(): void {
  if (!conn) return

  const rebuild = () => {
    if (!initialApplied || !conn || !onServerState) return
    const worldState = reconstructCanonicalState(conn, currentContext)
    const layoutState = reconstructLayoutState(conn, currentContext)
    onServerState(worldState, layoutState)
    tickWorldHubIfNeeded()
  }

  const domainTables = [
    conn.db.actors,
    conn.db.item_definitions,
    conn.db.inventory_entries,
    conn.db.carry_groups,
    conn.db.movement_groups,
    conn.db.node_positions,
    conn.db.group_positions,
    conn.db.group_size_overrides,
    conn.db.node_size_overrides,
    conn.db.group_list_view,
    conn.db.node_group_overrides,
    conn.db.group_node_positions,
    conn.db.free_segment_positions,
    conn.db.group_free_segment_positions,
    conn.db.group_node_orders,
    conn.db.custom_groups,
    conn.db.group_title_overrides,
    conn.db.node_title_overrides,
    conn.db.node_containment,
    conn.db.labels,
    conn.db.settings,
  ] as const

  for (const table of domainTables) {
    (table as unknown as { onInsert: (cb: () => void) => void }).onInsert(rebuild);
    (table as unknown as { onUpdate: (cb: () => void) => void }).onUpdate(rebuild);
    (table as unknown as { onDelete: (cb: () => void) => void }).onDelete(rebuild)
  }

  const presenceTables = [conn.db.users, conn.db.user_presences, conn.db.user_cursors, conn.db.user_cameras] as const
  for (const table of presenceTables) {
    (table as unknown as { onInsert: (cb: () => void) => void }).onInsert(rebuildPresence);
    (table as unknown as { onUpdate: (cb: () => void) => void }).onUpdate(rebuildPresence);
    (table as unknown as { onDelete: (cb: () => void) => void }).onDelete(rebuildPresence)
  }
}

function scheduleReconnect(): void {
  if (!shouldReconnect || !onServerState || !onConnectionStatus) return
  if (reconnectTimer) clearTimeout(reconnectTimer)

  const delay = Math.min(RECONNECT_BASE_MS * Math.pow(2, reconnectAttempt), RECONNECT_MAX_MS)
  reconnectAttempt++
  console.info(`[spacetimedb] reconnecting in ${delay}ms (attempt ${reconnectAttempt})`)

  reconnectTimer = setTimeout(() => {
    reconnectTimer = null
    if (!shouldReconnect) return
    buildConnection()
  }, delay)
}

function buildConnection(): void {
  if (!onServerState || !onConnectionStatus) return
  initialApplied = false

  const storedToken = getStoredToken()

  const builder = DbConnection.builder()
    .withUri(STDB_HOST)
    .withDatabaseName(STDB_DATABASE)
    .onConnect((_connection: DbConnection, identity: Identity, authToken: string) => {
      console.info('[spacetimedb] connected')
      myIdentityHex = identity.toHexString()
      reconnectAttempt = 0
      storeToken(authToken)
      markPresence()
      onConnectionStatus!('connected')
      subscribeToAllTables()
    })
    .onDisconnect((_ctx: ErrorContext, _error?: Error) => {
      console.info('[spacetimedb] disconnected')
      conn = null
      initialApplied = false
      onConnectionStatus!('disconnected')
      scheduleReconnect()
    })
    .onConnectError((_ctx: ErrorContext, err: Error) => {
      console.error('[spacetimedb] connection error', err)
      conn = null
      initialApplied = false
      onConnectionStatus!('error')
      scheduleReconnect()
    })

  if (storedToken) {
    builder.withToken(storedToken)
  }

  conn = builder.build()
  registerTableCallbacks()
}

export function connect(
  serverStateCb: ServerStateCallback,
  connectionStatusCb: ConnectionStatusCallback,
  tokenCb: TokenCallback,
  presenceCb: PresenceCallback,
  cameraRestoreCb: CameraRestoreCallback,
  context: WorldCanvasContext,
  token?: string,
  subscriptionMode: AppSubscriptionMode = 'canvas',
  worldHubRefreshCb?: () => void,
): void {
  onServerState = serverStateCb
  onConnectionStatus = connectionStatusCb
  onToken = tokenCb
  onPresence = presenceCb
  onCameraRestore = cameraRestoreCb
  onWorldHubRefresh = worldHubRefreshCb ?? null
  currentContext = context
  appSubscriptionMode = subscriptionMode
  shouldReconnect = true
  reconnectAttempt = 0

  if (token) storeToken(token)

  buildConnection()
}

export function updateMyCursor(x: number, y: number): void {
  if (!conn || !initialApplied) return
  markPresence()
  conn.reducers.updateCursor({
    worldSlug: currentContext.worldSlug,
    canvasSlug: currentContext.canvasSlug,
    x,
    y,
    viewportScale: undefined,
  })
}

export function updateMyCamera(panX: number, panY: number, zoom: number): void {
  if (!conn || !initialApplied) return
  markPresence()
  conn.reducers.updateCamera({
    worldSlug: currentContext.worldSlug,
    canvasSlug: currentContext.canvasSlug,
    panX,
    panY,
    zoom,
  })
}

export function setMyDisplayName(name: string): void {
  if (!conn || !initialApplied) return
  conn.reducers.setDisplayName({ displayName: name })
}

export function setUserRole(targetIdentityHex: string, role: 'gm' | 'player'): void {
  if (!conn || !initialApplied) return
  conn.reducers.setUserRole({ targetIdentityHex, role })
}

export function getMyIdentityHex(): string {
  return myIdentityHex
}

export function disconnect(): void {
  shouldReconnect = false
  if (reconnectTimer) {
    clearTimeout(reconnectTimer)
    reconnectTimer = null
  }
  if (conn) {
    conn.disconnect()
    conn = null
  }
  initialApplied = false
}

export function getConnection(): DbConnection | null {
  return conn
}

export function isConnected(): boolean {
  return conn != null && initialApplied
}
