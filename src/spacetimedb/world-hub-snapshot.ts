/**
 * Builds the world hub view model from an in-memory SpacetimeDB client cache.
 * Requires hub-mode subscriptions so layout/presence rows exist for all canvases in the world.
 */

import type { DbConnection } from '../module_bindings'
import type { ItemDefinition } from '../domain/types'
import { sampleState } from '../sample-data'
import { reconstructCanonicalState } from './reconstruct'
import type { WorldCanvasContext } from './context'
import { worldDisplayNameSettingKey } from './context'

const PRESENCE_MAX_AVATARS = 5
const STALE_PRESENCE_MS = 10 * 60 * 1000

export type HubPresenceAvatarVM = {
  readonly identityHex: string
  readonly displayName: string
  readonly initials: string
  readonly color: string
}

export type HubCanvasCardVM = {
  readonly canvasSlug: string
  readonly lastVisitedMs: number
  readonly presence: readonly HubPresenceAvatarVM[]
}

export type HubCatalogRowVM = ItemDefinition & { readonly isFromSample: boolean }

export type WorldHubSnapshot = {
  readonly worldSlug: string
  readonly displayName: string
  readonly canvases: readonly HubCanvasCardVM[]
  readonly catalog: readonly HubCatalogRowVM[]
}

export const hubUserInitials = (name: string): string => {
  const parts = name.trim().split(/\s+/)
  if (parts.length >= 2) return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
  return name.slice(0, 2).toUpperCase() || '?'
}

export const hubAvatarColor = (name: string): string => {
  let hash = 0
  for (let i = 0; i < name.length; i++) hash = ((hash << 5) - hash + name.charCodeAt(i)) | 0
  const hue = Math.abs(hash) % 360
  return `hsl(${hue}, 55%, 45%)`
}

const titleCaseFromSlug = (slug: string): string =>
  slug
    .split(/[-_]+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ') || slug

/** Collect canvas slugs that have layout (or presence) data for this world. */
const collectCanvasSlugs = (conn: DbConnection, worldSlug: string): Set<string> => {
  const out = new Set<string>(['main'])
  const add = (w: string, c: string): void => {
    if (w === worldSlug && c) out.add(c)
  }
  for (const row of conn.db.node_positions.iter()) add(row.worldSlug, row.canvasSlug)
  for (const row of conn.db.group_positions.iter()) add(row.worldSlug, row.canvasSlug)
  for (const row of conn.db.group_size_overrides.iter()) add(row.worldSlug, row.canvasSlug)
  for (const row of conn.db.node_size_overrides.iter()) add(row.worldSlug, row.canvasSlug)
  for (const row of conn.db.group_list_view.iter()) add(row.worldSlug, row.canvasSlug)
  for (const row of conn.db.node_group_overrides.iter()) add(row.worldSlug, row.canvasSlug)
  for (const row of conn.db.group_node_positions.iter()) add(row.worldSlug, row.canvasSlug)
  for (const row of conn.db.free_segment_positions.iter()) add(row.worldSlug, row.canvasSlug)
  for (const row of conn.db.group_free_segment_positions.iter()) add(row.worldSlug, row.canvasSlug)
  for (const row of conn.db.group_node_orders.iter()) add(row.worldSlug, row.canvasSlug)
  for (const row of conn.db.custom_groups.iter()) add(row.worldSlug, row.canvasSlug)
  for (const row of conn.db.group_title_overrides.iter()) add(row.worldSlug, row.canvasSlug)
  for (const row of conn.db.node_title_overrides.iter()) add(row.worldSlug, row.canvasSlug)
  for (const row of conn.db.node_containment.iter()) add(row.worldSlug, row.canvasSlug)
  for (const row of conn.db.labels.iter()) add(row.worldSlug, row.canvasSlug)
  for (const row of conn.db.user_presences.iter()) add(row.worldSlug, row.canvasSlug)
  return out
}

export function buildWorldHubSnapshot(
  conn: DbConnection,
  worldSlug: string,
  myIdentityHex: string,
): WorldHubSnapshot {
  const ctx: WorldCanvasContext = { worldSlug, canvasSlug: 'main' }
  const canonical = reconstructCanonicalState(conn, ctx)

  const dnKey = worldDisplayNameSettingKey(worldSlug)
  let displayName = titleCaseFromSlug(worldSlug)
  for (const row of conn.db.settings.iter()) {
    if (row.worldSlug !== worldSlug) continue
    if (row.key === dnKey && row.valueText != null && row.valueText.trim().length > 0) {
      displayName = row.valueText.trim()
      break
    }
  }

  const sampleIds = new Set(Object.keys(sampleState.itemDefinitions))
  const catalog: HubCatalogRowVM[] = Object.values(canonical.itemDefinitions)
    .slice()
    .sort((a, b) => a.canonicalName.localeCompare(b.canonicalName))
    .map((d) => ({ ...d, isFromSample: sampleIds.has(d.id) }))

  const canvasSlugs = collectCanvasSlugs(conn, worldSlug)
  const now = Date.now()

  const myLastByCanvas = new Map<string, number>()
  const identitiesByCanvas = new Map<string, Map<string, number>>()

  for (const row of conn.db.user_presences.iter()) {
    if (row.worldSlug !== worldSlug) continue
    const { canvasSlug } = row
    if (row.identityHex === myIdentityHex) {
      myLastByCanvas.set(canvasSlug, Math.max(myLastByCanvas.get(canvasSlug) ?? 0, row.lastSeenMs))
    }
    let im = identitiesByCanvas.get(canvasSlug)
    if (!im) {
      im = new Map()
      identitiesByCanvas.set(canvasSlug, im)
    }
    im.set(row.identityHex, Math.max(im.get(row.identityHex) ?? 0, row.lastSeenMs))
  }

  const canvases: HubCanvasCardVM[] = []
  for (const canvasSlug of canvasSlugs) {
    const lastVisitedMs = myLastByCanvas.get(canvasSlug) ?? 0
    const idents = identitiesByCanvas.get(canvasSlug) ?? new Map()
    const recent = [...idents.entries()]
      .filter(([, ms]) => now - ms <= STALE_PRESENCE_MS)
      .sort((a, b) => b[1] - a[1])
      .slice(0, PRESENCE_MAX_AVATARS + 5)

    const presence: HubPresenceAvatarVM[] = []
    for (const [identityHex] of recent.slice(0, PRESENCE_MAX_AVATARS)) {
      const u = conn.db.users.identityHex.find(identityHex)
      const displayName = u?.displayName ?? identityHex.slice(0, 8)
      presence.push({
        identityHex,
        displayName,
        initials: hubUserInitials(displayName),
        color: hubAvatarColor(displayName),
      })
    }

    canvases.push({ canvasSlug, lastVisitedMs, presence })
  }

  canvases.sort((a, b) => {
    if (b.lastVisitedMs !== a.lastVisitedMs) return b.lastVisitedMs - a.lastVisitedMs
    return a.canvasSlug.localeCompare(b.canvasSlug)
  })

  return { worldSlug, displayName, canvases, catalog }
}
