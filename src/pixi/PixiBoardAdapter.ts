import { Application, Assets, BitmapText, Color, Container, Graphics, Point, Rectangle } from 'pixi.js'
import { createSpring1D, createSpring2D, setSpring1DTarget, setSpringTarget, updateSpring1D, updateSpring2D } from './spring'
import type { SceneFreeSegmentVM, SceneGroupVM, SceneLabelVM, SceneNodeVM, ScenePatch, SceneVM, SceneSegmentVM } from '../worker/protocol'

/** Stored on segment blocks for context-menu hit testing. */
type SegmentContext = { segmentId: string; nodeId: string }

type GroupDragData = {
  readonly groupId: string
  /** Pointer offset from group top-left in world units. */
  readonly anchorOffset: { x: number; y: number }
}

type NodeReorderDragData = {
  readonly nodeIds: string[]
  readonly nodeContainers: Container[]
  readonly initialPositions: { x: number; y: number }[]
  readonly handleView: Container
  /** Pointer offset from primary node top-left in world units. */
  readonly anchorOffset: { x: number; y: number }
  targetGroupId: string | null
  targetIndex: number
  targetNestParentNodeId: string | null
}

type LabelDragData = {
  readonly labelId: string
  readonly offset: { x: number; y: number }
}

type ActiveDrag =
  | { type: 'idle' }
  | { type: 'segment'; state: SegmentDragState }
  | { type: 'group'; state: GroupDragData }
  | { type: 'nodeReorder'; state: NodeReorderDragData }
  | { type: 'label'; state: LabelDragData }
  | { type: 'marquee'; startX: number; startY: number; endX: number; endY: number }

type AdapterHandlers = {
  onHoverSegment(segmentId: string | null): void
  onMoveGroup?(groupId: string, x: number, y: number): void
  onMoveNodeToGroupIndex?(nodeId: string, groupId: string, index: number): void
  onNestNodeUnder?(nodeId: string, parentNodeId: string): void
  onMoveNodeToRoot?(nodeId: string, x: number, y: number): void
  onZoomChange(zoom: number): void
  onDragSegmentStart(segmentIds: string[]): void
  onDragSegmentUpdate(targetNodeId: string | null): void
  onDragSegmentEnd(targetNodeId: string | null, x?: number, y?: number): void
  onContextMenu(segmentId: string, nodeId: string, clientX: number, clientY: number): void
  onCanvasContextMenu?(worldX: number, worldY: number, clientX: number, clientY: number): void
  onSegmentClick?(segmentId: string, nodeId: string, addToSelection: boolean): void
  onSegmentDoubleClick?(segmentId: string, itemDefId: string, nodeId: string): void
  onMarqueeSelect?(segmentIds: string[], addToSelection: boolean): void
  onMoveLabel?(labelId: string, x: number, y: number): void
  onSelectLabel?(labelId: string | null): void
  onCanvasWorldClick?(x: number, y: number): boolean | void
}

type SegmentView = {
  container: Container
  spring: ReturnType<typeof createSpring2D>
}

type NodeView = {
  readonly root: Container
  readonly positionSpring: ReturnType<typeof createSpring2D>
  readonly segmentContainer: Container
  readonly contentContainer: Container
  segmentViews: Map<string, SegmentView>
  moveToRootBtn?: Graphics
  totalWidth: number
  totalHeight: number
  clipWidthSpring?: ReturnType<typeof createSpring1D>
  clipHeightSpring?: ReturnType<typeof createSpring1D>
  contentClip?: Graphics
  onClipAnimationComplete?: () => void
}

type GroupView = {
  readonly root: Container
}

type LabelView = {
  readonly root: Container
}

type FreeSegmentView = {
  readonly root: Container
}

type SegmentDragState = {
  readonly segments: readonly SceneSegmentVM[]
  readonly segmentIds: readonly string[]
  readonly sourceNodeIds: Readonly<Record<string, string>>
  readonly proxy: Container
  readonly lineLayer: Container
  /** Pointer offset from drag-proxy center in world units. */
  readonly proxyAnchorOffset: { x: number; y: number }
  /** Pointer offset from grabbed segment's visible top-left in world units. */
  readonly dropAnchorOffset: { x: number; y: number }
  snap: { nodeId: string; startSixth: number } | null
}

type ZoomTier = 'far' | 'medium' | 'close'

const STONE_GAP = 3
const STONE_W = 36
const STONE_H = 54
const SIXTH_ROWS = 6
const CELL_H = STONE_H / SIXTH_ROWS
const TOP_BAND_H = 22
const SLOT_START_X = 10
const DEFAULT_STONES_PER_ROW = 25
const STONE_ROW_GAP = 3
const NODE_CLIP_LEFT_OVERFLOW = 24

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

const drawNodeClipMask = (clip: Graphics, width: number, height: number): void => {
  clip.clear()
  clip.roundRect(0, 0, width, height, 10)
  // Preserve left-side overhang controls (drag handle / move-to-root) while clipping body.
  clip.rect(-NODE_CLIP_LEFT_OVERFLOW, 0, NODE_CLIP_LEFT_OVERFLOW, height)
  clip.fill({ color: 0xffffff, alpha: 0.001 })
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

const collapsedVisibleSlotCount = (
  segments: readonly SceneSegmentVM[],
  slotCount: number,
): number => {
  if (slotCount <= 0) return 0
  const occupied = occupiedSixthsFromSegments(segments, totalSixthsForSlots(slotCount))
  let highestOccupiedStone = -1
  occupied.forEach((sixth) => {
    highestOccupiedStone = Math.max(highestOccupiedStone, Math.floor(sixth / 6))
  })
  if (highestOccupiedStone < 0) return 1
  return Math.min(slotCount, highestOccupiedStone + 2)
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
  dimmed: boolean,
  dimmedAlpha: number,
): void => {
  if (!wield) return
  const cy = bounds.y + bounds.h / 2
  const scale = GRIP_ICON_SIZE / 24

  const drawOneGrip = (x: number, flip = false): void => {
    const g = new Graphics()
    g.eventMode = 'none'
    g.alpha = dimmed ? dimmedAlpha : 1
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

type DragProxyLayout = {
  readonly proxy: Container
  readonly pivot: { x: number; y: number }
  readonly segmentBounds: Record<string, { x: number; y: number; w: number; h: number }>
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
  dimmed: boolean,
  dimmedAlpha: number,
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
    txt.alpha = dimmed ? dimmedAlpha : 1
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
  onDragStart?: (segment: SceneSegmentVM, nodeId: string, clientX: number, clientY: number) => void,
  baseOffset?: { x: number; y: number },
  filterCategory?: string | null,
  _selectedSegmentIds?: readonly string[],
  onSegmentClick?: (segmentId: string, nodeId: string, addToSelection: boolean) => void,
  onSegmentDoubleClick?: (segmentId: string, itemDefId: string, nodeId: string) => void,
  getLastDragEndTime?: () => number,
  allowInteraction?: () => boolean,
): void => {
  const o = baseOffset ?? { x: 0, y: 0 }
  const { startStone, endStone } = segmentStoneSpan(segment.startSixth, segment.sizeSixths)
  const isDropPreview = segment.isDropPreview === true
  const dimmed = filterCategory != null && segment.category !== filterCategory
  const color = isDropPreview ? 0x5cadee : segment.isOverflow ? 0x932d4e : hovered ? 0x5cadee : 0x3d9ac9
  const dimmedAlpha = 0.12
  const alpha = isDropPreview ? 0.25 : segment.isOverflow ? 0.88 : dimmed ? dimmedAlpha : 0.95

  const block = new Graphics()
  block.eventMode = 'static'
  block.cursor = 'pointer'
  block.on('pointerover', (event: any) => {
    if (allowInteraction && !allowInteraction()) return
    handlers.onHoverSegment(segment.id)
    onTooltipEnter?.(segment, event.global.x, event.global.y)
  })
  block.on('pointermove', (event: any) => {
    if (allowInteraction && !allowInteraction()) return
    onTooltipMove?.(event.global.x, event.global.y)
  })
  block.on('pointerout', () => {
    if (allowInteraction && !allowInteraction()) return
    handlers.onHoverSegment(null)
    onTooltipLeave?.()
  })
  if (onDragStart && nodeId) {
    block.on('pointerdown', (event: any) => {
      if (event.button === 0) {
        event.stopPropagation()
        onTooltipLeave?.()
        const clientX = typeof event.clientX === 'number' ? event.clientX : event.global.x
        const clientY = typeof event.clientY === 'number' ? event.clientY : event.global.y
        onDragStart(segment, nodeId, clientX, clientY)
      }
    })
  }
  if (nodeId && (onSegmentClick || onSegmentDoubleClick)) {
    block.on('pointertap', (event: any) => {
      if (allowInteraction && !allowInteraction()) return
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
      : { width: 1.5, color: 0xd3ebff, alpha: dimmed ? dimmedAlpha : 0.9 }
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
        txt.alpha = dimmed ? dimmedAlpha : 1
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
    drawGripIndicators(container, segment.wield, blockBounds, dimmed, dimmedAlpha)
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
      dimmed,
      dimmedAlpha,
    )
    block.rect(hitBounds.x, hitBounds.y, hitBounds.w, hitBounds.h)
    block.fill({ color: 0xffffff, alpha: 0.001 })
    block.hitArea = new Rectangle(hitBounds.x, hitBounds.y, hitBounds.w, hitBounds.h)
    container.addChild(block)
    drawGripIndicators(container, segment.wield, hitBounds, dimmed, dimmedAlpha)
  }
}

export class PixiBoardAdapter {
  private app: Application
  private sceneRoot: Container
  private groupLayer: Container
  private worldLayer: Container
  private labelLayer: Container
  private selectionOverlayLayer: Container
  private hudLayer: Container
  private readonly nodeViews = new Map<string, NodeView>()
  private readonly freeSegmentViews = new Map<string, FreeSegmentView>()
  private readonly groupViews = new Map<string, GroupView>()
  private readonly labelViews = new Map<string, LabelView>()
  private readonly handlers: AdapterHandlers
  private zoom = 0.85
  private pan = { x: 60, y: 60 }
  private readonly paceText: BitmapText
  private readonly tooltipLayer: Container
  private readonly tooltipBg: Graphics
  private readonly tooltipText: BitmapText
  private currentScene: SceneVM | null = null
  private activeDrag: ActiveDrag = { type: 'idle' }
  private groupDropIndicator: Graphics
  private lastDragEndTime = 0
  private pendingRebuild = false
  private marqueeGraphics: Graphics | null = null
  private minVisibleLabelPx = DEFAULT_MIN_VISIBLE_PX
  private readonly maxVisibleLabelPx = DEFAULT_MAX_VISIBLE_PX
  private fontsLoaded = false
  private readonly nodeExpandedState = new Map<string, boolean>()
  private readonly nodeDisplayOffsetY = new Map<string, number>()
  private readonly groupDisplayHeights = new Map<string, number>()
  private readonly skipNodeAnimationOnce = new Set<string>()
  private readonly skipSegmentAnimationOnce = new Set<string>()
  private readonly hiddenNodeContentIds = new Set<string>()

  constructor(host: HTMLElement, handlers: AdapterHandlers) {
    this.handlers = handlers
    this.app = new Application()
    this.sceneRoot = new Container()
    this.groupLayer = new Container()
    this.groupDropIndicator = new Graphics()
    this.groupDropIndicator.eventMode = 'none'
    this.worldLayer = new Container()
    this.labelLayer = new Container()
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
      if (ctx) {
        this.handlers.onContextMenu(ctx.segmentId, ctx.nodeId, event.clientX, event.clientY)
        return
      }
      const world = this.screenToWorld(event.clientX, event.clientY)
      this.handlers.onCanvasContextMenu?.(world.x, world.y, event.clientX, event.clientY)
    })

    this.sceneRoot.addChild(this.groupLayer)
    this.groupLayer.addChild(this.groupDropIndicator)
    this.sceneRoot.addChild(this.worldLayer)
    this.sceneRoot.addChild(this.labelLayer)
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
      if (event.button === 0 && this.activeDrag.type === 'idle') {
        const hitInteractive = this.hitTestSkipMarquee(event.clientX, event.clientY)
        if (!hitInteractive) {
          this.handlers.onSelectLabel?.(null)
        }
        if (this.tryStartGroupDrag(event)) return
        if (!hitInteractive && this.handlers.onCanvasWorldClick) {
          const world = this.screenToWorld(event.clientX, event.clientY)
          const handled = this.handlers.onCanvasWorldClick(world.x, world.y)
          if (handled) return
        }
        if (!hitInteractive && this.handlers.onMarqueeSelect) {
          const { x, y } = canvasCoords(event)
          this.activeDrag = { type: 'marquee', startX: x, startY: y, endX: x, endY: y }
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
      if (event.button === 0) {
        switch (this.activeDrag.type) {
          case 'nodeReorder':
            this.finishNodeReorderDrag(event.clientX, event.clientY)
            return
          case 'label':
            this.endDrag()
            return
          case 'group':
            this.endDrag()
            return
          case 'marquee': {
            const { x, y } = canvasCoords(event)
            this.activeDrag.endX = x
            this.activeDrag.endY = y
            this.finishMarquee(event.shiftKey || event.ctrlKey || event.metaKey)
            this.activeDrag = { type: 'idle' }
            this.drawMarquee()
            return
          }
          case 'segment':
            this.endSegmentDrag(event)
            return
          case 'idle':
            break
        }
      }
      panning = false
    }

    const onMove = (event: PointerEvent): void => {
      switch (this.activeDrag.type) {
        case 'nodeReorder':
          this.updateNodeReorderDrag(event.clientX, event.clientY)
          return
        case 'label':
          this.updateLabelDrag(event.clientX, event.clientY)
          return
        case 'group':
          this.updateGroupDrag(event.clientX, event.clientY)
          return
        case 'marquee': {
          const { x, y } = canvasCoords(event)
          this.activeDrag.endX = x
          this.activeDrag.endY = y
          this.drawMarquee()
          return
        }
        case 'segment':
          this.updateSegmentDrag(event.clientX, event.clientY)
          return
        case 'idle':
          break
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
    const PAD = 0.75
    const STROKE = 2.5
    const RADIUS = 5
    for (const [nodeId, view] of this.nodeViews) {
      const node = this.currentScene.nodes[nodeId]
      if (!node) continue
      for (const segment of node.segments) {
        if (!selectedIds.has(segment.id)) continue
        const segView = view.segmentViews.get(segment.id)
        const bounds = segmentBoundsInNodeLocal(segment)
        const pos = segmentPositionInNode(segment)
        const nodePos = this.getNodeDisplayPosition(node)
        const worldX = nodePos.x + (segView ? segView.container.position.x : pos.x) + bounds.x - pos.x
        const worldY = nodePos.y + (segView ? segView.container.position.y : pos.y) + bounds.y - pos.y
        const g = new Graphics()
        g.eventMode = 'none'
        g.roundRect(worldX - PAD, worldY - PAD, bounds.w + PAD * 2, bounds.h + PAD * 2, RADIUS)
        g.stroke({ width: STROKE, color: 0xffffff, alpha: 0.95 })
        this.selectionOverlayLayer.addChild(g)
      }
    }
    for (const free of Object.values(this.currentScene.freeSegments ?? {})) {
      if (!selectedIds.has(free.segment.id)) continue
      const b = segmentBoundsInNodeLocal(free.segment)
      const segX = free.x + b.x - SLOT_START_X
      const segY = free.y + b.y - TOP_BAND_H
      const g = new Graphics()
      g.eventMode = 'none'
      g.roundRect(segX - PAD, segY - PAD, b.w + PAD * 2, b.h + PAD * 2, RADIUS)
      g.stroke({ width: STROKE, color: 0xffffff, alpha: 0.95 })
      this.selectionOverlayLayer.addChild(g)
    }
  }

  private drawMarquee(): void {
    if (!this.marqueeGraphics) return
    this.marqueeGraphics.clear()
    if (this.activeDrag.type !== 'marquee') return
    const { startX, startY, endX, endY } = this.activeDrag
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
    if (this.activeDrag.type !== 'marquee' || !this.currentScene || !this.handlers.onMarqueeSelect) return
    const { startX, startY, endX, endY } = this.activeDrag
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
        const nodePos = this.getNodeDisplayPosition(node)
        const segX1 = nodePos.x + b.x
        const segY1 = nodePos.y + b.y
        const segX2 = segX1 + b.w
        const segY2 = segY1 + b.h
        if (segX1 < maxW && segX2 > minW && segY1 < maxH && segY2 > minH) {
          segmentIds.push(segment.id)
        }
      }
    }
    for (const free of Object.values(this.currentScene.freeSegments ?? {})) {
      if (free.segment.isDropPreview) continue
      const b = segmentBoundsInNodeLocal(free.segment)
      const segX1 = free.x + b.x - SLOT_START_X
      const segY1 = free.y + b.y - TOP_BAND_H
      const segX2 = segX1 + b.w
      const segY2 = segY1 + b.h
      if (segX1 < maxW && segX2 > minW && segY1 < maxH && segY2 > minH) {
        segmentIds.push(free.segment.id)
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
      const c = cur as Container & {
        __segmentContext?: SegmentContext
        __dragHandle?: boolean
        __groupHandle?: boolean
        __labelHandleId?: string
        __labelId?: string
      }
      if (c.__segmentContext || c.__dragHandle || c.__groupHandle || c.__labelHandleId || c.__labelId) return true
      cur = cur.parent
    }
    return false
  }

  private hitTestGroupHandle(clientX: number, clientY: number): string | null {
    const events = (this.app.renderer as { events?: { mapPositionToPoint: (p: Point, x: number, y: number) => void; rootBoundary?: { hitTest: (x: number, y: number) => Container } } }).events
    if (!events?.rootBoundary) return null
    const pt = new Point()
    events.mapPositionToPoint(pt, clientX, clientY)
    const hit = events.rootBoundary.hitTest(pt.x, pt.y)
    if (!hit) return null
    let cur: Container | null = hit
    while (cur) {
      const c = cur as Container & { __groupHandleId?: string }
      if (typeof c.__groupHandleId === 'string' && c.__groupHandleId.length > 0) return c.__groupHandleId
      cur = cur.parent
    }
    return null
  }

  private hitTestSegmentOrNodeHandle(clientX: number, clientY: number): boolean {
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

  private tryStartGroupDrag(event: PointerEvent): boolean {
    if (!this.currentScene || !this.handlers.onMoveGroup) return false
    if (this.hitTestSegmentOrNodeHandle(event.clientX, event.clientY)) return false
    const handleGroupId = this.hitTestGroupHandle(event.clientX, event.clientY)
    if (!handleGroupId) return false
    const world = this.screenToWorld(event.clientX, event.clientY)
    const group = this.currentScene.groups?.[handleGroupId] ?? null
    if (!group) return false

    this.activeDrag = {
      type: 'group',
      state: {
        groupId: group.id,
        anchorOffset: { x: world.x - group.x, y: world.y - group.y },
      },
    }
    return true
  }

  private updateGroupDrag(clientX: number, clientY: number): void {
    if (this.activeDrag.type !== 'group' || !this.currentScene || !this.handlers.onMoveGroup) return
    const drag = this.activeDrag.state
    const world = this.screenToWorld(clientX, clientY)
    const nextX = world.x - drag.anchorOffset.x
    const nextY = world.y - drag.anchorOffset.y
    const groupView = this.groupViews.get(drag.groupId)
    if (groupView) {
      groupView.root.position.set(nextX, nextY)
    }
    this.handlers.onMoveGroup(drag.groupId, nextX, nextY)
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

  getWorldCenter(): { x: number; y: number } {
    const x = (this.app.screen.width / 2 - this.pan.x) / this.zoom
    const y = (this.app.screen.height / 2 - this.pan.y) / this.zoom
    return { x, y }
  }

  getWorldPointAtClient(clientX: number, clientY: number): { x: number; y: number } {
    return this.screenToWorld(clientX, clientY)
  }

  getDropTargetAtClient(clientX: number, clientY: number): string | null {
    const world = this.screenToWorld(clientX, clientY)
    return this.findDropTarget(world.x, world.y)
  }

  /** Drop target = whole character node. Returns nodeId if world point is inside any node's bounds. */
  private findDropTarget(worldX: number, worldY: number): string | null {
    if (!this.currentScene) return null
    for (const node of Object.values(this.currentScene.nodes)) {
      const pos = this.getNodeDisplayPosition(node)
      const dims = this.getNodeDisplayDimensions(node)
      if (worldX >= pos.x && worldX <= pos.x + dims.width &&
          worldY >= pos.y && worldY <= pos.y + dims.height) {
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

    const visibleSlotCount = this.getVisibleSlotCount(node)
    const nodeMeterWidth = meterWidthForSlots(visibleSlotCount)
    const slotAreaH = slotAreaHeightForSlots(visibleSlotCount)
    const pos = this.getNodeDisplayPosition(node)
    const inY = worldY >= pos.y + TOP_BAND_H && worldY <= pos.y + TOP_BAND_H + slotAreaH
    if (!inY) return { nodeId: targetNodeId, startSixth: 0 }
    const localX = worldX - pos.x - SLOT_START_X
    const localY = worldY - pos.y - TOP_BAND_H
    if (localX < -STONE_W || localX > nodeMeterWidth + STONE_W) return { nodeId: targetNodeId, startSixth: 0 }

    let startSixth = localToSixth(localX, localY, visibleSlotCount)
    if (isMultiStone(segment)) {
      startSixth = Math.floor(startSixth / 6) * 6
    }
    const totalSixths = totalSixthsForSlots(visibleSlotCount)
    const maxStart = Math.max(0, totalSixths - segment.sizeSixths)
    startSixth = Math.max(0, Math.min(maxStart, startSixth))
    return { nodeId: targetNodeId, startSixth }
  }

  private buildDragProxy(segments: readonly SceneSegmentVM[]): DragProxyLayout {
    const proxy = new Container()
    if (segments.length > 1) {
      let maxW = 0
      let maxH = 0
      for (const segment of segments) {
        const b = segmentBoundsInNodeLocal({ ...segment, startSixth: 0 })
        maxW = Math.max(maxW, b.w)
        maxH = Math.max(maxH, b.h)
      }
      const width = Math.max(24, maxW)
      const height = Math.max(18, maxH)
      const base = new Graphics()
      base.roundRect(0, 0, width, height, 7)
      base.fill({ color: 0x7bd7cf, alpha: 0.78 })
      base.stroke({ width: 1.5, color: 0xd3ebff, alpha: 0.9 })
      proxy.addChild(base)

      const badge = new Graphics()
      const badgeR = 10
      badge.circle(width - badgeR + 2, badgeR - 2, badgeR)
      badge.fill({ color: 0x173862, alpha: 0.96 })
      badge.stroke({ width: 1.5, color: 0xe8f4ff, alpha: 0.9 })
      proxy.addChild(badge)

      const countLabel = new BitmapText({
        text: `${segments.length}`,
        style: { fill: '#f3f9ff', fontSize: 12, fontFamily: FONT_SEMIBOLD, align: 'center' },
      })
      countLabel.eventMode = 'none'
      countLabel.anchor.set(0.5, 0.5)
      countLabel.position.set(width - badgeR + 2, badgeR - 2)
      proxy.addChild(countLabel)

      const segmentBounds: Record<string, { x: number; y: number; w: number; h: number }> = {}
      for (const segment of segments) {
        segmentBounds[segment.id] = { x: 0, y: 0, w: width, h: height }
      }
      const pivot = { x: width / 2, y: height / 2 }
      proxy.pivot.set(pivot.x, pivot.y)
      return { proxy, pivot, segmentBounds }
    }

    const ITEM_GAP = 4
    let offsetY = 0
    const segmentBounds: Record<string, { x: number; y: number; w: number; h: number }> = {}

    for (const segment of segments) {
      const color = segment.isOverflow ? 0xa83f62 : isMultiStone(segment) ? 0x61b5ff : 0x7bd7cf
      const alpha = 0.75

      if (isMultiStone(segment)) {
        const w = (segment.sizeSixths / 6) * (STONE_W + STONE_GAP) - STONE_GAP
        segmentBounds[segment.id] = { x: 0, y: offsetY, w, h: STONE_H }
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
        segmentBounds[segment.id] = { x: minX, y: minY, w: maxX - minX, h: maxY - minY }
        const stroke = new Graphics()
        stroke.roundRect(minX, minY, maxX - minX, maxY - minY, 4)
        stroke.stroke({ width: 1.5, color: 0xd3ebff, alpha: 0.85 })
        proxy.addChild(stroke)
        offsetY += (maxY - minY) + ITEM_GAP
      }
    }

    const b = proxy.getBounds()
    const pivot = { x: b.width / 2, y: b.height / 2 }
    proxy.pivot.set(pivot.x, pivot.y)
    return { proxy, pivot, segmentBounds }
  }

  private getDropTargetCenters(): { x: number; y: number }[] {
    const centers: { x: number; y: number }[] = []
    if (this.activeDrag.type !== 'segment') return centers
    const drag = this.activeDrag.state
    if (!drag.snap || !this.currentScene || drag.segments.length === 0) return centers
    const { nodeId, startSixth } = drag.snap
    const node = this.currentScene.nodes[nodeId]
    if (!node) return centers
    const nodePos = this.getNodeDisplayPosition(node)
    const previewSegs = node.segments.filter((s) => s.isDropPreview === true)
    if (previewSegs.length > 0) {
      previewSegs.forEach((s) => centers.push(segmentCenterInNode(s, nodePos.x, nodePos.y)))
      return centers
    }
    let cursorSixth = startSixth
    for (const seg of drag.segments) {
      const isSameAsSource = nodeId === drag.sourceNodeIds[seg.id]
      if (isSameAsSource) {
        const actualSeg = node.segments.find((s) => s.id === seg.id)
        if (actualSeg) {
          centers.push(segmentCenterInNode(actualSeg, nodePos.x, nodePos.y))
          cursorSixth = actualSeg.startSixth + actualSeg.sizeSixths
        } else {
          centers.push(segmentCenterInNode({ ...seg, startSixth: cursorSixth, sizeSixths: seg.sizeSixths }, nodePos.x, nodePos.y))
          cursorSixth += seg.sizeSixths
        }
      } else {
        centers.push(segmentCenterInNode({ ...seg, startSixth: cursorSixth, sizeSixths: seg.sizeSixths }, nodePos.x, nodePos.y))
        cursorSixth += seg.sizeSixths
      }
    }
    return centers
  }

  private getSegmentWorldBounds(segmentId: string, sourceNodeId: string): { x: number; y: number; w: number; h: number } | null {
    if (!this.currentScene) return null
    const sourceNode = this.currentScene.nodes[sourceNodeId]
    if (sourceNode) {
      const sourceSegment = sourceNode.segments.find((s) => s.id === segmentId)
      if (!sourceSegment) return null
      const b = segmentBoundsInNodeLocal(sourceSegment)
      const nodePos = this.getNodeDisplayPosition(sourceNode)
      return {
        x: nodePos.x + b.x,
        y: nodePos.y + b.y,
        w: b.w,
        h: b.h,
      }
    }
    const free = Object.values(this.currentScene.freeSegments ?? {}).find((fs) => fs.segment.id === segmentId)
    if (free) {
      const b = segmentBoundsInNodeLocal(free.segment)
      return {
        x: free.x + b.x - SLOT_START_X,
        y: free.y + b.y - TOP_BAND_H,
        w: b.w,
        h: b.h,
      }
    }
    return null
  }

  private beginSegmentDrag(segment: SceneSegmentVM, sourceNodeId: string, clientX: number, clientY: number): void {
    if (this.activeDrag.type !== 'idle') return
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
    for (const free of Object.values(this.currentScene.freeSegments ?? {})) {
      if (segmentIds.includes(free.segment.id)) {
        segmentById.set(free.segment.id, free.segment)
        sourceNodeIds[free.segment.id] = free.nodeId
      }
    }
    const segments: SceneSegmentVM[] = segmentIds
      .map((id) => segmentById.get(id))
      .filter((seg): seg is SceneSegmentVM => seg != null)
    if (segments.length === 0) return
    const { proxy, pivot, segmentBounds } = this.buildDragProxy(segments)
    const pointerWorld = this.screenToWorld(clientX, clientY)
    const grabbedWorldBounds = this.getSegmentWorldBounds(segment.id, sourceNodeId)
    const pointerInSegment = grabbedWorldBounds
      ? {
          x: Math.max(0, Math.min(grabbedWorldBounds.w, pointerWorld.x - grabbedWorldBounds.x)),
          y: Math.max(0, Math.min(grabbedWorldBounds.h, pointerWorld.y - grabbedWorldBounds.y)),
        }
      : { x: 0, y: 0 }
    const proxySegmentBounds = segmentBounds[segment.id]
    const proxyAnchorOffset = proxySegmentBounds
      ? {
          x: proxySegmentBounds.x + pointerInSegment.x - pivot.x,
          y: proxySegmentBounds.y + pointerInSegment.y - pivot.y,
        }
      : { x: 0, y: 0 }
    const lineLayer = new Container()
    this.worldLayer.addChild(lineLayer)
    this.worldLayer.addChild(proxy)
    this.activeDrag = {
      type: 'segment',
      state: {
        segments,
        segmentIds,
        sourceNodeIds,
        proxy,
        lineLayer,
        proxyAnchorOffset,
        dropAnchorOffset: pointerInSegment,
        snap: null,
      },
    }
    this.handlers.onDragSegmentStart(segmentIds)
    this.updateSegmentDrag(clientX, clientY)
  }

  private updateSegmentDrag(clientX: number, clientY: number): void {
    if (this.activeDrag.type !== 'segment') return
    const drag = this.activeDrag.state
    const world = this.screenToWorld(clientX, clientY)
    const targetNodeId = this.findDropTarget(world.x, world.y)
    this.handlers.onDragSegmentUpdate(targetNodeId ?? null)

    const snap = this.findSnapTarget(world.x, world.y, drag.segments[0])
    drag.snap = snap

    const proxyCenterX = world.x - drag.proxyAnchorOffset.x
    const proxyCenterY = world.y - drag.proxyAnchorOffset.y
    drag.proxy.position.set(proxyCenterX, proxyCenterY)

    drag.lineLayer.removeChildren()
    const targetCenters = this.getDropTargetCenters()
    for (const target of targetCenters) {
      const lineG = new Graphics()
      drawArrowLine(lineG, proxyCenterX, proxyCenterY, target.x, target.y)
      drag.lineLayer.addChild(lineG)
    }
  }

  private endSegmentDrag(event?: PointerEvent): void {
    if (this.activeDrag.type !== 'segment') return
    const drag = this.activeDrag.state
    this.lastDragEndTime = Date.now()
    const world = event ? this.screenToWorld(event.clientX, event.clientY) : null
    const targetNodeId = world ? this.findDropTarget(world.x, world.y) : drag.snap?.nodeId ?? null
    const anyDifferentSource = drag.segmentIds.some((id) => drag.sourceNodeIds[id] !== targetNodeId)
    const effectiveTarget = targetNodeId && anyDifferentSource ? targetNodeId : null
    this.skipSegmentAnimationOnce.clear()
    drag.segmentIds.forEach((segmentId) => this.skipSegmentAnimationOnce.add(segmentId))
    const dropX = world ? world.x - drag.dropAnchorOffset.x : undefined
    const dropY = world ? world.y - drag.dropAnchorOffset.y : undefined
    this.handlers.onDragSegmentEnd(effectiveTarget, dropX, dropY)
    this.worldLayer.removeChild(drag.lineLayer)
    this.worldLayer.removeChild(drag.proxy)
    drag.lineLayer.destroy({ children: true })
    drag.proxy.destroy({ children: true })
    this.endDrag()
  }

  private createNode(
    node: SceneNodeVM,
    hoveredSegmentId: string | null,
    filterCategory: string | null,
    selectedSegmentIds: readonly string[],
    previousSize?: { width: number; height: number },
  ): NodeView {
    const tier = getZoomTier(this.zoom)
    const textCompensationScale = getTextCompensationScale(this.zoom)
    const root = new Container()
    root.eventMode = 'static'
    const contentContainer = new Container()
    root.addChild(contentContainer)
    const displayPos = this.getNodeDisplayPosition(node)
    const positionSpring = createSpring2D(displayPos.x, displayPos.y)
    positionSpring.targetX = displayPos.x
    positionSpring.targetY = displayPos.y

    const slotCount = node.slotCount
    const isExpanded = this.isNodeExpanded(node.id)
    const visibleSlotCount = isExpanded ? slotCount : collapsedVisibleSlotCount(node.segments, slotCount)
    const totalMeterWidth = meterWidthForSlots(visibleSlotCount)
    const totalWidth = SLOT_START_X + totalMeterWidth + 20
    const totalHeight = TOP_BAND_H + slotAreaHeightForSlots(visibleSlotCount)
    const totalSixths = totalSixthsForSlots(slotCount)

    let moveToRootBtn: Graphics | undefined
    if (node.parentNodeId && this.handlers.onMoveNodeToRoot) {
      moveToRootBtn = new Graphics()
      moveToRootBtn.eventMode = 'static'
      moveToRootBtn.cursor = 'pointer'
      const btnW = 16
      const btnH = 16
      const btnX = -btnW - 4
      const btnY = totalHeight / 2 - btnH / 2
      moveToRootBtn.roundRect(btnX, btnY, btnW, btnH, 4)
      moveToRootBtn.fill({ color: 0x2f4878, alpha: 0.6 })
      moveToRootBtn.stroke({ width: 1, color: 0x5cadee, alpha: 0.8 })
      ;(moveToRootBtn as Container & { __dragHandle?: boolean }).__dragHandle = true
      moveToRootBtn.on('pointertap', () => {
        if (this.activeDrag.type !== 'idle') return
        this.handlers.onMoveNodeToRoot?.(node.id, root.position.x, root.position.y)
      })
      contentContainer.addChild(moveToRootBtn)
    }

    const bg = new Graphics()
    bg.roundRect(0, 0, totalWidth, totalHeight, 10)
    bg.fill({ color: 0x0d1a30, alpha: 0.92 })
    bg.stroke({ width: 1, color: 0x2f4878, alpha: 0.85 })
    contentContainer.addChild(bg)

    const speedColor = SPEED_COLORS[node.speedBand ?? 'green'] ?? 0x3dba72
    const speedBar = new Graphics()
    speedBar.roundRect(0, 0, 6, totalHeight, 3)
    speedBar.fill({ color: speedColor, alpha: 0.92 })
    contentContainer.addChild(speedBar)

    const dragHandle = new Graphics()
    dragHandle.eventMode = 'static'
    dragHandle.cursor = 'grab'
    ;(dragHandle as Container & { __dragHandle?: boolean }).__dragHandle = true
    const nodeHandleW = 14
    dragHandle.roundRect(0, 0, nodeHandleW, totalHeight, 8)
    dragHandle.fill({ color: 0x2a476f, alpha: 0.22 })
    const dotCenterY = totalHeight / 2 - 18
    for (let i = 0; i < 4; i += 1) {
      const y = dotCenterY + i * 12
      dragHandle.circle(3, y, 1.5)
      dragHandle.fill({ color: 0xe3f0ff, alpha: 0.86 })
    }
    contentContainer.addChild(dragHandle)

    const addExpandCaret = (midY: number): void => {
      const caret = new Graphics()
      caret.eventMode = 'static'
      caret.cursor = 'pointer'
      ;(caret as Container & { __dragHandle?: boolean }).__dragHandle = true
      caret.roundRect(14, midY - 9, 18, 18, 5)
      caret.fill({ color: 0xffffff, alpha: 0.001 })
      if (isExpanded) {
        caret.moveTo(18, midY - 2.5)
        caret.lineTo(26, midY - 2.5)
        caret.lineTo(22, midY + 2.5)
      } else {
        caret.moveTo(19, midY - 4)
        caret.lineTo(19, midY + 4)
        caret.lineTo(24, midY)
      }
      caret.fill({ color: 0xc5d8ff, alpha: 0.95 })
      caret.on('pointertap', (event: any) => {
        event.stopPropagation()
        this.setNodeExpanded(node.id, !isExpanded)
      })
      contentContainer.addChild(caret)
    }

    if (tier !== 'far') {
      const title = new BitmapText({
        text: node.title,
        style: { fill: '#e8f0ff', fontSize: 13, fontFamily: FONT_SEMIBOLD },
      })
      title.eventMode = 'none'
      title.anchor.set(0, 0.5)
      title.scale.set(textCompensationScale)
      const midY = TOP_BAND_H / 2
      addExpandCaret(midY)
      title.position.set(30, midY)
      contentContainer.addChild(title)
    } else {
      const compact = new BitmapText({
        text: `${compactToken(node.title, 4)} ${node.speedFeet}'`,
        style: { fill: '#b0c2e8', fontSize: 11, fontFamily: FONT_REGULAR },
      })
      compact.eventMode = 'none'
      compact.anchor.set(0, 0.5)
      compact.scale.set(textCompensationScale)
      const midY = TOP_BAND_H / 2
      addExpandCaret(midY)
      compact.position.set(30, midY)
      contentContainer.addChild(compact)
    }

    const occupiedSixths = occupiedSixthsFromSegments(node.segments, totalSixths)

    const slotFillLayer = new Graphics()
    const dimAlpha = tier === 'far' ? 0.1 : 0.14
    const brightAlpha = tier === 'far' ? 0.36 : 0.48
    const slotColorFn = node.twoBandSlots ? twoBandSlotColor : fixedSlotBandColor
    for (let stone = 0; stone < visibleSlotCount; stone += 1) {
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
    contentContainer.addChild(slotFillLayer)

    const segmentContainer = new Container()
    const segmentClip = new Graphics()
    segmentClip.eventMode = 'none'
    segmentClip.rect(0, 0, totalWidth, totalHeight)
    segmentClip.fill({ color: 0xffffff, alpha: 0.001 })
    contentContainer.addChild(segmentClip)
    segmentContainer.mask = segmentClip
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
        () => this.activeDrag.type === 'idle',
      )
      segmentContainer.addChild(segContainer)
    })
    contentContainer.addChild(segmentContainer)

    root.position.set(displayPos.x, displayPos.y)
    this.enableDrag(dragHandle, root, node.id)
    this.worldLayer.addChild(root)

    let clipWidthSpring: ReturnType<typeof createSpring1D> | undefined
    let clipHeightSpring: ReturnType<typeof createSpring1D> | undefined
    let contentClip: Graphics | undefined
    const needsClipAnimation =
      previousSize !== undefined &&
      (Math.abs(previousSize.width - totalWidth) > 0.5 || Math.abs(previousSize.height - totalHeight) > 0.5)
    if (needsClipAnimation) {
      clipWidthSpring = createSpring1D(previousSize.width)
      clipHeightSpring = createSpring1D(previousSize.height)
      setSpring1DTarget(clipWidthSpring, totalWidth)
      setSpring1DTarget(clipHeightSpring, totalHeight)
      contentClip = new Graphics()
      contentClip.eventMode = 'none'
      drawNodeClipMask(contentClip, clipWidthSpring.value, clipHeightSpring.value)
      root.addChildAt(contentClip, 0)
      contentContainer.mask = contentClip
    }

    return {
      root,
      positionSpring,
      segmentContainer,
      contentContainer,
      segmentViews,
      moveToRootBtn,
      totalWidth,
      totalHeight,
      clipWidthSpring,
      clipHeightSpring,
      contentClip,
    }
  }

  private updateNode(
    node: SceneNodeVM,
    view: NodeView,
    hoveredSegmentId: string | null,
    filterCategory: string | null,
    selectedSegmentIds: readonly string[],
  ): void {
    const displayPos = this.getNodeDisplayPosition(node)
    setSpringTarget(view.positionSpring, displayPos.x, displayPos.y)
    if (this.skipNodeAnimationOnce.delete(node.id)) {
      view.positionSpring.x = displayPos.x
      view.positionSpring.y = displayPos.y
      view.positionSpring.targetX = displayPos.x
      view.positionSpring.targetY = displayPos.y
      view.positionSpring.vx = 0
      view.positionSpring.vy = 0
      view.positionSpring.active = false
      view.root.position.set(displayPos.x, displayPos.y)
    }
    const totalHeight = this.getNodeDisplayDimensions(node).height
    if (node.parentNodeId && this.handlers.onMoveNodeToRoot) {
      if (!view.moveToRootBtn) {
        const moveToRootBtn = new Graphics()
        moveToRootBtn.eventMode = 'static'
        moveToRootBtn.cursor = 'pointer'
        const btnW = 16
        const btnH = 16
        const btnX = -btnW - 4
        const btnY = totalHeight / 2 - btnH / 2
        moveToRootBtn.roundRect(btnX, btnY, btnW, btnH, 4)
        moveToRootBtn.fill({ color: 0x2f4878, alpha: 0.6 })
        moveToRootBtn.stroke({ width: 1, color: 0x5cadee, alpha: 0.8 })
        ;(moveToRootBtn as Container & { __dragHandle?: boolean }).__dragHandle = true
        moveToRootBtn.on('pointertap', () => {
          if (this.activeDrag.type !== 'idle') return
          this.handlers.onMoveNodeToRoot?.(node.id, view.root.position.x, view.root.position.y)
        })
        view.contentContainer.addChildAt(moveToRootBtn, 0)
        ;(view as NodeView).moveToRootBtn = moveToRootBtn
      }
    } else if (view.moveToRootBtn) {
      view.contentContainer.removeChild(view.moveToRootBtn)
      view.moveToRootBtn.destroy()
      ;(view as NodeView).moveToRootBtn = undefined
    }

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
          () => this.activeDrag.type === 'idle',
        )
        view.segmentContainer.addChild(segContainer)
      } else {
        setSpringTarget(segView.spring, pos.x, pos.y)
        if (this.skipSegmentAnimationOnce.delete(segment.id)) {
          segView.spring.x = pos.x
          segView.spring.y = pos.y
          segView.spring.targetX = pos.x
          segView.spring.targetY = pos.y
          segView.spring.vx = 0
          segView.spring.vy = 0
          segView.spring.active = false
          segView.container.position.set(pos.x, pos.y)
        }
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
          () => this.activeDrag.type === 'idle',
        )
      }
    })
  }

  private enableDrag(handleView: Container, nodeContainer: Container, nodeId: string): void {
    handleView.on('pointerdown', (event) => {
      if (event.button !== 0 || this.activeDrag.type !== 'idle' || !this.currentScene) return
      this.handlers.onHoverSegment(null)
      this.hideTooltip()
      const nodeIds: string[] = [nodeId]
      for (const n of Object.values(this.currentScene.nodes)) {
        if (n.parentNodeId === nodeId) nodeIds.push(n.id)
      }
      const nodeContainers: Container[] = []
      for (const nid of nodeIds) {
        const v = this.nodeViews.get(nid)
        if (v) nodeContainers.push(v.root)
      }
      if (nodeContainers.length === 0) return
      const initialPositions = nodeContainers.map((c) => ({ x: c.position.x, y: c.position.y }))
      const canvasRect = this.app.canvas.getBoundingClientRect()
      const clientX = typeof event.clientX === 'number' ? event.clientX : event.global.x + canvasRect.left
      const clientY = typeof event.clientY === 'number' ? event.clientY : event.global.y + canvasRect.top
      const point = this.screenToWorld(clientX, clientY)
      const anchorOffset = {
        x: point.x - nodeContainer.position.x,
        y: point.y - nodeContainer.position.y,
      }
      this.activeDrag = {
        type: 'nodeReorder',
        state: {
          nodeIds,
          nodeContainers,
          initialPositions,
          handleView,
          anchorOffset,
          targetGroupId: null,
          targetIndex: 0,
          targetNestParentNodeId: null,
        },
      }
      handleView.cursor = 'grabbing'
      event.stopPropagation()
    })
    handleView.on('pointerup', () => {
      handleView.cursor = 'grab'
    })
    handleView.on('pointerupoutside', () => {
      handleView.cursor = 'grab'
    })
  }

  private createGroup(group: SceneGroupVM): GroupView {
    const root = new Container()
    root.position.set(group.x, group.y)
    const displayHeight = this.getGroupDisplayHeight(group)

    const bg = new Graphics()
    bg.roundRect(0, 0, group.width, displayHeight, 14)
    bg.fill({ color: 0x101b33, alpha: 0.36 })
    bg.stroke({ width: 2, color: 0x6f8fc5, alpha: 0.75 })
    root.addChild(bg)

    const handle = new Graphics()
    handle.eventMode = 'static'
    handle.cursor = 'grab'
    ;(handle as Container & { __groupHandle?: boolean; __groupHandleId?: string }).__groupHandle = true
    ;(handle as Container & { __groupHandle?: boolean; __groupHandleId?: string }).__groupHandleId = group.id
    const handleW = 14
    handle.roundRect(0, 0, handleW, displayHeight, 10)
    handle.fill({ color: 0x2a476f, alpha: 0.22 })
    const groupDotY = displayHeight / 2 - 18
    for (let i = 0; i < 4; i += 1) {
      const y = groupDotY + i * 12
      handle.circle(6.2, y, 1.5)
      handle.fill({ color: 0xe3f0ff, alpha: 0.86 })
    }
    root.addChild(handle)

    const title = new BitmapText({
      text: group.title,
      style: { fill: '#dfeaff', fontSize: 12, fontFamily: FONT_SEMIBOLD },
    })
    title.eventMode = 'none'
    title.scale.set(getTextCompensationScale(this.zoom))
    title.position.set(24, 14)
    root.addChild(title)

    this.groupLayer.addChild(root)
    return { root }
  }

  private createFreeSegment(
    free: SceneFreeSegmentVM,
    hoveredSegmentId: string | null,
    filterCategory: string | null,
    selectedSegmentIds: readonly string[],
  ): FreeSegmentView {
    const tier = getZoomTier(this.zoom)
    const textCompensationScale = getTextCompensationScale(this.zoom)
    const root = new Container()
    root.position.set(free.x - SLOT_START_X, free.y - TOP_BAND_H)
    const hovered = free.segment.id === hoveredSegmentId
    drawSegmentBlock(
      root,
      free.segment,
      tier,
      this.zoom,
      hovered,
      this.handlers,
      textCompensationScale,
      this.minVisibleLabelPx,
      this.maxVisibleLabelPx,
      Math.max(6, free.segment.sizeSixths),
      (seg, x, y) => this.showTooltip(seg, x, y),
      (x, y) => this.moveTooltip(x, y),
      () => this.hideTooltip(),
      free.nodeId,
      (seg, nodeId, x, y) => this.beginSegmentDrag(seg, nodeId, x, y),
      undefined,
      filterCategory,
      selectedSegmentIds,
      this.handlers.onSegmentClick,
      this.handlers.onSegmentDoubleClick,
      () => this.lastDragEndTime,
      () => this.activeDrag.type === 'idle',
    )
    this.worldLayer.addChild(root)
    return { root }
  }

  private createLabel(label: SceneLabelVM, selected: boolean): LabelView {
    const root = new Container()
    root.position.set(label.x, label.y)
    ;(root as Container & { __labelId?: string }).__labelId = label.id
    root.eventMode = 'static'
    root.cursor = 'default'
    root.on('pointertap', (event: any) => {
      event.stopPropagation()
      this.handlers.onSelectLabel?.(label.id)
    })

    const text = new BitmapText({
      text: label.text,
      style: { fill: '#eaf2ff', fontSize: 24, fontFamily: FONT_SEMIBOLD, align: 'left' },
    })
    text.eventMode = 'none'
    text.scale.set(getTextCompensationScale(this.zoom))
    text.position.set(0, 34)
    root.addChild(text)

    const bounds = text.getLocalBounds()
    const boxW = Math.max(170, bounds.width + 18)
    const boxH = Math.max(44, bounds.height * text.scale.y + 40)

    const panel = new Graphics()
    panel.eventMode = 'none'
    panel.roundRect(-8, 0, boxW, boxH, 10)
    panel.fill({ color: 0x0d1a30, alpha: selected ? 0.8 : 0.62 })
    panel.stroke({ width: selected ? 2 : 1, color: selected ? 0x8fc0ff : 0x5478b0, alpha: 0.9 })
    root.addChildAt(panel, 0)

    const handle = new Graphics()
    handle.eventMode = 'static'
    handle.cursor = 'grab'
    ;(handle as Container & { __labelHandleId?: string }).__labelHandleId = label.id
    handle.roundRect(-8, 0, boxW, 28, 10)
    handle.fill({ color: 0x2a476f, alpha: 0.84 })
    handle.stroke({ width: 1.5, color: 0xb0cbef, alpha: 0.9 })
    for (let i = 0; i < 3; i += 1) {
      const y = 8 + i * 6
      handle.roundRect(10, y, boxW - 20, 2.4, 1.2)
      handle.fill({ color: 0xe6f2ff, alpha: 0.84 })
    }
    handle.on('pointerdown', (event: any) => {
      if (event.button !== 0 || this.activeDrag.type !== 'idle') return
      const canvasRect = this.app.canvas.getBoundingClientRect()
      const clientX = typeof event.clientX === 'number' ? event.clientX : event.global.x + canvasRect.left
      const clientY = typeof event.clientY === 'number' ? event.clientY : event.global.y + canvasRect.top
      const world = this.screenToWorld(clientX, clientY)
      this.activeDrag = {
        type: 'label',
        state: {
          labelId: label.id,
          offset: { x: world.x - root.position.x, y: world.y - root.position.y },
        },
      }
      this.handlers.onSelectLabel?.(label.id)
      handle.cursor = 'grabbing'
      event.stopPropagation()
    })
    handle.on('pointerup', () => {
      handle.cursor = 'grab'
    })
    handle.on('pointerupoutside', () => {
      handle.cursor = 'grab'
    })
    root.addChild(handle)

    this.labelLayer.addChild(root)
    return { root }
  }

  private updateLabelDrag(clientX: number, clientY: number): void {
    if (this.activeDrag.type !== 'label') return
    const drag = this.activeDrag.state
    const view = this.labelViews.get(drag.labelId)
    if (!view) return
    const world = this.screenToWorld(clientX, clientY)
    const x = world.x - drag.offset.x
    const y = world.y - drag.offset.y
    view.root.position.set(x, y)
    this.handlers.onMoveLabel?.(drag.labelId, x, y)
  }

  private findNodeDropTarget(
    nodeIds: string[],
    worldX: number,
    worldY: number,
  ): { type: 'reorder'; groupId: string; index: number; lineY: number } | { type: 'nest'; parentNodeId: string; lineY: number } | null {
    if (!this.currentScene) return null
    const BODY_INSET = 8

    for (const node of Object.values(this.currentScene.nodes)) {
      if (nodeIds.includes(node.id)) continue
      if (node.parentNodeId) continue
      const pos = this.getNodeDisplayPosition(node)
      const dims = this.getNodeDisplayDimensions(node)
      const bodyLeft = pos.x + BODY_INSET
      const bodyRight = pos.x + dims.width - BODY_INSET
      const bodyTop = pos.y + TOP_BAND_H
      const bodyBottom = pos.y + dims.height - BODY_INSET
      if (worldX >= bodyLeft && worldX <= bodyRight && worldY >= bodyTop && worldY <= bodyBottom) {
        return { type: 'nest', parentNodeId: node.id, lineY: pos.y + dims.height / 2 }
      }
    }

    const groups = Object.values(this.currentScene.groups ?? {})
    let target: SceneGroupVM | null = null
    for (let i = groups.length - 1; i >= 0; i -= 1) {
      const g = groups[i]
      if (!g) continue
      const displayH = this.getGroupDisplayHeight(g)
      if (worldX >= g.x && worldX <= g.x + g.width && worldY >= g.y && worldY <= g.y + displayH) {
        target = g
        break
      }
    }
    if (!target) return null

    const candidateIds = target.nodeIds.filter((id) => !nodeIds.includes(id))
    let index = candidateIds.length
    for (let i = 0; i < candidateIds.length; i += 1) {
      const n = this.currentScene.nodes[candidateIds[i]]
      if (!n) continue
      if (worldY < n.y + n.height / 2) {
        index = i
        break
      }
    }
    let lineY = target.y + 42
    if (candidateIds.length === 0) {
      lineY = target.y + 56
    } else if (index >= candidateIds.length) {
      const last = this.currentScene.nodes[candidateIds[candidateIds.length - 1]]
      if (last) {
        const lastDims = this.getNodeDisplayDimensions(last)
        const lastPos = this.getNodeDisplayPosition(last)
        lineY = lastPos.y + lastDims.height + 4
      }
    } else {
      const n = this.currentScene.nodes[candidateIds[index]]
      if (n) {
        const nPos = this.getNodeDisplayPosition(n)
        lineY = nPos.y - 4
      }
    }
    return { type: 'reorder', groupId: target.id, index, lineY }
  }

  private drawGroupDropIndicator(
    drop:
      | { type: 'reorder'; groupId: string; lineY: number }
      | { type: 'nest'; parentNodeId: string; lineY: number },
  ): void {
    const indicator = this.groupDropIndicator
    if (!this.currentScene) return
    indicator.clear()
    this.groupLayer.addChild(indicator)
    if (drop.type === 'reorder') {
      const group = this.currentScene.groups[drop.groupId]
      if (!group) return
      const x1 = group.x + 20
      const x2 = group.x + group.width - 20
      indicator.moveTo(x1, drop.lineY)
      indicator.lineTo(x2, drop.lineY)
      indicator.stroke({ width: 3, color: 0xffffff, alpha: 0.95 })
    } else {
      const node = this.currentScene.nodes[drop.parentNodeId]
      if (!node) return
      const pos = this.getNodeDisplayPosition(node)
      const dims = this.getNodeDisplayDimensions(node)
      indicator.roundRect(pos.x - 2, pos.y - 2, dims.width + 4, dims.height + 4, 12)
      indicator.stroke({ width: 3, color: 0x5cadee, alpha: 0.9 })
    }
  }

  private updateNodeReorderDrag(clientX: number, clientY: number): void {
    if (this.activeDrag.type !== 'nodeReorder' || !this.currentScene) return
    const drag = this.activeDrag.state
    const world = this.screenToWorld(clientX, clientY)
    const x = world.x - drag.anchorOffset.x
    const y = world.y - drag.anchorOffset.y
    const dx = x - drag.initialPositions[0].x
    const dy = y - drag.initialPositions[0].y
    for (let i = 0; i < drag.nodeContainers.length; i++) {
      const c = drag.nodeContainers[i]
      const ip = drag.initialPositions[i]
      c.position.set(ip.x + dx, ip.y + dy)
    }
    const primaryNode = this.currentScene.nodes[drag.nodeIds[0]]
    const primaryDims = primaryNode ? this.getNodeDisplayDimensions(primaryNode) : null
    const probeX = primaryDims ? x + primaryDims.width / 2 : world.x
    const probeY = primaryDims ? y + primaryDims.height / 2 : world.y
    const drop = this.findNodeDropTarget(drag.nodeIds, probeX, probeY)
    if (drop) {
      if (drop.type === 'reorder') {
        drag.targetGroupId = drop.groupId
        drag.targetIndex = drop.index
        drag.targetNestParentNodeId = null
      } else {
        drag.targetGroupId = null
        drag.targetIndex = 0
        drag.targetNestParentNodeId = drop.parentNodeId
      }
      this.drawGroupDropIndicator(drop)
    } else {
      this.groupDropIndicator.clear()
      drag.targetGroupId = null
      drag.targetNestParentNodeId = null
    }
  }

  private finishNodeReorderDrag(finalClientX?: number, finalClientY?: number): void {
    if (this.activeDrag.type !== 'nodeReorder') return
    const drag = this.activeDrag.state
    this.setNodeContentVisibility(drag.nodeIds, true)
    if (finalClientX != null && finalClientY != null && this.currentScene) {
      const primaryNode = this.currentScene.nodes[drag.nodeIds[0]]
      if (primaryNode) {
        const primaryDims = this.getNodeDisplayDimensions(primaryNode)
        const world = this.screenToWorld(finalClientX, finalClientY)
        const x = world.x - drag.anchorOffset.x
        const y = world.y - drag.anchorOffset.y
        const probeX = x + primaryDims.width / 2
        const probeY = y + primaryDims.height / 2
        const finalDrop = this.findNodeDropTarget(drag.nodeIds, probeX, probeY)
        if (finalDrop) {
          if (finalDrop.type === 'reorder') {
            drag.targetGroupId = finalDrop.groupId
            drag.targetIndex = finalDrop.index
            drag.targetNestParentNodeId = null
          } else {
            drag.targetGroupId = null
            drag.targetIndex = 0
            drag.targetNestParentNodeId = finalDrop.parentNodeId
          }
        }
      }
    }
    drag.handleView.cursor = 'grab'
    this.groupDropIndicator.clear()
    this.skipNodeAnimationOnce.clear()
    if (drag.targetNestParentNodeId && this.handlers.onNestNodeUnder) {
      drag.nodeIds.forEach((nodeId) => this.skipNodeAnimationOnce.add(nodeId))
      this.handlers.onNestNodeUnder(drag.nodeIds[0], drag.targetNestParentNodeId)
    } else if (drag.targetGroupId && this.handlers.onMoveNodeToGroupIndex) {
      drag.nodeIds.forEach((nodeId) => this.skipNodeAnimationOnce.add(nodeId))
      this.handlers.onMoveNodeToGroupIndex(drag.nodeIds[0], drag.targetGroupId, drag.targetIndex)
    } else if (finalClientX != null && finalClientY != null && this.handlers.onMoveNodeToRoot) {
      const world = this.screenToWorld(finalClientX, finalClientY)
      drag.nodeIds.forEach((nodeId) => this.skipNodeAnimationOnce.add(nodeId))
      this.handlers.onMoveNodeToRoot(drag.nodeIds[0], world.x - drag.anchorOffset.x, world.y - drag.anchorOffset.y)
    }
    this.endDrag()
  }

  private setNodeContentVisibility(nodeIds: readonly string[], visible: boolean): void {
    nodeIds.forEach((nodeId) => {
      const view = this.nodeViews.get(nodeId)
      if (!view) return
      view.contentContainer.visible = visible
      if (!visible) this.hiddenNodeContentIds.add(nodeId)
      else this.hiddenNodeContentIds.delete(nodeId)
    })
  }

  private setGroupNodeContentVisibility(groupId: string, visible: boolean): void {
    if (!this.currentScene) return
    const group = this.currentScene.groups[groupId]
    if (!group) return
    this.setNodeContentVisibility(group.nodeIds, visible)
  }

  private endDrag(): void {
    if (this.activeDrag.type === 'group') {
      this.setGroupNodeContentVisibility(this.activeDrag.state.groupId, true)
    } else if (this.activeDrag.type === 'nodeReorder') {
      this.setNodeContentVisibility(this.activeDrag.state.nodeIds, true)
    }
    this.activeDrag = { type: 'idle' }
    if (this.pendingRebuild && this.currentScene) {
      this.rebuildAllNodes(this.currentScene)
      this.startSpringTicker()
      this.pendingRebuild = false
    }
  }

  private rebuildAllNodes(scene: SceneVM): void {
    if (!this.fontsLoaded) return
    this.recomputeDisplayFlow(scene)
    const previousNodePositions = new Map<string, { x: number; y: number }>()
    const previousNodeSizes = new Map<string, { width: number; height: number }>()
    for (const [nodeId, view] of this.nodeViews) {
      previousNodePositions.set(nodeId, { x: view.root.position.x, y: view.root.position.y })
      previousNodeSizes.set(nodeId, { width: view.totalWidth, height: view.totalHeight })
    }
    for (const [, view] of this.groupViews) {
      this.groupLayer.removeChild(view.root)
      view.root.destroy({ children: true })
    }
    this.groupViews.clear()
    for (const [, view] of this.nodeViews) {
      this.worldLayer.removeChild(view.root)
      view.root.destroy({ children: true })
    }
    this.nodeViews.clear()
    for (const [, view] of this.freeSegmentViews) {
      this.worldLayer.removeChild(view.root)
      view.root.destroy({ children: true })
    }
    this.freeSegmentViews.clear()
    for (const [, view] of this.labelViews) {
      this.labelLayer.removeChild(view.root)
      view.root.destroy({ children: true })
    }
    this.labelViews.clear()
    const liveNodeIds = new Set(Object.keys(scene.nodes))
    for (const nodeId of this.nodeExpandedState.keys()) {
      if (!liveNodeIds.has(nodeId)) this.nodeExpandedState.delete(nodeId)
    }
    const filterCategory = scene.filterCategory ?? null
    const selectedSegmentIds = scene.selectedSegmentIds ?? []
    Object.values(scene.nodes).forEach((node) => {
      const previousNodeSize = previousNodeSizes.get(node.id)
      const targetDims = this.getNodeDisplayDimensions(node)
      const previousSize =
        previousNodeSize &&
        (targetDims.width > previousNodeSize.width || targetDims.height > previousNodeSize.height)
          ? previousNodeSize
          : undefined
      const view = this.createNode(
        node,
        scene.hoveredSegmentId ?? null,
        filterCategory,
        selectedSegmentIds,
        previousSize,
      )
      const displayPos = this.getNodeDisplayPosition(node)
      if (this.skipNodeAnimationOnce.delete(node.id)) {
        view.positionSpring.x = displayPos.x
        view.positionSpring.y = displayPos.y
        view.positionSpring.targetX = displayPos.x
        view.positionSpring.targetY = displayPos.y
        view.positionSpring.vx = 0
        view.positionSpring.vy = 0
        view.positionSpring.active = false
        view.root.position.set(displayPos.x, displayPos.y)
      } else {
        const previousPos = previousNodePositions.get(node.id)
        if (previousPos) {
          const moved = previousPos.x !== displayPos.x || previousPos.y !== displayPos.y
          if (moved) {
            view.positionSpring.x = previousPos.x
            view.positionSpring.y = previousPos.y
            view.positionSpring.targetX = displayPos.x
            view.positionSpring.targetY = displayPos.y
            view.positionSpring.vx = 0
            view.positionSpring.vy = 0
            view.positionSpring.active = true
            view.root.position.set(previousPos.x, previousPos.y)
          }
        }
      }
      this.nodeViews.set(node.id, view)
    })
    if (this.hiddenNodeContentIds.size > 0) {
      this.setNodeContentVisibility([...this.hiddenNodeContentIds], false)
    }
    Object.values(scene.freeSegments ?? {}).forEach((free) => {
      this.freeSegmentViews.set(
        free.id,
        this.createFreeSegment(free, scene.hoveredSegmentId ?? null, filterCategory, selectedSegmentIds),
      )
    })
    Object.values(scene.groups ?? {}).forEach((group) => {
      this.groupViews.set(group.id, this.createGroup(group))
    })
    Object.values(scene.labels ?? {}).forEach((label) => {
      this.labelViews.set(label.id, this.createLabel(label, scene.selectedLabelId === label.id))
    })
    this.updateSelectionOverlay()
  }

  private rebuildGroups(scene: SceneVM): void {
    for (const [, view] of this.groupViews) {
      this.groupLayer.removeChild(view.root)
      view.root.destroy({ children: true })
    }
    this.groupViews.clear()
    Object.values(scene.groups ?? {}).forEach((group) => {
      this.groupViews.set(group.id, this.createGroup(group))
    })
  }

  private rebuildFreeSegments(scene: SceneVM): void {
    for (const [, view] of this.freeSegmentViews) {
      this.worldLayer.removeChild(view.root)
      view.root.destroy({ children: true })
    }
    this.freeSegmentViews.clear()
    Object.values(scene.freeSegments ?? {}).forEach((free) => {
      this.freeSegmentViews.set(
        free.id,
        this.createFreeSegment(
          free,
          scene.hoveredSegmentId ?? null,
          scene.filterCategory ?? null,
          scene.selectedSegmentIds ?? [],
        ),
      )
    })
  }

  applyInit(scene: SceneVM): void {
    this.currentScene = scene
    this.recomputeDisplayFlow(scene)
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
    const completedTransitions: Array<() => void> = []
    for (const [, view] of this.nodeViews) {
      if (updateSpring2D(view.positionSpring, dt)) anyActive = true
      view.root.position.set(view.positionSpring.x, view.positionSpring.y)
      if (view.clipWidthSpring && view.clipHeightSpring && view.contentClip) {
        const widthActive = updateSpring1D(view.clipWidthSpring, dt)
        const heightActive = updateSpring1D(view.clipHeightSpring, dt)
        if (widthActive || heightActive) anyActive = true
        drawNodeClipMask(view.contentClip, view.clipWidthSpring.value, view.clipHeightSpring.value)
        if (!view.clipWidthSpring.active && !view.clipHeightSpring.active) {
          const onComplete = view.onClipAnimationComplete
          if (onComplete) {
            ;(view as NodeView).onClipAnimationComplete = undefined
            ;(view as NodeView).clipWidthSpring = undefined
            ;(view as NodeView).clipHeightSpring = undefined
            completedTransitions.push(onComplete)
          } else {
            view.contentContainer.mask = null
            view.root.removeChild(view.contentClip)
            view.contentClip.destroy()
            ;(view as NodeView).clipWidthSpring = undefined
            ;(view as NodeView).clipHeightSpring = undefined
            ;(view as NodeView).contentClip = undefined
          }
        }
      }
      for (const [, segView] of view.segmentViews) {
        if (updateSpring2D(segView.spring, dt)) anyActive = true
        segView.container.position.set(segView.spring.x, segView.spring.y)
      }
    }
    this.updateSelectionOverlay()
    if (completedTransitions.length > 0) anyActive = true
    for (const done of completedTransitions) done()
    if (!anyActive) {
      this.app.ticker.remove(this.springTickerBound)
    }
  }

  private isNodeExpanded(nodeId: string): boolean {
    return this.nodeExpandedState.get(nodeId) === true
  }

  private setNodeExpanded(nodeId: string, expanded: boolean): void {
    if (!this.currentScene) return
    const node = this.currentScene.nodes[nodeId]
    const view = this.nodeViews.get(nodeId)
    if (!node || !view) {
      this.nodeExpandedState.set(nodeId, expanded)
      this.rebuildAllNodes(this.currentScene)
      this.startSpringTicker()
      return
    }

    if (expanded) {
      this.nodeExpandedState.set(nodeId, true)
      this.rebuildAllNodes(this.currentScene)
      this.startSpringTicker()
      return
    }

    const targetDims = this.getNodeDisplayDimensionsForExpanded(node, false)
    const currentWidth = view.clipWidthSpring?.value ?? view.totalWidth
    const currentHeight = view.clipHeightSpring?.value ?? view.totalHeight
    if (Math.abs(currentWidth - targetDims.width) <= 0.5 && Math.abs(currentHeight - targetDims.height) <= 0.5) {
      this.nodeExpandedState.set(nodeId, false)
      this.rebuildAllNodes(this.currentScene)
      this.startSpringTicker()
      return
    }

    // Update display flow immediately so sibling nodes start moving while this node clips closed.
    this.nodeExpandedState.set(nodeId, false)
    this.recomputeDisplayFlow(this.currentScene)
    for (const [id, nodeView] of this.nodeViews) {
      const sceneNode = this.currentScene.nodes[id]
      if (!sceneNode) continue
      const pos = this.getNodeDisplayPosition(sceneNode)
      setSpringTarget(nodeView.positionSpring, pos.x, pos.y)
    }

    let clip = view.contentClip
    if (!clip) {
      clip = new Graphics()
      clip.eventMode = 'none'
      drawNodeClipMask(clip, currentWidth, currentHeight)
      view.root.addChildAt(clip, 0)
      view.contentContainer.mask = clip
      ;(view as NodeView).contentClip = clip
    }
    const widthSpring = createSpring1D(currentWidth)
    const heightSpring = createSpring1D(currentHeight)
    setSpring1DTarget(widthSpring, targetDims.width)
    setSpring1DTarget(heightSpring, targetDims.height)
    ;(view as NodeView).clipWidthSpring = widthSpring
    ;(view as NodeView).clipHeightSpring = heightSpring
    ;(view as NodeView).onClipAnimationComplete = () => {
      if (!this.currentScene) return
      this.rebuildAllNodes(this.currentScene)
      this.startSpringTicker()
    }
    this.startSpringTicker()
  }

  private getVisibleSlotCount(node: SceneNodeVM): number {
    const expanded = this.isNodeExpanded(node.id)
    return expanded ? node.slotCount : collapsedVisibleSlotCount(node.segments, node.slotCount)
  }

  private getNodeDisplayDimensionsForExpanded(
    node: SceneNodeVM,
    expanded: boolean,
  ): { width: number; height: number } {
    const visibleSlotCount = expanded ? node.slotCount : collapsedVisibleSlotCount(node.segments, node.slotCount)
    const totalMeterWidth = meterWidthForSlots(visibleSlotCount)
    return {
      width: SLOT_START_X + totalMeterWidth + 20,
      height: TOP_BAND_H + slotAreaHeightForSlots(visibleSlotCount),
    }
  }

  private getNodeDisplayDimensions(node: SceneNodeVM): { width: number; height: number } {
    return this.getNodeDisplayDimensionsForExpanded(node, this.isNodeExpanded(node.id))
  }

  private recomputeDisplayFlow(scene: SceneVM): void {
    this.nodeDisplayOffsetY.clear()
    this.groupDisplayHeights.clear()
    for (const group of Object.values(scene.groups ?? {})) {
      let yOffset = 0
      for (const nodeId of group.nodeIds) {
        const node = scene.nodes[nodeId]
        if (!node) continue
        this.nodeDisplayOffsetY.set(node.id, yOffset)
        const dims = this.getNodeDisplayDimensions(node)
        yOffset += dims.height - node.height
      }
      this.groupDisplayHeights.set(group.id, Math.max(40, group.height + yOffset))
    }
  }

  private getNodeDisplayPosition(node: SceneNodeVM): { x: number; y: number } {
    return { x: node.x, y: node.y + (this.nodeDisplayOffsetY.get(node.id) ?? 0) }
  }

  private getGroupDisplayHeight(group: SceneGroupVM): number {
    return this.groupDisplayHeights.get(group.id) ?? group.height
  }

  applyPatches(patches: readonly ScenePatch[], scene: SceneVM): void {
    this.currentScene = scene
    this.recomputeDisplayFlow(scene)
    let needsFullRebuild = false
    let metaChanged = false
    patches.forEach((patch) => {
      if (patch.type === 'UPDATE_META') {
        this.paceText.text = `Party ${patch.partyPaceText}`
        metaChanged = true
        return
      }
      if (patch.type === 'UPDATE_NODE') {
        const view = this.nodeViews.get(patch.node.id)
        if (view) {
          if (!this.isNodeExpanded(patch.node.id)) {
            needsFullRebuild = true
            return
          }
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
    if (!needsFullRebuild && metaChanged) {
      this.rebuildGroups(scene)
      this.rebuildFreeSegments(scene)
      for (const node of Object.values(scene.nodes)) {
        const view = this.nodeViews.get(node.id)
        if (!view) {
          needsFullRebuild = true
          break
        }
        this.updateNode(
          node,
          view,
          scene.hoveredSegmentId ?? null,
          scene.filterCategory ?? null,
          scene.selectedSegmentIds ?? [],
        )
      }
      this.updateSelectionOverlay()
      this.startSpringTicker()
    }
    if (needsFullRebuild) {
      if (this.activeDrag.type !== 'idle') {
        this.pendingRebuild = true
      } else {
        this.rebuildAllNodes(scene)
        this.startSpringTicker()
      }
    }
  }
}

