import { SIXTHS_PER_STONE } from '../domain/types'
import { buildBoardVM } from '../vm/vm'
import type { CanonicalState } from '../domain/types'
import type { SceneNodeVM, SceneVM } from './protocol'

export type WorkerLocalState = {
  readonly hoveredSegmentId: string | null
  readonly nodePositions: Record<string, { x: number; y: number }>
}

const STONE_W = 36
const STONE_GAP = 3
const METER_X = 148
const baseNodeHeight = 84

const INDENT_X = 40

export const buildSceneVM = (worldState: CanonicalState, localState: WorkerLocalState): SceneVM => {
  const board = buildBoardVM(worldState)
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
    const nodeWidth = METER_X + slotCount * (STONE_W + STONE_GAP) - STONE_GAP + 20
    nodes[row.id] = {
      id: row.id,
      rowId: row.id,
      actorId: row.actorId,
      title: row.title,
      x: position.x,
      y: position.y,
      width: nodeWidth,
      height: baseNodeHeight,
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
      const childNodeWidth = METER_X + childSlotCount * (STONE_W + STONE_GAP) - STONE_GAP + 20
      nodes[child.id] = {
        id: child.id,
        rowId: child.id,
        actorId: child.actorId,
        title: child.title,
        x: childPosition.x,
        y: childPosition.y,
        width: childNodeWidth,
        height: baseNodeHeight,
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
          tooltip: segment.tooltip,
        })),
      }
      index += 1
    }
  }

  return {
    partyPaceText: `${board.partyPace.explorationFeet}'/${board.partyPace.combatFeet}'/${board.partyPace.runningFeet}' • ${board.partyPace.milesPerDay} mi/day`,
    hoveredSegmentId: localState.hoveredSegmentId,
    nodes,
  }
}

