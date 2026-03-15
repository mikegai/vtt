import type { ActorRowVM, BoardVM, PartyPaceVM, SegmentVM } from './vm-types'

export type BoardPatch =
  | { readonly type: 'ADD_ROW'; readonly row: ActorRowVM }
  | { readonly type: 'REMOVE_ROW'; readonly rowId: string }
  | { readonly type: 'UPDATE_ROW'; readonly row: ActorRowVM }
  | { readonly type: 'UPDATE_SEGMENT'; readonly rowId: string; readonly segment: SegmentVM }
  | { readonly type: 'UPDATE_PARTY_PACE'; readonly partyPace: PartyPaceVM }

const flattenRows = (rows: readonly ActorRowVM[]): ActorRowVM[] =>
  rows.flatMap((row) => [row, ...flattenRows(row.childRows)])

const stableRowShape = (row: ActorRowVM): string =>
  JSON.stringify({
    id: row.id,
    actorId: row.actorId,
    title: row.title,
    speed: row.speed,
    summary: row.summary,
    segmentIds: row.segments.map((segment) => segment.id),
  })

export const diffBoardVM = (prev: BoardVM | null, next: BoardVM): BoardPatch[] => {
  if (!prev) {
    return [
      ...flattenRows(next.rows).map((row) => ({ type: 'ADD_ROW', row }) as const),
      { type: 'UPDATE_PARTY_PACE', partyPace: next.partyPace },
    ]
  }

  const patches: BoardPatch[] = []
  const prevRows = new Map(flattenRows(prev.rows).map((row) => [row.id, row]))
  const nextRows = new Map(flattenRows(next.rows).map((row) => [row.id, row]))

  for (const [rowId, nextRow] of nextRows.entries()) {
    const prevRow = prevRows.get(rowId)
    if (!prevRow) {
      patches.push({ type: 'ADD_ROW', row: nextRow })
      continue
    }

    if (stableRowShape(prevRow) !== stableRowShape(nextRow)) {
      patches.push({ type: 'UPDATE_ROW', row: nextRow })
    }

    const prevSegments = new Map(prevRow.segments.map((segment) => [segment.id, segment]))
    for (const segment of nextRow.segments) {
      const prevSegment = prevSegments.get(segment.id)
      if (!prevSegment || JSON.stringify(prevSegment) !== JSON.stringify(segment)) {
        patches.push({ type: 'UPDATE_SEGMENT', rowId, segment })
      }
    }
  }

  for (const rowId of prevRows.keys()) {
    if (!nextRows.has(rowId)) {
      patches.push({ type: 'REMOVE_ROW', rowId })
    }
  }

  if (JSON.stringify(prev.partyPace) !== JSON.stringify(next.partyPace)) {
    patches.push({ type: 'UPDATE_PARTY_PACE', partyPace: next.partyPace })
  }

  return patches
}
