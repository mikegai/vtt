import { describe, expect, it } from 'vitest'
import { freeDropPositionsFromPointerDelta, freeSegmentAnchorFromVisualTopLeft } from './free-segment-drop-geometry'

describe('freeDropPositionsFromPointerDelta', () => {
  it('applies the same world delta as the pointer to each segment origin', () => {
    const initial = {
      a: { x: 10, y: 20 },
      b: { x: 100, y: 5 },
    }
    const start = { x: 0, y: 0 }
    const end = { x: 3, y: -7 }
    const out = freeDropPositionsFromPointerDelta(['a', 'b'], initial, start, end)
    expect(out.a).toEqual({ x: 13, y: 13 })
    expect(out.b).toEqual({ x: 103, y: -2 })
  })

  it('skips segment ids missing from the snapshot', () => {
    const out = freeDropPositionsFromPointerDelta(['a'], {}, { x: 0, y: 0 }, { x: 1, y: 1 })
    expect(Object.keys(out).length).toBe(0)
  })
})

describe('freeSegmentAnchorFromVisualTopLeft', () => {
  it('inverts Pixi free-segment visual top-left (bounds offset + chrome)', () => {
    const bounds = { x: 4, y: 8 }
    const anchor = { x: 100, y: 200 }
    const visual = { x: anchor.x + bounds.x - 10, y: anchor.y + bounds.y - 22 }
    expect(freeSegmentAnchorFromVisualTopLeft(visual, bounds)).toEqual(anchor)
  })
})
