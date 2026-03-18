import { describe, expect, it } from 'vitest'
import { decideNodeMotion } from '../pixi/drag-motion-policy'

describe('decideNodeMotion', () => {
  it('snaps dragged nodes even in list view', () => {
    expect(
      decideNodeMotion({
        isDraggedNode: true,
        isInListViewGroup: true,
        positionChanged: true,
      }),
    ).toBe('snap')
  })

  it('animates non-dragged list reflow moves', () => {
    expect(
      decideNodeMotion({
        isDraggedNode: false,
        isInListViewGroup: true,
        positionChanged: true,
      }),
    ).toBe('animate')
  })

  it('returns none when position did not change', () => {
    expect(
      decideNodeMotion({
        isDraggedNode: false,
        isInListViewGroup: false,
        positionChanged: false,
      }),
    ).toBe('none')
  })
})

