/** Expand row-major sixth indices occupied by a segment (contiguous fallback when explicit list omitted). */
export const expandOccupiedSixths = (segment: {
  readonly occupiedSixths?: readonly number[] | undefined
  readonly startSixth: number
  readonly sizeSixths: number
}): readonly number[] => {
  if (segment.occupiedSixths != null && segment.occupiedSixths.length > 0) {
    return segment.occupiedSixths
  }
  const out: number[] = []
  for (let i = 0; i < segment.sizeSixths; i += 1) {
    out.push(segment.startSixth + i)
  }
  return out
}
