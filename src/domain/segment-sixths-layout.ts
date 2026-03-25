/** One contiguous vertical slice within a stone column; height in sixth-rows (may be fractional). */
export type SixthStoneGroup = { stone: number; startRow: number; heightSixths: number }

/** Corner radius for blended (fractional) segment rects in node inventory. */
export const SEGMENT_BLENDED_CORNER_R = 4

export const isMultiStoneSize = (sizeSixths: number): boolean =>
  sizeSixths >= 6 && sizeSixths % 6 === 0

/**
 * Full-stone-width multi-slot rows only (integer stone multiples), excluding merged coinage
 * (which is always drawn as blended fractional rects even when size is a multiple of 6).
 */
export const usesStoneChunkSlotLayout = (segment: {
  sizeSixths: number
  isCoinageMerge?: boolean
}): boolean => isMultiStoneSize(segment.sizeSixths) && !segment.isCoinageMerge

/**
 * Group encumbrance span [startSixth, startSixth+sizeSixths) into stone columns; supports fractional sixths.
 * Consecutive slices in the same stone that meet on the sixth-row tape are merged into one group so
 * rendering is one visual column per stone (spell books, partial slots, merged coinage), not one rect per row.
 */
export const groupSixthsByStone = (startSixth: number, sizeSixths: number): SixthStoneGroup[] => {
  if (sizeSixths <= 0) return []
  const groups: SixthStoneGroup[] = []
  const end = startSixth + sizeSixths
  const eps = 1e-9
  let pos = startSixth
  while (pos < end - eps) {
    const stone = Math.floor(pos / 6)
    const rowFloat = pos - stone * 6
    const rowIdx = Math.floor(rowFloat)
    const fracStart = rowFloat - rowIdx
    const roomInRow = 1 - fracStart
    const take = Math.min(end - pos, roomInRow)
    const last = groups[groups.length - 1]
    if (last && last.stone === stone && Math.abs(last.startRow + last.heightSixths - rowFloat) < eps) {
      last.heightSixths += take
    } else {
      groups.push({ stone, startRow: rowIdx, heightSixths: take })
    }
    pos += take
  }
  return groups
}

/** Rounded corners only at the true start/end of a multi-slice blended segment (any item using sixth rects). */
export const computeBlendedSegmentCornerRadii = (
  index: number,
  groupCount: number,
  r: number,
): { tl: number; tr: number; br: number; bl: number } => {
  if (groupCount <= 1) {
    return { tl: r, tr: r, br: r, bl: r }
  }
  const isFirst = index === 0
  const isLast = index === groupCount - 1
  return {
    tl: isFirst ? r : 0,
    tr: isFirst ? r : 0,
    br: isLast ? r : 0,
    bl: isLast ? r : 0,
  }
}
