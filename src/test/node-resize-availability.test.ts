import { describe, expect, it } from 'vitest'
import { canShowNodeResizeHandles } from '../pixi/node-resize-availability'

describe('canShowNodeResizeHandles', () => {
  it('returns true when list view is off', () => {
    expect(canShowNodeResizeHandles(false)).toBe(true)
  })

  it('returns false when list view is on', () => {
    expect(canShowNodeResizeHandles(true)).toBe(false)
  })
})

