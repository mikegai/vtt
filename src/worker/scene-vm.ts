import type { ItemCategory } from '../domain/item-category'
import { SIXTHS_PER_STONE } from '../domain/types'
import { applyDropIntentToState } from '../vm/drop-intent'
import { buildBoardVM } from '../vm/vm'
import type { CanonicalState } from '../domain/types'
import type { DropIntent } from './protocol'
import type { SceneNodeVM, SceneVM } from './protocol'

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

const segmentIdToEntryId = (segmentId: string): string => {
  const colon = segmentId.indexOf(':')
  return colon >= 0 ? segmentId.slice(0, colon) : segmentId
}

export const buildSceneVM = (worldState: CanonicalState, localState: WorkerLocalState): SceneVM => {
  const effectiveState = localState.dropIntent
    ? applyDropIntentToState(worldState, localState.dropIntent)
    : worldState
  const board = buildBoardVM(effectiveState)
  const movedEntryId = localState.dropIntent ? segmentIdToEntryId(localState.dropIntent.segmentId) : null
  const nodes: Record<string, SceneNodeVM> = {}

  let index = 0
  for (const row of board.rows) {
    const actor = worldState.actors[row.actorId]
    const twoBandSlots = actor?.kind === 'animal' || actor?.kind === 'vehicle'
    const totalStoneSlots = Math.ceil(row.capacitySixths / SIXTHS_PER_STONE)
    const fixedGreenStoneSlots = twoBandSlots
      ? Math.floor(totalStoneSlots / 2)
      : actor?.stats.hasLoadBearing
        ? 7
        : 5

    const fallback = { x: 80, y: 80 + index * 104 }
    const position = localState.nodePositions[row.id] ?? fallback
    const slotCount = totalStoneSlots
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
        isDropPreview: movedEntryId != null && segmentIdToEntryId(segment.id) === movedEntryId && row.id === localState.dropIntent?.targetNodeId && localState.dropIntent.sourceNodeId !== localState.dropIntent.targetNodeId,
        itemDefId: segment.itemDefId,
        category: segment.category,
        wield: segment.state?.wield,
        tooltip: segment.tooltip,
      })),
    }
    index += 1

    for (const child of row.childRows) {
      const childActor = worldState.actors[child.actorId]
      const childTwoBandSlots = childActor?.kind === 'animal' || childActor?.kind === 'vehicle'
      const childTotalStoneSlots = Math.ceil(child.capacitySixths / SIXTHS_PER_STONE)
      const childFixedGreenStoneSlots = childTwoBandSlots
        ? Math.floor(childTotalStoneSlots / 2)
        : childActor?.stats.hasLoadBearing
          ? 7
          : 5

      const childFallback = { x: 80 + INDENT_X, y: 80 + index * 104 }
      const childPosition = localState.nodePositions[child.id] ?? childFallback
      const childSlotCount = childTotalStoneSlots
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
          isDropPreview: movedEntryId != null && segmentIdToEntryId(segment.id) === movedEntryId && child.id === localState.dropIntent?.targetNodeId && localState.dropIntent.sourceNodeId !== localState.dropIntent.targetNodeId,
          itemDefId: segment.itemDefId,
          category: segment.category,
          wield: segment.state?.wield,
          tooltip: segment.tooltip,
        })),
      }
      index += 1
    }
  }

  return {
    partyPaceText: `${board.partyPace.explorationFeet}'/${board.partyPace.combatFeet}'/${board.partyPace.runningFeet}' • ${board.partyPace.milesPerDay} mi/day`,
    hoveredSegmentId: localState.hoveredSegmentId,
    filterCategory: localState.filterCategory,
    selectedSegmentIds: localState.selectedSegmentIds,
    nodes,
  }
}

