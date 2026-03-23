import { buildBoardVM } from './vm'
import type { ActorRowVM } from './vm-types'
import type { CanonicalState } from '../domain/types'

/** Segment id → board row node id (same mapping as worker `DRAG_SEGMENT_START`). */
export const buildSegmentIdToSourceNodeId = (state: CanonicalState): Record<string, string> => {
  const board = buildBoardVM(state)
  const sourceNodeIds: Record<string, string> = {}
  const visit = (row: ActorRowVM): void => {
    for (const seg of row.segments) sourceNodeIds[seg.id] = row.id
    for (const child of row.childRows) visit(child)
  }
  for (const row of board.rows) visit(row)
  return sourceNodeIds
}
