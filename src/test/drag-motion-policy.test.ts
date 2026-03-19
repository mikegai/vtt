import { describe, expect, it } from 'vitest'
import { decideNodeMotion } from '../pixi/drag-motion-policy'

describe('decideNodeMotion', () => {
  it('snaps dragged nodes even in list view', () => {
    expect(
      decideNodeMotion({
        isDraggedNode: true,
        isInListViewGroup: true,
        positionChanged: true,
        isGroupTranslation: false,
      }),
    ).toBe('snap')
  })

  it('animates non-dragged list reflow moves', () => {
    expect(
      decideNodeMotion({
        isDraggedNode: false,
        isInListViewGroup: true,
        positionChanged: true,
        isGroupTranslation: false,
      }),
    ).toBe('animate')
  })

  it('returns none when position did not change', () => {
    expect(
      decideNodeMotion({
        isDraggedNode: false,
        isInListViewGroup: false,
        positionChanged: false,
        isGroupTranslation: false,
      }),
    ).toBe('none')
  })

  it('snaps nodes when their group translated', () => {
    expect(
      decideNodeMotion({
        isDraggedNode: false,
        isInListViewGroup: false,
        positionChanged: true,
        isGroupTranslation: true,
      }),
    ).toBe('snap')
  })

  it('snaps list-view nodes when their group translated', () => {
    expect(
      decideNodeMotion({
        isDraggedNode: false,
        isInListViewGroup: true,
        positionChanged: true,
        isGroupTranslation: true,
      }),
    ).toBe('snap')
  })
})

