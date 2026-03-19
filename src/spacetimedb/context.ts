export type WorldCanvasContext = {
  worldSlug: string
  canvasSlug: string
}

const DEFAULT_WORLD_SLUG = 'default-world'
const DEFAULT_CANVAS_SLUG = 'main'

const slugify = (raw: string): string =>
  raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')

export const contextFromPathname = (pathname: string): WorldCanvasContext => {
  const segments = pathname
    .split('/')
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
  const worldSlug = slugify(segments[0] ?? '') || DEFAULT_WORLD_SLUG
  const canvasSlug = slugify(segments[1] ?? '') || DEFAULT_CANVAS_SLUG
  return { worldSlug, canvasSlug }
}

export const canonicalPathForContext = (ctx: WorldCanvasContext): string =>
  `/${slugify(ctx.worldSlug) || DEFAULT_WORLD_SLUG}/${slugify(ctx.canvasSlug) || DEFAULT_CANVAS_SLUG}`

export const worldPrefix = (ctx: WorldCanvasContext): string => `w__${ctx.worldSlug}__`
export const canvasPrefix = (ctx: WorldCanvasContext): string =>
  `${worldPrefix(ctx)}c__${ctx.canvasSlug}__`

export const withWorldPrefix = (ctx: WorldCanvasContext, id: string): string => `${worldPrefix(ctx)}${id}`
export const withCanvasPrefix = (ctx: WorldCanvasContext, id: string): string => `${canvasPrefix(ctx)}${id}`

export const withoutPrefix = (id: string, prefix: string): string | null =>
  id.startsWith(prefix) ? id.slice(prefix.length) : null

export const isWorldScopedRow = (ctx: WorldCanvasContext, id: string): boolean =>
  id.startsWith(worldPrefix(ctx))

export const isCanvasScopedRow = (ctx: WorldCanvasContext, id: string): boolean =>
  id.startsWith(canvasPrefix(ctx))

