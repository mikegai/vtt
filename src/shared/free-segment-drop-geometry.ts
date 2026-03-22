/**
 * Free (canvas) drop positions from drag snapshot + pointer delta.
 * Matches Pixi absolute drag proxy: each segment moves by the same world delta as the pointer.
 */
export function freeDropPositionsFromPointerDelta(
  segmentIds: readonly string[],
  initialSegmentPositions: Readonly<Record<string, { x: number; y: number }>>,
  pointerWorldAtStart: { readonly x: number; readonly y: number },
  pointerWorldAtEnd: { readonly x: number; readonly y: number },
): Record<string, { x: number; y: number }> {
  const deltaX = pointerWorldAtEnd.x - pointerWorldAtStart.x
  const deltaY = pointerWorldAtEnd.y - pointerWorldAtStart.y
  const out: Record<string, { x: number; y: number }> = {}
  for (const segId of segmentIds) {
    const pos = initialSegmentPositions[segId]
    if (pos) {
      out[segId] = { x: pos.x + deltaX, y: pos.y + deltaY }
    }
  }
  return out
}
