/**
 * Aligns local URL/localStorage room ids with registry rows in SpacetimeDB:
 * - retired world/canvas slugs → canonical route + ids
 * - slug collision (another client created the room first) → adopt server ids
 */

import type { DbConnection } from '../module_bindings'
import type { AppRoute, WorldCanvasContext } from './context'
import { canonicalPathForRoute, DEFAULT_CANVAS_SLUG } from './context'

export type RegistryAdjust = {
  readonly route: AppRoute
  readonly worldId: string
  readonly canvasId: string
  /** True when the browser URL should be replaced with the canonical path (e.g. renamed slug). */
  readonly replaceUrl: boolean
}

function findWorldByCurrentSlug(conn: DbConnection, slug: string): { id: string; slug: string } | null {
  for (const w of conn.db.worlds.iter()) {
    if (w.slug === slug) return { id: w.id, slug: w.slug }
  }
  return null
}

function findWorldByRetiredSlug(conn: DbConnection, slug: string): { id: string; slug: string } | null {
  let best: { retiredAtMs: number; worldId: string } | null = null
  for (const h of conn.db.world_slug_history.iter()) {
    if (h.slug !== slug) continue
    if (!best || h.retiredAtMs > best.retiredAtMs) best = { retiredAtMs: h.retiredAtMs, worldId: h.worldId }
  }
  if (!best) return null
  const w = conn.db.worlds.id.find(best.worldId)
  return w ? { id: w.id, slug: w.slug } : null
}

function findCanvasByWorldAndSlug(
  conn: DbConnection,
  worldId: string,
  canvasSlug: string,
): { id: string; slug: string } | null {
  for (const c of conn.db.canvases.iter()) {
    if (c.worldId === worldId && c.slug === canvasSlug) return { id: c.id, slug: c.slug }
  }
  return null
}

function findCanvasByRetiredSlug(
  conn: DbConnection,
  worldId: string,
  canvasSlug: string,
): { id: string; slug: string } | null {
  let best: { retiredAtMs: number; canvasId: string } | null = null
  for (const h of conn.db.canvas_slug_history.iter()) {
    if (h.worldId !== worldId || h.slug !== canvasSlug) continue
    if (!best || h.retiredAtMs > best.retiredAtMs) best = { retiredAtMs: h.retiredAtMs, canvasId: h.canvasId }
  }
  if (!best) return null
  const c = conn.db.canvases.id.find(best.canvasId)
  return c ? { id: c.id, slug: c.slug } : null
}

/**
 * Returns registry adjustments when URL/slugs or local ids disagree with the server registry.
 * Returns null when nothing is known yet or already aligned.
 */
export function computeRegistryAdjust(
  conn: DbConnection,
  route: AppRoute,
  ctx: WorldCanvasContext,
): RegistryAdjust | null {
  const urlWorldSlug = route.worldSlug

  const world =
    findWorldByCurrentSlug(conn, urlWorldSlug) ?? findWorldByRetiredSlug(conn, urlWorldSlug)
  if (!world) return null

  const worldId = world.id
  const canonicalWorldSlug = world.slug

  let canonicalRoute: AppRoute
  let authorityCanvasId: string

  if (route.mode === 'hub') {
    canonicalRoute = { mode: 'hub', worldSlug: canonicalWorldSlug, hubView: route.hubView }
    const main = findCanvasByWorldAndSlug(conn, worldId, DEFAULT_CANVAS_SLUG)
    authorityCanvasId = main?.id ?? ctx.canvasId
  } else {
    let canvas = findCanvasByWorldAndSlug(conn, worldId, route.canvasSlug)
    if (!canvas) canvas = findCanvasByRetiredSlug(conn, worldId, route.canvasSlug)
    if (!canvas) return null
    canonicalRoute = {
      mode: 'canvas',
      worldSlug: canonicalWorldSlug,
      canvasSlug: canvas.slug,
    }
    authorityCanvasId = canvas.id
  }

  const pathMismatch = canonicalPathForRoute(canonicalRoute) !== canonicalPathForRoute(route)
  const idMismatch = ctx.worldId !== worldId || ctx.canvasId !== authorityCanvasId

  if (!pathMismatch && !idMismatch) return null

  return {
    route: canonicalRoute,
    worldId,
    canvasId: authorityCanvasId,
    replaceUrl: pathMismatch,
  }
}
