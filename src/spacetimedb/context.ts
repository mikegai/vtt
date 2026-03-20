import { logRoomDebug } from './debug-room-ids'

/** Deterministic ids for the default dev room (stable across browsers for `default-world` / `main`). */
export const STABLE_DEFAULT_WORLD_ID = '11111111-1111-4111-8111-111111111111'
export const STABLE_DEFAULT_MAIN_CANVAS_ID = '22222222-2222-4222-8222-222222222222'

export type WorldCanvasContext = {
  readonly worldId: string
  readonly canvasId: string
  readonly worldSlug: string
  readonly canvasSlug: string
}

/** Reserved second path segment: `/world/catalog` is the hub item catalog, not a canvas named "catalog". */
export const HUB_CATALOG_SEGMENT = 'catalog'

export type HubView = 'canvases' | 'catalog'

export type AppRoute =
  | { readonly mode: 'hub'; readonly worldSlug: string; readonly hubView: HubView }
  | { readonly mode: 'canvas'; readonly worldSlug: string; readonly canvasSlug: string }

export const DEFAULT_WORLD_SLUG = 'default-world'
export const DEFAULT_CANVAS_SLUG = 'main'

const slugify = (raw: string): string =>
  raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')

const pathSegments = (pathname: string): string[] =>
  pathname
    .split('/')
    .map((s) => s.trim())
    .filter((s) => s.length > 0)

/** Deterministic UUID (v4 variant bits) from a string — used when localStorage is unavailable. */
export function deterministicUuidFromString(seed: string): string {
  let h = 2166136261
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  const bytes = new Uint8Array(16)
  for (let i = 0; i < 16; i++) {
    h = Math.imul(h ^ (h >>> 15), 2246822519) ^ Math.imul(h ^ (h >>> 13), 3266489937)
    bytes[i] = (h >>> (i * 3)) & 0xff
  }
  bytes[6] = (bytes[6]! & 0x0f) | 0x40
  bytes[8] = (bytes[8]! & 0x3f) | 0x80
  const hex = [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`
}

/** Legacy: always yields a canvas (defaults to main). Prefer building context via main `getRoomIdsForRoute` + `worldCanvasContextFromRoute`. */
export const contextFromPathname = (pathname: string): WorldCanvasContext => {
  const segments = pathSegments(pathname)
  const worldSlug = slugify(segments[0] ?? '') || DEFAULT_WORLD_SLUG
  const canvasSlug = slugify(segments[1] ?? '') || DEFAULT_CANVAS_SLUG
  const worldId =
    worldSlug === DEFAULT_WORLD_SLUG ? STABLE_DEFAULT_WORLD_ID : deterministicUuidFromString(`world:${worldSlug}`)
  const canvasId =
    worldSlug === DEFAULT_WORLD_SLUG && canvasSlug === DEFAULT_CANVAS_SLUG
      ? STABLE_DEFAULT_MAIN_CANVAS_ID
      : deterministicUuidFromString(`canvas:${worldSlug}:${canvasSlug}`)
  return { worldId, canvasId, worldSlug, canvasSlug }
}

/** Single segment or empty → world hub (canvases); `/world/catalog` → hub catalog; else two segments → canvas. */
export const parseAppRoute = (pathname: string): AppRoute => {
  const segments = pathSegments(pathname)
  const worldSlug = slugify(segments[0] ?? '') || DEFAULT_WORLD_SLUG
  if (segments.length >= 2) {
    const second = slugify(segments[1] ?? '') || ''
    if (second === HUB_CATALOG_SEGMENT) {
      return { mode: 'hub', worldSlug, hubView: 'catalog' }
    }
    return { mode: 'canvas', worldSlug, canvasSlug: second || DEFAULT_CANVAS_SLUG }
  }
  return { mode: 'hub', worldSlug, hubView: 'canvases' }
}

export const canonicalHubPath = (worldSlug: string, hubView: HubView = 'canvases'): string => {
  const base = `/${slugify(worldSlug) || DEFAULT_WORLD_SLUG}`
  return hubView === 'catalog' ? `${base}/${HUB_CATALOG_SEGMENT}` : base
}

export const canonicalCanvasPath = (worldSlug: string, canvasSlug: string): string =>
  `/${slugify(worldSlug) || DEFAULT_WORLD_SLUG}/${slugify(canvasSlug) || DEFAULT_CANVAS_SLUG}`

const lsWorldIdKey = (worldSlug: string): string => `vtt:room:worldId:${worldSlug}`
const lsCanvasIdKey = (worldSlug: string, canvasSlug: string): string => `vtt:room:canvasId:${worldSlug}:${canvasSlug}`

/**
 * Resolves stable world/canvas UUIDs for the URL route: default room uses fixed ids;
 * other slugs persist in localStorage so returning visitors keep the same registry rows.
 */
export function getRoomIdsForRoute(route: AppRoute): { worldId: string; canvasId: string } {
  const worldSlug = route.worldSlug
  const canvasSlug = route.mode === 'hub' ? DEFAULT_CANVAS_SLUG : route.canvasSlug
  const worldId = resolveWorldId(worldSlug)
  const canvasId = resolveCanvasId(worldSlug, canvasSlug)
  logRoomDebug('slug→ids (localStorage / defaults)', {
    routeMode: route.mode,
    worldSlug,
    canvasSlugUsedForLookup: canvasSlug,
    worldId,
    canvasId,
  })
  return { worldId, canvasId }
}

function resolveWorldId(worldSlug: string): string {
  if (worldSlug === DEFAULT_WORLD_SLUG) return STABLE_DEFAULT_WORLD_ID
  try {
    const k = lsWorldIdKey(worldSlug)
    const existing = localStorage.getItem(k)
    if (existing) return existing
    const id = deterministicUuidFromString(`world:${worldSlug}`)
    localStorage.setItem(k, id)
    return id
  } catch {
    return deterministicUuidFromString(`world:${worldSlug}`)
  }
}

function resolveCanvasId(worldSlug: string, canvasSlug: string): string {
  if (worldSlug === DEFAULT_WORLD_SLUG && canvasSlug === DEFAULT_CANVAS_SLUG) return STABLE_DEFAULT_MAIN_CANVAS_ID
  try {
    const k = lsCanvasIdKey(worldSlug, canvasSlug)
    const existing = localStorage.getItem(k)
    if (existing) return existing
    const id = deterministicUuidFromString(`canvas:${worldSlug}:${canvasSlug}`)
    localStorage.setItem(k, id)
    return id
  } catch {
    return deterministicUuidFromString(`canvas:${worldSlug}:${canvasSlug}`)
  }
}

/** Persist server-authoritative ids for a slug pair (main thread; used after registry reconciliation). */
export function persistResolvedRoomIds(
  worldSlug: string,
  canvasSlug: string,
  worldId: string,
  canvasId: string,
): void {
  logRoomDebug('persistResolvedRoomIds (server registry → localStorage)', {
    worldSlug,
    canvasSlug,
    worldId,
    canvasId,
  })
  try {
    if (worldSlug !== DEFAULT_WORLD_SLUG) localStorage.setItem(lsWorldIdKey(worldSlug), worldId)
    if (!(worldSlug === DEFAULT_WORLD_SLUG && canvasSlug === DEFAULT_CANVAS_SLUG))
      localStorage.setItem(lsCanvasIdKey(worldSlug, canvasSlug), canvasId)
  } catch {
    /* noop */
  }
}

/** Build context from route + resolved UUIDs (from DB or localStorage on main). */
export function worldCanvasContextFromRoute(route: AppRoute, worldId: string, canvasId: string): WorldCanvasContext {
  if (route.mode === 'hub') {
    return { worldId, canvasId, worldSlug: route.worldSlug, canvasSlug: DEFAULT_CANVAS_SLUG }
  }
  return { worldId, canvasId, worldSlug: route.worldSlug, canvasSlug: route.canvasSlug }
}

export const canonicalPathForRoute = (route: AppRoute): string =>
  route.mode === 'hub' ? canonicalHubPath(route.worldSlug, route.hubView) : canonicalCanvasPath(route.worldSlug, route.canvasSlug)

export const canonicalPathForContext = (ctx: WorldCanvasContext): string =>
  canonicalCanvasPath(ctx.worldSlug, ctx.canvasSlug)

export const worldPrefix = (ctx: WorldCanvasContext): string => `w__${ctx.worldId}__`
export const canvasPrefix = (ctx: WorldCanvasContext): string => `w__${ctx.worldId}__c__${ctx.canvasId}__`

export const withWorldPrefix = (ctx: WorldCanvasContext, id: string): string => `${worldPrefix(ctx)}${id}`
export const withCanvasPrefix = (ctx: WorldCanvasContext, id: string): string => `${canvasPrefix(ctx)}${id}`

export const withoutPrefix = (id: string, prefix: string): string | null =>
  id.startsWith(prefix) ? id.slice(prefix.length) : null

export const isWorldScopedRow = (ctx: WorldCanvasContext, id: string): boolean => id.startsWith(worldPrefix(ctx))

export const isCanvasScopedRow = (ctx: WorldCanvasContext, id: string): boolean => id.startsWith(canvasPrefix(ctx))
