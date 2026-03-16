import type { ItemCategory } from '../domain/item-category'
import { SIXTHS_PER_STONE } from '../domain/types'
import { applyDropIntentToState } from '../vm/drop-intent'
import { buildBoardVM } from '../vm/vm'
import type { ActorRowVM } from '../vm/vm-types'
import type { CanonicalState } from '../domain/types'
import type { DropIntent } from './protocol'
import type { SceneFreeSegmentVM, SceneGroupVM, SceneNodeVM, SceneVM } from './protocol'

export type WorkerLocalState = {
  readonly hoveredSegmentId: string | null
  readonly groupPositions: Record<string, { x: number; y: number }>
  readonly nodeGroupOverrides: Record<string, string | null>
  readonly nodePositions: Record<string, { x: number; y: number }>
  readonly freeSegmentPositions: Record<string, { x: number; y: number }>
  readonly groupNodeOrders: Record<string, readonly string[]>
  readonly customGroups: Record<string, { title: string }>
  readonly dropIntent: DropIntent | null
  readonly stonesPerRow: number
  readonly filterCategory: ItemCategory | null
  readonly selectedSegmentIds: readonly string[]
  readonly labels: Record<string, { text: string; x: number; y: number }>
  readonly selectedLabelId: string | null
}

const STONE_W = 36
const STONE_GAP = 3
const STONE_H = 54
const STONE_ROW_GAP = 3
const SLOT_START_X = 10
const TOP_BAND_H = 34

const slotAreaHeightForSlots = (slotCount: number, stonesPerRow: number): number => {
  const numRows = Math.ceil(slotCount / stonesPerRow)
  return numRows * (STONE_H + STONE_ROW_GAP) - STONE_ROW_GAP
}

const meterWidthForSlots = (slotCount: number, stonesPerRow: number): number =>
  Math.min(slotCount, stonesPerRow) * (STONE_W + STONE_GAP) - STONE_GAP

const nodeHeightForSlots = (slotCount: number, stonesPerRow: number): number =>
  TOP_BAND_H + slotAreaHeightForSlots(slotCount, stonesPerRow)

const nodeWidthForSlots = (slotCount: number, stonesPerRow: number): number =>
  SLOT_START_X + meterWidthForSlots(slotCount, stonesPerRow) + 20

const GROUP_X = 80
const GROUP_STACK_GAP = 28
const NODE_ROW_GAP = 8
const GROUP_PADDING_X = 20
const GROUP_PADDING_TOP = 40
const GROUP_PADDING_BOTTOM = 18
const EMPTY_GROUP_MIN_WIDTH = 300
const EMPTY_GROUP_MIN_HEIGHT = 140
const NODE_INDENT = 24
const ROOT_NODE_X = 80
const ROOT_NODE_Y = 80
const ROOT_NODE_COL_GAP = 16
const ROOT_NODE_ROW_GAP = 16
const ROOT_NODE_MAX_W = 1800
const FREE_SEGMENT_STACK_GAP = 8

const flattenRows = (rows: readonly ActorRowVM[]): ActorRowVM[] => {
  const result: ActorRowVM[] = []
  const visit = (row: ActorRowVM): void => {
    result.push(row)
    row.childRows.forEach(visit)
  }
  rows.forEach(visit)
  return result
}

export const buildSceneVM = (worldState: CanonicalState, localState: WorkerLocalState): SceneVM => {
  const effectiveState = localState.dropIntent
    ? applyDropIntentToState(worldState, localState.dropIntent)
    : worldState
  const board = buildBoardVM(effectiveState)
  const movedSegmentIds = localState.dropIntent ? new Set(localState.dropIntent.segmentIds) : new Set<string>()
  const dropIntent = localState.dropIntent
  const rows = flattenRows(board.rows)
  const nodes: Record<string, SceneNodeVM> = {}
  const freeSegments: Record<string, SceneFreeSegmentVM> = {}
  const groupsById = new Map<string, { id: string; title: string; nodeIds: string[] }>()

  for (const [groupId, group] of Object.entries(localState.customGroups)) {
    groupsById.set(groupId, { id: groupId, title: group.title, nodeIds: [] })
  }

  for (const row of rows) {
    if (row.isDroppedRow) {
      // Dropped inventory lives directly on the canvas as free segments (no wrapper node).
      let yCursor = 0
      for (const segment of row.segments) {
        const pos = localState.freeSegmentPositions[segment.id] ?? { x: 120, y: 120 + yCursor }
        freeSegments[segment.id] = {
          id: segment.id,
          nodeId: row.id,
          x: pos.x,
          y: pos.y,
          segment: {
            id: segment.id,
            shortLabel: segment.labels.short,
            mediumLabel: segment.labels.medium,
            fullLabel: segment.labels.full,
            startSixth: 0,
            sizeSixths: segment.sizeSixths,
            isOverflow: segment.isOverflow,
            isDropPreview: false,
            itemDefId: segment.itemDefId,
            category: segment.category,
            wield: segment.state?.wield,
            tooltip: segment.tooltip,
          },
        }
        yCursor += STONE_H + FREE_SEGMENT_STACK_GAP
      }
      continue
    }

    const actor = worldState.actors[row.actorId]
    const twoBandSlots = actor?.kind === 'animal' || actor?.kind === 'vehicle'
    const totalStoneSlots = Math.ceil(row.capacitySixths / SIXTHS_PER_STONE)
    const fixedGreenStoneSlots = twoBandSlots
      ? Math.floor(totalStoneSlots / 2)
      : actor?.stats.hasLoadBearing
        ? 7
        : 5
    const slotCount = totalStoneSlots
    const baseGroupId = actor?.movementGroupId ?? 'ungrouped'
    const hasOverride = Object.prototype.hasOwnProperty.call(localState.nodeGroupOverrides, row.id)
    const groupId = hasOverride ? localState.nodeGroupOverrides[row.id] : baseGroupId
    const groupTitle = groupId
      ? (localState.customGroups[groupId]?.title ?? worldState.movementGroups[groupId]?.name ?? groupId)
      : null
    const parentNodeId = groupId == null ? undefined : row.parentActorId

    nodes[row.id] = {
      id: row.id,
      rowId: row.id,
      actorId: row.actorId,
      groupId,
      parentNodeId,
      actorKind: actor?.kind ?? 'pc',
      title: row.title,
      x: 0,
      y: 0,
      width: nodeWidthForSlots(slotCount, localState.stonesPerRow),
      height: nodeHeightForSlots(slotCount, localState.stonesPerRow),
      speedFeet: row.speed.explorationFeet,
      speedBand: row.speedBand.band,
      fixedGreenStoneSlots,
      slotCount,
      twoBandSlots,
      usedSixths: row.encumbranceSixths,
      usedStoneText: row.summary.usedStoneText,
      capacityStoneText: row.summary.capacityStoneText,
      segments: row.segments.map((segment) => ({
        id: segment.id,
        shortLabel: segment.labels.short,
        mediumLabel: segment.labels.medium,
        fullLabel: segment.labels.full,
        startSixth: segment.startSixth,
        sizeSixths: segment.sizeSixths,
        isOverflow: segment.isOverflow,
        isDropPreview: dropIntent != null && movedSegmentIds.has(segment.id) && row.id === dropIntent.targetNodeId && dropIntent.sourceNodeIds[segment.id] !== dropIntent.targetNodeId,
        itemDefId: segment.itemDefId,
        category: segment.category,
        wield: segment.state?.wield,
        tooltip: segment.tooltip,
      })),
    }

    if (groupId && groupTitle) {
      const existing = groupsById.get(groupId)
      if (existing) existing.nodeIds.push(row.id)
      else groupsById.set(groupId, { id: groupId, title: groupTitle, nodeIds: [row.id] })
    }
  }

  const groupOrder = [...groupsById.keys()]
  const groups: Record<string, SceneGroupVM> = {}
  let flowY = 80
  for (const groupId of groupOrder) {
    const meta = groupsById.get(groupId)
    if (!meta) continue
    const preferredOrder = localState.groupNodeOrders[groupId] ?? []
    const preferredSet = new Set(preferredOrder)
    const orderedNodeIds = [
      ...preferredOrder.filter((id) => meta.nodeIds.includes(id)),
      ...meta.nodeIds.filter((id) => !preferredSet.has(id)),
    ]
    meta.nodeIds = orderedNodeIds

    const pos = localState.groupPositions[groupId] ?? { x: GROUP_X, y: flowY }
    let cursorY = pos.y + GROUP_PADDING_TOP
    let maxNodeW = 0
    for (const nodeId of orderedNodeIds) {
      const node = nodes[nodeId]
      if (!node) continue
      const mutableNode = node as SceneNodeVM & { x: number; y: number }
      const indentPx = node.parentNodeId ? NODE_INDENT : 0
      mutableNode.x = pos.x + GROUP_PADDING_X + indentPx
      mutableNode.y = cursorY
      cursorY += node.height + NODE_ROW_GAP
      maxNodeW = Math.max(maxNodeW, node.width + indentPx)
    }
    const hasNodes = orderedNodeIds.length > 0
    const groupHeight = hasNodes
      ? cursorY - NODE_ROW_GAP - pos.y + GROUP_PADDING_BOTTOM
      : EMPTY_GROUP_MIN_HEIGHT
    groups[groupId] = {
      id: groupId,
      title: meta.title,
      nodeIds: orderedNodeIds,
      x: pos.x,
      y: pos.y,
      width: hasNodes
        ? maxNodeW + GROUP_PADDING_X * 2
        : EMPTY_GROUP_MIN_WIDTH,
      height: groupHeight,
    }
    if (!localState.groupPositions[groupId]) flowY = pos.y + groupHeight + GROUP_STACK_GAP
  }

  // Ungrouped nodes are freely positioned on the world canvas.
  let rootFlowX = ROOT_NODE_X
  let rootFlowY = ROOT_NODE_Y
  let tallestInRow = 0
  for (const node of Object.values(nodes)) {
    if (node.groupId != null) continue
    const preferred = localState.nodePositions[node.id]
    const mutableNode = node as SceneNodeVM & { x: number; y: number }
    if (preferred) {
      mutableNode.x = preferred.x
      mutableNode.y = preferred.y
      continue
    }
    if (rootFlowX + node.width > ROOT_NODE_MAX_W) {
      rootFlowX = ROOT_NODE_X
      rootFlowY += tallestInRow + ROOT_NODE_ROW_GAP
      tallestInRow = 0
    }
    mutableNode.x = rootFlowX
    mutableNode.y = rootFlowY
    rootFlowX += node.width + ROOT_NODE_COL_GAP
    tallestInRow = Math.max(tallestInRow, node.height)
  }

  return {
    partyPaceText: `${board.partyPace.explorationFeet}'/${board.partyPace.combatFeet}'/${board.partyPace.runningFeet}' • ${board.partyPace.milesPerDay} mi/day`,
    hoveredSegmentId: localState.hoveredSegmentId,
    filterCategory: localState.filterCategory,
    selectedSegmentIds: localState.selectedSegmentIds,
    nodes,
    freeSegments,
    groups,
    labels: Object.fromEntries(
      Object.entries(localState.labels).map(([id, l]) => [id, { id, text: l.text, x: l.x, y: l.y }]),
    ),
    selectedLabelId: localState.selectedLabelId,
  }
}

