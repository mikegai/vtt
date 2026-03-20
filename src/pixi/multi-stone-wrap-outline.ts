import type { Graphics } from 'pixi.js'
import { Polygon } from 'pixi.js'

export type Point2 = { x: number; y: number }

type Rect = { x: number; y: number; w: number; h: number }

/**
 * Merge axis-aligned rects on the same grid into horizontal chunks: each chunk is [startStone, endStone)
 * stone indices in one meter row, consecutive columns.
 */
export const stoneIndicesToRowChunks = (
  stoneIds: readonly number[],
  stonesPerRow: number,
): { start: number; end: number }[] => {
  const sorted = [...new Set(stoneIds)].sort((a, b) => {
    const ra = Math.floor(a / stonesPerRow)
    const rb = Math.floor(b / stonesPerRow)
    if (ra !== rb) return ra - rb
    return (a % stonesPerRow) - (b % stonesPerRow)
  })
  const chunks: { start: number; end: number }[] = []
  let chunkStart = -1
  let chunkEnd = -1
  for (const s of sorted) {
    const row = Math.floor(s / stonesPerRow)
    const col = s % stonesPerRow
    if (chunkStart < 0) {
      chunkStart = s
      chunkEnd = s + 1
      continue
    }
    const prev = chunkEnd - 1
    const prevRow = Math.floor(prev / stonesPerRow)
    const prevCol = prev % stonesPerRow
    if (row === prevRow && col === prevCol + 1) {
      chunkEnd = s + 1
    } else {
      chunks.push({ start: chunkStart, end: chunkEnd })
      chunkStart = s
      chunkEnd = s + 1
    }
  }
  if (chunkStart >= 0) chunks.push({ start: chunkStart, end: chunkEnd })
  return chunks
}

const rectCovers = (r: Rect, x: number, y: number): boolean =>
  x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h

/**
 * Outer boundary of a union of axis-aligned rects (vertices CCW).
 * Uses refinement to a coord grid so partial shared edges don't break the outline.
 */
export const orthogonalUnionOutline = (rects: readonly Rect[]): Point2[] => {
  if (rects.length === 0) return []
  if (rects.length === 1) {
    const r = rects[0]!
    return [
      { x: r.x, y: r.y },
      { x: r.x + r.w, y: r.y },
      { x: r.x + r.w, y: r.y + r.h },
      { x: r.x, y: r.y + r.h },
    ]
  }
  const xs = new Set<number>()
  const ys = new Set<number>()
  for (const r of rects) {
    xs.add(r.x)
    xs.add(r.x + r.w)
    ys.add(r.y)
    ys.add(r.y + r.h)
  }
  const xa = [...xs].sort((a, b) => a - b)
  const ya = [...ys].sort((a, b) => a - b)
  if (xa.length < 2 || ya.length < 2) return []

  const ix = xa.length - 1
  const iy = ya.length - 1
  const filled: boolean[][] = []
  for (let j = 0; j < iy; j += 1) {
    filled[j] = []
    for (let i = 0; i < ix; i += 1) {
      const cx = (xa[i]! + xa[i + 1]!) / 2
      const cyy = (ya[j]! + ya[j + 1]!) / 2
      filled[j]![i] = rects.some((r) => rectCovers(r, cx, cyy))
    }
  }

  type Edge = { x1: number; y1: number; x2: number; y2: number }
  const boundary: Edge[] = []
  for (let j = 0; j < iy; j += 1) {
    for (let i = 0; i < ix; i += 1) {
      if (!filled[j]![i]) continue
      const x0 = xa[i]!
      const x1 = xa[i + 1]!
      const y0 = ya[j]!
      const y1 = ya[j + 1]!
      if (j === 0 || !filled[j - 1]![i]) boundary.push({ x1: x0, y1: y0, x2: x1, y2: y0 })
      if (j === iy - 1 || !filled[j + 1]![i]) boundary.push({ x1: x1, y1: y1, x2: x0, y2: y1 })
      if (i === 0 || !filled[j]![i - 1]) boundary.push({ x1: x0, y1: y1, x2: x0, y2: y0 })
      if (i === ix - 1 || !filled[j]![i + 1]) boundary.push({ x1: x1, y1: y0, x2: x1, y2: y1 })
    }
  }

  if (boundary.length === 0) return []

  const adj = new Map<string, Array<[number, number]>>()
  const nodeKey = (x: number, y: number): string => `${x},${y}`
  const addAdj = (x1: number, y1: number, x2: number, y2: number): void => {
    if (x1 === x2 && y1 === y2) return
    const k1 = nodeKey(x1, y1)
    const k2 = nodeKey(x2, y2)
    if (!adj.has(k1)) adj.set(k1, [])
    if (!adj.has(k2)) adj.set(k2, [])
    adj.get(k1)!.push([x2, y2])
    adj.get(k2)!.push([x1, y1])
  }
  for (const e of boundary) {
    addAdj(e.x1, e.y1, e.x2, e.y2)
  }

  let start = xa[0]!
  let startY = ya[0]!
  for (const k of adj.keys()) {
    const [sx, sy] = k.split(',').map(Number)
    if (sy < startY || (sy === startY && sx < start)) {
      start = sx
      startY = sy
    }
  }

  const poly: Point2[] = []
  let cx = start
  let cy = startY
  let px = cx - 1
  let py = cy
  const maxSteps = boundary.length * 8 + 20
  for (let step = 0; step < maxSteps; step += 1) {
    poly.push({ x: cx, y: cy })
    const neighbors = adj.get(nodeKey(cx, cy))
    if (!neighbors || neighbors.length === 0) break
    const opts = neighbors
      .filter(([nx, ny]) => !(nx === px && ny === py))
      .map(([nx, ny]) => {
        const dx = nx - cx
        const dy = ny - cy
        let ang = Math.atan2(dy, dx) - Math.atan2(cy - py, cx - px)
        while (ang <= -Math.PI) ang += 2 * Math.PI
        while (ang > Math.PI) ang -= 2 * Math.PI
        return { nx, ny, ang }
      })
      .sort((a, b) => a.ang - b.ang)
    const pick = opts[0]
    if (!pick) break
    px = cx
    py = cy
    cx = pick.nx
    cy = pick.ny
    if (cx === start && cy === startY) break
  }
  return poly
}

export const drawRoundedPolygonFillStroke = (
  g: Graphics,
  points: readonly Point2[],
  radius: number,
  fillOpt: { color: number; alpha: number },
  strokeOpt: { width: number; color: number; alpha: number },
): void => {
  const n = points.length
  if (n < 3) return
  for (let i = 0; i < n; i += 1) {
    const prev = points[(i - 1 + n) % n]!
    const curr = points[i]!
    const next = points[(i + 1) % n]!

    const v1x = curr.x - prev.x
    const v1y = curr.y - prev.y
    const v2x = next.x - curr.x
    const v2y = next.y - curr.y

    const len1 = Math.hypot(v1x, v1y)
    const len2 = Math.hypot(v2x, v2y)
    if (len1 < 1e-6 || len2 < 1e-6) continue

    const r = Math.min(radius, len1 / 2, len2 / 2)

    const p1 = {
      x: curr.x - (v1x / len1) * r,
      y: curr.y - (v1y / len1) * r,
    }
    const p2 = {
      x: curr.x + (v2x / len2) * r,
      y: curr.y + (v2y / len2) * r,
    }

    if (i === 0) {
      g.moveTo(p1.x, p1.y)
    } else {
      g.lineTo(p1.x, p1.y)
    }
    g.quadraticCurveTo(curr.x, curr.y, p2.x, p2.y)
  }
  g.closePath()
  g.fill(fillOpt)
  g.stroke(strokeOpt)
}

/** Hit polygon matching the orthogonal shell (ignores corner fillet — close enough for pointers). */
export const polygonHitAreaFromOutline = (points: readonly Point2[]): Polygon =>
  new Polygon(points.flatMap((p) => [p.x, p.y]))
