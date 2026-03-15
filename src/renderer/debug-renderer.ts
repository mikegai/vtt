import type { BoardPatch } from '../vm/diff'
import type { RendererAdapter } from './renderer'
import type { ActorRowVM, BoardVM, SegmentVM } from '../vm/vm-types'

const segmentToken = (segment: SegmentVM): string => {
  const label = segment.labels.short
  const held = segment.state.heldHands ? '👊'.repeat(segment.state.heldHands) : ''
  const dropped = segment.state.dropped ? ' ghost' : ''
  const overflow = segment.isOverflow ? ' !OVER' : ''
  return `[${label}${held}${dropped}${overflow}]`
}

const renderRow = (row: ActorRowVM): string => {
  const segments = row.segments.map(segmentToken).join(' ')
  return `${row.title.padEnd(18)} spd:${String(row.speed.explorationFeet).padStart(3)} used:${row.summary.usedStoneText} cap:${row.summary.capacityStoneText} ${segments}`
}

export const renderBoardAscii = (board: BoardVM): string => {
  const lines: string[] = []
  lines.push('Party Pace')
  lines.push(
    `${board.partyPace.explorationFeet}' / ${board.partyPace.combatFeet}' / ${board.partyPace.runningFeet}' | ${board.partyPace.milesPerDay} miles/day`,
  )
  lines.push(`Limited by: ${board.partyPace.limitedByActorId ?? 'none'}`)
  lines.push('')

  for (const row of board.rows) {
    lines.push(renderRow(row))
    for (const child of row.childRows) {
      lines.push(`  ${renderRow(child)}`)
    }
  }

  return lines.join('\n')
}

export const createDebugRenderer = (output: HTMLElement): RendererAdapter => {
  let currentBoard: BoardVM | null = null

  const paint = (): void => {
    if (!currentBoard) return
    output.textContent = renderBoardAscii(currentBoard)
  }

  return {
    fullRebuild(board) {
      currentBoard = board
      paint()
    },
    applyPatch(_patch: BoardPatch) {
      paint()
    },
  }
}
