import { Application, Assets, BitmapText, Color, Container, Graphics, Point, Rectangle } from 'pixi.js'
import { createSpring1D, createSpring2D, setSpring1DTarget, setSpringTarget, updateSpring1D, updateSpring2D } from './spring'
import type { SceneFreeSegmentVM, SceneGroupVM, SceneLabelVM, SceneNodeVM, ScenePatch, SceneVM, SceneSegmentVM } from '../worker/protocol'
import { resolveNodeGroupDropMode } from './node-drop-mode'
import { canShowNodeResizeHandles } from './node-resize-availability'
import { groupContiguousSameType } from './group-contiguous-same-type'
import { resolveDragStartFromSegment } from './drag-start-resolution'

/** Stored on segment blocks for context-menu hit testing. */
type SegmentContext = { segmentId: string; nodeId: string }

type GroupDragData = {
  readonly groupId: string
  /** Pointer offset from group top-left in world units. */
  readonly anchorOffset: { x: number; y: number }
}

type GroupResizeDragData = {
  readonly groupId: string
  readonly startPointerWorld: { x: number; y: number }
  readonly startWidth: number
  readonly startHeight: number
  readonly resizeX: boolean
  readonly resizeY: boolean
}

type NodeResizeDragData = {
  readonly nodeId: string
  readonly startPointerWorld: { x: number; y: number }
  readonly startSlotCols: number
  readonly startSlotRows: number
  readonly resizeX: boolean
  readonly resizeY: boolean
}

type NodeReorderDragData = {
  readonly nodeIds: string[]
  readonly operationNodeIds: string[]
  readonly nodeContainers: Container[]
  readonly initialPositions: { x: number; y: number }[]
  readonly handleView: Container
  /** Pointer offset from primary node top-left in world units. */
  readonly anchorOffset: { x: number; y: number }
  readonly originalGroupId: string | null
  readonly originalIndex: number
  readonly originalNestParentId: string | null
  targetGroupId: string | null
  targetIndex: number
  targetNestParentNodeId: string | null
  targetContainNodeId: string | null
}

type LabelDragData = {
  readonly labelId: string
  readonly offset: { x: number; y: number }
}

type ConnectorDragData = {
  readonly nodeId: string
  readonly fromX: number
  readonly fromY: number
  targetNodeId: string | null
}

type MarqueeSelection = {
  readonly segmentIds: string[]
  readonly nodeIds: string[]
  readonly groupIds: string[]
  readonly labelIds: string[]
}

type MarqueeOriginScope =
  | { type: 'world' }
  | { type: 'group'; groupId: string }
  | { type: 'node'; nodeId: string }

type ActiveDrag =
  | { type: 'idle' }
  | { type: 'pendingSegment'; segment: SceneSegmentVM; nodeId: string; startClientX: number; startClientY: number; addToSelection: boolean }
  | { type: 'segment'; state: SegmentDragState }
  | { type: 'group'; state: GroupDragData }
  | { type: 'groupResize'; state: GroupResizeDragData }
  | { type: 'nodeResize'; state: NodeResizeDragData }
  | { type: 'nodeReorder'; state: NodeReorderDragData }
  | { type: 'connector'; state: ConnectorDragData }
  | { type: 'label'; state: LabelDragData }
  | { type: 'marquee'; startWorldX: number; startWorldY: number; endX: number; endY: number; origin: MarqueeOriginScope }

type AdapterHandlers = {
  onHoverSegment(segmentId: string | null): void
  onMoveGroup?(groupId: string, x: number, y: number): void
  onResizeGroup?(groupId: string, width: number, height: number): void
  onSetGroupListView?(groupId: string, enabled: boolean): void
  onResizeNode?(nodeId: string, slotCols: number, slotRows: number): void
  onMoveNodeToGroupIndex?(nodeId: string, groupId: string, index: number): void
  onMoveNodeInGroup?(nodeId: string, groupId: string, x: number, y: number): void
  onDropNodeIntoNode?(nodeId: string, targetNodeId: string): void
  onConnectNodeParent?(nodeId: string, parentNodeId: string): void
  onNestNodeUnder?(nodeId: string, parentNodeId: string): void
  onMoveNodeToRoot?(nodeId: string, x: number, y: number): void
  onZoomChange(zoom: number): void
  onDragSegmentStart(segmentIds: string[]): void
  onDragSegmentUpdate(targetNodeId: string | null): void
  onDragSegmentEnd(
    targetNodeId: string | null,
    targetGroupId?: string | null,
    x?: number,
    y?: number,
    freeSegmentPositions?: Readonly<Record<string, { x: number; y: number }>>,
  ): void
  onContextMenu(segmentId: string, nodeId: string, clientX: number, clientY: number): void
  onNodeContextMenu?(nodeId: string, clientX: number, clientY: number): void
  onGroupContextMenu?(groupId: string, clientX: number, clientY: number): void
  onCanvasContextMenu?(worldX: number, worldY: number, clientX: number, clientY: number): void
  onSegmentClick?(segmentId: string, nodeId: string, addToSelection: boolean): void
  onSegmentDoubleClick?(segmentId: string, itemDefId: string, nodeId: string): void
  onMarqueeSelect?(selection: MarqueeSelection, addToSelection: boolean): void
  onMoveLabel?(labelId: string, x: number, y: number): void
  onSelectLabel?(labelId: string | null): void
  onEditNodeTitleRequest?(
    nodeId: string,
    currentTitle: string,
    overlay: { left: number; top: number; width: number; height: number; fontSizePx: number },
  ): void
  onEditGroupTitleRequest?(
    groupId: string,
    currentTitle: string,
    overlay: { left: number; top: number; width: number; height: number; fontSizePx: number },
  ): void
  onCanvasWorldClick?(x: number, y: number): boolean | void
  onExternalDragEnd?(
    targetNodeId: string | null,
    x: number,
    y: number,
    cancelled: boolean,
    freeSegmentPositions?: Readonly<Record<string, { x: number; y: number }>>,
  ): void
}

type SegmentView = {
  container: Container
  spring: ReturnType<typeof createSpring2D>
}

type NodeView = {
  readonly root: Container
  readonly positionSpring: ReturnType<typeof createSpring2D>
  readonly segmentContainer: Container
  readonly runVisualsContainer: Container
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
  readonly hoverOutline: Graphics
  contentContainer?: Container
  clipWidthSpring?: ReturnType<typeof createSpring1D>
  clipHeightSpring?: ReturnType<typeof createSpring1D>
  contentClip?: Graphics
  onClipAnimationComplete?: () => void
}

type SegmentDropTarget =
  | { type: 'node'; nodeId: string }
  | { type: 'group'; groupId: string }
  | null

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
  /** World position of each segment's top-left at drag start (for absolute drop). */
  readonly initialSegmentPositions: Readonly<Record<string, { x: number; y: number }>>
  /** Pointer world position at drag start (for computing delta on absolute drop). */
  readonly pointerWorldAtStart: { x: number; y: number }
  /** Id of the segment that was grabbed (primary for anchor). */
  readonly grabbedSegmentId: string
  snap: { nodeId: string; startSixth: number } | null
  /** 'compact' when over a node, 'absolute' when outside (drawing-tool style). */
  proxyMode: 'compact' | 'absolute'
  /** For absolute mode: pointerAtStart - grabbedPos (constant). */
  readonly absoluteProxyAnchorOffset: { x: number; y: number }
  /** True when this drag originated from outside the canvas (paste inventory). */
  readonly isExternal?: boolean
}

type ZoomTier = 'far' | 'medium' | 'close'

const STONE_GAP = 3
const STONE_W = 36
const STONE_H = 54
const SIXTH_ROWS = 6
const CELL_H = STONE_H / SIXTH_ROWS
const TOP_BAND_H = 22
const NODE_BOTTOM_PADDING = 6
const SLOT_START_X = 10
const DEFAULT_STONES_PER_ROW = 25
const STONE_ROW_GAP = 3
const NODE_CLIP_LEFT_OVERFLOW = 24

/** Group layout constants - must match scene-vm for collapsed dimension computation. */
const GROUP_PADDING_X = 20
const GROUP_PADDING_TOP = 40
const GROUP_PADDING_BOTTOM = 18
const NODE_ROW_GAP = 8
const NODE_INDENT = 24
const EMPTY_GROUP_MIN_WIDTH = 300
const EMPTY_GROUP_MIN_HEIGHT = 140

/** Auto-pan when dragging near viewport edge (Miro-style). */
const AUTO_PAN_MARGIN = 60
const AUTO_PAN_SPEED = 12

/** Movement threshold in screen pixels before committing to drag (Miro-style click vs drag). */
const DRAG_THRESHOLD_PX = 5

let stonesPerRow = DEFAULT_STONES_PER_ROW

const meterWidthForSlots = (slotCount: number): number =>
  Math.min(slotCount, stonesPerRow) * (STONE_W + STONE_GAP) - STONE_GAP
const meterWidthForCols = (slotCols: number): number =>
  Math.max(1, slotCols) * (STONE_W + STONE_GAP) - STONE_GAP
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

/** Draw a scissors icon for "cut attachment" on a Graphics object. */
const drawScissorsIcon = (g: Graphics, cx: number, cy: number): void => {
  const color = 0xc5d8ff
  const alpha = 0.95
  g.moveTo(cx - 5, cy - 3)
  g.lineTo(cx + 2, cy)
  g.moveTo(cx - 5, cy + 3)
  g.lineTo(cx + 2, cy)
  g.stroke({ width: 1.5, color, alpha })
  g.circle(cx - 5, cy - 3, 1.8)
  g.circle(cx - 5, cy + 3, 1.8)
  g.fill({ color, alpha })
}

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

/** Days of rations in a group spanning [groupStartSixth, groupStartSixth + count). */
const rationDaysInGroup = (
  run: readonly SceneSegmentVM[],
  groupStartSixth: number,
  count: number,
): number => {
  if (run[0]?.itemDefId !== 'ironRationsDay') return 0
  const groupEnd = groupStartSixth + count
  let days = 0
  for (const seg of run) {
    const segEnd = seg.startSixth + seg.sizeSixths
    const overlapStart = Math.max(seg.startSixth, groupStartSixth)
    const overlapEnd = Math.min(segEnd, groupEnd)
    const overlapSixths = Math.max(0, overlapEnd - overlapStart)
    const daysPerSixth = seg.tooltip.title.toLowerCase().includes('2 daily') ? 4 : 1
    days += overlapSixths * daysPerSixth
  }
  return days
}

/** Simple pluralizer for item names. Pluralizes only the last word. */
const pluralize = (name: string): string => {
  const trimmed = name.trim()
  if (trimmed.length === 0) return trimmed
  const words = trimmed.split(/\s+/)
  const last = words[words.length - 1]!
  const lower = last.toLowerCase()
  // If it already looks plural, keep it unchanged (e.g. "torches").
  if ((lower.endsWith('s') && !lower.endsWith('ss')) || lower.endsWith('ies')) {
    return trimmed
  }
  let plural: string
  if (lower.endsWith('x') || lower.endsWith('z') || lower.endsWith('ch') || lower.endsWith('sh') || lower.endsWith('ss')) {
    plural = last + 'es'
  } else if (lower.endsWith('y') && lower.length > 1 && !'aeiou'.includes(lower[lower.length - 2]!)) {
    plural = last.slice(0, -1) + 'ies'
  } else {
    plural = last + 's'
  }
  return words.length === 1 ? plural : [...words.slice(0, -1), plural].join(' ')
}

/** Label steps for a merged run: quantity + pluralized name (e.g. "7 torches"). */
const runLabelSteps = (run: readonly SceneSegmentVM[]): string[] => {
  const totalQty = run.reduce((s, seg) => s + (parseInt(seg.tooltip.quantityText, 10) || 1), 0)
  const baseName = run[0]?.fullLabel ?? run[0]?.tooltip.title ?? '?'
  const displayName = totalQty === 1 ? baseName : pluralize(baseName)
  const withQty = totalQty === 1 ? baseName : `${totalQty} ${displayName}`
  const withQtyTitle = totalQty === 1 ? baseName : `${totalQty} ${displayName.charAt(0).toUpperCase() + displayName.slice(1)}`
  return [
    withQtyTitle,
    withQty,
    ...uniqueTextSteps(run[0]!).map((s) => (totalQty > 1 ? `${totalQty} ${s}` : s)),
    compactToken(withQty, 4),
    compactToken(withQty, 3),
    compactToken(withQty, 2),
    compactToken(withQty, 1),
  ].filter((v, i, a) => a.indexOf(v) === i)
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

const stoneToX = (stoneIndex: number, stonesPerRowOverride = stonesPerRow): number =>
  (stoneIndex % stonesPerRowOverride) * (STONE_W + STONE_GAP)
const stoneToY = (stoneIndex: number, stonesPerRowOverride = stonesPerRow): number =>
  Math.floor(stoneIndex / stonesPerRowOverride) * (STONE_H + STONE_ROW_GAP)

const slotAreaHeightForSlots = (slotCount: number, stonesPerRowOverride = stonesPerRow): number => {
  const numRows = Math.ceil(slotCount / stonesPerRowOverride)
  return numRows * (STONE_H + STONE_ROW_GAP) - STONE_ROW_GAP
}
const slotAreaHeightForRows = (slotRows: number): number =>
  Math.max(1, slotRows) * (STONE_H + STONE_ROW_GAP) - STONE_ROW_GAP

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
const segmentPositionInNode = (segment: SceneSegmentVM, stonesPerRowOverride = stonesPerRow): { x: number; y: number } => {
  const { startStone } = segmentStoneSpan(segment.startSixth, segment.sizeSixths)
  const isMulti = segment.sizeSixths >= 6 && segment.sizeSixths % 6 === 0
  if (isMulti) {
    return {
      x: SLOT_START_X + stoneToX(startStone, stonesPerRowOverride),
      y: TOP_BAND_H + stoneToY(startStone, stonesPerRowOverride),
    }
  }
  const groups = groupSixthsByStone(segment.startSixth, segment.sizeSixths)
  let minX = Infinity, minY = Infinity
  groups.forEach((g) => {
    minX = Math.min(minX, stoneToX(g.stone, stonesPerRowOverride))
    minY = Math.min(minY, stoneToY(g.stone, stonesPerRowOverride) + g.startRow * CELL_H)
  })
  return {
    x: SLOT_START_X + minX,
    y: TOP_BAND_H + minY,
  }
}

/** Bounds of segment in node-local space (relative to node root). */
const segmentBoundsInNodeLocal = (segment: SceneSegmentVM, stonesPerRowOverride = stonesPerRow): { x: number; y: number; w: number; h: number } => {
  const { startStone, endStone } = segmentStoneSpan(segment.startSixth, segment.sizeSixths)
  const isMulti = isMultiStone(segment)
  if (isMulti) {
    const chunks = splitStonesAtWrap(startStone, endStone, stonesPerRowOverride)
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
    chunks.forEach((chunk) => {
      const cx = SLOT_START_X + stoneToX(chunk.start, stonesPerRowOverride)
      const cy = TOP_BAND_H + stoneToY(chunk.start, stonesPerRowOverride)
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
    const x = stoneToX(g.stone, stonesPerRowOverride)
    const y = stoneToY(g.stone, stonesPerRowOverride) + g.startRow * CELL_H
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
  stonesPerRowOverride = stonesPerRow,
): { x: number; y: number } => {
  const { startStone, endStone } = segmentStoneSpan(segment.startSixth, segment.sizeSixths)
  const isMulti = segment.sizeSixths >= 6 && segment.sizeSixths % 6 === 0
  if (isMulti) {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
    for (let s = startStone; s < endStone; s += 1) {
      const x = stoneToX(s, stonesPerRowOverride)
      const y = stoneToY(s, stonesPerRowOverride)
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
    const x = stoneToX(g.stone, stonesPerRowOverride)
    const y = stoneToY(g.stone, stonesPerRowOverride) + g.startRow * CELL_H
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
  g.stroke({ width: 2, color: 0xffffff, alpha: 0.95 })
}

/** Draw a dashed line (Pixi v8 has no built-in dash). Ensures the final dash extends to (x2,y2). */
const drawDashedLine = (
  g: Graphics,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  color: number,
  alpha: number,
  dashLen = 3,
  gapLen = 4,
): void => {
  const dx = x2 - x1
  const dy = y2 - y1
  const len = Math.sqrt(dx * dx + dy * dy)
  if (len < 0.001) return
  const ux = dx / len
  const uy = dy / len
  let t = 0
  let dash = true
  while (t < len - 0.001) {
    const segLen = dash ? Math.min(dashLen, len - t) : Math.min(gapLen, len - t)
    if (dash && segLen > 0) {
      const endT = Math.min(t + segLen, len)
      const ex = x1 + ux * endT
      const ey = y1 + uy * endT
      g.moveTo(x1 + ux * t, y1 + uy * t)
      g.lineTo(ex, ey)
      g.stroke({ width: 0.5, color, alpha })
    }
    t += segLen
    dash = !dash
  }
  if (t < len - 0.001) {
    g.moveTo(x1 + ux * t, y1 + uy * t)
    g.lineTo(x2, y2)
    g.stroke({ width: 0.5, color, alpha })
  }
}

/** Darken a hex color by factor (0–1). Used for stroke/outline. */
const darkenColor = (hex: number, factor = 0.65): number => {
  const r = Math.floor(((hex >> 16) & 0xff) * factor)
  const g = Math.floor(((hex >> 8) & 0xff) * factor)
  const b = Math.floor((hex & 0xff) * factor)
  return (r << 16) | (g << 8) | b
}

/** Draw a filled rect with per-corner radii (for wrap continuity). */
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

/** Split stone range into chunks at stonesPerRow boundaries. */
const splitStonesAtWrap = (
  startStone: number,
  endStone: number,
  stonesPerRowOverride = stonesPerRow,
): { start: number; end: number }[] => {
  const chunks: { start: number; end: number }[] = []
  let s = startStone
  while (s < endStone) {
    const rowStart = Math.floor(s / stonesPerRowOverride) * stonesPerRowOverride
    const rowEnd = rowStart + stonesPerRowOverride
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
  cornerRadii: { tl: number; tr: number; br: number; bl: number },
): void => {
  fillRoundedRect(g, x, y, w, h, cornerRadii)
  g.fill(fillOpt)
  g.moveTo(x + w, y + h)
  if (sides.bottom) g.lineTo(x, y + h)
  else g.moveTo(x, y + h)
  if (sides.left) g.lineTo(x, y)
  else g.moveTo(x, y)
  if (sides.top) g.lineTo(x + w, y)
  else g.moveTo(x + w, y)
  if (sides.right) g.lineTo(x + w, y + h)
  else g.moveTo(x + w, y + h)
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

const localToSixth = (localX: number, localY: number, slotCount: number, stonesPerRowOverride = stonesPerRow): number => {
  if (localX <= 0) return 0
  const totalSixths = totalSixthsForSlots(slotCount)
  const numRows = Math.ceil(slotCount / stonesPerRowOverride)
  for (let rowIndex = 0; rowIndex < numRows; rowIndex += 1) {
    const rowY = rowIndex * (STONE_H + STONE_ROW_GAP)
    const rowBottom = rowY + STONE_H
    if (localY < rowY) return Math.min(totalSixths, rowIndex * stonesPerRowOverride * 6)
    if (localY >= rowBottom + (rowIndex < numRows - 1 ? STONE_ROW_GAP : 0)) continue
    const stonesInRow = Math.min(stonesPerRowOverride, slotCount - rowIndex * stonesPerRowOverride)
    const rowWidth = stonesInRow * (STONE_W + STONE_GAP) - STONE_GAP
    if (localX >= rowWidth + STONE_W) return Math.min(totalSixths, (rowIndex * stonesPerRowOverride + stonesInRow) * 6)
    for (let col = 0; col < stonesInRow; col += 1) {
      const stoneStart = col * (STONE_W + STONE_GAP)
      const stoneEnd = stoneStart + STONE_W
      if (localX >= stoneStart && localX < stoneEnd) {
        const sixthRow = Math.max(0, Math.min(5, Math.floor((localY - rowY) / CELL_H)))
        return (rowIndex * stonesPerRowOverride + col) * 6 + sixthRow
      }
      if (localX >= stoneEnd && localX < stoneStart + STONE_W + STONE_GAP) {
        return (rowIndex * stonesPerRowOverride + col + 1) * 6
      }
    }
    return Math.min(totalSixths, (rowIndex * stonesPerRowOverride + stonesInRow) * 6)
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
): { hitBounds: { x: number; y: number; w: number; h: number }; groupBounds: { x: number; y: number; w: number; h: number }[] } => {
  const groups = groupSixthsByStone(segment.startSixth, segment.sizeSixths)
  const PAD = 1.2
  const strokeColor = darkenColor(color)
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  const groupBounds: { x: number; y: number; w: number; h: number }[] = []

  const zoomReadableScale = zoom < 0.45 ? 1.14 : 1
  const visualScale = textCompensationScale * zoomReadableScale

  const isDropPreview = segment.isDropPreview === true

  groups.forEach((group, index) => {
    const x = baseX + stoneToX(group.stone)
    const y = baseY + stoneToY(group.stone) + group.startRow * CELL_H
    const w = STONE_W
    const h = group.count * CELL_H

    const prev = index > 0 ? groups[index - 1] : undefined
    const next = index < groups.length - 1 ? groups[index + 1] : undefined
    const continuesFromPrev =
      !!prev &&
      prev.stone + 1 === group.stone &&
      prev.startRow + prev.count >= SIXTH_ROWS &&
      group.startRow === 0
    const continuesToNext =
      !!next &&
      group.stone + 1 === next.stone &&
      group.startRow + group.count >= SIXTH_ROWS &&
      next.startRow === 0
    const top = !continuesFromPrev
    const bottom = !continuesToNext

    const rect = new Graphics()
    rect.eventMode = 'none'
    drawChunkRect(
      rect,
      x + PAD,
      y + PAD,
      w - PAD * 2,
      h - PAD * 2,
      { left: true, top, right: true, bottom },
      { color, alpha },
      isDropPreview ? { width: 2, color: 0x5cadee, alpha: 0.7 } : { width: 0.5, color: strokeColor, alpha: 1 },
      { tl: top ? 4 : 0, tr: top ? 4 : 0, br: bottom ? 4 : 0, bl: bottom ? 4 : 0 },
    )
    container.addChild(rect)

    minX = Math.min(minX, x)
    minY = Math.min(minY, y)
    maxX = Math.max(maxX, x + w)
    maxY = Math.max(maxY, y + h)
    groupBounds.push({ x, y, w, h })

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
    groupBounds,
  }
}

/** Draw merged visual block for a contiguous run of same-type segments (run.length >= 2). */
const drawRunVisuals = (
  container: Container,
  run: readonly SceneSegmentVM[],
  baseX: number,
  baseY: number,
  color: number,
  alpha: number,
  tier: ZoomTier,
  zoom: number,
  textCompensationScale: number,
  minVisibleLabelPx: number,
  maxVisibleLabelPx: number,
  dimmed: boolean,
  dimmedAlpha: number,
  stonesPerRowOverride = stonesPerRow,
): void => {
  const startSixth = run[0].startSixth
  const sizeSixths = run.reduce((sum, s) => sum + s.sizeSixths, 0)
  const { startStone, endStone } = segmentStoneSpan(startSixth, sizeSixths)
  const strokeColor = darkenColor(color)
  const isMulti = startSixth % 6 === 0 && sizeSixths >= 6 && sizeSixths % 6 === 0

  const zoomReadableScale = zoom < 0.45 ? 1.14 : 1
  const visualScale = textCompensationScale * zoomReadableScale

  if (isMulti) {
    const chunks = splitStonesAtWrap(startStone, endStone, stonesPerRowOverride)
    const R = 5
    const multi = chunks.length > 1
    const fillOpt = { color, alpha }
    const strokeOpt = { width: 0.5, color: strokeColor, alpha: 1 }
    let labelBounds: { x: number; y: number; w: number; h: number } | null = null

    chunks.forEach((chunk, idx) => {
      const cx = baseX + stoneToX(chunk.start, stonesPerRowOverride)
      const cy = baseY + stoneToY(chunk.start, stonesPerRowOverride)
      const cw = (chunk.end - chunk.start) * (STONE_W + STONE_GAP) - STONE_GAP
      const ch = STONE_H
      const pad = 0.5
      const rx = cx + pad
      const ry = cy + 2.5
      const rw = cw - 1
      const rh = ch - 5
      const isFirst = idx === 0
      const isLast = idx === chunks.length - 1
      const sides = { left: true, top: isFirst || !multi, right: true, bottom: isLast || !multi }
      const cornerRadii = {
        tl: isFirst ? R : 0,
        tr: isFirst ? R : 0,
        br: isLast ? R : 0,
        bl: isLast ? R : 0,
      }
      const g = new Graphics()
      g.eventMode = 'none'
      drawChunkRect(g, rx, ry, rw, rh, sides, fillOpt, strokeOpt, cornerRadii)
      container.addChild(g)
      if (idx === 0) {
        labelBounds = { x: rx, y: ry, w: rw, h: rh }
      }
    })

    for (let i = 0; i < run.length - 1; i += 1) {
      const boundarySixth = run[i].startSixth + run[i].sizeSixths
      const div = new Graphics()
      div.eventMode = 'none'
      if (boundarySixth % 6 === 0) {
        const stone = boundarySixth / 6
        const x = baseX + stoneToX(stone - 1, stonesPerRowOverride) + STONE_W
        const y = baseY + stoneToY(stone - 1, stonesPerRowOverride)
        drawDashedLine(div, x, y, x, y + STONE_H, strokeColor, 0.85)
      } else {
        const stone = Math.floor(boundarySixth / 6)
        const row = boundarySixth % 6
        const x = baseX + stoneToX(stone, stonesPerRowOverride)
        const y = baseY + stoneToY(stone, stonesPerRowOverride) + row * CELL_H
        drawDashedLine(div, x, y, x + STONE_W, y, strokeColor, 0.85)
      }
      container.addChild(div)
    }

    const lb = labelBounds ?? { x: baseX, y: baseY, w: STONE_W, h: STONE_H }
    const centerX = lb.x + lb.w / 2
    const centerY = lb.y + lb.h / 2
    const steps = runLabelSteps(run)
    const fit = selectLabelFitForSteps(
      steps,
      tier,
      Math.max(8, lb.w - 6),
      Math.max(8, lb.h - 8),
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
    clip.rect(centerX - lb.w / 2, centerY - lb.h / 2, lb.w, lb.h)
    clip.fill({ color: 0xffffff, alpha: 0.001 })
    container.addChild(clip)
    txt.mask = clip
    container.addChild(txt)
  } else {
    const groups = groupSixthsByStone(startSixth, sizeSixths)
    const PAD = 1.2

    groups.forEach((group, idx) => {
      const x = baseX + stoneToX(group.stone, stonesPerRowOverride)
      const y = baseY + stoneToY(group.stone, stonesPerRowOverride) + group.startRow * CELL_H
      const w = STONE_W
      const h = group.count * CELL_H

      const prev = idx > 0 ? groups[idx - 1] : undefined
      const next = idx < groups.length - 1 ? groups[idx + 1] : undefined
      const continuesFromPrev =
        !!prev &&
        prev.stone + 1 === group.stone &&
        prev.startRow + prev.count >= SIXTH_ROWS &&
        group.startRow === 0
      const continuesToNext =
        !!next &&
        group.stone + 1 === next.stone &&
        group.startRow + group.count >= SIXTH_ROWS &&
        next.startRow === 0
      const top = !continuesFromPrev
      const bottom = !continuesToNext

      const rect = new Graphics()
      rect.eventMode = 'none'
      drawChunkRect(
        rect,
        x + PAD,
        y + PAD,
        w - PAD * 2,
        h - PAD * 2,
        { left: true, top, right: true, bottom },
        { color, alpha },
        { width: 0.5, color: strokeColor, alpha: 1 },
        { tl: top ? 4 : 0, tr: top ? 4 : 0, br: bottom ? 4 : 0, bl: bottom ? 4 : 0 },
      )
      container.addChild(rect)
    })
    for (let i = 0; i < run.length - 1; i += 1) {
      const boundarySixth = run[i].startSixth + run[i].sizeSixths
      const div = new Graphics()
      div.eventMode = 'none'
      if (boundarySixth % 6 === 0) {
        const stone = boundarySixth / 6
        const x = baseX + stoneToX(stone - 1) + STONE_W
        const y = baseY + stoneToY(stone - 1)
        drawDashedLine(div, x, y, x, y + STONE_H, strokeColor, 0.85)
      } else {
        const stone = Math.floor(boundarySixth / 6)
        const row = boundarySixth % 6
        const x = baseX + stoneToX(stone)
        const y = baseY + stoneToY(stone) + row * CELL_H
        drawDashedLine(div, x, y, x + STONE_W, y, strokeColor, 0.85)
      }
      container.addChild(div)
    }
    const baseName = run[0]?.fullLabel ?? run[0]?.tooltip.title ?? '?'
    const isRations = run[0]?.itemDefId === 'ironRationsDay'
    groups.forEach((group) => {
      const x = baseX + stoneToX(group.stone)
      const y = baseY + stoneToY(group.stone) + group.startRow * CELL_H
      const w = STONE_W
      const h = group.count * CELL_H
      const groupStartSixth = group.stone * 6 + group.startRow
      const days = isRations ? rationDaysInGroup(run, groupStartSixth, group.count) : 0
      const partQty = isRations && days > 0 ? days : Math.max(1, group.count)
      const partName = isRations && days > 0
        ? (days === 1 ? 'daily iron ration' : 'daily iron rations')
        : (partQty === 1 ? baseName : pluralize(baseName))
      const partLabel = `${partQty} ${partName}`
      const steps = [partLabel, compactToken(partLabel, 4), compactToken(partLabel, 3), compactToken(partLabel, 2), compactToken(partLabel, 1)]
      const fit = selectLabelFitForSteps(
        steps,
        tier,
        Math.max(8, w - 6),
        Math.max(8, h - 6),
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
      txt.position.set(x + w / 2, y + h / 2)
      const clip = new Graphics()
      clip.eventMode = 'none'
      clip.rect(x, y, w, h)
      clip.fill({ color: 0xffffff, alpha: 0.001 })
      container.addChild(clip)
      txt.mask = clip
      container.addChild(txt)
    })
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
  onSegmentPointerDown?: (segment: SceneSegmentVM, nodeId: string, clientX: number, clientY: number, addToSelection: boolean) => void,
  baseOffset?: { x: number; y: number },
  filterCategory?: string | null,
  _selectedSegmentIds?: readonly string[],
  onSegmentClick?: (segmentId: string, nodeId: string, addToSelection: boolean) => void,
  onSegmentDoubleClick?: (segmentId: string, itemDefId: string, nodeId: string) => void,
  getLastDragEndTime?: () => number,
  allowInteraction?: () => boolean,
  visuallyMerged?: boolean,
): void => {
  const o = baseOffset ?? { x: 0, y: 0 }
  const { startStone, endStone } = segmentStoneSpan(segment.startSixth, segment.sizeSixths)
  const isDropPreview = segment.isDropPreview === true
  const dimmed = filterCategory != null && segment.category !== filterCategory
  const color = isDropPreview
    ? 0x5cadee
    : segment.isSelfWeightToken
      ? 0x8a6eff
      : segment.isOverflow
        ? 0x932d4e
        : hovered
          ? 0x5cadee
          : 0x3d9ac9
  const dimmedAlpha = 0.12
  const alpha = isDropPreview ? 0.25 : segment.isOverflow ? 0.88 : dimmed ? dimmedAlpha : 0.95
  const isLocked = segment.locked === true || segment.isSelfWeightToken === true

  const block = new Graphics()
  block.eventMode = isLocked ? 'none' : 'static'
  block.cursor = isLocked ? 'default' : 'pointer'
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
  if (!isLocked && onSegmentPointerDown && nodeId) {
    block.on('pointerdown', (event: any) => {
      if (event.button === 0) {
        event.stopPropagation()
        onTooltipLeave?.()
        const clientX = typeof event.clientX === 'number' ? event.clientX : event.global.x
        const clientY = typeof event.clientY === 'number' ? event.clientY : event.global.y
        const addToSelection = !!(event.ctrlKey || event.metaKey || event.shiftKey)
        onSegmentPointerDown(segment, nodeId, clientX, clientY, addToSelection)
      }
    })
  }
  if (!isLocked && nodeId && (onSegmentClick || onSegmentDoubleClick)) {
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

  if (visuallyMerged) {
    const b = segmentBoundsInNodeLocal(segment)
    block.rect(b.x - o.x, b.y - o.y, b.w, b.h)
    block.fill({ color: 0xffffff, alpha: 0.001 })
    block.hitArea = new Rectangle(b.x - o.x, b.y - o.y, b.w, b.h)
    container.addChild(block)
    return
  }

  if (isMultiStone(segment)) {
    const chunks = splitStonesAtWrap(startStone, endStone)
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
    const strokeOpt = isDropPreview
      ? { width: 2, color: 0x5cadee, alpha: 0.7 }
      : { width: 0.5, color: darkenColor(color), alpha: 1 }
    const fillOpt = { color, alpha }

    container.addChild(block)
    const R = 5
    const multi = chunks.length > 1
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
        left: true,
        top: isFirst || !multi,
        right: true,
        bottom: isLast || !multi,
      }
      const cornerRadii = {
        tl: isFirst ? R : 0,
        tr: isFirst ? R : 0,
        br: isLast ? R : 0,
        bl: isLast ? R : 0,
      }
      drawChunkRect(block, rx, ry, rw, rh, sides, fillOpt, strokeOpt, cornerRadii)
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
    const { hitBounds, groupBounds } = drawBlendedSegmentRects(
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
    block.hitArea = {
      contains: (x: number, y: number) =>
        groupBounds.some((b) => x >= b.x && x < b.x + b.w && y >= b.y && y < b.y + b.h),
    }
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
  private nestConnectorGraphics: Graphics
  private connectorDragLine: Graphics
  private lastDragEndTime = 0
  private segmentDragHoveredGroupId: string | null = null
  private pendingRebuild = false
  private marqueeGraphics: Graphics | null = null
  /** During marquee drag: typed IDs that would be selected (live preview). */
  private marqueePreviewSelection: {
    segmentIds: Set<string>
    nodeIds: Set<string>
    groupIds: Set<string>
    labelIds: Set<string>
  } | null = null
  /** During marquee drag: whether add-to-selection modifier is held (for preview merge). */
  private marqueePreviewAddToSelection = false
  private minVisibleLabelPx = DEFAULT_MIN_VISIBLE_PX
  private readonly maxVisibleLabelPx = DEFAULT_MAX_VISIBLE_PX
  private fontsLoaded = false
  private readonly nodeExpandedState = new Map<string, boolean>()
  private readonly groupExpandedState = new Map<string, boolean>()
  private readonly nodeDisplayOffsetY = new Map<string, number>()
  private readonly groupDisplayHeights = new Map<string, number>()
  private readonly skipNodeAnimationOnce = new Set<string>()
  private readonly skipSegmentAnimationOnce = new Set<string>()
  private readonly hiddenNodeContentIds = new Set<string>()
  private editingTitle: { type: 'node' | 'group'; id: string } | null = null
  private lastTitleTap:
    | { key: string; atMs: number }
    | null = null
  private lastPointerPosition: { clientX: number; clientY: number } | null = null
  private autoPanRafId: number | null = null

  constructor(host: HTMLElement, handlers: AdapterHandlers) {
    this.handlers = handlers
    this.app = new Application()
    this.sceneRoot = new Container()
    this.groupLayer = new Container()
    this.groupDropIndicator = new Graphics()
    this.groupDropIndicator.eventMode = 'none'
    this.nestConnectorGraphics = new Graphics()
    this.nestConnectorGraphics.eventMode = 'none'
    this.connectorDragLine = new Graphics()
    this.connectorDragLine.eventMode = 'none'
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
      const nodeId = this.hitTestNodeContext(event.clientX, event.clientY)
      if (nodeId) {
        this.handlers.onNodeContextMenu?.(nodeId, event.clientX, event.clientY)
        return
      }
      const groupId = this.hitTestGroupContext(event.clientX, event.clientY)
      if (groupId && groupId.startsWith('custom-group:')) {
        this.handlers.onGroupContextMenu?.(groupId, event.clientX, event.clientY)
        return
      }
      const world = this.screenToWorld(event.clientX, event.clientY)
      this.handlers.onCanvasContextMenu?.(world.x, world.y, event.clientX, event.clientY)
    })

    this.sceneRoot.addChild(this.groupLayer)
    this.groupLayer.addChild(this.groupDropIndicator)
    this.worldLayer.addChild(this.nestConnectorGraphics)
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
    this.hudLayer.addChild(this.connectorDragLine)
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
          const startWorldX = (x - this.pan.x) / this.zoom
          const startWorldY = (y - this.pan.y) / this.zoom
          this.activeDrag = {
            type: 'marquee',
            startWorldX,
            startWorldY,
            endX: x,
            endY: y,
            origin: this.getMarqueeOriginScope(startWorldX, startWorldY),
          }
          this.lastPointerPosition = { clientX: event.clientX, clientY: event.clientY }
          this.startAutoPanLoop()
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
          case 'groupResize':
          case 'nodeResize':
            this.endDrag()
            return
          case 'connector':
            this.finishConnectorDrag(event.clientX, event.clientY)
            return
          case 'marquee': {
            const { x, y } = canvasCoords(event)
            this.activeDrag.endX = x
            this.activeDrag.endY = y
            this.stopAutoPanLoop()
            this.finishMarquee(event.shiftKey || event.ctrlKey || event.metaKey)
            this.activeDrag = { type: 'idle' }
            this.drawMarquee()
            return
          }
          case 'segment':
            this.endSegmentDrag(event)
            return
          case 'pendingSegment':
            this.activeDrag = { type: 'idle' }
            return
          case 'idle':
            break
        }
      }
      panning = false
    }

    const onMove = (event: PointerEvent): void => {
      if (this.activeDrag.type !== 'idle' && this.activeDrag.type !== 'pendingSegment') {
        this.lastPointerPosition = { clientX: event.clientX, clientY: event.clientY }
      }
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
        case 'groupResize':
          this.updateGroupResizeDrag(event.clientX, event.clientY)
          return
        case 'nodeResize':
          this.updateNodeResizeDrag(event.clientX, event.clientY)
          return
        case 'connector':
          this.updateConnectorDrag(event.clientX, event.clientY)
          return
        case 'marquee': {
          const { x, y } = canvasCoords(event)
          this.activeDrag.endX = x
          this.activeDrag.endY = y
          this.drawMarquee()
          this.updateMarqueePreview(event.shiftKey || event.ctrlKey || event.metaKey)
          return
        }
        case 'pendingSegment': {
          const { segment, nodeId, startClientX, startClientY } = this.activeDrag
          const dx = event.clientX - startClientX
          const dy = event.clientY - startClientY
          if (Math.sqrt(dx * dx + dy * dy) > DRAG_THRESHOLD_PX) {
            this.beginSegmentDrag(segment, nodeId, event.clientX, event.clientY)
          }
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

  /** Returns pan delta (dx, dy) when pointer is in margin zone. Positive dx = pan right, positive dy = pan down. */
  private getAutoPanDelta(
    rect: DOMRect,
    clientX: number,
    clientY: number,
  ): { dx: number; dy: number } {
    let dx = 0
    let dy = 0
    const left = rect.left
    const right = rect.right
    const top = rect.top
    const bottom = rect.bottom
    if (clientX < left + AUTO_PAN_MARGIN) {
      const strength = (left + AUTO_PAN_MARGIN - clientX) / AUTO_PAN_MARGIN
      dx = strength * AUTO_PAN_SPEED
    } else if (clientX > right - AUTO_PAN_MARGIN) {
      const strength = (clientX - (right - AUTO_PAN_MARGIN)) / AUTO_PAN_MARGIN
      dx = -strength * AUTO_PAN_SPEED
    }
    if (clientY < top + AUTO_PAN_MARGIN) {
      const strength = (top + AUTO_PAN_MARGIN - clientY) / AUTO_PAN_MARGIN
      dy = strength * AUTO_PAN_SPEED
    } else if (clientY > bottom - AUTO_PAN_MARGIN) {
      const strength = (clientY - (bottom - AUTO_PAN_MARGIN)) / AUTO_PAN_MARGIN
      dy = -strength * AUTO_PAN_SPEED
    }
    return { dx, dy }
  }

  private startAutoPanLoop(): void {
    if (this.autoPanRafId != null) return
    const tick = (): void => {
      this.autoPanRafId = null
      if (this.activeDrag.type === 'idle') return
      const pos = this.lastPointerPosition
      if (!pos) {
        this.autoPanRafId = requestAnimationFrame(tick)
        return
      }
      const rect = this.app.canvas.getBoundingClientRect()
      const { dx, dy } = this.getAutoPanDelta(rect, pos.clientX, pos.clientY)
      if (dx !== 0 || dy !== 0) {
        this.pan.x += dx
        this.pan.y += dy
        this.applyCamera()
        switch (this.activeDrag.type) {
          case 'segment':
            this.updateSegmentDrag(pos.clientX, pos.clientY)
            break
          case 'group':
            this.updateGroupDrag(pos.clientX, pos.clientY)
            break
          case 'label':
            this.updateLabelDrag(pos.clientX, pos.clientY)
            break
          case 'nodeResize':
            this.updateNodeResizeDrag(pos.clientX, pos.clientY)
            break
          case 'nodeReorder':
            this.updateNodeReorderDrag(pos.clientX, pos.clientY)
            break
          case 'connector':
            this.updateConnectorDrag(pos.clientX, pos.clientY)
            break
          case 'marquee': {
            const canvasX = pos.clientX - rect.left
            const canvasY = pos.clientY - rect.top
            this.activeDrag.endX = canvasX
            this.activeDrag.endY = canvasY
            this.drawMarquee()
            this.updateMarqueePreview(this.marqueePreviewAddToSelection)
            break
          }
        }
      }
      this.autoPanRafId = requestAnimationFrame(tick)
    }
    this.autoPanRafId = requestAnimationFrame(tick)
  }

  private stopAutoPanLoop(): void {
    if (this.autoPanRafId != null) {
      cancelAnimationFrame(this.autoPanRafId)
      this.autoPanRafId = null
    }
  }

  private updateSelectionOverlay(): void {
    this.selectionOverlayLayer.removeChildren()
    if (!this.currentScene) return
    let selectedIds = new Set(this.currentScene.selectedSegmentIds ?? [])
    let selectedNodeIds = new Set(this.currentScene.selectedNodeIds ?? [])
    let selectedGroupIds = new Set(this.currentScene.selectedGroupIds ?? [])
    let selectedLabelIds = new Set(this.currentScene.selectedLabelIds ?? [])
    if (this.marqueePreviewSelection) {
      if (this.marqueePreviewAddToSelection) {
        this.marqueePreviewSelection.segmentIds.forEach((id) => selectedIds.add(id))
        this.marqueePreviewSelection.nodeIds.forEach((id) => selectedNodeIds.add(id))
        this.marqueePreviewSelection.groupIds.forEach((id) => selectedGroupIds.add(id))
        this.marqueePreviewSelection.labelIds.forEach((id) => selectedLabelIds.add(id))
      } else {
        selectedIds = new Set(this.marqueePreviewSelection.segmentIds)
        selectedNodeIds = new Set(this.marqueePreviewSelection.nodeIds)
        selectedGroupIds = new Set(this.marqueePreviewSelection.groupIds)
        selectedLabelIds = new Set(this.marqueePreviewSelection.labelIds)
      }
    }
    if (selectedIds.size === 0 && selectedNodeIds.size === 0 && selectedGroupIds.size === 0 && selectedLabelIds.size === 0) return
    const PAD = 0.2
    const STROKE = 0.8
    const RADIUS = 2
    const boxBounds: { left: number; top: number; right: number; bottom: number }[] = []
    for (const [groupId, group] of Object.entries(this.currentScene.groups ?? {})) {
      if (!selectedGroupIds.has(groupId)) continue
      const dims = this.getGroupDisplayDimensions(group)
      const g = new Graphics()
      g.eventMode = 'none'
      g.roundRect(group.x, group.y, dims.width, dims.height, 12)
      g.stroke({ width: 2, color: 0xc8e4ff, alpha: 0.72 })
      this.selectionOverlayLayer.addChild(g)
      boxBounds.push({ left: group.x, top: group.y, right: group.x + dims.width, bottom: group.y + dims.height })
    }
    for (const nodeId of selectedNodeIds) {
      const node = this.currentScene.nodes[nodeId]
      if (!node) continue
      const pos = this.getNodeDisplayPosition(node)
      const dims = this.getNodeDisplayDimensions(node)
      const g = new Graphics()
      g.eventMode = 'none'
      g.roundRect(pos.x, pos.y, dims.width, dims.height, 10)
      g.stroke({ width: 2, color: 0xffffff, alpha: 0.72 })
      this.selectionOverlayLayer.addChild(g)
      boxBounds.push({ left: pos.x, top: pos.y, right: pos.x + dims.width, bottom: pos.y + dims.height })
    }
    for (const [nodeId, view] of this.nodeViews) {
      const node = this.currentScene.nodes[nodeId]
      if (!node) continue
      for (const segment of node.segments) {
        if (!selectedIds.has(segment.id)) continue
        const segView = view.segmentViews.get(segment.id)
        const bounds = segmentBoundsInNodeLocal(segment, node.slotCols)
        const pos = segmentPositionInNode(segment, node.slotCols)
        const nodePos = this.getNodeDisplayPosition(node)
        const worldX = nodePos.x + (segView ? segView.container.position.x : pos.x) + bounds.x - pos.x
        const worldY = nodePos.y + (segView ? segView.container.position.y : pos.y) + bounds.y - pos.y
        const left = worldX - PAD
        const top = worldY - PAD
        const right = worldX + bounds.w + PAD
        const bottom = worldY + bounds.h + PAD
        boxBounds.push({ left, top, right, bottom })
        const g = new Graphics()
        g.eventMode = 'none'
        g.roundRect(left, top, bounds.w + PAD * 2, bounds.h + PAD * 2, RADIUS)
        g.stroke({ width: STROKE, color: 0xffffff, alpha: 0.55 })
        this.selectionOverlayLayer.addChild(g)
      }
    }
    for (const free of Object.values(this.currentScene.freeSegments ?? {})) {
      if (!selectedIds.has(free.segment.id)) continue
      const b = segmentBoundsInNodeLocal(free.segment)
      const anchor = this.freeSegmentAnchorWorld(free)
      const segX = anchor.x + b.x - SLOT_START_X
      const segY = anchor.y + b.y - TOP_BAND_H
      const left = segX - PAD
      const top = segY - PAD
      const right = segX + b.w + PAD
      const bottom = segY + b.h + PAD
      boxBounds.push({ left, top, right, bottom })
      const g = new Graphics()
      g.eventMode = 'none'
      g.roundRect(left, top, b.w + PAD * 2, b.h + PAD * 2, RADIUS)
      g.stroke({ width: STROKE, color: 0xffffff, alpha: 0.55 })
      this.selectionOverlayLayer.addChild(g)
    }
    for (const labelId of selectedLabelIds) {
      const label = this.currentScene.labels[labelId]
      const view = this.labelViews.get(labelId)
      if (!label || !view) continue
      const b = view.root.getLocalBounds()
      const w = Math.max(40, b.width)
      const h = Math.max(20, b.height)
      const g = new Graphics()
      g.eventMode = 'none'
      g.roundRect(label.x - 8, label.y, w, h, 6)
      g.stroke({ width: 1.5, color: 0xbad8ff, alpha: 0.72 })
      this.selectionOverlayLayer.addChild(g)
      boxBounds.push({ left: label.x - 8, top: label.y, right: label.x - 8 + w, bottom: label.y + h })
    }
    const selectedCount = selectedIds.size + selectedNodeIds.size + selectedGroupIds.size + selectedLabelIds.size
    if (selectedCount > 1 && boxBounds.length > 0) {
      const minX = Math.min(...boxBounds.map((bb) => bb.left))
      const minY = Math.min(...boxBounds.map((bb) => bb.top))
      const maxX = Math.max(...boxBounds.map((bb) => bb.right))
      const maxY = Math.max(...boxBounds.map((bb) => bb.bottom))
      const outer = new Graphics()
      outer.eventMode = 'none'
      outer.rect(minX, minY, maxX - minX, maxY - minY)
      outer.stroke({ width: 1, color: 0xffffff, alpha: 0.7 })
      this.selectionOverlayLayer.addChild(outer)
    }
  }

  private drawMarquee(): void {
    if (!this.marqueeGraphics) return
    this.marqueeGraphics.clear()
    if (this.activeDrag.type !== 'marquee') return
    const { startWorldX, startWorldY, endX, endY } = this.activeDrag
    const startX = startWorldX * this.zoom + this.pan.x
    const startY = startWorldY * this.zoom + this.pan.y
    const x = Math.min(startX, endX)
    const y = Math.min(startY, endY)
    const w = Math.abs(endX - startX)
    const h = Math.abs(endY - startY)
    if (w < 2 && h < 2) return
    this.marqueeGraphics.rect(x, y, w, h)
    this.marqueeGraphics.stroke({ width: 2, color: 0x5cadee, alpha: 0.9 })
    this.marqueeGraphics.fill({ color: 0x5cadee, alpha: 0.12 })
  }

  private getMarqueeOriginScope(worldX: number, worldY: number): MarqueeOriginScope {
    if (!this.currentScene) return { type: 'world' }
    for (const node of Object.values(this.currentScene.nodes)) {
      const pos = this.getNodeDisplayPosition(node)
      const dims = this.getNodeDisplayDimensions(node)
      if (worldX >= pos.x && worldX <= pos.x + dims.width && worldY >= pos.y && worldY <= pos.y + dims.height) {
        return { type: 'node', nodeId: node.id }
      }
    }
    const groups = Object.values(this.currentScene.groups ?? {})
    for (let i = groups.length - 1; i >= 0; i -= 1) {
      const g = groups[i]
      if (!g) continue
      const dims = this.getGroupDisplayDimensions(g)
      if (worldX >= g.x && worldX <= g.x + dims.width && worldY >= g.y && worldY <= g.y + dims.height) {
        return { type: 'group', groupId: g.id }
      }
    }
    return { type: 'world' }
  }

  /** Returns peer-level marquee selection for the chosen origin scope. */
  private computeMarqueeSelection(
    origin: MarqueeOriginScope,
    x1: number,
    y1: number,
    x2: number,
    y2: number,
  ): MarqueeSelection {
    if (!this.currentScene) return { segmentIds: [], nodeIds: [], groupIds: [], labelIds: [] }
    const minW = (Math.min(x1, x2) - this.pan.x) / this.zoom
    const maxW = (Math.max(x1, x2) - this.pan.x) / this.zoom
    const minH = (Math.min(y1, y2) - this.pan.y) / this.zoom
    const maxH = (Math.max(y1, y2) - this.pan.y) / this.zoom
    const intersects = (x: number, y: number, w: number, h: number): boolean =>
      x < maxW && x + w > minW && y < maxH && y + h > minH
    const selection: MarqueeSelection = { segmentIds: [], nodeIds: [], groupIds: [], labelIds: [] }

    if (origin.type === 'world') {
      const groups = Object.values(this.currentScene.groups ?? {})
      for (let i = groups.length - 1; i >= 0; i -= 1) {
        const group = groups[i]
        if (!group) continue
        const dims = this.getGroupDisplayDimensions(group)
        if (intersects(group.x, group.y, dims.width, dims.height)) selection.groupIds.push(group.id)
      }
      for (const node of Object.values(this.currentScene.nodes)) {
        if (node.groupId != null) continue
        const pos = this.getNodeDisplayPosition(node)
        const dims = this.getNodeDisplayDimensions(node)
        if (intersects(pos.x, pos.y, dims.width, dims.height)) selection.nodeIds.push(node.id)
      }
      for (const free of Object.values(this.currentScene.freeSegments ?? {})) {
        if (free.groupId) continue
        if (free.segment.isDropPreview) continue
        const b = segmentBoundsInNodeLocal(free.segment)
        const anchor = this.freeSegmentAnchorWorld(free)
        const x = anchor.x + b.x - SLOT_START_X
        const y = anchor.y + b.y - TOP_BAND_H
        if (intersects(x, y, b.w, b.h)) selection.segmentIds.push(free.segment.id)
      }
      for (const [labelId, label] of Object.entries(this.currentScene.labels ?? {})) {
        const view = this.labelViews.get(labelId)
        const b = view?.root.getLocalBounds()
        const w = b ? Math.max(40, b.width) : 120
        const h = b ? Math.max(20, b.height) : 28
        if (intersects(label.x - 8, label.y, w, h)) selection.labelIds.push(label.id)
      }
      return selection
    }

    if (origin.type === 'group') {
      for (const node of Object.values(this.currentScene.nodes)) {
        if (node.groupId !== origin.groupId) continue
        const pos = this.getNodeDisplayPosition(node)
        const dims = this.getNodeDisplayDimensions(node)
        if (intersects(pos.x, pos.y, dims.width, dims.height)) selection.nodeIds.push(node.id)
      }
      for (const free of Object.values(this.currentScene.freeSegments ?? {})) {
        if (free.groupId !== origin.groupId) continue
        if (free.segment.isDropPreview) continue
        const b = segmentBoundsInNodeLocal(free.segment)
        const anchor = this.freeSegmentAnchorWorld(free)
        const x = anchor.x + b.x - SLOT_START_X
        const y = anchor.y + b.y - TOP_BAND_H
        if (intersects(x, y, b.w, b.h)) selection.segmentIds.push(free.segment.id)
      }
      return selection
    }

    const originNode = this.currentScene.nodes[origin.nodeId]
    if (!originNode) return selection
    const nodePos = this.getNodeDisplayPosition(originNode)
    for (const segment of originNode.segments) {
      if (segment.isDropPreview) continue
      const b = segmentBoundsInNodeLocal(segment, originNode.slotCols)
      const x = nodePos.x + b.x
      const y = nodePos.y + b.y
      if (intersects(x, y, b.w, b.h)) selection.segmentIds.push(segment.id)
    }
    return selection
  }

  private updateMarqueePreview(addToSelection: boolean): void {
    if (this.activeDrag.type !== 'marquee') return
    const { startWorldX, startWorldY, endX, endY, origin } = this.activeDrag
    const startX = startWorldX * this.zoom + this.pan.x
    const startY = startWorldY * this.zoom + this.pan.y
    const w = Math.abs(endX - startX)
    const h = Math.abs(endY - startY)
    if (w < 2 && h < 2) {
      this.marqueePreviewSelection = null
      this.marqueePreviewAddToSelection = false
    } else {
      const selection = this.computeMarqueeSelection(origin, startX, startY, endX, endY)
      this.marqueePreviewSelection = {
        segmentIds: new Set(selection.segmentIds),
        nodeIds: new Set(selection.nodeIds),
        groupIds: new Set(selection.groupIds),
        labelIds: new Set(selection.labelIds),
      }
      this.marqueePreviewAddToSelection = addToSelection
    }
    this.updateSelectionOverlay()
  }

  private clearMarqueePreview(): void {
    this.marqueePreviewSelection = null
    this.marqueePreviewAddToSelection = false
    this.updateSelectionOverlay()
  }

  private finishMarquee(addToSelection: boolean): void {
    if (this.activeDrag.type !== 'marquee' || !this.currentScene || !this.handlers.onMarqueeSelect) return
    const { startWorldX, startWorldY, endX, endY, origin } = this.activeDrag
    const startX = startWorldX * this.zoom + this.pan.x
    const startY = startWorldY * this.zoom + this.pan.y
    const selection = this.computeMarqueeSelection(origin, startX, startY, endX, endY)
    this.clearMarqueePreview()
    this.handlers.onMarqueeSelect(selection, addToSelection)
  }

  /** Cancel marquee drag (e.g. on Escape). Clears preview without committing selection. */
  cancelMarquee(): void {
    if (this.activeDrag.type !== 'marquee') return
    this.activeDrag = { type: 'idle' }
    this.stopAutoPanLoop()
    this.clearMarqueePreview()
    this.drawMarquee()
  }

  isMarqueeActive(): boolean {
    return this.activeDrag.type === 'marquee'
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

  /** Hit-test at client coords; returns groupId if over a group (but not a segment or node). */
  private hitTestGroupContext(clientX: number, clientY: number): string | null {
    const events = (this.app.renderer as { events?: { mapPositionToPoint: (p: Point, x: number, y: number) => void; rootBoundary?: { hitTest: (x: number, y: number) => Container } } }).events
    if (!events?.rootBoundary) return null
    const pt = new Point()
    events.mapPositionToPoint(pt, clientX, clientY)
    const hit = events.rootBoundary.hitTest(pt.x, pt.y)
    if (!hit) return null
    let cur: Container | null = hit
    while (cur) {
      const c = cur as Container & { __segmentContext?: SegmentContext; __nodeId?: string; __groupHandleId?: string }
      if (c.__segmentContext || c.__nodeId) return null
      if (typeof c.__groupHandleId === 'string' && c.__groupHandleId.length > 0) return c.__groupHandleId
      cur = cur.parent
    }
    return null
  }

  /** Hit-test at client coords; returns nodeId if over a node (header/body) but not a segment. */
  private hitTestNodeContext(clientX: number, clientY: number): string | null {
    const events = (this.app.renderer as { events?: { mapPositionToPoint: (p: Point, x: number, y: number) => void; rootBoundary?: { hitTest: (x: number, y: number) => Container } } }).events
    if (!events?.rootBoundary) return null
    const pt = new Point()
    events.mapPositionToPoint(pt, clientX, clientY)
    const hit = events.rootBoundary.hitTest(pt.x, pt.y)
    if (!hit) return null
    let cur: Container | null = hit
    while (cur) {
      const c = cur as Container & { __segmentContext?: SegmentContext; __nodeId?: string }
      if (c.__segmentContext) return null
      if (typeof c.__nodeId === 'string' && c.__nodeId.length > 0) return c.__nodeId
      cur = cur.parent
    }
    return null
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
        __groupResizeHandle?: boolean
        __labelHandleId?: string
        __labelId?: string
      }
      if (c.__segmentContext || c.__dragHandle || c.__groupHandle || c.__groupResizeHandle || c.__labelHandleId || c.__labelId) return true
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
    this.lastPointerPosition = { clientX: event.clientX, clientY: event.clientY }
    this.startAutoPanLoop()
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

  private applyLocalGroupSize(groupId: string, width: number, height: number): void {
    if (!this.currentScene?.groups?.[groupId]) return
    const mutableGroup = this.currentScene.groups[groupId] as SceneGroupVM & { width: number; height: number }
    mutableGroup.width = width
    mutableGroup.height = height
    this.recomputeDisplayFlow(this.currentScene)
    this.rebuildGroups(this.currentScene)
  }

  private startGroupResizeDrag(
    groupId: string,
    resizeX: boolean,
    resizeY: boolean,
    clientX: number,
    clientY: number,
  ): void {
    if (!this.currentScene || !this.handlers.onResizeGroup) return
    const group = this.currentScene.groups?.[groupId]
    if (!group) return
    let startWidth = this.getGroupDisplayDimensions(group).width
    let startHeight = this.getGroupDisplayDimensions(group).height
    if (!this.isGroupExpanded(groupId)) {
      const collapsedDims = this.getGroupCollapsedDimensions(group)
      startWidth = collapsedDims.width
      startHeight = collapsedDims.height
      this.setGroupExpanded(groupId, true)
      this.applyLocalGroupSize(groupId, startWidth, startHeight)
      this.handlers.onResizeGroup(groupId, startWidth, startHeight)
    }
    const startPointerWorld = this.screenToWorld(clientX, clientY)
    this.activeDrag = {
      type: 'groupResize',
      state: {
        groupId,
        startPointerWorld,
        startWidth,
        startHeight,
        resizeX,
        resizeY,
      },
    }
    this.lastPointerPosition = { clientX, clientY }
    this.startAutoPanLoop()
  }

  private updateGroupResizeDrag(clientX: number, clientY: number): void {
    if (this.activeDrag.type !== 'groupResize' || !this.currentScene || !this.handlers.onResizeGroup) return
    const drag = this.activeDrag.state
    const group = this.currentScene.groups?.[drag.groupId]
    if (!group) return
    const world = this.screenToWorld(clientX, clientY)
    const deltaX = world.x - drag.startPointerWorld.x
    const deltaY = world.y - drag.startPointerWorld.y
    const contentMin = this.getGroupContentMinDimensions(group)
    const nextWidth = drag.resizeX
      ? Math.max(contentMin.width, drag.startWidth + deltaX)
      : drag.startWidth
    const nextHeight = drag.resizeY
      ? Math.max(contentMin.height, drag.startHeight + deltaY)
      : drag.startHeight
    this.applyLocalGroupSize(drag.groupId, nextWidth, nextHeight)
    this.handlers.onResizeGroup(drag.groupId, nextWidth, nextHeight)
  }

  private applyLocalNodeSize(nodeId: string, slotCols: number, slotRows: number): void {
    if (!this.currentScene?.nodes?.[nodeId]) return
    const mutableNode = this.currentScene.nodes[nodeId] as SceneNodeVM & { slotCols: number; slotRows: number; width: number; height: number }
    mutableNode.slotCols = Math.max(1, Math.floor(slotCols))
    mutableNode.slotRows = Math.max(1, Math.floor(slotRows))
    mutableNode.width = SLOT_START_X + meterWidthForCols(mutableNode.slotCols) + 20
    mutableNode.height = TOP_BAND_H + slotAreaHeightForRows(mutableNode.slotRows) + NODE_BOTTOM_PADDING
    this.recomputeDisplayFlow(this.currentScene)
    this.rebuildAllNodes(this.currentScene)
  }

  private startNodeResizeDrag(
    nodeId: string,
    resizeX: boolean,
    resizeY: boolean,
    clientX: number,
    clientY: number,
  ): void {
    if (!this.currentScene || !this.handlers.onResizeNode) return
    const node = this.currentScene.nodes[nodeId]
    if (!node) return
    if (!this.isNodeExpanded(nodeId)) this.setNodeExpanded(nodeId, true)
    const startPointerWorld = this.screenToWorld(clientX, clientY)
    this.activeDrag = {
      type: 'nodeResize',
      state: {
        nodeId,
        startPointerWorld,
        startSlotCols: Math.max(1, node.slotCols),
        startSlotRows: Math.max(1, node.slotRows),
        resizeX,
        resizeY,
      },
    }
    this.lastPointerPosition = { clientX, clientY }
    this.startAutoPanLoop()
  }

  private updateNodeResizeDrag(clientX: number, clientY: number): void {
    if (this.activeDrag.type !== 'nodeResize' || !this.currentScene || !this.handlers.onResizeNode) return
    const drag = this.activeDrag.state
    const node = this.currentScene.nodes[drag.nodeId]
    if (!node) return
    const world = this.screenToWorld(clientX, clientY)
    const deltaX = world.x - drag.startPointerWorld.x
    const deltaY = world.y - drag.startPointerWorld.y
    const stepX = STONE_W + STONE_GAP
    const stepY = STONE_H + STONE_ROW_GAP
    const nextCols = drag.resizeX
      ? Math.max(1, drag.startSlotCols + Math.round(deltaX / stepX))
      : drag.startSlotCols
    const nextRows = drag.resizeY
      ? Math.max(1, drag.startSlotRows + Math.round(deltaY / stepY))
      : drag.startSlotRows
    this.applyLocalNodeSize(drag.nodeId, nextCols, nextRows)
    this.handlers.onResizeNode(drag.nodeId, nextCols, nextRows)
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

  setEditingTitle(target: { type: 'node' | 'group'; id: string } | null): void {
    this.editingTitle = target
    if (this.currentScene) this.rebuildAllNodes(this.currentScene)
  }

  private buildTitleOverlayMetrics(
    title: BitmapText,
    paddingPx: number,
  ): { left: number; top: number; width: number; height: number; fontSizePx: number } {
    const bounds = title.getBounds()
    const canvasRect = this.app.canvas.getBoundingClientRect()
    const worldScaleY = Math.abs(title.worldTransform.d || 1)
    const baseFontSize = Number.parseFloat(String(title.style.fontSize)) || 14
    return {
      left: canvasRect.left + bounds.x - paddingPx,
      top: canvasRect.top + bounds.y - paddingPx,
      width: bounds.width + paddingPx * 2,
      height: bounds.height + paddingPx * 2,
      fontSizePx: Math.max(10, baseFontSize * worldScaleY),
    }
  }

  private shouldTreatAsDoubleTap(key: string): boolean {
    const now = Date.now()
    const isDouble = this.lastTitleTap?.key === key && now - this.lastTitleTap.atMs <= 350
    this.lastTitleTap = { key, atMs: now }
    return isDouble
  }

  private freeSegmentAnchorWorld(free: SceneFreeSegmentVM): { x: number; y: number } {
    if (!free.groupId || !this.currentScene?.groups?.[free.groupId]) return { x: free.x, y: free.y }
    const group = this.currentScene.groups[free.groupId]
    return { x: group.x + free.x, y: group.y + free.y }
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
    return this.findSegmentNodeDropTarget(world.x, world.y)
  }

  getGroupIdAtPoint(worldX: number, worldY: number): string | null {
    if (!this.currentScene?.groups) return null
    for (const group of Object.values(this.currentScene.groups)) {
      const dims = this.getGroupDisplayDimensions(group)
      const inside =
        worldX >= group.x &&
        worldX <= group.x + dims.width &&
        worldY >= group.y &&
        worldY <= group.y + dims.height
      if (inside) return group.id
    }
    return null
  }

  isPointInsideGroup(worldX: number, worldY: number): boolean {
    return this.getGroupIdAtPoint(worldX, worldY) != null
  }

  /** Virtual node-style layout for segments (e.g. paste inventory). Used as initialSegmentPositions for external drag. */
  computeVirtualSegmentLayout(segments: readonly SceneSegmentVM[]): Record<string, { x: number; y: number }> {
    const ITEM_GAP = 4
    const result: Record<string, { x: number; y: number }> = {}
    let offsetY = 0
    for (const segment of segments) {
      if (isMultiStone(segment)) {
        result[segment.id] = { x: 0, y: offsetY }
        offsetY += STONE_H + ITEM_GAP
      } else {
        const groups = groupSixthsByStone(0, segment.sizeSixths)
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
        groups.forEach((g) => {
          const gy = offsetY + stoneToY(g.stone) + g.startRow * CELL_H
          minX = Math.min(minX, stoneToX(g.stone))
          minY = Math.min(minY, gy)
          maxX = Math.max(maxX, stoneToX(g.stone) + STONE_W)
          maxY = Math.max(maxY, gy + g.count * CELL_H)
        })
        result[segment.id] = { x: minX, y: minY }
        offsetY += maxY - minY + ITEM_GAP
      }
    }
    return result
  }

  beginExternalDrag(
    segments: readonly SceneSegmentVM[],
    clientX: number,
    clientY: number,
    initialSegmentPositions?: Record<string, { x: number; y: number }>,
  ): void {
    if (this.activeDrag.type !== 'idle') return
    if (segments.length === 0) return
    const pointerWorld = this.screenToWorld(clientX, clientY)
    const { proxy: compactProxy, pivot, segmentBounds: _segmentBounds } = this.buildDragProxy(segments)
    const proxy = new Container()
    proxy.addChild(compactProxy)
    const lineLayer = new Container()
    this.worldLayer.addChild(lineLayer)
    this.worldLayer.addChild(proxy)
    const proxyAnchorOffset = { x: 0, y: 0 }
    this.activeDrag = {
      type: 'segment',
      state: {
        segments,
        segmentIds: segments.map((s) => s.id),
        sourceNodeIds: {},
        proxy,
        lineLayer,
        proxyAnchorOffset,
        dropAnchorOffset: { x: pivot.x, y: pivot.y },
        initialSegmentPositions: initialSegmentPositions ?? {},
        pointerWorldAtStart: pointerWorld,
        grabbedSegmentId: segments[0].id,
        snap: null,
        proxyMode: 'compact',
        absoluteProxyAnchorOffset: { x: 0, y: 0 },
        isExternal: true,
      },
    }
    this.lastPointerPosition = { clientX, clientY }
    this.startAutoPanLoop()
    this.updateSegmentDrag(clientX, clientY)
  }

  cancelExternalDrag(): void {
    if (this.activeDrag.type !== 'segment' || !this.activeDrag.state.isExternal) return
    const drag = this.activeDrag.state
    this.worldLayer.removeChild(drag.lineLayer)
    this.worldLayer.removeChild(drag.proxy)
    drag.lineLayer.destroy({ children: true })
    drag.proxy.destroy({ children: true })
    this.endDrag()
  }

  /** Drop target = whole character node. Returns nodeId if world point is inside any node's bounds. */
  private findSegmentNodeDropTarget(worldX: number, worldY: number): string | null {
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

  private findDropTarget(worldX: number, worldY: number): SegmentDropTarget {
    const nodeId = this.findSegmentNodeDropTarget(worldX, worldY)
    if (nodeId) return { type: 'node', nodeId }
    if (!this.currentScene?.groups) return null
    const groups = Object.values(this.currentScene.groups)
    for (let i = groups.length - 1; i >= 0; i -= 1) {
      const group = groups[i]
      if (!group) continue
      const dims = this.getGroupDisplayDimensions(group)
      if (
        worldX >= group.x &&
        worldX <= group.x + dims.width &&
        worldY >= group.y &&
        worldY <= group.y + dims.height
      ) {
        return { type: 'group', groupId: group.id }
      }
    }
    return null
  }

  private findSnapTarget(worldX: number, worldY: number, segment: SceneSegmentVM): { nodeId: string; startSixth: number } | null {
    const targetNodeId = this.findSegmentNodeDropTarget(worldX, worldY)
    if (!targetNodeId || !this.currentScene) return null

    const node = this.currentScene.nodes[targetNodeId]
    if (!node) return null

    const visibleSlotCount = this.getVisibleSlotCount(node)
    const layoutCols = this.isNodeExpanded(node.id)
      ? node.slotCols
      : Math.max(1, Math.min(visibleSlotCount, stonesPerRow))
    const nodeMeterWidth = meterWidthForCols(layoutCols)
    const slotAreaH = slotAreaHeightForSlots(visibleSlotCount, layoutCols)
    const pos = this.getNodeDisplayPosition(node)
    const inY = worldY >= pos.y + TOP_BAND_H && worldY <= pos.y + TOP_BAND_H + slotAreaH
    if (!inY) return { nodeId: targetNodeId, startSixth: 0 }
    const localX = worldX - pos.x - SLOT_START_X
    const localY = worldY - pos.y - TOP_BAND_H
    if (localX < -STONE_W || localX > nodeMeterWidth + STONE_W) return { nodeId: targetNodeId, startSixth: 0 }

    let startSixth = localToSixth(localX, localY, visibleSlotCount, layoutCols)
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

  /** Build proxy with segments at their absolute relative positions (for outside-group drop). */
  private buildDragProxyAbsolute(
    segments: readonly SceneSegmentVM[],
    initialPositions: Readonly<Record<string, { x: number; y: number }>>,
    grabbedSegmentId: string,
  ): Container {
    const proxy = new Container()
    const grabbed = initialPositions[grabbedSegmentId]
    if (!grabbed) return proxy
    for (const segment of segments) {
      const pos = initialPositions[segment.id]
      if (!pos) continue
      const relX = pos.x - grabbed.x
      const relY = pos.y - grabbed.y
      const color = segment.isOverflow ? 0xa83f62 : isMultiStone(segment) ? 0x61b5ff : 0x7bd7cf
      const alpha = 0.75
      if (isMultiStone(segment)) {
        const w = (segment.sizeSixths / 6) * (STONE_W + STONE_GAP) - STONE_GAP
        const rect = new Graphics()
        rect.roundRect(relX, relY, w, STONE_H, 6)
        rect.fill({ color, alpha })
        rect.stroke({ width: 1.5, color: 0xd3ebff, alpha: 0.9 })
        proxy.addChild(rect)
      } else {
        drawGhostCells(proxy, 0, relX, relY, segment.sizeSixths, color, alpha)
        const groups = groupSixthsByStone(0, segment.sizeSixths)
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
        groups.forEach((g) => {
          const gy = relY + stoneToY(g.stone) + g.startRow * CELL_H
          minX = Math.min(minX, relX + stoneToX(g.stone))
          minY = Math.min(minY, gy)
          maxX = Math.max(maxX, relX + stoneToX(g.stone) + STONE_W)
          maxY = Math.max(maxY, gy + g.count * CELL_H)
        })
        const stroke = new Graphics()
        stroke.roundRect(minX, minY, maxX - minX, maxY - minY, 4)
        stroke.stroke({ width: 1.5, color: 0xd3ebff, alpha: 0.85 })
        proxy.addChild(stroke)
      }
    }
    return proxy
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
      const anchor = this.freeSegmentAnchorWorld(free)
      return {
        x: anchor.x + b.x - SLOT_START_X,
        y: anchor.y + b.y - TOP_BAND_H,
        w: b.w,
        h: b.h,
      }
    }
    return null
  }

  private onSegmentPointerDown(segment: SceneSegmentVM, nodeId: string, clientX: number, clientY: number, addToSelection: boolean): void {
    if (this.activeDrag.type !== 'idle') return
    this.activeDrag = {
      type: 'pendingSegment',
      segment,
      nodeId,
      startClientX: clientX,
      startClientY: clientY,
      addToSelection,
    }
  }

  private startGroupDragById(groupId: string, clientX: number, clientY: number): boolean {
    if (!this.currentScene || !this.handlers.onMoveGroup) return false
    const group = this.currentScene.groups?.[groupId] ?? null
    if (!group) return false
    const world = this.screenToWorld(clientX, clientY)
    this.activeDrag = {
      type: 'group',
      state: {
        groupId: group.id,
        anchorOffset: { x: world.x - group.x, y: world.y - group.y },
      },
    }
    this.lastPointerPosition = { clientX, clientY }
    this.startAutoPanLoop()
    return true
  }

  private startNodeReorderDragForNodeIds(
    visualNodeIds: readonly string[],
    operationNodeIds: readonly string[],
    primaryNodeId: string,
    primaryNodeContainer: Container,
    handleView: Container,
    clientX: number,
    clientY: number,
  ): boolean {
    if (!this.currentScene || visualNodeIds.length === 0) return false
    const dedupedVisualIds = [...new Set(visualNodeIds)]
    const nodeContainers: Container[] = []
    const resolvedNodeIds: string[] = []
    for (const nid of dedupedVisualIds) {
      const v = this.nodeViews.get(nid)
      if (!v) continue
      resolvedNodeIds.push(nid)
      nodeContainers.push(v.root)
    }
    if (nodeContainers.length === 0) return false
    const initialPositions = nodeContainers.map((c) => ({ x: c.position.x, y: c.position.y }))
    const point = this.screenToWorld(clientX, clientY)
    const anchorOffset = {
      x: point.x - primaryNodeContainer.position.x,
      y: point.y - primaryNodeContainer.position.y,
    }
    const primaryNode = this.currentScene.nodes[primaryNodeId]
    const originalGroupId = primaryNode?.groupId ?? null
    const originalIndex = (() => {
      const gid = primaryNode?.groupId
      if (!gid || !this.currentScene?.groups?.[gid]) return 0
      const idx = this.currentScene.groups[gid].nodeIds.indexOf(primaryNodeId)
      return idx >= 0 ? idx : 0
    })()
    const originalNestParentId = primaryNode?.parentNodeId ?? null
    this.activeDrag = {
      type: 'nodeReorder',
      state: {
        nodeIds: resolvedNodeIds,
        operationNodeIds: [...new Set(operationNodeIds)],
        nodeContainers,
        initialPositions,
        handleView,
        anchorOffset,
        originalGroupId,
        originalIndex,
        originalNestParentId,
        targetGroupId: null,
        targetIndex: 0,
        targetNestParentNodeId: null,
        targetContainNodeId: null,
      },
    }
    this.lastPointerPosition = { clientX, clientY }
    this.startAutoPanLoop()
    handleView.cursor = 'grabbing'
    return true
  }

  private beginSegmentDrag(segment: SceneSegmentVM, sourceNodeId: string, clientX: number, clientY: number): void {
    if (this.activeDrag.type !== 'idle' && this.activeDrag.type !== 'pendingSegment') return
    if (!this.currentScene) return
    const sourceNode = this.currentScene.nodes[sourceNodeId]
    const sourceGroupId = sourceNode?.groupId ?? null
    const dragResolution = resolveDragStartFromSegment(
      sourceNodeId,
      sourceGroupId,
      this.currentScene.selectedNodeIds ?? [],
      this.currentScene.selectedGroupIds ?? [],
    )
    if (dragResolution.type === 'group') {
      if (this.startGroupDragById(dragResolution.groupId, clientX, clientY)) return
    }
    if (dragResolution.type === 'node') {
      const selectedNodeIds = this.currentScene.selectedNodeIds ?? []
      const operationNodeIds = selectedNodeIds.length > 0 ? selectedNodeIds : [sourceNodeId]
      const primaryNodeId = operationNodeIds.includes(sourceNodeId) ? sourceNodeId : operationNodeIds[0]
      const primaryView = this.nodeViews.get(primaryNodeId)
      if (primaryView) {
        if (this.startNodeReorderDragForNodeIds(operationNodeIds, operationNodeIds, primaryNodeId, primaryView.root, primaryView.root, clientX, clientY)) return
      }
    }
    const selectedIds = this.currentScene?.selectedSegmentIds ?? []
    const segmentIds = selectedIds.includes(segment.id) && selectedIds.length > 1
      ? [...selectedIds]
      : [segment.id]
    const segmentById = new Map<string, SceneSegmentVM>()
    const sourceNodeIds: Record<string, string> = {}
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
    const pointerWorld = this.screenToWorld(clientX, clientY)
    const initialSegmentPositions: Record<string, { x: number; y: number }> = {}
    for (const seg of segments) {
      const b = this.getSegmentWorldBounds(seg.id, sourceNodeIds[seg.id])
      if (b) initialSegmentPositions[seg.id] = { x: b.x, y: b.y }
    }
    const { proxy: compactProxy, pivot, segmentBounds } = this.buildDragProxy(segments)
    const absoluteProxy = this.buildDragProxyAbsolute(segments, initialSegmentPositions, segment.id)
    absoluteProxy.visible = false
    const proxy = new Container()
    proxy.addChild(compactProxy)
    proxy.addChild(absoluteProxy)
    const grabbedWorldBounds = this.getSegmentWorldBounds(segment.id, sourceNodeId)
    const grabbedPos = initialSegmentPositions[segment.id] ?? { x: 0, y: 0 }
    const absoluteProxyAnchorOffset = {
      x: pointerWorld.x - grabbedPos.x,
      y: pointerWorld.y - grabbedPos.y,
    }
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
        initialSegmentPositions,
        pointerWorldAtStart: pointerWorld,
        grabbedSegmentId: segment.id,
        snap: null,
        proxyMode: 'compact',
        absoluteProxyAnchorOffset,
      },
    }
    this.lastPointerPosition = { clientX, clientY }
    this.startAutoPanLoop()
    this.handlers.onDragSegmentStart(segmentIds)
    this.updateSegmentDrag(clientX, clientY)
  }

  private updateSegmentDrag(clientX: number, clientY: number): void {
    if (this.activeDrag.type !== 'segment') return
    const drag = this.activeDrag.state
    const world = this.screenToWorld(clientX, clientY)
    const dropTarget = this.findDropTarget(world.x, world.y)
    const targetNodeId = dropTarget?.type === 'node' ? dropTarget.nodeId : null
    const targetGroupId = dropTarget?.type === 'group' ? dropTarget.groupId : null
    if (!drag.isExternal) {
      this.handlers.onDragSegmentUpdate(targetNodeId ?? null)
    }
    this.setSegmentDragHoveredGroup(targetGroupId)

    const snap = this.findSnapTarget(world.x, world.y, drag.segments[0])
    drag.snap = snap

    const useAbsolute = (!!targetGroupId || !targetNodeId) && !drag.isExternal
    if (useAbsolute && drag.proxyMode !== 'absolute') {
      drag.proxyMode = 'absolute'
      const compact = drag.proxy.getChildAt(0) as Container
      const absolute = drag.proxy.getChildAt(1) as Container
      compact.visible = false
      absolute.visible = true
    } else if (!useAbsolute && drag.proxyMode !== 'compact') {
      drag.proxyMode = 'compact'
      const compact = drag.proxy.getChildAt(0) as Container
      const absolute = drag.proxy.getChildAt(1) as Container
      compact.visible = true
      absolute.visible = false
    }

    const anchorOffset = useAbsolute ? drag.absoluteProxyAnchorOffset : drag.proxyAnchorOffset
    const proxyX = world.x - anchorOffset.x
    const proxyY = world.y - anchorOffset.y
    drag.proxy.position.set(proxyX, proxyY)

    drag.lineLayer.removeChildren()
    const targetCenters = this.getDropTargetCenters()
    for (const target of targetCenters) {
      const lineG = new Graphics()
      drawArrowLine(lineG, proxyX, proxyY, target.x, target.y)
      drag.lineLayer.addChild(lineG)
    }
  }

  private endSegmentDrag(event?: PointerEvent): void {
    if (this.activeDrag.type !== 'segment') return
    const drag = this.activeDrag.state
    this.lastDragEndTime = Date.now()
    const world = event ? this.screenToWorld(event.clientX, event.clientY) : null
    const dropTarget = world
      ? this.findDropTarget(world.x, world.y)
      : drag.snap?.nodeId
        ? ({ type: 'node', nodeId: drag.snap.nodeId } as const)
        : null
    const targetNodeId = dropTarget?.type === 'node' ? dropTarget.nodeId : null
    const targetGroupId = dropTarget?.type === 'group' ? dropTarget.groupId : null
    this.setSegmentDragHoveredGroup(null)
    console.info('[pixi drag] endSegmentDrag start', {
      isExternal: !!drag.isExternal,
      hasEvent: !!event,
      targetNodeId,
      targetGroupId,
      worldX: world?.x ?? null,
      worldY: world?.y ?? null,
      segmentIds: drag.segmentIds,
    })

    if (drag.isExternal) {
      let cancelled = !event
      if (event && !cancelled) {
        const rect = this.app.canvas.getBoundingClientRect()
        if (
          event.clientX < rect.left || event.clientX > rect.right ||
          event.clientY < rect.top || event.clientY > rect.bottom
        ) {
          cancelled = true
        }
      }
      const dropX = world?.x ?? 0
      const dropY = world?.y ?? 0
      let freeSegmentPositions: Record<string, { x: number; y: number }> | undefined
      if (!cancelled && !targetNodeId && world && Object.keys(drag.initialSegmentPositions).length > 0) {
        freeSegmentPositions = {}
        const anchor = drag.dropAnchorOffset
        for (const segId of drag.segmentIds) {
          const pos = drag.initialSegmentPositions[segId]
          if (pos) {
            freeSegmentPositions[segId] = {
              x: world.x - anchor.x + pos.x,
              y: world.y - anchor.y + pos.y,
            }
          }
        }
      }
      console.info('[pixi drag] external drag end payload', {
        targetNodeId,
        cancelled,
        dropX,
        dropY,
        freeSegmentPositionsCount: freeSegmentPositions ? Object.keys(freeSegmentPositions).length : 0,
      })
      this.worldLayer.removeChild(drag.lineLayer)
      this.worldLayer.removeChild(drag.proxy)
      drag.lineLayer.destroy({ children: true })
      drag.proxy.destroy({ children: true })
      this.endDrag()
      this.handlers.onExternalDragEnd?.(targetNodeId, dropX, dropY, cancelled, freeSegmentPositions)
      return
    }

    const anyDifferentSource = drag.segmentIds.some((id) => drag.sourceNodeIds[id] !== targetNodeId)
    const effectiveTarget = targetNodeId && anyDifferentSource ? targetNodeId : null
    this.skipSegmentAnimationOnce.clear()
    drag.segmentIds.forEach((segmentId) => this.skipSegmentAnimationOnce.add(segmentId))
    let dropX: number | undefined
    let dropY: number | undefined
    let freeSegmentPositions: Record<string, { x: number; y: number }> | undefined
    if (world) {
      if (effectiveTarget) {
        dropX = world.x - drag.dropAnchorOffset.x
        dropY = world.y - drag.dropAnchorOffset.y
      } else {
        const deltaX = world.x - drag.pointerWorldAtStart.x
        const deltaY = world.y - drag.pointerWorldAtStart.y
        freeSegmentPositions = {}
        for (const segId of drag.segmentIds) {
          const pos = drag.initialSegmentPositions[segId]
          if (pos) {
            freeSegmentPositions[segId] = { x: pos.x + deltaX, y: pos.y + deltaY }
          }
        }
        dropX = world.x - drag.dropAnchorOffset.x
        dropY = world.y - drag.dropAnchorOffset.y
      }
    }
    console.info('[pixi drag] internal drag end payload', {
      targetNodeId,
      effectiveTarget,
      dropX,
      dropY,
      freeSegmentPositionsCount: freeSegmentPositions ? Object.keys(freeSegmentPositions).length : 0,
      segmentIds: drag.segmentIds,
    })
    this.handlers.onDragSegmentEnd(targetNodeId, targetGroupId, dropX, dropY, freeSegmentPositions)
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
    ;(root as Container & { __nodeId?: string }).__nodeId = node.id
    const contentContainer = new Container()
    root.addChild(contentContainer)
    const displayPos = this.getNodeDisplayPosition(node)
    const positionSpring = createSpring2D(displayPos.x, displayPos.y)
    positionSpring.targetX = displayPos.x
    positionSpring.targetY = displayPos.y

    const slotCount = node.slotCount
    const isExpanded = this.isNodeExpanded(node.id)
    const visibleSlotCount = isExpanded
      ? Math.max(slotCount, node.slotCols * node.slotRows)
      : collapsedVisibleSlotCount(node.segments, slotCount)
    const layoutCols = isExpanded
      ? node.slotCols
      : Math.max(1, Math.min(visibleSlotCount, stonesPerRow))
    const totalMeterWidth = meterWidthForCols(layoutCols)
    const totalWidth = SLOT_START_X + totalMeterWidth + 20
    const totalHeight = TOP_BAND_H + (isExpanded ? slotAreaHeightForRows(node.slotRows) : slotAreaHeightForSlots(visibleSlotCount)) + NODE_BOTTOM_PADDING
    const totalSixths = totalSixthsForSlots(slotCount)

    let moveToRootBtn: Graphics | undefined
    if (node.parentNodeId && this.handlers.onMoveNodeToGroupIndex && this.currentScene) {
      const parent = this.currentScene.nodes[node.parentNodeId]
      const groupId = parent?.groupId
      if (groupId != null) {
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
        const cx = btnX + btnW / 2
        const cy = btnY + btnH / 2
        drawScissorsIcon(moveToRootBtn, cx, cy)
        ;(moveToRootBtn as Container & { __dragHandle?: boolean }).__dragHandle = true
        moveToRootBtn.on('pointertap', () => {
          if (this.activeDrag.type !== 'idle') return
          const scene = this.currentScene
          const parentNodeId = node.parentNodeId
          const p = parentNodeId ? scene?.nodes[parentNodeId] : undefined
          const g = p?.groupId && scene?.groups?.[p.groupId]
          const idx = g && parentNodeId ? g.nodeIds.indexOf(parentNodeId) : -1
          const targetIdx = idx >= 0 ? idx + 1 : 0
          this.handlers.onMoveNodeToGroupIndex?.(node.id, p?.groupId ?? groupId, targetIdx)
        })
        contentContainer.addChild(moveToRootBtn)
      }
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

    const connectorPin = new Graphics()
    connectorPin.eventMode = 'static'
    connectorPin.cursor = 'crosshair'
    ;(connectorPin as Container & { __dragHandle?: boolean }).__dragHandle = true
    const pinR = 5
    const pinX = totalWidth - 12
    const pinY = TOP_BAND_H / 2
    connectorPin.circle(pinX, pinY, pinR)
    connectorPin.fill({ color: 0x17324f, alpha: 0.9 })
    connectorPin.stroke({ width: 1.5, color: 0xbddfff, alpha: 0.95 })
    connectorPin.visible = false
    contentContainer.addChild(connectorPin)
    root.eventMode = 'static'
    root.on('pointerover', () => {
      connectorPin.visible = true
    })
    root.on('pointerout', () => {
      connectorPin.visible = false
    })
    connectorPin.on('pointerdown', (event: any) => {
      if (event.button !== 0 || this.activeDrag.type !== 'idle') return
      const canvasRect = this.app.canvas.getBoundingClientRect()
      const clientX = typeof event.clientX === 'number' ? event.clientX : event.global.x + canvasRect.left
      const clientY = typeof event.clientY === 'number' ? event.clientY : event.global.y + canvasRect.top
      const world = this.screenToWorld(clientX, clientY)
      this.activeDrag = {
        type: 'connector',
        state: {
          nodeId: node.id,
          fromX: world.x,
          fromY: world.y,
          targetNodeId: null,
        },
      }
      this.lastPointerPosition = { clientX, clientY }
      this.startAutoPanLoop()
      event.stopPropagation()
    })

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

    const nodeTitleMidY = TOP_BAND_H / 2
    if (tier !== 'far') {
      const title = new BitmapText({
        text: node.title,
        style: { fill: '#e8f0ff', fontSize: 13, fontFamily: FONT_SEMIBOLD },
      })
      title.eventMode = 'none'
      title.anchor.set(0, 0.5)
      title.scale.set(textCompensationScale)
      addExpandCaret(nodeTitleMidY)
      title.position.set(30, nodeTitleMidY)
      title.visible = !(this.editingTitle?.type === 'node' && this.editingTitle.id === node.id)
      contentContainer.addChild(title)

      const titleHitPadding = 8
      const titleBounds = title.getLocalBounds()
      const titleTapTarget = new Graphics()
      titleTapTarget.eventMode = 'static'
      titleTapTarget.cursor = 'text'
      titleTapTarget.position.set(title.position.x, title.position.y)
      titleTapTarget.roundRect(
        titleBounds.x - titleHitPadding,
        titleBounds.y - titleHitPadding,
        Math.max(80, titleBounds.width + titleHitPadding * 2),
        titleBounds.height + titleHitPadding * 2,
        6,
      )
      titleTapTarget.fill({ color: 0xffffff, alpha: 0.001 })
      ;(titleTapTarget as Container & { __dragHandle?: boolean }).__dragHandle = true
      titleTapTarget.on('pointertap', (event: any) => {
        if (event.button !== 0 || !this.shouldTreatAsDoubleTap(`node:${node.id}`)) return
        event.stopPropagation()
        this.handlers.onEditNodeTitleRequest?.(
          node.id,
          node.title,
          this.buildTitleOverlayMetrics(title, 0),
        )
      })
      contentContainer.addChild(titleTapTarget)
    } else {
      const compact = new BitmapText({
        text: `${compactToken(node.title, 4)} ${node.speedFeet}'`,
        style: { fill: '#b0c2e8', fontSize: 11, fontFamily: FONT_REGULAR },
      })
      compact.eventMode = 'none'
      compact.anchor.set(0, 0.5)
      compact.scale.set(textCompensationScale)
      addExpandCaret(nodeTitleMidY)
      compact.position.set(30, nodeTitleMidY)
      contentContainer.addChild(compact)
    }

    const occupiedSixths = occupiedSixthsFromSegments(node.segments, totalSixths)

    const slotFillLayer = new Graphics()
    const dimAlpha = tier === 'far' ? 0.1 : 0.14
    const brightAlpha = tier === 'far' ? 0.36 : 0.48
    const slotColorFn = node.twoBandSlots ? twoBandSlotColor : fixedSlotBandColor
    for (let stone = 0; stone < visibleSlotCount; stone += 1) {
      const sx = SLOT_START_X + (stone % layoutCols) * (STONE_W + STONE_GAP)
      const sy = TOP_BAND_H + Math.floor(stone / layoutCols) * (STONE_H + STONE_ROW_GAP)
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
    const runVisualsContainer = new Container()
    runVisualsContainer.eventMode = 'none'
    segmentContainer.addChild(runVisualsContainer)

    const runs = groupContiguousSameType(node.segments)
    const mergedIds = new Set(runs.filter((r) => r.length > 1).flatMap((r) => r.map((s) => s.id)))

    for (const run of runs) {
      if (run.length < 2) continue
      const runHovered = run.some((s) => s.id === hoveredSegmentId)
      const first = run[0]
      const dimmed = filterCategory != null && first.category !== filterCategory
      const dimmedAlpha = 0.12
      const color = runHovered ? 0x5cadee : 0x3d9ac9
      const alpha = dimmed ? dimmedAlpha : 0.95
      drawRunVisuals(
        runVisualsContainer,
        run,
        SLOT_START_X,
        TOP_BAND_H,
        color,
        alpha,
        tier,
        this.zoom,
        textCompensationScale,
        this.minVisibleLabelPx,
        this.maxVisibleLabelPx,
        dimmed,
        dimmedAlpha,
        layoutCols,
      )
    }

    const segmentViews = new Map<string, SegmentView>()
    node.segments.forEach((segment) => {
      const pos = segmentPositionInNode(segment, layoutCols)
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
        (seg, nodeId, x, y, addToSel) => this.onSegmentPointerDown(seg, nodeId, x, y, addToSel),
        pos,
        filterCategory,
        selectedSegmentIds,
        this.handlers.onSegmentClick,
        this.handlers.onSegmentDoubleClick,
        () => this.lastDragEndTime,
        () => this.activeDrag.type === 'idle' || this.activeDrag.type === 'pendingSegment',
        mergedIds.has(segment.id),
      )
      segmentContainer.addChild(segContainer)
    })
    contentContainer.addChild(segmentContainer)

    const owningGroup = node.groupId ? this.currentScene?.groups?.[node.groupId] : null
    const canResizeNode = canShowNodeResizeHandles(owningGroup?.listViewEnabled === true)
    if (canResizeNode && this.handlers.onResizeNode) {
      const addNodeResizeHandle = (
        x: number,
        y: number,
        w: number,
        h: number,
        cursor: string,
        resizeX: boolean,
        resizeY: boolean,
      ): void => {
        const resizeHandle = new Graphics()
        resizeHandle.eventMode = 'static'
        resizeHandle.cursor = cursor
        ;(resizeHandle as Container & { __dragHandle?: boolean }).__dragHandle = true
        resizeHandle.roundRect(x, y, w, h, 6)
        resizeHandle.fill({ color: 0xffffff, alpha: 0.001 })
        resizeHandle.on('pointerdown', (event: any) => {
          if (event.button !== 0 || this.activeDrag.type !== 'idle') return
          const canvasRect = this.app.canvas.getBoundingClientRect()
          const clientX = typeof event.clientX === 'number' ? event.clientX : event.global.x + canvasRect.left
          const clientY = typeof event.clientY === 'number' ? event.clientY : event.global.y + canvasRect.top
          this.startNodeResizeDrag(node.id, resizeX, resizeY, clientX, clientY)
          event.stopPropagation()
        })
        contentContainer.addChild(resizeHandle)
      }
      const edgeThickness = 10
      addNodeResizeHandle(totalWidth - edgeThickness, TOP_BAND_H, edgeThickness, Math.max(20, totalHeight - TOP_BAND_H), 'ew-resize', true, false)
      addNodeResizeHandle(18, totalHeight - edgeThickness, Math.max(44, totalWidth - 18), edgeThickness, 'ns-resize', false, true)
      addNodeResizeHandle(totalWidth - 14, totalHeight - 14, 14, 14, 'nwse-resize', true, true)
    }

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
      runVisualsContainer,
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
    if (node.parentNodeId && this.handlers.onMoveNodeToGroupIndex && this.currentScene) {
      const parent = this.currentScene.nodes[node.parentNodeId]
      const groupId = parent?.groupId
      if (groupId != null && !view.moveToRootBtn) {
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
        const cx = btnX + btnW / 2
        const cy = btnY + btnH / 2
        drawScissorsIcon(moveToRootBtn, cx, cy)
        ;(moveToRootBtn as Container & { __dragHandle?: boolean }).__dragHandle = true
        moveToRootBtn.on('pointertap', () => {
          if (this.activeDrag.type !== 'idle') return
          const scene = this.currentScene
          const parentNodeId = node.parentNodeId
          const p = parentNodeId ? scene?.nodes[parentNodeId] : undefined
          const g = p?.groupId && scene?.groups?.[p.groupId]
          const idx = g && parentNodeId ? g.nodeIds.indexOf(parentNodeId) : -1
          const targetIdx = idx >= 0 ? idx + 1 : 0
          this.handlers.onMoveNodeToGroupIndex?.(node.id, p?.groupId ?? groupId, targetIdx)
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

    view.runVisualsContainer.removeChildren()
    const runs = groupContiguousSameType(node.segments)
    const mergedIds = new Set(runs.filter((r) => r.length > 1).flatMap((r) => r.map((s) => s.id)))
    for (const run of runs) {
      if (run.length < 2) continue
      const runHovered = run.some((s) => s.id === hoveredSegmentId)
      const first = run[0]
      const dimmed = filterCategory != null && first.category !== filterCategory
      const dimmedAlpha = 0.12
      const color = runHovered ? 0x5cadee : 0x3d9ac9
      const alpha = dimmed ? dimmedAlpha : 0.95
      drawRunVisuals(
        view.runVisualsContainer,
        run,
        SLOT_START_X,
        TOP_BAND_H,
        color,
        alpha,
        tier,
        this.zoom,
        textCompensationScale,
        this.minVisibleLabelPx,
        this.maxVisibleLabelPx,
        dimmed,
        dimmedAlpha,
        node.slotCols,
      )
    }

    const nextIds = new Set(node.segments.map((s) => s.id))
    for (const [id, segView] of view.segmentViews) {
      if (!nextIds.has(id)) {
        view.segmentContainer.removeChild(segView.container)
        segView.container.destroy({ children: true })
        view.segmentViews.delete(id)
      }
    }
    node.segments.forEach((segment) => {
      const pos = segmentPositionInNode(segment, node.slotCols)
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
          (seg, nodeId, x, y, addToSel) => this.onSegmentPointerDown(seg, nodeId, x, y, addToSel),
          pos,
          filterCategory,
          selectedSegmentIds,
          this.handlers.onSegmentClick,
          this.handlers.onSegmentDoubleClick,
          () => this.lastDragEndTime,
          () => this.activeDrag.type === 'idle' || this.activeDrag.type === 'pendingSegment',
          mergedIds.has(segment.id),
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
          (seg, nodeId, x, y, addToSel) => this.onSegmentPointerDown(seg, nodeId, x, y, addToSel),
          pos,
          filterCategory,
          selectedSegmentIds,
          this.handlers.onSegmentClick,
          this.handlers.onSegmentDoubleClick,
          () => this.lastDragEndTime,
          () => this.activeDrag.type === 'idle' || this.activeDrag.type === 'pendingSegment',
          mergedIds.has(segment.id),
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
      const canvasRect = this.app.canvas.getBoundingClientRect()
      const clientX = typeof event.clientX === 'number' ? event.clientX : event.global.x + canvasRect.left
      const clientY = typeof event.clientY === 'number' ? event.clientY : event.global.y + canvasRect.top
      this.startNodeReorderDragForNodeIds(nodeIds, [nodeId], nodeId, nodeContainer, handleView, clientX, clientY)
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
    ;(root as Container & { __groupHandleId?: string }).__groupHandleId = group.id
    const dims = this.getGroupDisplayDimensions(group)
    const displayWidth = dims.width
    const displayHeight = dims.height

    const bg = new Graphics()
    bg.roundRect(0, 0, displayWidth, displayHeight, 14)
    bg.fill({ color: 0x101b33, alpha: 0.36 })
    bg.stroke({ width: 2, color: 0x6f8fc5, alpha: 0.75 })
    root.addChild(bg)
    const hoverOutline = new Graphics()
    hoverOutline.roundRect(0, 0, displayWidth, displayHeight, 14)
    hoverOutline.stroke({ width: 3, color: 0xb5deff, alpha: 0.95 })
    hoverOutline.visible = this.segmentDragHoveredGroupId === group.id
    root.addChild(hoverOutline)

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

    const addResizeHandle = (
      x: number,
      y: number,
      w: number,
      h: number,
      cursor: string,
      resizeX: boolean,
      resizeY: boolean,
    ): void => {
      const resizeHandle = new Graphics()
      resizeHandle.eventMode = 'static'
      resizeHandle.cursor = cursor
      ;(resizeHandle as Container & { __groupResizeHandle?: boolean }).__groupResizeHandle = true
      resizeHandle.roundRect(x, y, w, h, 6)
      // Keep resize affordances interactive but fully invisible.
      resizeHandle.fill({ color: 0xffffff, alpha: 0.001 })
      resizeHandle.on('pointerdown', (event: any) => {
        if (event.button !== 0 || this.activeDrag.type !== 'idle') return
        const canvasRect = this.app.canvas.getBoundingClientRect()
        const clientX = typeof event.clientX === 'number' ? event.clientX : event.global.x + canvasRect.left
        const clientY = typeof event.clientY === 'number' ? event.clientY : event.global.y + canvasRect.top
        this.startGroupResizeDrag(group.id, resizeX, resizeY, clientX, clientY)
        event.stopPropagation()
      })
      root.addChild(resizeHandle)
    }

    const edgeThickness = 10
    addResizeHandle(displayWidth - edgeThickness, TOP_BAND_H, edgeThickness, Math.max(24, displayHeight - TOP_BAND_H), 'ew-resize', true, false)
    addResizeHandle(18, displayHeight - edgeThickness, Math.max(48, displayWidth - 18), edgeThickness, 'ns-resize', false, true)
    addResizeHandle(displayWidth - 14, displayHeight - 14, 14, 14, 'nwse-resize', true, true)

    const isExpanded = this.isGroupExpanded(group.id)
    const groupTitleMidY = TOP_BAND_H / 2
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
        this.setGroupExpanded(group.id, !isExpanded)
      })
      root.addChild(caret)
    }

    addExpandCaret(groupTitleMidY)

    const title = new BitmapText({
      text: group.title,
      style: { fill: '#dfeaff', fontSize: 14, fontFamily: FONT_SEMIBOLD },
    })
    title.eventMode = 'none'
    title.anchor.set(0, 0.5)
    title.scale.set(getTextCompensationScale(this.zoom))
    title.position.set(34, groupTitleMidY)
    title.visible = !(this.editingTitle?.type === 'group' && this.editingTitle.id === group.id)
    root.addChild(title)

    const titleHitPadding = 8
    const titleBounds = title.getLocalBounds()
    const titleTapTarget = new Graphics()
    titleTapTarget.eventMode = 'static'
    titleTapTarget.cursor = 'text'
    titleTapTarget.position.set(title.position.x, title.position.y)
    titleTapTarget.roundRect(
      titleBounds.x - titleHitPadding,
      titleBounds.y - titleHitPadding,
      Math.max(80, titleBounds.width + titleHitPadding * 2),
      titleBounds.height + titleHitPadding * 2,
      6,
    )
    titleTapTarget.fill({ color: 0xffffff, alpha: 0.001 })
    ;(titleTapTarget as Container & { __dragHandle?: boolean }).__dragHandle = true
    titleTapTarget.on('pointertap', (event: any) => {
      if (event.button !== 0 || !this.shouldTreatAsDoubleTap(`group:${group.id}`)) return
      event.stopPropagation()
      this.handlers.onEditGroupTitleRequest?.(
        group.id,
        group.title,
        this.buildTitleOverlayMetrics(title, 0),
      )
    })
    root.addChild(titleTapTarget)

    const listToggleW = 92
    const listToggleH = 20
    const listToggleX = Math.max(36, displayWidth - listToggleW - 12)
    const listToggleY = 10
    const listToggle = new Graphics()
    listToggle.eventMode = 'static'
    listToggle.cursor = 'pointer'
    ;(listToggle as Container & { __dragHandle?: boolean }).__dragHandle = true
    listToggle.roundRect(listToggleX, listToggleY, listToggleW, listToggleH, 8)
    listToggle.fill({ color: group.listViewEnabled ? 0x214d78 : 0x28344b, alpha: 0.9 })
    listToggle.stroke({ width: 1, color: group.listViewEnabled ? 0x8fd0ff : 0x778db3, alpha: 0.95 })
    listToggle.on('pointertap', (event: any) => {
      event.stopPropagation()
      this.handlers.onSetGroupListView?.(group.id, !group.listViewEnabled)
    })
    root.addChild(listToggle)

    const listToggleLabel = new BitmapText({
      text: `List view ${group.listViewEnabled ? 'on' : 'off'}`,
      style: { fill: '#d8ebff', fontSize: 11, fontFamily: FONT_SEMIBOLD },
    })
    listToggleLabel.eventMode = 'none'
    listToggleLabel.anchor.set(0.5, 0.5)
    listToggleLabel.scale.set(getTextCompensationScale(this.zoom))
    listToggleLabel.position.set(listToggleX + listToggleW / 2, listToggleY + listToggleH / 2 + 1)
    root.addChild(listToggleLabel)

    this.groupLayer.addChild(root)
    return { root, hoverOutline }
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
      (seg, nodeId, x, y, addToSel) => this.onSegmentPointerDown(seg, nodeId, x, y, addToSel),
      undefined,
      filterCategory,
      selectedSegmentIds,
      this.handlers.onSegmentClick,
      this.handlers.onSegmentDoubleClick,
      () => this.lastDragEndTime,
      () => this.activeDrag.type === 'idle' || this.activeDrag.type === 'pendingSegment',
    )
    const parent = free.groupId
      ? this.groupViews.get(free.groupId)?.root ?? this.worldLayer
      : this.worldLayer
    parent.addChild(root)
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
      this.lastPointerPosition = { clientX, clientY }
      this.startAutoPanLoop()
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
  ): { type: 'reorder'; groupId: string; index: number; lineY: number }
    | { type: 'absolute'; groupId: string }
    | { type: 'contain'; targetNodeId: string }
    | null {
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
        return { type: 'contain', targetNodeId: node.id }
      }
    }

    const groups = Object.values(this.currentScene.groups ?? {})
    let target: SceneGroupVM | null = null
    for (let i = groups.length - 1; i >= 0; i -= 1) {
      const g = groups[i]
      if (!g) continue
      const dims = this.getGroupDisplayDimensions(g)
      if (worldX >= g.x && worldX <= g.x + dims.width && worldY >= g.y && worldY <= g.y + dims.height) {
        target = g
        break
      }
    }
    if (!target) return null
    if (resolveNodeGroupDropMode(target.listViewEnabled) === 'absolute') {
      return { type: 'absolute', groupId: target.id }
    }

    const candidateIds = target.nodeIds.filter((id) => !nodeIds.includes(id))
    let index = candidateIds.length
    for (let i = 0; i < candidateIds.length; i += 1) {
      const n = this.currentScene.nodes[candidateIds[i]]
      if (!n) continue
      const nPos = this.getNodeDisplayPosition(n)
      const nDims = this.getNodeDisplayDimensions(n)
      if (worldY < nPos.y + nDims.height / 2) {
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
    drop: { type: 'reorder'; groupId: string; lineY: number },
  ): void {
    const indicator = this.groupDropIndicator
    if (!this.currentScene) return
    indicator.clear()
    this.groupLayer.addChild(indicator)
    const group = this.currentScene.groups[drop.groupId]
    if (!group) return
    const dims = this.getGroupDisplayDimensions(group)
    const x1 = group.x + 20
    const x2 = group.x + dims.width - 20
    indicator.moveTo(x1, drop.lineY)
    indicator.lineTo(x2, drop.lineY)
    indicator.stroke({ width: 3, color: 0xffffff, alpha: 0.95 })
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
        drag.targetContainNodeId = null
      } else if (drop.type === 'absolute') {
        drag.targetGroupId = drop.groupId
        drag.targetIndex = -1
        drag.targetNestParentNodeId = null
        drag.targetContainNodeId = null
      } else {
        drag.targetGroupId = null
        drag.targetIndex = 0
        drag.targetNestParentNodeId = null
        drag.targetContainNodeId = drop.targetNodeId
      }
      if (drop.type === 'reorder') this.drawGroupDropIndicator(drop)
      else this.groupDropIndicator.clear()
    } else {
      this.groupDropIndicator.clear()
      drag.targetGroupId = null
      drag.targetNestParentNodeId = null
      drag.targetContainNodeId = null
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
            drag.targetContainNodeId = null
          } else if (finalDrop.type === 'absolute') {
            drag.targetGroupId = finalDrop.groupId
            drag.targetIndex = -1
            drag.targetNestParentNodeId = null
            drag.targetContainNodeId = null
          } else {
            drag.targetGroupId = null
            drag.targetIndex = 0
            drag.targetNestParentNodeId = null
            drag.targetContainNodeId = finalDrop.targetNodeId
          }
        }
      }
    }
    drag.handleView.cursor = 'grab'
    this.groupDropIndicator.clear()
    this.skipNodeAnimationOnce.clear()
    const operationNodeIds = drag.operationNodeIds.length > 0 ? drag.operationNodeIds : [drag.nodeIds[0]]
    const isSingleOp = operationNodeIds.length === 1
    const isNoOp = !isSingleOp
      ? false
      : drag.targetContainNodeId
      ? drag.targetContainNodeId === operationNodeIds[0]
      : drag.targetNestParentNodeId
      ? drag.targetNestParentNodeId === drag.originalNestParentId
      : drag.targetGroupId != null
        ? (drag.targetIndex >= 0 && drag.targetGroupId === drag.originalGroupId && drag.targetIndex === drag.originalIndex)
        : false
    console.info('[pixi node] drag finish decision', {
      nodeId: drag.nodeIds[0],
      targetNestParentNodeId: drag.targetNestParentNodeId,
      targetGroupId: drag.targetGroupId,
      targetIndex: drag.targetIndex,
      originalNestParentId: drag.originalNestParentId,
      originalGroupId: drag.originalGroupId,
      originalIndex: drag.originalIndex,
      isNoOp,
      hasFinalPointer: finalClientX != null && finalClientY != null,
    })
    if (isNoOp && this.currentScene) {
      this.recomputeDisplayFlow(this.currentScene)
      for (const nodeId of drag.nodeIds) {
        const view = this.nodeViews.get(nodeId)
        const node = this.currentScene.nodes[nodeId]
        if (view && node) {
          const pos = this.getNodeDisplayPosition(node)
          view.root.position.set(pos.x, pos.y)
        }
      }
    } else if (drag.targetContainNodeId && this.handlers.onDropNodeIntoNode) {
      drag.nodeIds.forEach((nodeId) => this.skipNodeAnimationOnce.add(nodeId))
      operationNodeIds
        .filter((nodeId) => nodeId !== drag.targetContainNodeId)
        .forEach((nodeId) => this.handlers.onDropNodeIntoNode?.(nodeId, drag.targetContainNodeId!))
    } else if (drag.targetNestParentNodeId && this.handlers.onNestNodeUnder) {
      drag.nodeIds.forEach((nodeId) => this.skipNodeAnimationOnce.add(nodeId))
      console.info('[pixi node] dispatch onNestNodeUnder', {
        nodeIds: operationNodeIds,
        parentNodeId: drag.targetNestParentNodeId,
      })
      operationNodeIds
        .filter((nodeId) => nodeId !== drag.targetNestParentNodeId)
        .forEach((nodeId) => this.handlers.onNestNodeUnder?.(nodeId, drag.targetNestParentNodeId!))
    } else if (drag.targetGroupId && drag.targetIndex < 0 && this.handlers.onMoveNodeInGroup && finalClientX != null && finalClientY != null) {
      drag.nodeIds.forEach((nodeId) => this.skipNodeAnimationOnce.add(nodeId))
      operationNodeIds.forEach((nodeId) => {
        const view = this.nodeViews.get(nodeId)
        if (!view) return
        this.handlers.onMoveNodeInGroup?.(nodeId, drag.targetGroupId!, view.root.position.x, view.root.position.y)
      })
    } else if (drag.targetGroupId && this.handlers.onMoveNodeToGroupIndex) {
      drag.nodeIds.forEach((nodeId) => this.skipNodeAnimationOnce.add(nodeId))
      console.info('[pixi node] dispatch onMoveNodeToGroupIndex', {
        nodeIds: operationNodeIds,
        groupId: drag.targetGroupId,
        index: drag.targetIndex,
      })
      operationNodeIds.forEach((nodeId, idx) => {
        this.handlers.onMoveNodeToGroupIndex?.(nodeId, drag.targetGroupId!, drag.targetIndex + idx)
      })
    } else if (finalClientX != null && finalClientY != null && this.handlers.onMoveNodeToRoot) {
      drag.nodeIds.forEach((nodeId) => this.skipNodeAnimationOnce.add(nodeId))
      console.info('[pixi node] dispatch onMoveNodeToRoot', {
        nodeIds: operationNodeIds,
      })
      operationNodeIds.forEach((nodeId) => {
        const view = this.nodeViews.get(nodeId)
        if (!view) return
        this.handlers.onMoveNodeToRoot?.(nodeId, view.root.position.x, view.root.position.y)
      })
    }
    this.endDrag()
  }

  private updateConnectorDrag(clientX: number, clientY: number): void {
    if (this.activeDrag.type !== 'connector' || !this.currentScene) return
    const drag = this.activeDrag.state
    const world = this.screenToWorld(clientX, clientY)
    this.connectorDragLine.clear()
    this.connectorDragLine.moveTo(drag.fromX, drag.fromY)
    this.connectorDragLine.lineTo(world.x, world.y)
    this.connectorDragLine.stroke({ width: 2, color: 0x9ecfff, alpha: 0.95 })
    let targetNodeId: string | null = null
    for (const node of Object.values(this.currentScene.nodes)) {
      if (node.id === drag.nodeId) continue
      const pos = this.getNodeDisplayPosition(node)
      const dims = this.getNodeDisplayDimensions(node)
      if (world.x >= pos.x && world.x <= pos.x + dims.width && world.y >= pos.y && world.y <= pos.y + dims.height) {
        targetNodeId = node.id
      }
    }
    drag.targetNodeId = targetNodeId
  }

  private finishConnectorDrag(finalClientX: number, finalClientY: number): void {
    if (this.activeDrag.type !== 'connector') return
    this.updateConnectorDrag(finalClientX, finalClientY)
    const drag = this.activeDrag.state
    if (drag.targetNodeId && this.handlers.onConnectNodeParent) {
      this.handlers.onConnectNodeParent(drag.nodeId, drag.targetNodeId)
    }
    this.connectorDragLine.clear()
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
    this.stopAutoPanLoop()
    this.setSegmentDragHoveredGroup(null)
    this.connectorDragLine.clear()
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
    const liveGroupIds = new Set(Object.keys(scene.groups ?? {}))
    for (const groupId of this.groupExpandedState.keys()) {
      if (!liveGroupIds.has(groupId)) this.groupExpandedState.delete(groupId)
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
    Object.values(scene.groups ?? {}).forEach((group) => {
      this.groupViews.set(group.id, this.createGroup(group))
    })
    Object.values(scene.freeSegments ?? {}).forEach((free) => {
      this.freeSegmentViews.set(
        free.id,
        this.createFreeSegment(free, scene.hoveredSegmentId ?? null, filterCategory, selectedSegmentIds),
      )
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
    this.rebuildFreeSegments(scene)
  }

  private rebuildFreeSegments(scene: SceneVM): void {
    for (const [, view] of this.freeSegmentViews) {
      view.root.parent?.removeChild(view.root)
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
    for (const [, view] of this.groupViews) {
      if (view.clipWidthSpring && view.clipHeightSpring && view.contentClip) {
        const widthActive = updateSpring1D(view.clipWidthSpring, dt)
        const heightActive = updateSpring1D(view.clipHeightSpring, dt)
        if (widthActive || heightActive) anyActive = true
        drawNodeClipMask(view.contentClip, view.clipWidthSpring.value, view.clipHeightSpring.value)
        if (!view.clipWidthSpring.active && !view.clipHeightSpring.active) {
          const onComplete = view.onClipAnimationComplete
          if (onComplete) {
            ;(view as GroupView).onClipAnimationComplete = undefined
            ;(view as GroupView).clipWidthSpring = undefined
            ;(view as GroupView).clipHeightSpring = undefined
            completedTransitions.push(onComplete)
          } else {
            view.root.mask = null
            view.root.removeChild(view.contentClip)
            view.contentClip.destroy()
            ;(view as GroupView).clipWidthSpring = undefined
            ;(view as GroupView).clipHeightSpring = undefined
            ;(view as GroupView).contentClip = undefined
          }
        }
      }
    }
    this.drawNestConnectors()
    this.updateSelectionOverlay()
    if (completedTransitions.length > 0) anyActive = true
    for (const done of completedTransitions) done()
    if (!anyActive) {
      this.app.ticker.remove(this.springTickerBound)
    }
  }

  private drawNestConnectors(): void {
    if (!this.currentScene) return
    this.nestConnectorGraphics.clear()
    const CONNECTOR_COLOR = 0x5cadee
    const CONNECTOR_ALPHA = 0.6
    const CONNECTOR_WIDTH = 2
    for (const [nodeId, view] of this.nodeViews) {
      const node = this.currentScene.nodes[nodeId]
      const parentId = node?.parentNodeId
      if (!parentId) continue
      const parentView = this.nodeViews.get(parentId)
      if (!parentView) continue
      const px = parentView.root.position.x
      const py = parentView.root.position.y
      const ph = parentView.totalHeight
      const cx = view.root.position.x
      const cy = view.root.position.y
      const parentBottom = py + ph
      const childTop = cy
      const midY = (parentBottom + childTop) / 2
      const branchX = (px + cx) / 2
      this.nestConnectorGraphics.moveTo(branchX, parentBottom)
      this.nestConnectorGraphics.lineTo(branchX, midY)
      this.nestConnectorGraphics.lineTo(cx, midY)
      this.nestConnectorGraphics.lineTo(cx, childTop)
      this.nestConnectorGraphics.stroke({ width: CONNECTOR_WIDTH, color: CONNECTOR_COLOR, alpha: CONNECTOR_ALPHA })
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
    return expanded ? Math.max(node.slotCount, node.slotCols * node.slotRows) : collapsedVisibleSlotCount(node.segments, node.slotCount)
  }

  private getNodeDisplayDimensionsForExpanded(
    node: SceneNodeVM,
    expanded: boolean,
  ): { width: number; height: number } {
    const visibleSlotCount = expanded
      ? Math.max(node.slotCount, node.slotCols * node.slotRows)
      : collapsedVisibleSlotCount(node.segments, node.slotCount)
    const totalMeterWidth = expanded
      ? meterWidthForCols(node.slotCols)
      : meterWidthForSlots(visibleSlotCount)
    return {
      width: SLOT_START_X + totalMeterWidth + 20,
      height: TOP_BAND_H + (expanded ? slotAreaHeightForRows(node.slotRows) : slotAreaHeightForSlots(visibleSlotCount)) + NODE_BOTTOM_PADDING,
    }
  }

  private getNodeDisplayDimensions(node: SceneNodeVM): { width: number; height: number } {
    return this.getNodeDisplayDimensionsForExpanded(node, this.isNodeExpanded(node.id))
  }

  private recomputeDisplayFlow(scene: SceneVM): void {
    this.nodeDisplayOffsetY.clear()
    this.groupDisplayHeights.clear()
    for (const group of Object.values(scene.groups ?? {})) {
      if (group.listViewEnabled) {
        let yOffset = 0
        for (const nodeId of group.nodeIds) {
          const node = scene.nodes[nodeId]
          if (!node) continue
          this.nodeDisplayOffsetY.set(node.id, yOffset)
          const dims = this.getNodeDisplayDimensions(node)
          yOffset += dims.height - node.height
        }
      } else {
        for (const nodeId of group.nodeIds) {
          this.nodeDisplayOffsetY.set(nodeId, 0)
        }
      }
      if (this.isGroupExpanded(group.id)) {
        this.groupDisplayHeights.set(group.id, group.height)
      } else {
        const collapsed = this.getGroupCollapsedDimensions(group)
        this.groupDisplayHeights.set(group.id, collapsed.height)
      }
    }
  }

  private getNodeDisplayPosition(node: SceneNodeVM): { x: number; y: number } {
    return { x: node.x, y: node.y + (this.nodeDisplayOffsetY.get(node.id) ?? 0) }
  }

  private isGroupExpanded(groupId: string): boolean {
    return this.groupExpandedState.get(groupId) === true
  }

  private setGroupExpanded(groupId: string, expanded: boolean): void {
    if (!this.currentScene) return
    const group = this.currentScene.groups?.[groupId]
    const view = this.groupViews.get(groupId)
    if (!group || !view) {
      this.groupExpandedState.set(groupId, expanded)
      this.rebuildGroups(this.currentScene)
      this.startSpringTicker()
      return
    }

    if (expanded) {
      this.groupExpandedState.set(groupId, true)
      this.recomputeDisplayFlow(this.currentScene)
      this.rebuildGroups(this.currentScene)
      this.startSpringTicker()
      return
    }

    const targetDims = this.getGroupCollapsedDimensions(group)
    const currentWidth = view.clipWidthSpring?.value ?? this.getGroupDisplayDimensions(group).width
    const currentHeight = view.clipHeightSpring?.value ?? this.getGroupDisplayDimensions(group).height
    if (Math.abs(currentWidth - targetDims.width) <= 0.5 && Math.abs(currentHeight - targetDims.height) <= 0.5) {
      this.groupExpandedState.set(groupId, false)
      this.recomputeDisplayFlow(this.currentScene)
      this.rebuildGroups(this.currentScene)
      this.startSpringTicker()
      return
    }

    this.groupExpandedState.set(groupId, false)
    this.recomputeDisplayFlow(this.currentScene)
    let clip = view.contentClip
    if (!clip) {
      clip = new Graphics()
      clip.eventMode = 'none'
      drawNodeClipMask(clip, currentWidth, currentHeight)
      view.root.addChildAt(clip, 0)
      view.root.mask = clip
      ;(view as GroupView).contentClip = clip
    }
    const widthSpring = createSpring1D(currentWidth)
    const heightSpring = createSpring1D(currentHeight)
    setSpring1DTarget(widthSpring, targetDims.width)
    setSpring1DTarget(heightSpring, targetDims.height)
    ;(view as GroupView).clipWidthSpring = widthSpring
    ;(view as GroupView).clipHeightSpring = heightSpring
    ;(view as GroupView).onClipAnimationComplete = () => {
      if (!this.currentScene) return
      this.rebuildGroups(this.currentScene)
      this.startSpringTicker()
    }
    this.startSpringTicker()
  }

  private getGroupContentMinDimensions(group: SceneGroupVM): { width: number; height: number } {
    if (!this.currentScene) return { width: group.width, height: group.height }
    let nodeWidth = 0
    let nodeHeight = 0
    if (group.nodeIds.length > 0) {
      if (group.listViewEnabled) {
        const nodeIdsInGroup = new Set(group.nodeIds)
        const childrenByParent = new Map<string, string[]>()
        for (const nodeId of group.nodeIds) {
          const node = this.currentScene.nodes[nodeId]
          const parentId = node?.parentNodeId
          if (!parentId || !nodeIdsInGroup.has(parentId)) continue
          const siblings = childrenByParent.get(parentId) ?? []
          siblings.push(nodeId)
          childrenByParent.set(parentId, siblings)
        }
        const orderedRoots = group.nodeIds.filter((nodeId) => {
          const parentId = this.currentScene!.nodes[nodeId]?.parentNodeId
          return !parentId || !nodeIdsInGroup.has(parentId)
        })
        let maxNodeW = 0
        let cursorY = group.y + GROUP_PADDING_TOP
        const layoutSubtree = (nodeId: string, depth: number): void => {
          const node = this.currentScene!.nodes[nodeId]
          if (!node) return
          const dims = this.getNodeDisplayDimensions(node)
          const indentPx = depth * NODE_INDENT
          maxNodeW = Math.max(maxNodeW, dims.width + indentPx)
          cursorY += dims.height + NODE_ROW_GAP
          const children = childrenByParent.get(nodeId) ?? []
          children.forEach((childId) => layoutSubtree(childId, depth + 1))
        }
        orderedRoots.forEach((rootId) => layoutSubtree(rootId, 0))
        nodeWidth = maxNodeW + GROUP_PADDING_X * 2
        nodeHeight = cursorY - NODE_ROW_GAP - group.y + GROUP_PADDING_BOTTOM
      } else {
        let maxNodeRight = 0
        let maxNodeBottom = 0
        for (const nodeId of group.nodeIds) {
          const node = this.currentScene.nodes[nodeId]
          if (!node) continue
          const pos = this.getNodeDisplayPosition(node)
          const dims = this.getNodeDisplayDimensions(node)
          maxNodeRight = Math.max(maxNodeRight, pos.x - group.x + dims.width)
          maxNodeBottom = Math.max(maxNodeBottom, pos.y - group.y + dims.height)
        }
        nodeWidth = maxNodeRight + GROUP_PADDING_X
        nodeHeight = maxNodeBottom + GROUP_PADDING_BOTTOM
      }
    }

    let segmentWidth = 0
    let segmentHeight = 0
    for (const segmentId of group.freeSegmentIds) {
      const free = this.currentScene.freeSegments[segmentId]
      if (!free) continue
      const bounds = segmentBoundsInNodeLocal(free.segment)
      const right = free.x + bounds.x - SLOT_START_X + bounds.w
      const bottom = free.y + bounds.y - TOP_BAND_H + bounds.h
      segmentWidth = Math.max(segmentWidth, right + GROUP_PADDING_X)
      segmentHeight = Math.max(segmentHeight, bottom + GROUP_PADDING_BOTTOM)
    }
    return {
      width: Math.max(EMPTY_GROUP_MIN_WIDTH, nodeWidth, segmentWidth),
      height: Math.max(EMPTY_GROUP_MIN_HEIGHT, nodeHeight, segmentHeight),
    }
  }

  private getGroupCollapsedDimensions(group: SceneGroupVM): { width: number; height: number } {
    if (!this.currentScene) return { width: group.width, height: group.height }
    if (!group.listViewEnabled) {
      return this.getGroupContentMinDimensions(group)
    }
    const nodeIdsInGroup = new Set(group.nodeIds)
    const childrenByParent = new Map<string, string[]>()
    for (const nodeId of group.nodeIds) {
      const node = this.currentScene.nodes[nodeId]
      const parentId = node?.parentNodeId
      if (!parentId || !nodeIdsInGroup.has(parentId)) continue
      const siblings = childrenByParent.get(parentId) ?? []
      siblings.push(nodeId)
      childrenByParent.set(parentId, siblings)
    }
    const orderedRoots = group.nodeIds.filter((nodeId) => {
      const parentId = this.currentScene!.nodes[nodeId]?.parentNodeId
      return !parentId || !nodeIdsInGroup.has(parentId)
    })

    let maxNodeRight = 0
    let cursorY = group.y + GROUP_PADDING_TOP
    const layoutSubtree = (nodeId: string, depth: number): void => {
      const node = this.currentScene!.nodes[nodeId]
      if (!node) return
      const dims = this.getNodeDisplayDimensions(node)
      const indentPx = depth * NODE_INDENT
      const nodeRight = group.x + GROUP_PADDING_X + indentPx + dims.width
      maxNodeRight = Math.max(maxNodeRight, nodeRight)
      cursorY += dims.height + NODE_ROW_GAP
      const children = childrenByParent.get(nodeId) ?? []
      children.forEach((childId) => layoutSubtree(childId, depth + 1))
    }
    for (const rootId of orderedRoots) layoutSubtree(rootId, 0)

    const hasNodes = orderedRoots.length > 0
    if (!hasNodes) {
      if (group.freeSegmentIds.length > 0) {
        let maxX = 0
        let maxY = 0
        for (const segmentId of group.freeSegmentIds) {
          const free = this.currentScene.freeSegments[segmentId]
          if (!free) continue
          const bounds = segmentBoundsInNodeLocal(free.segment)
          const right = free.x + bounds.x - SLOT_START_X + bounds.w
          const bottom = free.y + bounds.y - TOP_BAND_H + bounds.h
          maxX = Math.max(maxX, right)
          maxY = Math.max(maxY, bottom)
        }
        return {
          width: Math.max(EMPTY_GROUP_MIN_WIDTH, maxX + GROUP_PADDING_X),
          height: Math.max(EMPTY_GROUP_MIN_HEIGHT, maxY + GROUP_PADDING_BOTTOM),
        }
      }
      return { width: EMPTY_GROUP_MIN_WIDTH, height: EMPTY_GROUP_MIN_HEIGHT }
    }
    const width = maxNodeRight - group.x + GROUP_PADDING_X
    const height = cursorY - NODE_ROW_GAP - group.y + GROUP_PADDING_BOTTOM
    return { width: Math.max(40, width), height: Math.max(40, height) }
  }

  private getGroupDisplayDimensions(group: SceneGroupVM): { width: number; height: number } {
    if (this.isGroupExpanded(group.id)) {
      const contentMin = this.getGroupContentMinDimensions(group)
      return {
        width: Math.max(group.width, contentMin.width),
        height: Math.max(
          this.groupDisplayHeights.get(group.id) ?? group.height,
          contentMin.height,
        ),
      }
    }
    return this.getGroupCollapsedDimensions(group)
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

  private setSegmentDragHoveredGroup(groupId: string | null): void {
    if (this.segmentDragHoveredGroupId === groupId) return
    this.segmentDragHoveredGroupId = groupId
    for (const [id, view] of this.groupViews.entries()) {
      view.hoverOutline.visible = groupId === id
    }
  }
}

