import { describe, expect, it } from 'vitest'
import { resolveDragStartFromSegment } from '../pixi/drag-start-resolution'

describe('resolveDragStartFromSegment', () => {
  it('prioritizes dragging the selected parent group', () => {
    const resolution = resolveDragStartFromSegment(
      'n1',
      'g1',
      ['n1'],
      ['g1'],
    )
    expect(resolution).toEqual({ type: 'group', groupId: 'g1' })
  })

  it('falls back to node drag when source node is selected', () => {
    const resolution = resolveDragStartFromSegment(
      'n1',
      null,
      ['n1', 'n2'],
      [],
    )
    expect(resolution).toEqual({ type: 'node' })
  })

  it('uses segment drag when neither parent group nor node is selected', () => {
    const resolution = resolveDragStartFromSegment(
      'n1',
      'g1',
      [],
      [],
    )
    expect(resolution).toEqual({ type: 'segment' })
  })
})

