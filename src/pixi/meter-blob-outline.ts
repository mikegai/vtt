import type { Graphics } from 'pixi.js'
import type { MeterCell } from '../shared/meter-grid'

const fillRoundedRect = (
  g: Graphics,
  x: number,
  y: number,
  w: number,
  h: number,
  radii: { tl: number; tr: number; br: number; bl: number },
): void => {
  const { tl, tr, br, bl } = radii
  g.moveTo(x + tl, y)
  g.lineTo(x + w - tr, y)
  if (tr > 0) g.arc(x + w - tr, y + tr, tr, -Math.PI / 2, 0)
  g.lineTo(x + w, y + h - br)
  if (br > 0) g.arc(x + w - br, y + h - br, br, 0, Math.PI / 2)
  g.lineTo(x + bl, y + h)
  if (bl > 0) g.arc(x + bl, y + h - bl, bl, Math.PI / 2, Math.PI)
  g.lineTo(x, y + tl)
  if (tl > 0) g.arc(x + tl, y + tl, tl, Math.PI, -Math.PI / 2)
  g.closePath()
}

/** All cells fill one axis-aligned rectangle (no holes). */
const isSolidRect = (cells: readonly MeterCell[]): boolean => {
  if (cells.length === 0) return false
  let minR = Infinity, maxR = -Infinity, minC = Infinity, maxC = -Infinity
  for (const z of cells) {
    minR = Math.min(minR, z.row)
    maxR = Math.max(maxR, z.row)
    minC = Math.min(minC, z.col)
    maxC = Math.max(maxC, z.col)
  }
  return (maxC - minC + 1) * (maxR - minR + 1) === cells.length
}

/**
 * Rounded fill (and stroke) for a union of full stone cells. Non-rectangular unions use
 * one filled round-rect per cell (no double-stroke on internal edges).
 */
export const drawRoundedMeterBlob = (
  g: Graphics,
  cells: readonly MeterCell[],
  cellW: number,
  cellH: number,
  gapX: number,
  gapY: number,
  originX: number,
  originY: number,
  pad: number,
  cornerR: number,
  fillOpt: { color: number; alpha: number },
  strokeOpt: { width: number; color: number; alpha: number },
): void => {
  if (cells.length === 0) return

  const stepX = cellW + gapX
  const stepY = cellH + gapY
  const rr = Math.min(cornerR, 5, (cellW - pad * 2) / 2 - 0.5, (cellH - pad * 2) / 2 - 0.5)

  if (isSolidRect(cells)) {
    let minR = Infinity, maxR = -Infinity, minC = Infinity, maxC = -Infinity
    for (const c of cells) {
      minR = Math.min(minR, c.row)
      maxR = Math.max(maxR, c.row)
      minC = Math.min(minC, c.col)
      maxC = Math.max(maxC, c.col)
    }
    const x = originX + minC * stepX + pad
    const y = originY + minR * stepY + pad
    const w = (maxC - minC + 1) * cellW + (maxC - minC) * gapX - pad * 2
    const h = (maxR - minR + 1) * cellH + (maxR - minR) * gapY - pad * 2
    const R = Math.max(1, Math.min(rr, Math.min(w, h) / 2 - 0.5))
    fillRoundedRect(g, x, y, w, h, { tl: R, tr: R, br: R, bl: R })
    g.fill(fillOpt)
    fillRoundedRect(g, x, y, w, h, { tl: R, tr: R, br: R, bl: R })
    g.stroke(strokeOpt)
    return
  }

  for (const c of cells) {
    const x = originX + c.col * stepX + pad
    const y = originY + c.row * stepY + pad
    const w = cellW - pad * 2
    const h = cellH - pad * 2
    fillRoundedRect(g, x, y, w, h, { tl: rr, tr: rr, br: rr, bl: rr })
    g.fill(fillOpt)
  }

  const byKey = new Set(cells.map((c) => `${c.row},${c.col}`))
  const has = (r: number, col: number): boolean => byKey.has(`${r},${col}`)
  const edgeStroke = { ...strokeOpt, cap: 'round' as const, join: 'round' as const }
  for (const c of cells) {
    const x0 = originX + c.col * stepX + pad
    const y0 = originY + c.row * stepY + pad
    const x1 = x0 + cellW - pad * 2
    const y1 = y0 + cellH - pad * 2
    if (!has(c.row - 1, c.col)) {
      g.moveTo(x0, y0)
      g.lineTo(x1, y0)
      g.stroke(edgeStroke)
    }
    if (!has(c.row + 1, c.col)) {
      g.moveTo(x0, y1)
      g.lineTo(x1, y1)
      g.stroke(edgeStroke)
    }
    if (!has(c.row, c.col - 1)) {
      g.moveTo(x0, y0)
      g.lineTo(x0, y1)
      g.stroke(edgeStroke)
    }
    if (!has(c.row, c.col + 1)) {
      g.moveTo(x1, y0)
      g.lineTo(x1, y1)
      g.stroke(edgeStroke)
    }
  }
}
