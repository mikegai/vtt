import { describe, expect, it } from 'vitest'
import { groupContiguousSameType, isEligibleForVisualGrouping } from '../pixi/group-contiguous-same-type'
import type { SceneSegmentVM } from '../worker/protocol'

const mk = (overrides: Partial<SceneSegmentVM>): SceneSegmentVM => ({
  id: 'seg',
  shortLabel: 'x',
  mediumLabel: 'x',
  fullLabel: 'x',
  startSixth: 0,
  sizeSixths: 1,
  isOverflow: false,
  itemDefId: 'item',
  category: 'adventuring-equipment',
  tooltip: { title: 'Item', encumbranceText: '0', zoneText: 'Stowed', quantityText: '1' },
  ...overrides,
})

describe('groupContiguousSameType', () => {
  it('does not merge two adjacent 4/6 segments of same type (multi-slot items)', () => {
    const seg1 = mk({ id: 'a', startSixth: 0, sizeSixths: 4, itemDefId: 'silverServiceSet' })
    const seg2 = mk({ id: 'b', startSixth: 4, sizeSixths: 4, itemDefId: 'silverServiceSet' })
    const runs = groupContiguousSameType([seg1, seg2])
    expect(runs).toHaveLength(2)
    expect(runs[0]).toHaveLength(1)
    expect(runs[1]).toHaveLength(1)
  })

  it('merges adjacent 1/6 fungible segments when explicitly marked', () => {
    const seg1 = mk({ id: 'a', startSixth: 0, sizeSixths: 1, itemDefId: 'torch', isFungibleVisual: true })
    const seg2 = mk({ id: 'b', startSixth: 1, sizeSixths: 1, itemDefId: 'torch', isFungibleVisual: true })
    const runs = groupContiguousSameType([seg1, seg2])
    expect(runs).toHaveLength(1)
    expect(runs[0]).toHaveLength(2)
  })

  it('merges adjacent 1/6 segments via fallback when isFungibleVisual is absent', () => {
    const seg1 = mk({ id: 'a', startSixth: 0, sizeSixths: 1, itemDefId: 'unknown' })
    const seg2 = mk({ id: 'b', startSixth: 1, sizeSixths: 1, itemDefId: 'unknown' })
    const runs = groupContiguousSameType([seg1, seg2])
    expect(runs).toHaveLength(1)
    expect(runs[0]).toHaveLength(2)
  })

  it('does not merge when isFungibleVisual is explicitly false', () => {
    const seg1 = mk({ id: 'a', startSixth: 0, sizeSixths: 1, itemDefId: 'x', isFungibleVisual: false })
    const seg2 = mk({ id: 'b', startSixth: 1, sizeSixths: 1, itemDefId: 'x', isFungibleVisual: false })
    const runs = groupContiguousSameType([seg1, seg2])
    expect(runs).toHaveLength(2)
  })
})

describe('isEligibleForVisualGrouping', () => {
  it('uses explicit isFungibleVisual when defined', () => {
    expect(isEligibleForVisualGrouping(mk({ sizeSixths: 4, isFungibleVisual: true }))).toBe(true)
    expect(isEligibleForVisualGrouping(mk({ sizeSixths: 1, isFungibleVisual: false }))).toBe(false)
  })

  it('falls back to sizeSixths <= 1 when isFungibleVisual is absent', () => {
    expect(isEligibleForVisualGrouping(mk({ sizeSixths: 1 }))).toBe(true)
    expect(isEligibleForVisualGrouping(mk({ sizeSixths: 4 }))).toBe(false)
  })
})
