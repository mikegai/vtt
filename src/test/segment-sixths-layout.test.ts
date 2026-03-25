import { describe, expect, it } from 'vitest'
import {
  computeBlendedSegmentCornerRadii,
  groupSixthsByStone,
  SEGMENT_BLENDED_CORNER_R,
  usesStoneChunkSlotLayout,
} from '../domain/segment-sixths-layout'

describe('groupSixthsByStone', () => {
  it('merges consecutive rows within a stone into one vertical slice', () => {
    const groups = groupSixthsByStone(0, 6)
    expect(groups).toHaveLength(1)
    expect(groups[0]!).toEqual({ stone: 0, startRow: 0, heightSixths: 6 })
  })

  it('splits at stone boundary into one group per stone column', () => {
    const groups = groupSixthsByStone(0, 8)
    expect(groups).toHaveLength(2)
    expect(groups[0]!).toEqual({ stone: 0, startRow: 0, heightSixths: 6 })
    expect(groups[1]!).toEqual({ stone: 1, startRow: 0, heightSixths: 2 })
  })

  it('handles pool smaller than one sixth', () => {
    const groups = groupSixthsByStone(0, 0.5)
    expect(groups).toHaveLength(1)
    expect(groups[0]!.heightSixths).toBeCloseTo(0.5)
  })
})

describe('usesStoneChunkSlotLayout', () => {
  it('returns false for isCoinageMerge even at exact stone multiples', () => {
    expect(usesStoneChunkSlotLayout({ sizeSixths: 12, isCoinageMerge: true })).toBe(false)
    expect(usesStoneChunkSlotLayout({ sizeSixths: 6, isCoinageMerge: true })).toBe(false)
  })

  it('returns true for non-coinage multi-stone integer sizes', () => {
    expect(usesStoneChunkSlotLayout({ sizeSixths: 12, isCoinageMerge: false })).toBe(true)
    expect(usesStoneChunkSlotLayout({ sizeSixths: 6, isCoinageMerge: false })).toBe(true)
  })

  it('returns false for fractional sizes', () => {
    expect(usesStoneChunkSlotLayout({ sizeSixths: 5, isCoinageMerge: false })).toBe(false)
  })
})

describe('computeBlendedSegmentCornerRadii', () => {
  const R = SEGMENT_BLENDED_CORNER_R

  it('rounds all corners for single group', () => {
    expect(computeBlendedSegmentCornerRadii(0, 1, R)).toEqual({ tl: R, tr: R, bl: R, br: R })
  })

  it('rounds only top for first of multiple groups', () => {
    expect(computeBlendedSegmentCornerRadii(0, 3, R)).toEqual({ tl: R, tr: R, bl: 0, br: 0 })
  })

  it('rounds only bottom for last group', () => {
    expect(computeBlendedSegmentCornerRadii(2, 3, R)).toEqual({ tl: 0, tr: 0, bl: R, br: R })
  })

  it('no rounding for middle groups', () => {
    expect(computeBlendedSegmentCornerRadii(1, 3, R)).toEqual({ tl: 0, tr: 0, bl: 0, br: 0 })
  })
})
