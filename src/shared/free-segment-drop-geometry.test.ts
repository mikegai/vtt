import { describe, expect, it } from 'vitest'
import { freeDropPositionsFromPointerDelta } from './free-segment-drop-geometry'

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
