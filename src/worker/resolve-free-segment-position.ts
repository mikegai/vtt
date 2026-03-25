import { isCoinageMergedSegmentId } from '../domain/coinage'

/**
 * Canvas layout is keyed by the segment id used during drag; merged coinage uses
 * `entryId:coinageMerged` while the dropped-row VM emits bare `entryId` (coinage is not merged
 * for `isDroppedRow`). Match either key so anchors stay under the pointer.
 */
export const resolveFreeSegmentLayoutPosition = (
  positions: Readonly<Record<string, { x: number; y: number }>>,
  segmentId: string,
): { x: number; y: number } | undefined => {
  const direct = positions[segmentId]
  if (direct) return direct
  const colon = segmentId.indexOf(':')
  const base = colon >= 0 ? segmentId.slice(0, colon) : segmentId
  if (!isCoinageMergedSegmentId(segmentId)) {
    const mergedKey = `${base}:coinageMerged`
    if (positions[mergedKey]) return positions[mergedKey]
  }
  if (base !== segmentId && positions[base]) return positions[base]
  return undefined
}
