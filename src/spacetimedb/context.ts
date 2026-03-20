export type WorldCanvasContext = {
  worldSlug: string
  canvasSlug: string
}

export type AppRoute =
  | { readonly mode: 'hub'; readonly worldSlug: string }
  | { readonly mode: 'canvas'; readonly worldSlug: string; readonly canvasSlug: string }

const DEFAULT_WORLD_SLUG = 'default-world'
const DEFAULT_CANVAS_SLUG = 'main'

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

/** Legacy: always yields a canvas (defaults to main). Prefer `parseAppRoute` for routing. */
export const contextFromPathname = (pathname: string): WorldCanvasContext => {
  const segments = pathSegments(pathname)
  const worldSlug = slugify(segments[0] ?? '') || DEFAULT_WORLD_SLUG
  const canvasSlug = slugify(segments[1] ?? '') || DEFAULT_CANVAS_SLUG
  return { worldSlug, canvasSlug }
}

/** Single segment or empty → world hub; two+ → canvas view. */
export const parseAppRoute = (pathname: string): AppRoute => {
  const segments = pathSegments(pathname)
  const worldSlug = slugify(segments[0] ?? '') || DEFAULT_WORLD_SLUG
  if (segments.length >= 2) {
    const canvasSlug = slugify(segments[1] ?? '') || DEFAULT_CANVAS_SLUG
    return { mode: 'canvas', worldSlug, canvasSlug }
  }
  return { mode: 'hub', worldSlug }
}

export const canonicalHubPath = (worldSlug: string): string => `/${slugify(worldSlug) || DEFAULT_WORLD_SLUG}`

export const canonicalCanvasPath = (worldSlug: string, canvasSlug: string): string =>
  `/${slugify(worldSlug) || DEFAULT_WORLD_SLUG}/${slugify(canvasSlug) || DEFAULT_CANVAS_SLUG}`

export const worldCanvasContextFromRoute = (route: AppRoute): WorldCanvasContext =>
  route.mode === 'hub'
    ? { worldSlug: route.worldSlug, canvasSlug: DEFAULT_CANVAS_SLUG }
    : { worldSlug: route.worldSlug, canvasSlug: route.canvasSlug }

export const canonicalPathForRoute = (route: AppRoute): string =>
  route.mode === 'hub' ? canonicalHubPath(route.worldSlug) : canonicalCanvasPath(route.worldSlug, route.canvasSlug)

export const canonicalPathForContext = (ctx: WorldCanvasContext): string => canonicalCanvasPath(ctx.worldSlug, ctx.canvasSlug)

export const worldPrefix = (ctx: WorldCanvasContext): string => `w__${ctx.worldSlug}__`
export const canvasPrefix = (ctx: WorldCanvasContext): string =>
  `${worldPrefix(ctx)}c__${ctx.canvasSlug}__`

export const withWorldPrefix = (ctx: WorldCanvasContext, id: string): string => `${worldPrefix(ctx)}${id}`
export const withCanvasPrefix = (ctx: WorldCanvasContext, id: string): string => `${canvasPrefix(ctx)}${id}`

/** Settings row key: human title for a world (stored on canonical `main` canvas). */
export const worldDisplayNameSettingKey = (worldSlug: string): string =>
  withCanvasPrefix({ worldSlug, canvasSlug: DEFAULT_CANVAS_SLUG }, 'settings:worldDisplayName')

export const withoutPrefix = (id: string, prefix: string): string | null =>
  id.startsWith(prefix) ? id.slice(prefix.length) : null

export const isWorldScopedRow = (ctx: WorldCanvasContext, id: string): boolean =>
  id.startsWith(worldPrefix(ctx))

export const isCanvasScopedRow = (ctx: WorldCanvasContext, id: string): boolean =>
  id.startsWith(canvasPrefix(ctx))

