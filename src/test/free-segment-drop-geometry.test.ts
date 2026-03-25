import { describe, expect, it } from 'vitest'
import { freeDropPositionsFromPointerDelta, freeSegmentAnchorFromVisualTopLeft } from '../shared/free-segment-drop-geometry'

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

/**
 * Internal inventory→canvas free drop uses `freeDropPositionsFromPointerDelta` in PixiBoardAdapter.endSegmentDrag:
 * visualEnd = initialVisualTL + (pointerWorldAtEnd - pointerWorldAtStart).
 * So any systematic error e on pointerWorldAtStart (too large in x,y) shifts the placed segment by -e — i.e. left and up.
 */
describe('free drop sensitivity to pointerWorldAtStart bias', () => {
  it('positive bias on start shifts final visual top-left left and up by the same vector', () => {
    const initial = { a: { x: 50, y: 60 } }
    const end = { x: 80, y: 90 }
    const startTrue = { x: 10, y: 10 }
    const error = { x: 3, y: 4 }
    const startWrong = { x: startTrue.x + error.x, y: startTrue.y + error.y }

    const vTrue = freeDropPositionsFromPointerDelta(['a'], initial, startTrue, end).a!
    const vWrong = freeDropPositionsFromPointerDelta(['a'], initial, startWrong, end).a!

    expect(vTrue).toEqual({ x: 120, y: 140 })
    expect(vWrong).toEqual({ x: vTrue.x - error.x, y: vTrue.y - error.y })
    expect(vWrong).toEqual({ x: 117, y: 136 })
  })
})
