import type { ItemCategory } from '../domain/item-category'
import { SIXTHS_PER_STONE } from '../domain/types'
import { applyDropIntentToState } from '../vm/drop-intent'
import { buildBoardVM } from '../vm/vm'
import type { CanonicalState } from '../domain/types'
import type { DropIntent } from './protocol'
import type { SceneGroupVM, SceneNodeVM, SceneVM } from './protocol'

export type WorkerLocalState = {
  readonly hoveredSegmentId: string | null
  readonly nodePositions: Record<string, { x: number; y: number }>
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

const INDENT_X = 40
const NODE_ROW_GAP = 20
const GROUP_PADDING_X = 22
const GROUP_PADDING_TOP = 44
const GROUP_PADDING_BOTTOM = 24

export const buildSceneVM = (worldState: CanonicalState, localState: WorkerLocalState): SceneVM => {
  const effectiveState = localState.dropIntent
    ? applyDropIntentToState(worldState, localState.dropIntent)
    : worldState
  const board = buildBoardVM(effectiveState)
  const movedSegmentIds = localState.dropIntent ? new Set(localState.dropIntent.segmentIds) : new Set<string>()
  const dropIntent = localState.dropIntent
  const nodes: Record<string, SceneNodeVM> = {}

  let accumY = 80
  for (const row of board.rows) {
    const actor = worldState.actors[row.actorId]
    const twoBandSlots = actor?.kind === 'animal' || actor?.kind === 'vehicle'
    const totalStoneSlots = Math.ceil(row.capacitySixths / SIXTHS_PER_STONE)
    const fixedGreenStoneSlots = twoBandSlots
      ? Math.floor(totalStoneSlots / 2)
      : actor?.stats.hasLoadBearing
        ? 7
        : 5

    const slotCount = totalStoneSlots
    const nodeHeight = nodeHeightForSlots(slotCount, localState.stonesPerRow)
    const fallback = { x: 80, y: accumY }
    const position = localState.nodePositions[row.id] ?? fallback
    accumY += nodeHeight + NODE_ROW_GAP
    nodes[row.id] = {
      id: row.id,
      rowId: row.id,
      actorId: row.actorId,
      actorKind: actor?.kind ?? 'pc',
      title: row.title,
      x: position.x,
      y: position.y,
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

    for (const child of row.childRows) {
      const childActor = worldState.actors[child.actorId]
      const childTwoBandSlots = childActor?.kind === 'animal' || childActor?.kind === 'vehicle'
      const childTotalStoneSlots = Math.ceil(child.capacitySixths / SIXTHS_PER_STONE)
      const childFixedGreenStoneSlots = childTwoBandSlots
        ? Math.floor(childTotalStoneSlots / 2)
        : childActor?.stats.hasLoadBearing
          ? 7
          : 5

      const childSlotCount = childTotalStoneSlots
      const childNodeHeight = nodeHeightForSlots(childSlotCount, localState.stonesPerRow)
      const childFallback = { x: 80 + INDENT_X, y: accumY }
      const childPosition = localState.nodePositions[child.id] ?? childFallback
      accumY += childNodeHeight + NODE_ROW_GAP
      nodes[child.id] = {
        id: child.id,
        rowId: child.id,
        actorId: child.actorId,
        actorKind: childActor?.kind ?? 'pc',
        title: child.title,
        x: childPosition.x,
        y: childPosition.y,
        width: nodeWidthForSlots(childSlotCount, localState.stonesPerRow),
        height: nodeHeightForSlots(childSlotCount, localState.stonesPerRow),
        speedFeet: child.speed.explorationFeet,
        speedBand: child.speedBand.band,
        fixedGreenStoneSlots: childFixedGreenStoneSlots,
        slotCount: childSlotCount,
        twoBandSlots: childTwoBandSlots,
        usedSixths: child.encumbranceSixths,
        usedStoneText: child.summary.usedStoneText,
        capacityStoneText: child.summary.capacityStoneText,
        segments: child.segments.map((segment) => ({
          id: segment.id,
          shortLabel: segment.labels.short,
          mediumLabel: segment.labels.medium,
          fullLabel: segment.labels.full,
          startSixth: segment.startSixth,
          sizeSixths: segment.sizeSixths,
          isOverflow: segment.isOverflow,
          isDropPreview: dropIntent != null && movedSegmentIds.has(segment.id) && child.id === dropIntent.targetNodeId && dropIntent.sourceNodeIds[segment.id] !== dropIntent.targetNodeId,
          itemDefId: segment.itemDefId,
          category: segment.category,
          wield: segment.state?.wield,
          tooltip: segment.tooltip,
        })),
      }
    }
  }

  const groupsById = new Map<string, { id: string; title: string; nodeIds: string[] }>()
  for (const node of Object.values(nodes)) {
    const actor = worldState.actors[node.actorId]
    const groupId = actor?.movementGroupId ?? 'ungrouped'
    const groupTitle = worldState.movementGroups[groupId]?.name ?? groupId
    const existing = groupsById.get(groupId)
    if (existing) {
      existing.nodeIds.push(node.id)
    } else {
      groupsById.set(groupId, { id: groupId, title: groupTitle, nodeIds: [node.id] })
    }
  }
  const groups: Record<string, SceneGroupVM> = {}
  for (const group of groupsById.values()) {
    let minX = Infinity
    let minY = Infinity
    let maxX = -Infinity
    let maxY = -Infinity
    for (const nodeId of group.nodeIds) {
      const node = nodes[nodeId]
      if (!node) continue
      minX = Math.min(minX, node.x)
      minY = Math.min(minY, node.y)
      maxX = Math.max(maxX, node.x + node.width)
      maxY = Math.max(maxY, node.y + node.height)
    }
    if (!Number.isFinite(minX) || !Number.isFinite(minY)) continue
    groups[group.id] = {
      id: group.id,
      title: group.title,
      nodeIds: group.nodeIds,
      x: minX - GROUP_PADDING_X,
      y: minY - GROUP_PADDING_TOP,
      width: (maxX - minX) + GROUP_PADDING_X * 2,
      height: (maxY - minY) + GROUP_PADDING_TOP + GROUP_PADDING_BOTTOM,
    }
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

