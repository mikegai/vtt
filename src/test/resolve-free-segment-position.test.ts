import { describe, expect, it } from 'vitest'
import { resolveFreeSegmentLayoutPosition } from '../worker/resolve-free-segment-position'

describe('resolveFreeSegmentLayoutPosition', () => {
  const p = { x: 633.81, y: 232.6 }

  it('returns exact key when present', () => {
    expect(resolveFreeSegmentLayoutPosition({ 'a:coinageMerged': p }, 'a:coinageMerged')).toEqual(p)
    expect(resolveFreeSegmentLayoutPosition({ a: p }, 'a')).toEqual(p)
  })

  it('maps bare dropped-row id to merged coinage drag key', () => {
    expect(resolveFreeSegmentLayoutPosition({ 'spawn_coinGp_x:coinageMerged': p }, 'spawn_coinGp_x')).toEqual(p)
  })

  it('maps merged coinage id to bare key when only bare was stored', () => {
    expect(resolveFreeSegmentLayoutPosition({ spawn_coinGp_x: p }, 'spawn_coinGp_x:coinageMerged')).toEqual(p)
  })
})
