import { describe, expect, it } from 'vitest'
import { resolveNodeGroupDropMode } from '../pixi/node-drop-mode'

describe('resolveNodeGroupDropMode', () => {
  it('uses reorder mode when list view is enabled', () => {
    expect(resolveNodeGroupDropMode(true)).toBe('reorder')
  })

  it('uses absolute mode when list view is disabled', () => {
    expect(resolveNodeGroupDropMode(false)).toBe('absolute')
  })
})

