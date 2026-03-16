import { Application, Assets, BitmapText, Color, Container, Graphics, Point, Rectangle } from 'pixi.js'
import { createSpring2D, setSpringTarget, updateSpring2D } from './spring'
import type { SceneNodeVM, ScenePatch, SceneVM, SceneSegmentVM } from '../worker/protocol'

/** Stored on segment blocks for context-menu hit testing. */
type SegmentContext = { segmentId: string; nodeId: string }

type AdapterHandlers = {
  onHoverSegment(segmentId: string | null): void
  onMoveNode(nodeId: string, x: number, y: number): void
  onZoomChange(zoom: number): void
  onDragSegmentStart(segmentIds: string[]): void
  onDragSegmentUpdate(targetNodeId: string | null): void
  onDragSegmentEnd(targetNodeId: string | null): void
  onContextMenu(segmentId: string, nodeId: string, clientX: number, clientY: number): void
  onSegmentClick?(segmentId: string, nodeId: string, addToSelection: boolean): void
  onSegmentDoubleClick?(segmentId: string, itemDefId: string, nodeId: string): void
  onMarqueeSelect?(segmentIds: string[], addToSelection: boolean): void
}

type SegmentView = {
  container: Container
  spring: ReturnType<typeof createSpring2D>
}

type NodeView = {
  readonly root: Container
  readonly segmentContainer: Container
  segmentViews: Map<string, SegmentView>
}

type SegmentDragState = {
  readonly segments: readonly SceneSegmentVM[]
  readonly segmentIds: readonly string[]
  readonly sourceNodeIds: Readonly<Record<string, string>>
  readonly proxy: Container
  readonly lineLayer: Container
  snap: { nodeId: string; startSixth: number } | null
}

type ZoomTier = 'far' | 'medium' | 'close'

const STONE_GAP = 3
const STONE_W = 36
const STONE_H = 54
const SIXTH_ROWS = 6
const CELL_H = STONE_H / SIXTH_ROWS
const TOP_BAND_H = 34
const SLOT_START_X = 10
const SLOT_PADDING = 4
const DEFAULT_STONES_PER_ROW = 25
const STONE_ROW_GAP = 3

let stonesPerRow = DEFAULT_STONES_PER_ROW

const meterWidthForSlots = (slotCount: number): number =>
  Math.min(slotCount, stonesPerRow) * (STONE_W + STONE_GAP) - STONE_GAP
const totalSixthsForSlots = (slotCount: number): number => slotCount * 6

const SPEED_COLORS: Record<string, number> = {
  green: 0x3dba72,
  yellow: 0xc9b83d,
  orange: 0xd18a2e,
  red: 0xc93d4e,
}

const FONT_SEMIBOLD = 'Alegreya-SemiBold'
const FONT_REGULAR = 'Alegreya-Regular'

const ALEGREYA_SB_ADV: Record<number, number> = {
  32:9,33:14,34:15,35:25,36:22,37:34,38:34,39:8,40:14,41:14,42:20,43:24,44:13,
  45:17,46:14,47:16,48:25,49:17,50:23,51:20,52:22,53:21,54:22,55:20,56:23,57:22,
  58:11,59:11,60:23,61:24,62:23,63:18,64:41,65:29,66:30,67:30,68:33,69:29,70:25,
  71:32,72:36,73:17,74:16,75:31,76:25,77:40,78:35,79:33,80:27,81:33,82:30,83:26,
  84:27,85:32,86:30,87:46,88:32,89:28,90:28,91:15,92:16,93:15,94:24,95:22,96:19,
  97:23,98:25,99:21,100:26,101:22,102:16,103:24,104:26,105:14,106:13,107:25,108:12,
  109:40,110:27,111:25,112:26,113:25,114:19,115:20,116:16,117:26,118:22,119:35,
  120:24,121:22,122:22,123:15,124:17,125:15,126:24,
}
const ALEGREYA_SB_DEFAULT_ADV = 24
const ALEGREYA_SB_FONT_SIZE = 48

const fixedSlotBandColor = (stoneIndex: number, greenSlots: number): number => {
  if (stoneIndex < greenSlots) return SPEED_COLORS.green
  if (stoneIndex < greenSlots + 2) return SPEED_COLORS.yellow
  if (stoneIndex < greenSlots + 5) return SPEED_COLORS.orange
  return SPEED_COLORS.red
}

/** Animals and vehicles: green for first half of slots, orange for second half (50% breakpoint). */
const twoBandSlotColor = (stoneIndex: number, greenSlots: number): number =>
  stoneIndex < greenSlots ? SPEED_COLORS.green : SPEED_COLORS.orange

const getZoomTier = (zoom: number): ZoomTier => {
  if (zoom < 0.55) return 'far'
  if (zoom < 1.4) return 'medium'
  return 'close'
}

const TEXT_SCALE_STEPS = [2.2, 1.9, 1.6, 1.35, 1.2, 1.05, 0.92, 0.82, 0.74, 0.66]
const DEFAULT_MIN_VISIBLE_PX = 6
const DEFAULT_MAX_VISIBLE_PX = 12

/** Keep text fairly fixed size across zoom - clamp to narrow range so it stays legible. */
const getTextCompensationScale = (zoom: number): number => {
  const raw = 1 / zoom
  const matched = TEXT_SCALE_STEPS.reduce((best, step) => {
    return Math.abs(step - raw) < Math.abs(best - raw) ? step : best
  }, TEXT_SCALE_STEPS[0] ?? 1)
  return Math.min(1.1, Math.max(0.85, matched))
}

const textWidthCache = new Map<string, number>()
const textFitCache = new Map<string, { text: string; fontSize: number }>()

const compactToken = (label: string, maxChars: number): string => {
  const collapsed = label.replace(/[^a-z0-9]/gi, '')
  const noVowels = collapsed.replace(/[aeiou]/gi, '')
  const source = noVowels.length > 0 ? noVowels : collapsed
  const picked = source.slice(0, maxChars)
  const raw = picked.length > 0 ? picked : label.slice(0, maxChars)
  return raw.length === 0 ? '' : raw[0].toUpperCase() + raw.slice(1).toLowerCase()
}

const measureTextWidth = (text: string, fontSize: number): number => {
  const cacheKey = `${fontSize}|${text}`
  const cached = textWidthCache.get(cacheKey)
  if (cached !== undefined) return cached
  const scale = fontSize / ALEGREYA_SB_FONT_SIZE
  let w = 0
  for (let i = 0; i < text.length; i++) {
    w += ALEGREYA_SB_ADV[text.charCodeAt(i)] ?? ALEGREYA_SB_DEFAULT_ADV
  }
  const measured = w * scale
  textWidthCache.set(cacheKey, measured)
  return measured
}

const uniqueTextSteps = (segment: SceneSegmentVM): string[] => {
  const steps = [
    segment.tooltip.title,
    segment.fullLabel,
    segment.mediumLabel,
    segment.shortLabel,
    compactToken(segment.shortLabel, 4),
    compactToken(segment.shortLabel, 3),
    compactToken(segment.shortLabel, 2),
    compactToken(segment.shortLabel, 1),
  ]
  return steps.filter((value, index) => steps.indexOf(value) === index)
}

/** Wrap at word boundaries only - never mid-letter. Returns null if any word exceeds maxWidth. */
const wrapTextByWidth = (text: string, maxWidth: number, fontSize: number, maxLines: number): string[] | null => {
  const words = text.trim().split(/\s+/).filter((part) => part.length > 0)
  if (words.length === 0) return null
  for (const word of words) {
    if (measureTextWidth(word, fontSize) > maxWidth) return null
  }

  const lines: string[] = []
  let line = ''
  for (const word of words) {
    const candidate = line.length === 0 ? word : `${line} ${word}`
    if (measureTextWidth(candidate, fontSize) <= maxWidth) {
      line = candidate
      continue
    }
    if (line.length > 0) lines.push(line)
    line = word
    if (lines.length >= maxLines) return null
  }
  if (line.length > 0) lines.push(line)
  if (lines.length > maxLines) return null
  return lines
}

/** Use denser 2x3 layout only when zoomed far out. */
const GRID_ROWS = 3

const selectLabelFitForSteps = (
  steps: string[],
  tier: ZoomTier,
  availableWorldWidth: number,
  availableWorldHeight: number,
  visualScale: number,
  zoom: number,
  minVisiblePx: number,
  maxVisiblePx: number,
): { text: string; fontSize: number } => {
  const gridCols = tier === 'far' ? 2 : 1
  const cellW = availableWorldWidth / gridCols
  const maxLineWidth = cellW / visualScale
  const maxLines = GRID_ROWS

  const apparentScale = Math.max(0.01, visualScale * zoom)
  const minFontSize = Math.max(1, Math.ceil(minVisiblePx / apparentScale))
  const maxFontSize = Math.max(minFontSize, Math.floor(maxVisiblePx / visualScale))

  const cacheKey = `steps:${steps.join('|')}|${tier}|${gridCols}|${Math.round(availableWorldWidth)}|${Math.round(availableWorldHeight)}|${Math.round(visualScale * 100)}|${Math.round(zoom * 100)}|${minFontSize}|${maxFontSize}`
  const cached = textFitCache.get(cacheKey)
  if (cached) return cached

  for (const stepText of steps) {
    for (let fontSize = maxFontSize; fontSize >= minFontSize; fontSize -= 1) {
      const lineHeight = fontSize * 1.14
      const wrapped = wrapTextByWidth(stepText, maxLineWidth, fontSize, maxLines)
      if (!wrapped) continue
      const widestLine = wrapped.reduce((max, line) => Math.max(max, measureTextWidth(line, fontSize)), 0)
      const totalHeight = wrapped.length * lineHeight
      const worldWidth = widestLine * visualScale
      const worldHeight = totalHeight * visualScale
      if (worldWidth <= availableWorldWidth && worldHeight <= availableWorldHeight) {
        const fit = { text: wrapped.join('\n'), fontSize }
        textFitCache.set(cacheKey, fit)
        return fit
      }
    }
  }

  const fallback = {
    text: steps[steps.length - 1] ?? '?',
    fontSize: minFontSize,
  }
  textFitCache.set(cacheKey, fallback)
  return fallback
}

const isMultiStone = (segment: SceneSegmentVM): boolean =>
  segment.sizeSixths >= 6 && segment.sizeSixths % 6 === 0

const stoneToX = (stoneIndex: number): number =>
  (stoneIndex % stonesPerRow) * (STONE_W + STONE_GAP)
const stoneToY = (stoneIndex: number): number =>
  Math.floor(stoneIndex / stonesPerRow) * (STONE_H + STONE_ROW_GAP)

const slotAreaHeightForSlots = (slotCount: number): number => {
  const numRows = Math.ceil(slotCount / stonesPerRow)
  return numRows * (STONE_H + STONE_ROW_GAP) - STONE_ROW_GAP
}

/** Group sixths by stone column for blended rect drawing. */
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

const segmentStoneSpan = (startSixth: number, sizeSixths: number): { startStone: number; endStone: number } => {
  const startStone = Math.floor(startSixth / 6)
  const endStone = Math.max(startStone + 1, Math.ceil((startSixth + sizeSixths) / 6))
  return { startStone, endStone }
}

/** Position (top-left) of segment in node's local space (relative to node root). */
const segmentPositionInNode = (segment: SceneSegmentVM): { x: number; y: number } => {
  const { startStone } = segmentStoneSpan(segment.startSixth, segment.sizeSixths)
  const isMulti = segment.sizeSixths >= 6 && segment.sizeSixths % 6 === 0
  if (isMulti) {
    return {
      x: SLOT_START_X + stoneToX(startStone),
      y: TOP_BAND_H + stoneToY(startStone),
    }
  }
  const groups = groupSixthsByStone(segment.startSixth, segment.sizeSixths)
  let minX = Infinity, minY = Infinity
  groups.forEach((g) => {
    minX = Math.min(minX, stoneToX(g.stone))
    minY = Math.min(minY, stoneToY(g.stone) + g.startRow * CELL_H)
  })
  return {
    x: SLOT_START_X + minX,
    y: TOP_BAND_H + minY,
  }
}

/** Bounds of segment in node-local space (relative to node root). */
const segmentBoundsInNodeLocal = (segment: SceneSegmentVM): { x: number; y: number; w: number; h: number } => {
  const { startStone, endStone } = segmentStoneSpan(segment.startSixth, segment.sizeSixths)
  const isMulti = isMultiStone(segment)
  if (isMulti) {
    const chunks = splitStonesAtWrap(startStone, endStone)
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
    chunks.forEach((chunk) => {
      const cx = SLOT_START_X + stoneToX(chunk.start)
      const cy = TOP_BAND_H + stoneToY(chunk.start)
      const cw = (chunk.end - chunk.start) * (STONE_W + STONE_GAP) - STONE_GAP
      minX = Math.min(minX, cx)
      minY = Math.min(minY, cy)
      maxX = Math.max(maxX, cx + cw)
      maxY = Math.max(maxY, cy + STONE_H)
    })
    return { x: minX, y: minY, w: maxX - minX, h: maxY - minY }
  }
  const groups = groupSixthsByStone(segment.startSixth, segment.sizeSixths)
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  groups.forEach((g) => {
    const x = stoneToX(g.stone)
    const y = stoneToY(g.stone) + g.startRow * CELL_H
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

/** World-space center of a segment within a node. */
const segmentCenterInNode = (
  segment: SceneSegmentVM,
  nodeX: number,
  nodeY: number,
): { x: number; y: number } => {
  const { startStone, endStone } = segmentStoneSpan(segment.startSixth, segment.sizeSixths)
  const isMulti = segment.sizeSixths >= 6 && segment.sizeSixths % 6 === 0
  if (isMulti) {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
    for (let s = startStone; s < endStone; s += 1) {
      const x = stoneToX(s)
      const y = stoneToY(s)
      minX = Math.min(minX, x)
      minY = Math.min(minY, y)
      maxX = Math.max(maxX, x + STONE_W)
      maxY = Math.max(maxY, y + STONE_H)
    }
    return {
      x: nodeX + SLOT_START_X + (minX + maxX) / 2,
      y: nodeY + TOP_BAND_H + (minY + maxY) / 2,
    }
  }
  const groups = groupSixthsByStone(segment.startSixth, segment.sizeSixths)
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  groups.forEach((g) => {
    const x = stoneToX(g.stone)
    const y = stoneToY(g.stone) + g.startRow * CELL_H
    minX = Math.min(minX, x)
    minY = Math.min(minY, y)
    maxX = Math.max(maxX, x + STONE_W)
    maxY = Math.max(maxY, y + g.count * CELL_H)
  })
  return {
    x: nodeX + SLOT_START_X + (minX + maxX) / 2,
    y: nodeY + TOP_BAND_H + (minY + maxY) / 2,
  }
}

/** Draw arrow line from (x1,y1) to (x2,y2) with arrowhead at end. */
const drawArrowLine = (g: Graphics, x1: number, y1: number, x2: number, y2: number): void => {
  const dx = x2 - x1
  const dy = y2 - y1
  const len = Math.sqrt(dx * dx + dy * dy)
  if (len < 2) return
  const ux = dx / len
  const uy = dy / len
  const arrowLen = 10
  const arrowAngle = Math.PI / 6
  const ax1 = x2 - ux * arrowLen + uy * arrowLen * Math.tan(arrowAngle)
  const ay1 = y2 - uy * arrowLen - ux * arrowLen * Math.tan(arrowAngle)
  const ax2 = x2 - ux * arrowLen - uy * arrowLen * Math.tan(arrowAngle)
  const ay2 = y2 - uy * arrowLen + ux * arrowLen * Math.tan(arrowAngle)
  g.moveTo(x1, y1)
  g.lineTo(x2, y2)
  g.moveTo(ax1, ay1)
  g.lineTo(x2, y2)
  g.lineTo(ax2, ay2)
  g.stroke({ width: 2, color: 0x5cadee, alpha: 0.85 })
}

/** Split stone range into chunks at stonesPerRow boundaries. */
const splitStonesAtWrap = (
  startStone: number,
  endStone: number,
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

/** Draw rect with fill and stroke on specific sides (for wrap continuity). */
const drawChunkRect = (
  g: Graphics,
  x: number,
  y: number,
  w: number,
  h: number,
  sides: { left: boolean; top: boolean; right: boolean; bottom: boolean },
  fillOpt: { color: number; alpha: number },
  strokeOpt: { width: number; color: number; alpha: number },
  cornerRadius: number,
): void => {
  g.roundRect(x, y, w, h, cornerRadius)
  g.fill(fillOpt)
  g.moveTo(x + w, y + h)
  if (sides.bottom) g.lineTo(x, y + h)
  if (sides.left) g.lineTo(x, y)
  if (sides.top) g.lineTo(x + w, y)
  if (sides.right) g.lineTo(x + w, y + h)
  g.stroke(strokeOpt)
}

const occupiedSixthsFromSegments = (
  segments: readonly SceneSegmentVM[],
  totalSixths: number,
): Set<number> => {
  const occupied = new Set<number>()
  segments.forEach((segment) => {
    if (segment.isOverflow) return
    const start = Math.max(0, segment.startSixth)
    const endExclusive = Math.min(totalSixths, segment.startSixth + segment.sizeSixths)
    for (let idx = start; idx < endExclusive; idx += 1) {
      occupied.add(idx)
    }
  })
  return occupied
}

const localToSixth = (localX: number, localY: number, slotCount: number): number => {
  if (localX <= 0) return 0
  const totalSixths = totalSixthsForSlots(slotCount)
  const numRows = Math.ceil(slotCount / stonesPerRow)
  for (let rowIndex = 0; rowIndex < numRows; rowIndex += 1) {
    const rowY = rowIndex * (STONE_H + STONE_ROW_GAP)
    const rowBottom = rowY + STONE_H
    if (localY < rowY) return Math.min(totalSixths, rowIndex * stonesPerRow * 6)
    if (localY >= rowBottom + (rowIndex < numRows - 1 ? STONE_ROW_GAP : 0)) continue
    const stonesInRow = Math.min(stonesPerRow, slotCount - rowIndex * stonesPerRow)
    const rowWidth = stonesInRow * (STONE_W + STONE_GAP) - STONE_GAP
    if (localX >= rowWidth + STONE_W) return Math.min(totalSixths, (rowIndex * stonesPerRow + stonesInRow) * 6)
    for (let col = 0; col < stonesInRow; col += 1) {
      const stoneStart = col * (STONE_W + STONE_GAP)
      const stoneEnd = stoneStart + STONE_W
      if (localX >= stoneStart && localX < stoneEnd) {
        const sixthRow = Math.max(0, Math.min(5, Math.floor((localY - rowY) / CELL_H)))
        return (rowIndex * stonesPerRow + col) * 6 + sixthRow
      }
      if (localX >= stoneEnd && localX < stoneStart + STONE_W + STONE_GAP) {
        return (rowIndex * stonesPerRow + col + 1) * 6
      }
    }
    return Math.min(totalSixths, (rowIndex * stonesPerRow + stonesInRow) * 6)
  }
  return totalSixths
}

/** Hand/fist marker to indicate wielded sides. */
const GRIP_ICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">
  <path d="M6.6 13.8v-2.2a1.5 1.5 0 1 1 3 0V7.1a1.5 1.5 0 1 1 3 0v4.5V6.3a1.5 1.5 0 1 1 3 0v5.3V7.9a1.5 1.5 0 1 1 3 0v8.2c0 2.5-2 4.5-4.5 4.5h-4.2c-2.5 0-4.5-2-4.5-4.5V14l-1.1-1.1a1.6 1.6 0 1 1 2.3-2.3l1 1Z"
    fill="#ffd84a" stroke="#fff6b3" stroke-width="0.9" stroke-linejoin="round"/>
</svg>`

const GRIP_ICON_SIZE = 10

/** Draw grip indicators on left and/or right edge of segment bounds based on wield state. */
const drawGripIndicators = (
  container: Container,
  wield: 'left' | 'right' | 'both' | undefined,
  bounds: { x: number; y: number; w: number; h: number },
): void => {
  if (!wield) return
  const cy = bounds.y + bounds.h / 2
  const scale = GRIP_ICON_SIZE / 24

  const drawOneGrip = (x: number, flip = false): void => {
    const g = new Graphics()
    g.eventMode = 'none'
    g.svg(GRIP_ICON_SVG)
    // Anchor at icon center, then mirror/scale so left/right markers stay edge-aligned.
    g.pivot.set(12, 12)
    g.position.set(x, cy)
    g.scale.set(flip ? -scale : scale, scale)
    container.addChild(g)
  }

  if (wield === 'left' || wield === 'both') {
    drawOneGrip(bounds.x, true)
  }
  if (wield === 'right' || wield === 'both') {
    drawOneGrip(bounds.x + bounds.w, false)
  }
}

/** Draw individual cells for drag ghost (no labels). */
const drawGhostCells = (
  container: Container,
  startSixth: number,
  baseX: number,
  baseY: number,
  sizeSixths: number,
  color: number,
  alpha: number,
): void => {
  for (let i = 0; i < sizeSixths; i += 1) {
    const stone = Math.floor((startSixth + i) / 6)
    const row = (startSixth + i) % 6
    const x = baseX + stoneToX(stone)
    const y = baseY + stoneToY(stone) + row * CELL_H
    const cellGraphic = new Graphics()
    cellGraphic.roundRect(x + 1.2, y + 0.6, STONE_W - 2.4, CELL_H - 1.2, 1.8)
    cellGraphic.fill({ color, alpha })
    container.addChild(cellGraphic)
  }
}

/** Draw blended rectangles: one per stone column, with (cont.) label for continuations. */
const drawBlendedSegmentRects = (
  container: Container,
  segment: SceneSegmentVM,
  baseX: number,
  baseY: number,
  color: number,
  alpha: number,
  _totalSixths: number,
  tier: ZoomTier,
  zoom: number,
  textCompensationScale: number,
  minVisibleLabelPx: number,
  maxVisibleLabelPx: number,
): { hitBounds: { x: number; y: number; w: number; h: number } } => {
  const groups = groupSixthsByStone(segment.startSixth, segment.sizeSixths)
  const PAD = 1.2
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity

  const zoomReadableScale = zoom < 0.45 ? 1.14 : 1
  const visualScale = textCompensationScale * zoomReadableScale

  const isDropPreview = segment.isDropPreview === true

  groups.forEach((group, index) => {
    const x = baseX + stoneToX(group.stone)
    const y = baseY + stoneToY(group.stone) + group.startRow * CELL_H
    const w = STONE_W
    const h = group.count * CELL_H

    const rect = new Graphics()
    rect.eventMode = 'none'
    rect.roundRect(x + PAD, y + PAD, w - PAD * 2, h - PAD * 2, 4)
    rect.fill({ color, alpha })
    if (isDropPreview) {
      rect.stroke({ width: 2, color: 0x5cadee, alpha: 0.7 })
    }
    container.addChild(rect)

    minX = Math.min(minX, x)
    minY = Math.min(minY, y)
    maxX = Math.max(maxX, x + w)
    maxY = Math.max(maxY, y + h)

    const availableWorldWidth = Math.max(8, w - 6)
    const availableWorldHeight = Math.max(8, h - 6)
    const centerX = x + w / 2
    const centerY = y + h / 2

    const steps = index === 0
      ? uniqueTextSteps(segment)
      : uniqueTextSteps(segment).map((s) => `${s} (cont.)`)
    const fit = selectLabelFitForSteps(
      steps,
      tier,
      availableWorldWidth,
      availableWorldHeight,
      visualScale,
      zoom,
      minVisibleLabelPx,
      maxVisibleLabelPx,
    )
    const txt = new BitmapText({
      text: fit.text,
      style: { fill: '#f0f8ff', fontSize: fit.fontSize, fontFamily: FONT_SEMIBOLD, align: 'center' },
    })
    txt.eventMode = 'none'
    txt.scale.set(visualScale)
    txt.anchor.set(0.5, 0.5)
    txt.position.set(centerX, centerY)

    const clip = new Graphics()
    clip.eventMode = 'none'
    clip.rect(centerX - availableWorldWidth / 2, centerY - availableWorldHeight / 2, availableWorldWidth, availableWorldHeight)
    clip.fill({ color: 0xffffff, alpha: 0.001 })
    container.addChild(clip)
    txt.mask = clip
    container.addChild(txt)
  })

  return {
    hitBounds: {
      x: minX,
      y: minY,
      w: maxX - minX,
      h: maxY - minY,
    },
  }
}

const drawSegmentBlock = (
  container: Container,
  segment: SceneSegmentVM,
  tier: ZoomTier,
  zoom: number,
  hovered: boolean,
  handlers: AdapterHandlers,
  textCompensationScale: number,
  minVisibleLabelPx: number,
  maxVisibleLabelPx: number,
  totalSixths: number,
  onTooltipEnter?: (segment: SceneSegmentVM, globalX: number, globalY: number) => void,
  onTooltipMove?: (globalX: number, globalY: number) => void,
  onTooltipLeave?: () => void,
  nodeId?: string,
  onDragStart?: (segment: SceneSegmentVM, nodeId: string, x: number, y: number) => void,
  baseOffset?: { x: number; y: number },
  filterCategory?: string | null,
  _selectedSegmentIds?: readonly string[],
  onSegmentClick?: (segmentId: string, nodeId: string, addToSelection: boolean) => void,
  onSegmentDoubleClick?: (segmentId: string, itemDefId: string, nodeId: string) => void,
  getLastDragEndTime?: () => number,
): void => {
  const o = baseOffset ?? { x: 0, y: 0 }
  const { startStone, endStone } = segmentStoneSpan(segment.startSixth, segment.sizeSixths)
  const isDropPreview = segment.isDropPreview === true
  const dimmed = filterCategory != null && segment.category !== filterCategory
  const color = isDropPreview ? 0x5cadee : segment.isOverflow ? 0x932d4e : hovered ? 0x5cadee : 0x3d9ac9
  const alpha = isDropPreview ? 0.25 : segment.isOverflow ? 0.88 : dimmed ? 0.65 : 0.95

  const block = new Graphics()
  block.eventMode = 'static'
  block.cursor = 'pointer'
  block.on('pointerover', (event: any) => {
    handlers.onHoverSegment(segment.id)
    onTooltipEnter?.(segment, event.global.x, event.global.y)
  })
  block.on('pointermove', (event: any) => {
    onTooltipMove?.(event.global.x, event.global.y)
  })
  block.on('pointerout', () => {
    handlers.onHoverSegment(null)
    onTooltipLeave?.()
  })
  if (onDragStart && nodeId) {
    block.on('pointerdown', (event: any) => {
      if (event.button === 0) {
        event.stopPropagation()
        onTooltipLeave?.()
        onDragStart(segment, nodeId, event.global.x, event.global.y)
      }
    })
  }
  if (nodeId && (onSegmentClick || onSegmentDoubleClick)) {
    block.on('pointertap', (event: any) => {
      if (event.button !== 0) return
      if (getLastDragEndTime && Date.now() - getLastDragEndTime() < 150) return
      if (event.detail === 2) {
        onSegmentDoubleClick?.(segment.id, segment.itemDefId, nodeId)
      } else {
        onSegmentClick?.(segment.id, nodeId, event.ctrlKey || event.metaKey || event.shiftKey)
      }
    })
  }
  if (nodeId) {
    ;(block as Graphics & { __segmentContext?: SegmentContext }).__segmentContext = {
      segmentId: segment.id,
      nodeId,
    }
  }

  if (isMultiStone(segment)) {
    const chunks = splitStonesAtWrap(startStone, endStone)
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
    const strokeOpt = isDropPreview
      ? { width: 2, color: 0x5cadee, alpha: 0.7 }
      : { width: 1.5, color: 0xd3ebff, alpha: 0.9 }
    const fillOpt = { color, alpha }

    container.addChild(block)
    chunks.forEach((chunk, idx) => {
      const cx = SLOT_START_X + stoneToX(chunk.start) - o.x
      const cy = TOP_BAND_H + stoneToY(chunk.start) - o.y
      const cw = (chunk.end - chunk.start) * (STONE_W + STONE_GAP) - STONE_GAP
      const ch = STONE_H
      const pad = 0.5
      const rx = cx + pad
      const ry = cy + 2.5
      const rw = cw - 1
      const rh = ch - 5
      const isFirst = idx === 0
      const isLast = idx === chunks.length - 1
      const sides = {
        left: isFirst || chunks.length === 1,
        top: true,
        right: isLast || chunks.length === 1,
        bottom: true,
      }
      drawChunkRect(block, rx, ry, rw, rh, sides, fillOpt, strokeOpt, 5)
      minX = Math.min(minX, rx)
      minY = Math.min(minY, ry)
      maxX = Math.max(maxX, rx + rw)
      maxY = Math.max(maxY, ry + rh)

      if (segment.sizeSixths >= 1) {
        const availableWorldWidth = Math.max(8, rw - 6)
        const availableWorldHeight = Math.max(8, rh - 8)
        const centerX = rx + rw / 2
        const centerY = ry + rh / 2
        const zoomReadableScale = zoom < 0.45 ? 1.14 : 1
        const visualScale = textCompensationScale * zoomReadableScale
        const steps = idx === 0 ? uniqueTextSteps(segment) : uniqueTextSteps(segment).map((s) => `${s} (cont.)`)
        const fit = selectLabelFitForSteps(
          steps,
          tier,
          availableWorldWidth,
          availableWorldHeight,
          visualScale,
          zoom,
          minVisibleLabelPx,
          maxVisibleLabelPx,
        )
        const txt = new BitmapText({
          text: fit.text,
          style: { fill: '#f0f8ff', fontSize: fit.fontSize, fontFamily: FONT_SEMIBOLD, align: 'center' },
        })
        txt.eventMode = 'none'
        txt.scale.set(visualScale)
        txt.anchor.set(0.5, 0.5)
        txt.position.set(centerX, centerY)

        const clip = new Graphics()
        clip.eventMode = 'none'
        clip.rect(centerX - availableWorldWidth / 2, centerY - availableWorldHeight / 2, availableWorldWidth, availableWorldHeight)
        clip.fill({ color: 0xffffff, alpha: 0.001 })
        container.addChild(clip)
        txt.mask = clip
        container.addChild(txt)
      }
    })

    const blockBounds = { x: minX, y: minY, w: maxX - minX, h: maxY - minY }
    block.rect(blockBounds.x, blockBounds.y, blockBounds.w, blockBounds.h)
    block.fill({ color: 0xffffff, alpha: 0.001 })
    block.hitArea = new Rectangle(blockBounds.x, blockBounds.y, blockBounds.w, blockBounds.h)
    drawGripIndicators(container, segment.wield, blockBounds)
  } else {
    const { hitBounds } = drawBlendedSegmentRects(
      container,
      segment,
      SLOT_START_X - o.x,
      TOP_BAND_H - o.y,
      color,
      alpha,
      totalSixths,
      tier,
      zoom,
      textCompensationScale,
      minVisibleLabelPx,
      maxVisibleLabelPx,
    )
    block.rect(hitBounds.x, hitBounds.y, hitBounds.w, hitBounds.h)
    block.fill({ color: 0xffffff, alpha: 0.001 })
    block.hitArea = new Rectangle(hitBounds.x, hitBounds.y, hitBounds.w, hitBounds.h)
    container.addChild(block)
    drawGripIndicators(container, segment.wield, hitBounds)
  }
}

export class PixiBoardAdapter {
  private app: Application
  private sceneRoot: Container
  private worldLayer: Container
  private selectionOverlayLayer: Container
  private hudLayer: Container
  private readonly nodeViews = new Map<string, NodeView>()
  private readonly handlers: AdapterHandlers
  private zoom = 0.85
  private pan = { x: 60, y: 60 }
  private readonly paceText: BitmapText
  private readonly tooltipLayer: Container
  private readonly tooltipBg: Graphics
  private readonly tooltipText: BitmapText
  private currentScene: SceneVM | null = null
  private segmentDrag: SegmentDragState | null = null
  private lastDragEndTime = 0
  private marqueeState: { startX: number; startY: number; endX: number; endY: number } | null = null
  private marqueeGraphics: Graphics | null = null
  private minVisibleLabelPx = DEFAULT_MIN_VISIBLE_PX
  private readonly maxVisibleLabelPx = DEFAULT_MAX_VISIBLE_PX
  private fontsLoaded = false

  constructor(host: HTMLElement, handlers: AdapterHandlers) {
    this.handlers = handlers
    this.app = new Application()
    this.sceneRoot = new Container()
    this.worldLayer = new Container()
    this.selectionOverlayLayer = new Container()
    this.selectionOverlayLayer.eventMode = 'none'
    this.hudLayer = new Container()
    this.tooltipLayer = new Container()
    this.tooltipBg = new Graphics()
    this.tooltipText = new BitmapText({
      text: '',
      style: { fill: '#eaf1ff', fontSize: 12, fontFamily: FONT_REGULAR },
    })
    this.paceText = new BitmapText({
      text: '',
      style: { fill: '#b8caee', fontSize: 14, fontFamily: FONT_REGULAR },
    })

    void this.mount(host)
  }

  private async mount(host: HTMLElement): Promise<void> {
    await this.app.init({
      resizeTo: host,
      antialias: true,
      backgroundColor: new Color('#070d1a'),
    })

    await Promise.all([
      Assets.load('fonts/Alegreya-SemiBold.fnt'),
      Assets.load('fonts/Alegreya-Regular.fnt'),
    ])
    this.fontsLoaded = true

    host.replaceChildren(this.app.canvas)
    this.app.canvas.addEventListener('contextmenu', (event: MouseEvent) => {
      event.preventDefault()
      const ctx = this.hitTestSegmentContext(event.clientX, event.clientY)
      if (ctx) this.handlers.onContextMenu(ctx.segmentId, ctx.nodeId, event.clientX, event.clientY)
    })

    this.sceneRoot.addChild(this.worldLayer)
    this.sceneRoot.addChild(this.selectionOverlayLayer)
    this.app.stage.addChild(this.sceneRoot)
    this.hudLayer.addChild(this.paceText)
    this.tooltipLayer.addChild(this.tooltipBg)
    this.tooltipLayer.addChild(this.tooltipText)
    this.tooltipLayer.visible = false
    this.hudLayer.addChild(this.tooltipLayer)
    this.marqueeGraphics = new Graphics()
    this.marqueeGraphics.eventMode = 'none'
    this.hudLayer.addChild(this.marqueeGraphics)
    this.app.stage.addChild(this.hudLayer)
    this.paceText.position.set(16, 12)

    this.setupPanZoom()
    this.applyCamera()

    if (this.currentScene) this.rebuildAllNodes(this.currentScene)
  }

  private setupPanZoom(): void {
    let panning = false
    let last = { x: 0, y: 0 }

    this.app.canvas.addEventListener(
      'pointerdown',
      (event: PointerEvent) => {
        if (event.button === 2) {
          const ctx = this.hitTestSegmentContext(event.clientX, event.clientY)
          if (ctx) event.stopImmediatePropagation()
        }
      },
      { capture: true },
    )

    const canvasCoords = (e: PointerEvent) => {
      const rect = this.app.canvas.getBoundingClientRect()
      return { x: e.clientX - rect.left, y: e.clientY - rect.top }
    }

    const onDown = (event: PointerEvent): void => {
      if (event.button === 0) {
        if (!this.hitTestSkipMarquee(event.clientX, event.clientY) && this.handlers.onMarqueeSelect) {
          const { x, y } = canvasCoords(event)
          this.marqueeState = { startX: x, startY: y, endX: x, endY: y }
          this.drawMarquee()
        }
        return
      }
      if (event.button === 1 || event.button === 2) {
        panning = true
        last = { x: event.clientX, y: event.clientY }
      }
    }

    const onUp = (event: PointerEvent): void => {
      if (event.button === 0 && this.marqueeState) {
        const { x, y } = canvasCoords(event)
        this.marqueeState.endX = x
        this.marqueeState.endY = y
        this.finishMarquee(event.shiftKey || event.ctrlKey || event.metaKey)
        this.marqueeState = null
        this.drawMarquee()
        return
      }
      panning = false
      if (this.segmentDrag) this.endSegmentDrag(event)
    }

    const onMove = (event: PointerEvent): void => {
      if (this.marqueeState) {
        const { x, y } = canvasCoords(event)
        this.marqueeState.endX = x
        this.marqueeState.endY = y
        this.drawMarquee()
        return
      }
      if (this.segmentDrag) {
        this.updateSegmentDrag(event.clientX, event.clientY)
        return
      }
      if (!panning) return
      this.pan.x += event.clientX - last.x
      this.pan.y += event.clientY - last.y
      last = { x: event.clientX, y: event.clientY }
      this.applyCamera()
    }

    const onWheel = (event: WheelEvent): void => {
      event.preventDefault()
      const direction = event.deltaY > 0 ? -1 : 1
      const factor = direction > 0 ? 1.12 : 0.9
      const prev = this.zoom
      this.zoom = Math.min(3.0, Math.max(0.18, this.zoom * factor))
      const ratio = this.zoom / prev
      this.pan.x = event.offsetX - (event.offsetX - this.pan.x) * ratio
      this.pan.y = event.offsetY - (event.offsetY - this.pan.y) * ratio
      this.applyCamera()
      this.handlers.onZoomChange(this.zoom)
      if (this.currentScene) this.rebuildAllNodes(this.currentScene)
    }

    this.app.canvas.addEventListener('pointerdown', onDown)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointermove', onMove)
    this.app.canvas.addEventListener('wheel', onWheel, { passive: false })
  }

  private applyCamera(): void {
    this.sceneRoot.position.set(this.pan.x, this.pan.y)
    this.sceneRoot.scale.set(this.zoom, this.zoom)
  }

  private updateSelectionOverlay(): void {
    this.selectionOverlayLayer.removeChildren()
    if (!this.currentScene) return
    const selectedIds = new Set(this.currentScene.selectedSegmentIds ?? [])
    if (selectedIds.size === 0) return
    const PAD = 1.5
    const STROKE = 3
    for (const [nodeId, view] of this.nodeViews) {
      const node = this.currentScene.nodes[nodeId]
      if (!node) continue
      for (const segment of node.segments) {
        if (!selectedIds.has(segment.id)) continue
        const segView = view.segmentViews.get(segment.id)
        const bounds = segmentBoundsInNodeLocal(segment)
        const pos = segmentPositionInNode(segment)
        const worldX = node.x + (segView ? segView.container.position.x : pos.x) + bounds.x - pos.x
        const worldY = node.y + (segView ? segView.container.position.y : pos.y) + bounds.y - pos.y
        const g = new Graphics()
        g.eventMode = 'none'
        g.rect(worldX - PAD, worldY - PAD, bounds.w + PAD * 2, bounds.h + PAD * 2)
        g.stroke({ width: STROKE, color: 0xffffff, alpha: 0.95 })
        this.selectionOverlayLayer.addChild(g)
      }
    }
  }

  private drawMarquee(): void {
    if (!this.marqueeGraphics) return
    this.marqueeGraphics.clear()
    if (!this.marqueeState) return
    const { startX, startY, endX, endY } = this.marqueeState
    const x = Math.min(startX, endX)
    const y = Math.min(startY, endY)
    const w = Math.abs(endX - startX)
    const h = Math.abs(endY - startY)
    if (w < 2 && h < 2) return
    this.marqueeGraphics.rect(x, y, w, h)
    this.marqueeGraphics.stroke({ width: 2, color: 0x5cadee, alpha: 0.9 })
    this.marqueeGraphics.fill({ color: 0x5cadee, alpha: 0.12 })
  }

  private finishMarquee(addToSelection: boolean): void {
    if (!this.marqueeState || !this.currentScene || !this.handlers.onMarqueeSelect) return
    const { startX, startY, endX, endY } = this.marqueeState
    const x1 = Math.min(startX, endX)
    const y1 = Math.min(startY, endY)
    const x2 = Math.max(startX, endX)
    const y2 = Math.max(startY, endY)
    const minW = (x1 - this.pan.x) / this.zoom
    const maxW = (x2 - this.pan.x) / this.zoom
    const minH = (y1 - this.pan.y) / this.zoom
    const maxH = (y2 - this.pan.y) / this.zoom
    const segmentIds: string[] = []
    for (const node of Object.values(this.currentScene.nodes)) {
      for (const segment of node.segments) {
        if (segment.isDropPreview) continue
        const b = segmentBoundsInNodeLocal(segment)
        const segX1 = node.x + b.x
        const segY1 = node.y + b.y
        const segX2 = segX1 + b.w
        const segY2 = segY1 + b.h
        if (segX1 < maxW && segX2 > minW && segY1 < maxH && segY2 > minH) {
          segmentIds.push(segment.id)
        }
      }
    }
    this.handlers.onMarqueeSelect(segmentIds, addToSelection)
  }

  private showTooltip(segment: SceneSegmentVM, globalX: number, globalY: number): void {
    const line1 = segment.tooltip.title
    const line2 = `${segment.tooltip.quantityText} qty • ${segment.tooltip.encumbranceText}`
    const line3 = segment.tooltip.zoneText
    this.tooltipText.text = `${line1}\n${line2}\n${line3}`

    this.tooltipBg.clear()
    this.tooltipBg.roundRect(0, 0, this.tooltipText.width + 14, this.tooltipText.height + 12, 6)
    this.tooltipBg.fill({ color: 0x060b18, alpha: 0.94 })
    this.tooltipBg.stroke({ width: 1, color: 0x3f5f99, alpha: 0.9 })
    this.tooltipText.position.set(7, 6)

    this.tooltipLayer.visible = true
    this.moveTooltip(globalX, globalY)
  }

  private moveTooltip(globalX: number, globalY: number): void {
    if (!this.tooltipLayer.visible) return
    const padding = 14
    const x = Math.min(this.app.screen.width - this.tooltipBg.width - padding, globalX + 14)
    const y = Math.min(this.app.screen.height - this.tooltipBg.height - padding, globalY + 14)
    this.tooltipLayer.position.set(Math.max(8, x), Math.max(8, y))
  }

  private hideTooltip(): void {
    this.tooltipLayer.visible = false
  }

  setLabelMinVisiblePx(value: number): void {
    this.minVisibleLabelPx = Math.max(4, Math.min(12, Math.round(value)))
    textFitCache.clear()
    if (this.currentScene) this.rebuildAllNodes(this.currentScene)
  }

  setStonesPerRow(value: number): void {
    const v = Math.max(10, Math.min(50, Math.round(value)))
    if (stonesPerRow === v) return
    stonesPerRow = v
    textFitCache.clear()
    // Worker will send new scene with updated node dimensions; applyInit will rebuild
  }

  /** Hit-test at client coords; returns segment context if over a segment block. */
  private hitTestSegmentContext(clientX: number, clientY: number): SegmentContext | null {
    const events = (this.app.renderer as { events?: { mapPositionToPoint: (p: Point, x: number, y: number) => void; rootBoundary?: { hitTest: (x: number, y: number) => Container } } }).events
    if (!events?.rootBoundary) return null
    const pt = new Point()
    events.mapPositionToPoint(pt, clientX, clientY)
    const hit = events.rootBoundary.hitTest(pt.x, pt.y)
    if (!hit) return null
    let cur: Container | null = hit
    while (cur) {
      const ctx = (cur as Container & { __segmentContext?: SegmentContext }).__segmentContext
      if (ctx) return ctx
      cur = cur.parent
    }
    return null
  }

  /** True if we hit a segment or drag handle (should not start marquee). */
  private hitTestSkipMarquee(clientX: number, clientY: number): boolean {
    const events = (this.app.renderer as { events?: { mapPositionToPoint: (p: Point, x: number, y: number) => void; rootBoundary?: { hitTest: (x: number, y: number) => Container } } }).events
    if (!events?.rootBoundary) return false
    const pt = new Point()
    events.mapPositionToPoint(pt, clientX, clientY)
    const hit = events.rootBoundary.hitTest(pt.x, pt.y)
    if (!hit) return false
    let cur: Container | null = hit
    while (cur) {
      const c = cur as Container & { __segmentContext?: SegmentContext; __dragHandle?: boolean }
      if (c.__segmentContext || c.__dragHandle) return true
      cur = cur.parent
    }
    return false
  }

  private screenToWorld(clientX: number, clientY: number): { x: number; y: number } {
    const rect = this.app.canvas.getBoundingClientRect()
    const canvasX = clientX - rect.left
    const canvasY = clientY - rect.top
    return {
      x: (canvasX - this.pan.x) / this.zoom,
      y: (canvasY - this.pan.y) / this.zoom,
    }
  }

  /** Drop target = whole character node. Returns nodeId if world point is inside any node's bounds. */
  private findDropTarget(worldX: number, worldY: number): string | null {
    if (!this.currentScene) return null
    for (const node of Object.values(this.currentScene.nodes)) {
      if (worldX >= node.x && worldX <= node.x + node.width &&
          worldY >= node.y && worldY <= node.y + node.height) {
        return node.id
      }
    }
    return null
  }

  private findSnapTarget(worldX: number, worldY: number, segment: SceneSegmentVM): { nodeId: string; startSixth: number } | null {
    const targetNodeId = this.findDropTarget(worldX, worldY)
    if (!targetNodeId || !this.currentScene) return null

    const node = this.currentScene.nodes[targetNodeId]
    if (!node) return null

    const nodeMeterWidth = meterWidthForSlots(node.slotCount)
    const slotAreaH = slotAreaHeightForSlots(node.slotCount)
    const inY = worldY >= node.y + TOP_BAND_H && worldY <= node.y + TOP_BAND_H + slotAreaH
    if (!inY) return { nodeId: targetNodeId, startSixth: 0 }
    const localX = worldX - node.x - SLOT_START_X
    const localY = worldY - node.y - TOP_BAND_H
    if (localX < -STONE_W || localX > nodeMeterWidth + STONE_W) return { nodeId: targetNodeId, startSixth: 0 }

    let startSixth = localToSixth(localX, localY, node.slotCount)
    if (isMultiStone(segment)) {
      startSixth = Math.floor(startSixth / 6) * 6
    }
    const totalSixths = totalSixthsForSlots(node.slotCount)
    const maxStart = Math.max(0, totalSixths - segment.sizeSixths)
    startSixth = Math.max(0, Math.min(maxStart, startSixth))
    return { nodeId: targetNodeId, startSixth }
  }

  private buildDragProxy(segments: readonly SceneSegmentVM[]): Container {
    const proxy = new Container()
    const ITEM_GAP = 4
    let offsetY = 0

    for (const segment of segments) {
      const color = segment.isOverflow ? 0xa83f62 : isMultiStone(segment) ? 0x61b5ff : 0x7bd7cf
      const alpha = 0.75

      if (isMultiStone(segment)) {
        const w = (segment.sizeSixths / 6) * (STONE_W + STONE_GAP) - STONE_GAP
        const rect = new Graphics()
        rect.roundRect(0, offsetY, w, STONE_H, 6)
        rect.fill({ color, alpha })
        rect.stroke({ width: 1.5, color: 0xd3ebff, alpha: 0.9 })
        proxy.addChild(rect)
        offsetY += STONE_H + ITEM_GAP
      } else {
        drawGhostCells(proxy, 0, offsetY, 0, segment.sizeSixths, color, alpha)
        const groups = groupSixthsByStone(0, segment.sizeSixths)
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
        groups.forEach((g) => {
          const gy = offsetY + stoneToY(g.stone) + g.startRow * CELL_H
          minX = Math.min(minX, stoneToX(g.stone))
          minY = Math.min(minY, gy)
          maxX = Math.max(maxX, stoneToX(g.stone) + STONE_W)
          maxY = Math.max(maxY, gy + g.count * CELL_H)
        })
        const stroke = new Graphics()
        stroke.roundRect(minX, minY, maxX - minX, maxY - minY, 4)
        stroke.stroke({ width: 1.5, color: 0xd3ebff, alpha: 0.85 })
        proxy.addChild(stroke)
        offsetY += (maxY - minY) + ITEM_GAP
      }
    }

    const b = proxy.getBounds()
    proxy.pivot.set(b.width / 2, b.height / 2)
    return proxy
  }

  private getDropTargetCenters(): { x: number; y: number }[] {
    const centers: { x: number; y: number }[] = []
    if (!this.segmentDrag?.snap || !this.currentScene || this.segmentDrag.segments.length === 0) return centers
    const { nodeId, startSixth } = this.segmentDrag.snap
    const node = this.currentScene.nodes[nodeId]
    if (!node) return centers
    const previewSegs = node.segments.filter((s) => s.isDropPreview === true)
    if (previewSegs.length > 0) {
      previewSegs.forEach((s) => centers.push(segmentCenterInNode(s, node.x, node.y)))
      return centers
    }
    let cursorSixth = startSixth
    for (const seg of this.segmentDrag.segments) {
      const isSameAsSource = nodeId === this.segmentDrag.sourceNodeIds[seg.id]
      if (isSameAsSource) {
        const actualSeg = node.segments.find((s) => s.id === seg.id)
        if (actualSeg) {
          centers.push(segmentCenterInNode(actualSeg, node.x, node.y))
          cursorSixth = actualSeg.startSixth + actualSeg.sizeSixths
        } else {
          centers.push(segmentCenterInNode({ ...seg, startSixth: cursorSixth, sizeSixths: seg.sizeSixths }, node.x, node.y))
          cursorSixth += seg.sizeSixths
        }
      } else {
        centers.push(segmentCenterInNode({ ...seg, startSixth: cursorSixth, sizeSixths: seg.sizeSixths }, node.x, node.y))
        cursorSixth += seg.sizeSixths
      }
    }
    return centers
  }

  private beginSegmentDrag(segment: SceneSegmentVM, _sourceNodeId: string, globalX: number, globalY: number): void {
    if (this.segmentDrag) this.endSegmentDrag()
    const selectedIds = this.currentScene?.selectedSegmentIds ?? []
    const segmentIds = selectedIds.includes(segment.id) && selectedIds.length > 1
      ? [...selectedIds]
      : [segment.id]
    const segmentById = new Map<string, SceneSegmentVM>()
    const sourceNodeIds: Record<string, string> = {}
    if (!this.currentScene) return
    for (const node of Object.values(this.currentScene.nodes)) {
      for (const seg of node.segments) {
        if (segmentIds.includes(seg.id)) {
          segmentById.set(seg.id, seg)
          sourceNodeIds[seg.id] = node.id
        }
      }
    }
    const segments: SceneSegmentVM[] = segmentIds
      .map((id) => segmentById.get(id))
      .filter((seg): seg is SceneSegmentVM => seg != null)
    if (segments.length === 0) return
    const proxy = this.buildDragProxy(segments)
    const lineLayer = new Container()
    this.worldLayer.addChild(lineLayer)
    this.worldLayer.addChild(proxy)
    this.segmentDrag = { segments, segmentIds, sourceNodeIds, proxy, lineLayer, snap: null }
    this.handlers.onDragSegmentStart(segmentIds)
    this.updateSegmentDrag(globalX, globalY)
  }

  private updateSegmentDrag(clientX: number, clientY: number): void {
    if (!this.segmentDrag) return
    const world = this.screenToWorld(clientX, clientY)
    const targetNodeId = this.findDropTarget(world.x, world.y)
    this.handlers.onDragSegmentUpdate(targetNodeId ?? null)

    const snap = this.findSnapTarget(world.x, world.y, this.segmentDrag.segments[0])
    this.segmentDrag.snap = snap

    this.segmentDrag.proxy.position.set(world.x, world.y)
    const proxyCenterX = world.x
    const proxyCenterY = world.y

    this.segmentDrag.lineLayer.removeChildren()
    const targetCenters = this.getDropTargetCenters()
    for (const target of targetCenters) {
      const lineG = new Graphics()
      drawArrowLine(lineG, proxyCenterX, proxyCenterY, target.x, target.y)
      this.segmentDrag.lineLayer.addChild(lineG)
    }
  }

  private endSegmentDrag(event?: PointerEvent): void {
    if (!this.segmentDrag) return
    this.lastDragEndTime = Date.now()
    const world = event ? this.screenToWorld(event.clientX, event.clientY) : null
    const targetNodeId = world ? this.findDropTarget(world.x, world.y) : this.segmentDrag.snap?.nodeId ?? null
    const anyDifferentSource = this.segmentDrag.segmentIds.some((id) => this.segmentDrag!.sourceNodeIds[id] !== targetNodeId)
    const effectiveTarget = targetNodeId && anyDifferentSource ? targetNodeId : null
    this.handlers.onDragSegmentEnd(effectiveTarget)
    this.worldLayer.removeChild(this.segmentDrag.lineLayer)
    this.worldLayer.removeChild(this.segmentDrag.proxy)
    this.segmentDrag.lineLayer.destroy({ children: true })
    this.segmentDrag.proxy.destroy({ children: true })
    this.segmentDrag = null
  }

  private createNode(
    node: SceneNodeVM,
    hoveredSegmentId: string | null,
    filterCategory: string | null,
    selectedSegmentIds: readonly string[],
  ): NodeView {
    const tier = getZoomTier(this.zoom)
    const textCompensationScale = getTextCompensationScale(this.zoom)
    const root = new Container()
    root.eventMode = 'static'

    const slotCount = node.slotCount
    const totalMeterWidth = meterWidthForSlots(slotCount)
    const totalWidth = SLOT_START_X + totalMeterWidth + 20
    const totalHeight = TOP_BAND_H + slotAreaHeightForSlots(slotCount)
    const totalSixths = totalSixthsForSlots(slotCount)

    const bg = new Graphics()
    bg.roundRect(0, 0, totalWidth, totalHeight, 10)
    bg.fill({ color: 0x0d1a30, alpha: 0.92 })
    bg.stroke({ width: 1, color: 0x2f4878, alpha: 0.85 })
    root.addChild(bg)

    const speedColor = SPEED_COLORS[node.speedBand ?? 'green'] ?? 0x3dba72
    const speedBar = new Graphics()
    speedBar.roundRect(0, 0, 6, totalHeight, 3)
    speedBar.fill({ color: speedColor, alpha: 0.92 })
    root.addChild(speedBar)

    const dragHandle = new Graphics()
    dragHandle.eventMode = 'static'
    dragHandle.cursor = 'grab'
    ;(dragHandle as Container & { __dragHandle?: boolean }).__dragHandle = true
    dragHandle.rect(0, 0, totalWidth, TOP_BAND_H)
    dragHandle.fill({ color: 0xffffff, alpha: 0.001 })
    dragHandle.rect(0, TOP_BAND_H, SLOT_START_X + SLOT_PADDING, totalHeight - TOP_BAND_H)
    dragHandle.fill({ color: 0xffffff, alpha: 0.001 })
    root.addChild(dragHandle)

    if (tier !== 'far') {
      const title = new BitmapText({
        text: node.title,
        style: { fill: '#e8f0ff', fontSize: 13, fontFamily: FONT_SEMIBOLD },
      })
      title.eventMode = 'none'
      title.scale.set(textCompensationScale)
      title.position.set(8, 8)
      root.addChild(title)

      const meta = new BitmapText({
        text: `${node.speedFeet}' • ${node.usedStoneText} / ${node.capacityStoneText}`,
        style: { fill: '#8ba0ca', fontSize: 11, fontFamily: FONT_REGULAR },
      })
      meta.eventMode = 'none'
      meta.scale.set(textCompensationScale)
      meta.position.set(8 + title.width * textCompensationScale + 12, 8)
      root.addChild(meta)
    } else {
      const compact = new BitmapText({
        text: `${compactToken(node.title, 4)} ${node.speedFeet}'`,
        style: { fill: '#b0c2e8', fontSize: 11, fontFamily: FONT_REGULAR },
      })
      compact.eventMode = 'none'
      compact.scale.set(textCompensationScale)
      compact.position.set(8, 8)
      root.addChild(compact)
    }

    const occupiedSixths = occupiedSixthsFromSegments(node.segments, totalSixths)

    const slotFillLayer = new Graphics()
    const dimAlpha = tier === 'far' ? 0.1 : 0.14
    const brightAlpha = tier === 'far' ? 0.36 : 0.48
    const slotColorFn = node.twoBandSlots ? twoBandSlotColor : fixedSlotBandColor
    for (let stone = 0; stone < slotCount; stone += 1) {
      const sx = SLOT_START_X + stoneToX(stone)
      const sy = TOP_BAND_H + stoneToY(stone)
      const slotBandColor = slotColorFn(stone, node.fixedGreenStoneSlots)
      for (let row = 0; row < SIXTH_ROWS; row += 1) {
        const sixth = stone * 6 + row
        const filled = occupiedSixths.has(sixth)
        const cy = sy + row * CELL_H
        slotFillLayer.roundRect(sx + 1.6, cy + 0.8, STONE_W - 3.2, CELL_H - 1.6, 1.6)
        slotFillLayer.fill({
          color: slotBandColor,
          alpha: filled ? brightAlpha : dimAlpha,
        })
      }
    }
    root.addChild(slotFillLayer)

    const segmentContainer = new Container()
    const segmentViews = new Map<string, SegmentView>()
    node.segments.forEach((segment) => {
      const pos = segmentPositionInNode(segment)
      const segContainer = new Container()
      segContainer.position.set(pos.x, pos.y)
      const spring = createSpring2D(pos.x, pos.y)
      spring.targetX = pos.x
      spring.targetY = pos.y
      segmentViews.set(segment.id, { container: segContainer, spring })
      const hovered = segment.id === hoveredSegmentId
      drawSegmentBlock(
        segContainer,
        segment,
        tier,
        this.zoom,
        hovered,
        this.handlers,
        textCompensationScale,
        this.minVisibleLabelPx,
        this.maxVisibleLabelPx,
        totalSixths,
        (seg, x, y) => this.showTooltip(seg, x, y),
        (x, y) => this.moveTooltip(x, y),
        () => this.hideTooltip(),
        node.id,
        (seg, nodeId, x, y) => this.beginSegmentDrag(seg, nodeId, x, y),
        pos,
        filterCategory,
        selectedSegmentIds,
        this.handlers.onSegmentClick,
        this.handlers.onSegmentDoubleClick,
        () => this.lastDragEndTime,
      )
      segmentContainer.addChild(segContainer)
    })
    root.addChild(segmentContainer)

    root.position.set(node.x, node.y)
    this.enableDrag(dragHandle, root, node.id)
    this.worldLayer.addChild(root)
    return { root, segmentContainer, segmentViews }
  }

  private updateNode(
    node: SceneNodeVM,
    view: NodeView,
    hoveredSegmentId: string | null,
    filterCategory: string | null,
    selectedSegmentIds: readonly string[],
  ): void {
    const tier = getZoomTier(this.zoom)
    const textCompensationScale = getTextCompensationScale(this.zoom)
    const totalSixths = totalSixthsForSlots(node.slotCount)
    const nextIds = new Set(node.segments.map((s) => s.id))
    for (const [id, segView] of view.segmentViews) {
      if (!nextIds.has(id)) {
        view.segmentContainer.removeChild(segView.container)
        segView.container.destroy({ children: true })
        view.segmentViews.delete(id)
      }
    }
    node.segments.forEach((segment) => {
      const pos = segmentPositionInNode(segment)
      let segView = view.segmentViews.get(segment.id)
      if (!segView) {
        const segContainer = new Container()
        segContainer.position.set(pos.x, pos.y)
        const spring = createSpring2D(pos.x, pos.y)
        spring.targetX = pos.x
        spring.targetY = pos.y
        segView = { container: segContainer, spring }
        view.segmentViews.set(segment.id, segView)
        const hovered = segment.id === hoveredSegmentId
        drawSegmentBlock(
          segContainer,
          segment,
          tier,
          this.zoom,
          hovered,
          this.handlers,
          textCompensationScale,
          this.minVisibleLabelPx,
          this.maxVisibleLabelPx,
          totalSixths,
          (seg, x, y) => this.showTooltip(seg, x, y),
          (x, y) => this.moveTooltip(x, y),
          () => this.hideTooltip(),
          node.id,
          (seg, nodeId, x, y) => this.beginSegmentDrag(seg, nodeId, x, y),
          pos,
          filterCategory,
          selectedSegmentIds,
          this.handlers.onSegmentClick,
          this.handlers.onSegmentDoubleClick,
          () => this.lastDragEndTime,
        )
        view.segmentContainer.addChild(segContainer)
      } else {
        setSpringTarget(segView.spring, pos.x, pos.y)
        const hovered = segment.id === hoveredSegmentId
        segView.container.removeChildren()
        drawSegmentBlock(
          segView.container,
          segment,
          tier,
          this.zoom,
          hovered,
          this.handlers,
          textCompensationScale,
          this.minVisibleLabelPx,
          this.maxVisibleLabelPx,
          totalSixths,
          (seg, x, y) => this.showTooltip(seg, x, y),
          (x, y) => this.moveTooltip(x, y),
          () => this.hideTooltip(),
          node.id,
          (seg, nodeId, x, y) => this.beginSegmentDrag(seg, nodeId, x, y),
          pos,
          filterCategory,
          selectedSegmentIds,
          this.handlers.onSegmentClick,
          this.handlers.onSegmentDoubleClick,
          () => this.lastDragEndTime,
        )
      }
    })
  }

  private enableDrag(handleView: Container, nodeContainer: Container, nodeId: string): void {
    let dragging = false
    let offset = { x: 0, y: 0 }
    handleView.on('pointerdown', (event) => {
      if (event.button !== 0) return
      dragging = true
      const point = event.global
      offset = {
        x: (point.x - this.pan.x) / this.zoom - nodeContainer.position.x,
        y: (point.y - this.pan.y) / this.zoom - nodeContainer.position.y,
      }
      handleView.cursor = 'grabbing'
      event.stopPropagation()
    })
    const stop = (): void => {
      dragging = false
      handleView.cursor = 'grab'
    }
    handleView.on('pointerup', stop)
    handleView.on('pointerupoutside', stop)
    handleView.on('globalpointermove', (event) => {
      if (!dragging) return
      const point = event.global
      const x = (point.x - this.pan.x) / this.zoom - offset.x
      const y = (point.y - this.pan.y) / this.zoom - offset.y
      nodeContainer.position.set(x, y)
      this.handlers.onMoveNode(nodeId, x, y)
    })
  }

  private rebuildAllNodes(scene: SceneVM): void {
    if (!this.fontsLoaded) return
    for (const [, view] of this.nodeViews) {
      this.worldLayer.removeChild(view.root)
      view.root.destroy({ children: true })
    }
    this.nodeViews.clear()
    const filterCategory = scene.filterCategory ?? null
    const selectedSegmentIds = scene.selectedSegmentIds ?? []
    Object.values(scene.nodes).forEach((node) => {
      this.nodeViews.set(node.id, this.createNode(node, scene.hoveredSegmentId ?? null, filterCategory, selectedSegmentIds))
    })
    this.updateSelectionOverlay()
  }

  applyInit(scene: SceneVM): void {
    this.currentScene = scene
    this.paceText.text = `Party ${scene.partyPaceText}`
    this.rebuildAllNodes(scene)
  }

  private springTickerBound = (): void => {
    this.updateSprings()
  }

  private startSpringTicker(): void {
    this.app.ticker.remove(this.springTickerBound)
    this.app.ticker.add(this.springTickerBound)
  }

  private updateSprings(): void {
    const dt = 1 / 60
    let anyActive = false
    for (const [, view] of this.nodeViews) {
      for (const [, segView] of view.segmentViews) {
        if (updateSpring2D(segView.spring, dt)) anyActive = true
        segView.container.position.set(segView.spring.x, segView.spring.y)
      }
    }
    this.updateSelectionOverlay()
    if (!anyActive) {
      this.app.ticker.remove(this.springTickerBound)
    }
  }

  applyPatches(patches: readonly ScenePatch[], scene: SceneVM): void {
    this.currentScene = scene
    let needsFullRebuild = false
    patches.forEach((patch) => {
      if (patch.type === 'UPDATE_META') {
        this.paceText.text = `Party ${patch.partyPaceText}`
        needsFullRebuild = true
        return
      }
      if (patch.type === 'UPDATE_NODE') {
        const view = this.nodeViews.get(patch.node.id)
        if (view) {
          this.updateNode(
            patch.node,
            view,
            scene.hoveredSegmentId ?? null,
            scene.filterCategory ?? null,
            scene.selectedSegmentIds ?? [],
          )
          this.updateSelectionOverlay()
          this.startSpringTicker()
        } else {
          needsFullRebuild = true
        }
        return
      }
      if (patch.type === 'ADD_NODE' || patch.type === 'REMOVE_NODE') {
        needsFullRebuild = true
        return
      }
      needsFullRebuild = true
    })
    if (needsFullRebuild) {
      this.rebuildAllNodes(scene)
      this.startSpringTicker()
    }
  }
}

