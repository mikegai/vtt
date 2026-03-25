/**
 * Convert canvas free-segment visual top-left (from getSegmentWorldBounds) to VM anchor
 * coordinates stored in worker local state. Must match PixiBoardAdapter free-segment rendering:
 * `root.position.set(free.x - SLOT_START_X, free.y - TOP_BAND_H)`.
 */
export function freeSegmentAnchorFromVisualTopLeft(
  visualTopLeft: { readonly x: number; readonly y: number },
  segmentBoundsInNodeLocal: { readonly x: number; readonly y: number },
): { x: number; y: number } {
  const SLOT_START_X = 10
  const TOP_BAND_H = 22
  return {
    x: visualTopLeft.x - segmentBoundsInNodeLocal.x + SLOT_START_X,
    y: visualTopLeft.y - segmentBoundsInNodeLocal.y + TOP_BAND_H,
  }
}

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
