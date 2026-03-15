import { buildBoardVM } from '../vm/vm'
import type { CanonicalState } from '../domain/types'
import type { SceneNodeVM, SceneVM } from './protocol'

export type WorkerLocalState = {
  readonly hoveredSegmentId: string | null
  readonly nodePositions: Record<string, { x: number; y: number }>
}

const baseNodeWidth = 780
const baseNodeHeight = 84

export const buildSceneVM = (worldState: CanonicalState, localState: WorkerLocalState): SceneVM => {
  const board = buildBoardVM(worldState)
  const nodes: Record<string, SceneNodeVM> = {}

  const allRows = board.rows.flatMap((row) => [row, ...row.childRows])
  allRows.forEach((row, index) => {
    const fallback = {
      x: 80,
      y: 80 + index * 104,
    }
    const position = localState.nodePositions[row.id] ?? fallback
    nodes[row.id] = {
      id: row.id,
      rowId: row.id,
      actorId: row.actorId,
      title: row.title,
      x: position.x,
      y: position.y,
      width: baseNodeWidth,
      height: baseNodeHeight,
      speedFeet: row.speed.explorationFeet,
      speedBand: row.speedBand.band,
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
  })

  return {
    partyPaceText: `${board.partyPace.explorationFeet}'/${board.partyPace.combatFeet}'/${board.partyPace.runningFeet}' • ${board.partyPace.milesPerDay} mi/day`,
    hoveredSegmentId: localState.hoveredSegmentId,
    nodes,
  }
}

