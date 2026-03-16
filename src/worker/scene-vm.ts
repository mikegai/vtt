import type { ItemCategory } from '../domain/item-category'
import { SIXTHS_PER_STONE } from '../domain/types'
import { applyDropIntentToState } from '../vm/drop-intent'
import { buildBoardVM } from '../vm/vm'
import type { ActorRowVM } from '../vm/vm-types'
import type { CanonicalState } from '../domain/types'
import type { DropIntent } from './protocol'
import type { SceneGroupVM, SceneNodeVM, SceneVM } from './protocol'

export type WorkerLocalState = {
  readonly hoveredSegmentId: string | null
  readonly groupPositions: Record<string, { x: number; y: number }>
  readonly nodeGroupOverrides: Record<string, string>
  readonly groupNodeOrders: Record<string, readonly string[]>
  readonly dropIntent: DropIntent | null
  readonly stonesPerRow: number
  readonly filterCategory: ItemCategory | null
  readonly selectedSegmentIds: readonly string[]
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
  const groupsById = new Map<string, { id: string; title: string; nodeIds: string[] }>()

  for (const row of rows) {
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
    const groupId = localState.nodeGroupOverrides[row.id] ?? baseGroupId
    const groupTitle = worldState.movementGroups[groupId]?.name ?? groupId

    nodes[row.id] = {
      id: row.id,
      rowId: row.id,
      actorId: row.actorId,
      groupId,
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

    const existing = groupsById.get(groupId)
    if (existing) existing.nodeIds.push(row.id)
    else groupsById.set(groupId, { id: groupId, title: groupTitle, nodeIds: [row.id] })
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
      mutableNode.x = pos.x + GROUP_PADDING_X
      mutableNode.y = cursorY
      cursorY += node.height + NODE_ROW_GAP
      maxNodeW = Math.max(maxNodeW, node.width)
    }
    const hasNodes = orderedNodeIds.length > 0
    const groupHeight = hasNodes
      ? cursorY - NODE_ROW_GAP - pos.y + GROUP_PADDING_BOTTOM
      : GROUP_PADDING_TOP + GROUP_PADDING_BOTTOM + 20
    groups[groupId] = {
      id: groupId,
      title: meta.title,
      nodeIds: orderedNodeIds,
      x: pos.x,
      y: pos.y,
      width: maxNodeW + GROUP_PADDING_X * 2,
      height: groupHeight,
    }
    if (!localState.groupPositions[groupId]) flowY = pos.y + groupHeight + GROUP_STACK_GAP
  }

  return {
    partyPaceText: `${board.partyPace.explorationFeet}'/${board.partyPace.combatFeet}'/${board.partyPace.runningFeet}' • ${board.partyPace.milesPerDay} mi/day`,
    hoveredSegmentId: localState.hoveredSegmentId,
    filterCategory: localState.filterCategory,
    selectedSegmentIds: localState.selectedSegmentIds,
    nodes,
    groups,
  }
}

