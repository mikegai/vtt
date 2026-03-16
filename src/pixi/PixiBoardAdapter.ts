import { Application, Assets, BitmapText, Color, Container, Graphics } from 'pixi.js'
import type { SceneNodeVM, ScenePatch, SceneVM, SceneSegmentVM } from '../worker/protocol'

type AdapterHandlers = {
  onHoverSegment(segmentId: string | null): void
  onMoveNode(nodeId: string, x: number, y: number): void
  onZoomChange(zoom: number): void
}

type NodeView = {
  readonly root: Container
}

type SegmentDragState = {
  readonly segment: SceneSegmentVM
  readonly sourceNodeId: string
  readonly ghost: Container
  snap: { nodeId: string; startSixth: number } | null
}

type ZoomTier = 'far' | 'medium' | 'close'

const STONE_GAP = 3
const STONE_W = 36
const STONE_H = 54
const SIXTH_ROWS = 6
const CELL_H = STONE_H / SIXTH_ROWS
const METER_X = 148
const METER_Y = 34
const SLOT_COUNT = 20
const ROW_H = 100

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

const selectLabelFit = (
  segment: SceneSegmentVM,
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

  // apparentScale = how many screen pixels per font-size unit.
  // Use it only for the MINIMUM threshold (readability floor).
  // maxFontSize is capped by what fits in the world-space box, not by zoom.
  const apparentScale = Math.max(0.01, visualScale * zoom)
  const minFontSize = Math.max(1, Math.ceil(minVisiblePx / apparentScale))
  const maxFontSize = Math.max(minFontSize, Math.floor(maxVisiblePx / visualScale))

  const widthBucket = Math.max(0, Math.round(availableWorldWidth))
  const heightBucket = Math.max(0, Math.round(availableWorldHeight))
  const scaleBucket = Math.round(visualScale * 100)
  const zoomBucket = Math.round(zoom * 100)
  const cacheKey = `${segment.tooltip.title}|${segment.fullLabel}|${segment.mediumLabel}|${segment.shortLabel}|${tier}|${gridCols}|${widthBucket}|${heightBucket}|${scaleBucket}|${zoomBucket}|${minFontSize}|${maxFontSize}`
  const cached = textFitCache.get(cacheKey)
  if (cached) return cached

  const steps = uniqueTextSteps(segment)
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

const TOTAL_SIXTHS = SLOT_COUNT * 6
const METER_WIDTH = SLOT_COUNT * (STONE_W + STONE_GAP) - STONE_GAP

const isMultiStone = (segment: SceneSegmentVM): boolean =>
  segment.sizeSixths >= 6 && segment.sizeSixths % 6 === 0

const isBookLikeChainable = (segment: SceneSegmentVM): boolean => {
  const title = segment.tooltip.title.toLowerCase()
  if (!title.includes('book')) return false
  return title.includes('holy') || title.includes('spell')
}

const stoneToX = (stoneIndex: number): number => stoneIndex * (STONE_W + STONE_GAP)

const sixthToCellLocal = (sixthIndex: number): { x: number; y: number } => {
  const clamped = Math.max(0, Math.min(TOTAL_SIXTHS, sixthIndex))
  const stone = Math.floor(clamped / 6)
  const row = clamped % 6
  return {
    x: stoneToX(stone),
    y: row * CELL_H,
  }
}

const segmentStoneSpan = (startSixth: number, sizeSixths: number): { startStone: number; endStone: number } => {
  const startStone = Math.floor(startSixth / 6)
  const endStone = Math.max(startStone + 1, Math.ceil((startSixth + sizeSixths) / 6))
  return { startStone, endStone }
}

const occupiedSixthsFromSegments = (segments: readonly SceneSegmentVM[]): Set<number> => {
  const occupied = new Set<number>()
  segments.forEach((segment) => {
    if (segment.isOverflow) return
    const start = Math.max(0, segment.startSixth)
    const endExclusive = Math.min(TOTAL_SIXTHS, segment.startSixth + segment.sizeSixths)
    for (let idx = start; idx < endExclusive; idx += 1) {
      occupied.add(idx)
    }
  })
  return occupied
}

const localToSixth = (localX: number, localY: number): number => {
  if (localX <= 0) return 0
  const maxLocal = stoneToX(SLOT_COUNT)
  if (localX >= maxLocal) return TOTAL_SIXTHS

  for (let stone = 0; stone < SLOT_COUNT; stone += 1) {
    const stoneStart = stoneToX(stone)
    const stoneEnd = stoneStart + STONE_W
    if (localX >= stoneStart && localX < stoneEnd) {
      const row = Math.max(0, Math.min(5, Math.floor(localY / CELL_H)))
      return stone * 6 + row
    }
    if (localX >= stoneEnd && localX < stoneStart + STONE_W + STONE_GAP) {
      return (stone + 1) * 6
    }
  }
  return TOTAL_SIXTHS
}

const drawMultiItemChain = (
  container: Container,
  startSixth: number,
  baseX: number,
  baseY: number,
  sizeSixths: number,
  color: number,
  alpha: number,
  connectEdges: boolean,
  compactCells: boolean,
): void => {
  let previousCenter: { x: number; y: number } | null = null
  for (let i = 0; i < sizeSixths; i += 1) {
    const slot = sixthToCellLocal(startSixth + i)
    const x = baseX + slot.x
    const y = baseY + slot.y
    const cellGraphic = new Graphics()
    const padX = compactCells ? 4.2 : 1.2
    const padY = compactCells ? 2.1 : 0.6
    cellGraphic.roundRect(x + padX, y + padY, STONE_W - padX * 2, CELL_H - padY * 2, 1.8)
    cellGraphic.fill({ color, alpha })
    container.addChild(cellGraphic)

    const centerX = x + STONE_W / 2
    const centerY = y + CELL_H / 2
    if (connectEdges && previousCenter) {
      const edge = new Graphics()
      edge.setStrokeStyle({ width: 1.2, color, alpha: Math.min(1, alpha + 0.15) })
      edge.moveTo(previousCenter.x, previousCenter.y)
      edge.lineTo(centerX, centerY)
      edge.stroke()
      container.addChild(edge)
    }
    previousCenter = { x: centerX, y: centerY }
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
  onTooltipEnter?: (segment: SceneSegmentVM, globalX: number, globalY: number) => void,
  onTooltipMove?: (globalX: number, globalY: number) => void,
  onTooltipLeave?: () => void,
  nodeId?: string,
  onDragStart?: (segment: SceneSegmentVM, nodeId: string, x: number, y: number) => void,
): void => {
  const { startStone, endStone } = segmentStoneSpan(segment.startSixth, segment.sizeSixths)
  const startX = METER_X + stoneToX(startStone)
  const width = (endStone - startStone) * (STONE_W + STONE_GAP) - STONE_GAP
  const color = segment.isOverflow ? 0x932d4e : hovered ? 0x5cadee : 0x3d9ac9
  const alpha = segment.isOverflow ? 0.58 : 0.82
  const useConnectedChain = !isMultiStone(segment) && isBookLikeChainable(segment)

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
      event.stopPropagation()
      onTooltipLeave?.()
      onDragStart(segment, nodeId, event.global.x, event.global.y)
    })
  }

  if (isMultiStone(segment)) {
    block.roundRect(startX + 0.5, METER_Y + 2.5, width - 1, STONE_H - 5, 5)
    block.fill({ color, alpha })
    container.addChild(block)
  } else {
    drawMultiItemChain(
      container,
      segment.startSixth,
      METER_X,
      METER_Y,
      segment.sizeSixths,
      color,
      alpha,
      useConnectedChain,
      !useConnectedChain,
    )
    const first = sixthToCellLocal(segment.startSixth)
    const last = sixthToCellLocal(segment.startSixth + segment.sizeSixths - 1)
    const hitX = METER_X + Math.min(first.x, last.x)
    const hitY = METER_Y + Math.min(first.y, last.y)
    const hitW = Math.max(first.x, last.x) + STONE_W - Math.min(first.x, last.x)
    const hitH = Math.max(first.y, last.y) + CELL_H - Math.min(first.y, last.y)
    block.rect(hitX, hitY, hitW, hitH)
    block.fill({ color: 0xffffff, alpha: 0.001 })
    container.addChild(block)
  }

  if (segment.sizeSixths >= 1) {
    let availableWorldWidth = Math.max(8, width - 6)
    let availableWorldHeight = Math.max(8, STONE_H - 8)
    let centerX = startX + width / 2
    let centerY = METER_Y + STONE_H / 2
    if (!isMultiStone(segment)) {
      const first = sixthToCellLocal(segment.startSixth)
      const last = sixthToCellLocal(segment.startSixth + segment.sizeSixths - 1)
      const minX = METER_X + Math.min(first.x, last.x)
      const maxX = METER_X + Math.max(first.x, last.x) + STONE_W
      const minY = METER_Y + Math.min(first.y, last.y)
      const maxY = METER_Y + Math.max(first.y, last.y) + CELL_H
      centerX = (minX + maxX) / 2
      centerY = (minY + maxY) / 2
      availableWorldWidth = Math.max(8, maxX - minX - 6)
      availableWorldHeight = Math.max(8, maxY - minY - 6)
    }
    const zoomReadableScale = zoom < 0.45 ? 1.14 : 1
    const visualScale = textCompensationScale * zoomReadableScale
    const fit = selectLabelFit(
      segment,
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
    txt.scale.set(visualScale)
    txt.anchor.set(0.5, 0.5)

    txt.position.set(centerX, centerY)

    const clip = new Graphics()
    clip.rect(centerX - availableWorldWidth / 2, centerY - availableWorldHeight / 2, availableWorldWidth, availableWorldHeight)
    clip.fill({ color: 0xffffff, alpha: 0.001 })
    container.addChild(clip)
    txt.mask = clip
    container.addChild(txt)
  }
}

export class PixiBoardAdapter {
  private app: Application
  private sceneRoot: Container
  private worldLayer: Container
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
  private minVisibleLabelPx = DEFAULT_MIN_VISIBLE_PX
  private readonly maxVisibleLabelPx = DEFAULT_MAX_VISIBLE_PX
  private fontsLoaded = false

  constructor(host: HTMLElement, handlers: AdapterHandlers) {
    this.handlers = handlers
    this.app = new Application()
    this.sceneRoot = new Container()
    this.worldLayer = new Container()
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
    this.app.canvas.addEventListener('contextmenu', (event) => event.preventDefault())

    this.sceneRoot.addChild(this.worldLayer)
    this.app.stage.addChild(this.sceneRoot)
    this.hudLayer.addChild(this.paceText)
    this.tooltipLayer.addChild(this.tooltipBg)
    this.tooltipLayer.addChild(this.tooltipText)
    this.tooltipLayer.visible = false
    this.hudLayer.addChild(this.tooltipLayer)
    this.app.stage.addChild(this.hudLayer)
    this.paceText.position.set(16, 12)

    this.setupPanZoom()
    this.applyCamera()

    if (this.currentScene) this.rebuildAllNodes(this.currentScene)
  }

  private setupPanZoom(): void {
    let panning = false
    let last = { x: 0, y: 0 }

    const onDown = (event: PointerEvent): void => {
      if (event.button === 1 || event.button === 2) {
        panning = true
        last = { x: event.clientX, y: event.clientY }
      }
    }

    const onUp = (): void => {
      panning = false
      if (this.segmentDrag) this.endSegmentDrag()
    }

    const onMove = (event: PointerEvent): void => {
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

  private screenToWorld(clientX: number, clientY: number): { x: number; y: number } {
    return {
      x: (clientX - this.pan.x) / this.zoom,
      y: (clientY - this.pan.y) / this.zoom,
    }
  }

  private findSnapTarget(worldX: number, worldY: number, segment: SceneSegmentVM): { nodeId: string; startSixth: number } | null {
    if (!this.currentScene) return null

    for (const node of Object.values(this.currentScene.nodes)) {
      const inY = worldY >= node.y + METER_Y && worldY <= node.y + METER_Y + STONE_H
      if (!inY) continue
      const localX = worldX - node.x - METER_X
      const localY = worldY - node.y - METER_Y
      if (localX < -STONE_W || localX > METER_WIDTH + STONE_W) continue

      let startSixth = localToSixth(localX, localY)
      if (isMultiStone(segment)) {
        startSixth = Math.floor(startSixth / 6) * 6
      }
      const maxStart = Math.max(0, TOTAL_SIXTHS - segment.sizeSixths)
      startSixth = Math.max(0, Math.min(maxStart, startSixth))
      return { nodeId: node.id, startSixth }
    }
    return null
  }

  private buildDragGhost(segment: SceneSegmentVM): Container {
    const ghost = new Container()
    const color = segment.isOverflow ? 0xa83f62 : isMultiStone(segment) ? 0x61b5ff : 0x7bd7cf
    const alpha = 0.56

    if (isMultiStone(segment)) {
      const w = (segment.sizeSixths / 6) * (STONE_W + STONE_GAP) - STONE_GAP
      const rect = new Graphics()
      rect.roundRect(0, 0, w, STONE_H, 6)
      rect.fill({ color, alpha })
      rect.stroke({ width: 1, color: 0xd3ebff, alpha: 0.7 })
      ghost.addChild(rect)
    } else {
      drawMultiItemChain(ghost, 0, 0, 0, segment.sizeSixths, color, alpha, isBookLikeChainable(segment), !isBookLikeChainable(segment))
      const stroke = new Graphics()
      const span = segmentStoneSpan(0, segment.sizeSixths)
      const w = (span.endStone - span.startStone) * (STONE_W + STONE_GAP) - STONE_GAP
      stroke.roundRect(0, 0, Math.max(STONE_W, w), STONE_H, 4)
      stroke.stroke({ width: 1, color: 0xd3ebff, alpha: 0.65 })
      ghost.addChild(stroke)
    }

    return ghost
  }

  private beginSegmentDrag(segment: SceneSegmentVM, sourceNodeId: string, globalX: number, globalY: number): void {
    if (this.segmentDrag) this.endSegmentDrag()
    const ghost = this.buildDragGhost(segment)
    this.worldLayer.addChild(ghost)
    this.segmentDrag = { segment, sourceNodeId, ghost, snap: null }
    this.updateSegmentDrag(globalX, globalY)
  }

  private updateSegmentDrag(clientX: number, clientY: number): void {
    if (!this.segmentDrag) return
    const world = this.screenToWorld(clientX, clientY)
    const snap = this.findSnapTarget(world.x, world.y, this.segmentDrag.segment)
    this.segmentDrag.snap = snap

    if (snap && this.currentScene) {
      const node = this.currentScene.nodes[snap.nodeId]
      if (node) {
        const slot = sixthToCellLocal(snap.startSixth)
        const x = node.x + METER_X + slot.x
        const y = node.y + METER_Y + (isMultiStone(this.segmentDrag.segment) ? 0 : slot.y)
        this.segmentDrag.ghost.position.set(x, y)
        return
      }
    }
    this.segmentDrag.ghost.position.set(world.x, world.y - STONE_H / 2)
  }

  private endSegmentDrag(): void {
    if (!this.segmentDrag) return
    this.worldLayer.removeChild(this.segmentDrag.ghost)
    this.segmentDrag.ghost.destroy({ children: true })
    this.segmentDrag = null
  }

  private createNode(node: SceneNodeVM, hoveredSegmentId: string | null): NodeView {
    const tier = getZoomTier(this.zoom)
    const textCompensationScale = getTextCompensationScale(this.zoom)
    const root = new Container()
    root.eventMode = 'static'
    root.cursor = 'grab'

    const totalMeterWidth = METER_WIDTH
    const totalWidth = METER_X + totalMeterWidth + 20
    const totalHeight = ROW_H

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

    if (tier !== 'far') {
      const title = new BitmapText({
        text: node.title,
        style: { fill: '#e8f0ff', fontSize: 13, fontFamily: FONT_SEMIBOLD },
      })
      title.scale.set(textCompensationScale)
      title.position.set(16, 8)
      root.addChild(title)

      const meta = new BitmapText({
        text: `${node.speedFeet}' • ${node.usedStoneText} / ${node.capacityStoneText}`,
        style: { fill: '#8ba0ca', fontSize: 11, fontFamily: FONT_REGULAR },
      })
      meta.scale.set(textCompensationScale)
      meta.position.set(16, 24)
      root.addChild(meta)
    } else {
      const compact = new BitmapText({
        text: `${compactToken(node.title, 4)} ${node.speedFeet}'`,
        style: { fill: '#b0c2e8', fontSize: 11, fontFamily: FONT_REGULAR },
      })
      compact.scale.set(textCompensationScale)
      compact.position.set(16, 8)
      root.addChild(compact)
    }

    const occupiedSixths = occupiedSixthsFromSegments(node.segments)

    const slotFillLayer = new Graphics()
    const dimAlpha = tier === 'far' ? 0.1 : 0.14
    const brightAlpha = tier === 'far' ? 0.36 : 0.48
    for (let stone = 0; stone < SLOT_COUNT; stone += 1) {
      const sx = METER_X + stoneToX(stone)
      const slotBandColor = fixedSlotBandColor(stone, node.fixedGreenStoneSlots)
      for (let row = 0; row < SIXTH_ROWS; row += 1) {
        const sixth = stone * 6 + row
        const filled = occupiedSixths.has(sixth)
        const cy = METER_Y + row * CELL_H
        slotFillLayer.roundRect(sx + 1.6, cy + 0.8, STONE_W - 3.2, CELL_H - 1.6, 1.6)
        slotFillLayer.fill({
          color: slotBandColor,
          alpha: filled ? brightAlpha : dimAlpha,
        })
      }
    }
    root.addChild(slotFillLayer)

    const segmentContainer = new Container()
    node.segments.forEach((segment) => {
      const hovered = segment.id === hoveredSegmentId
      drawSegmentBlock(
        segmentContainer,
        segment,
        tier,
        this.zoom,
        hovered,
        this.handlers,
        textCompensationScale,
        this.minVisibleLabelPx,
        this.maxVisibleLabelPx,
        (seg, x, y) => this.showTooltip(seg, x, y),
        (x, y) => this.moveTooltip(x, y),
        () => this.hideTooltip(),
        node.id,
        (seg, nodeId, x, y) => this.beginSegmentDrag(seg, nodeId, x, y),
      )
    })
    root.addChild(segmentContainer)

    root.position.set(node.x, node.y)
    this.enableDrag(root, node.id)
    this.worldLayer.addChild(root)
    return { root }
  }

  private enableDrag(view: Container, nodeId: string): void {
    let dragging = false
    let offset = { x: 0, y: 0 }
    view.on('pointerdown', (event) => {
      if (event.button !== 0) return
      dragging = true
      const point = event.global
      offset = {
        x: (point.x - this.pan.x) / this.zoom - view.position.x,
        y: (point.y - this.pan.y) / this.zoom - view.position.y,
      }
      view.cursor = 'grabbing'
      event.stopPropagation()
    })
    const stop = (): void => {
      dragging = false
      view.cursor = 'grab'
    }
    view.on('pointerup', stop)
    view.on('pointerupoutside', stop)
    view.on('globalpointermove', (event) => {
      if (!dragging) return
      const point = event.global
      const x = (point.x - this.pan.x) / this.zoom - offset.x
      const y = (point.y - this.pan.y) / this.zoom - offset.y
      view.position.set(x, y)
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
    Object.values(scene.nodes).forEach((node) => {
      this.nodeViews.set(node.id, this.createNode(node, scene.hoveredSegmentId))
    })
  }

  applyInit(scene: SceneVM): void {
    this.currentScene = scene
    this.paceText.text = `Party ${scene.partyPaceText}`
    this.rebuildAllNodes(scene)
  }

  applyPatches(patches: readonly ScenePatch[], scene: SceneVM): void {
    this.currentScene = scene
    let needsFullRebuild = false
    patches.forEach((patch) => {
      if (patch.type === 'UPDATE_META') {
        this.paceText.text = `Party ${patch.partyPaceText}${patch.hoveredSegmentId ? `  hover: ${patch.hoveredSegmentId}` : ''}`
        if (patch.hoveredSegmentId !== null || (this.currentScene && this.currentScene.hoveredSegmentId !== null)) {
          needsFullRebuild = true
        }
        return
      }
      needsFullRebuild = true
    })
    if (needsFullRebuild) {
      this.rebuildAllNodes(scene)
    }
  }
}
