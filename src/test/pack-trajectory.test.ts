import { describe, expect, it } from 'vitest'
import {
  buildColumnMajorDownPackOrder,
  buildSerpentinePackOrder,
  findAlignedPackStart,
  sliceFormsWholeStones,
} from '../domain/pack-trajectory'

describe('pack trajectory', () => {
  it('buildSerpentinePackOrder covers each sixth exactly once', () => {
    const order = buildSerpentinePackOrder(12, 2)
    expect(order).toHaveLength(12)
    const sorted = [...order].sort((a, b) => a - b)
    expect(sorted).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11])
  })

  it('alternates column direction (2 cols, 2 stones)', () => {
    const order = buildSerpentinePackOrder(12, 2)
    expect(order.slice(0, 6)).toEqual([0, 1, 2, 3, 4, 5])
    expect(order.slice(6, 12)).toEqual([11, 10, 9, 8, 7, 6])
  })

  it('column-major down keeps second column top→bottom (2 cols, 2 stones)', () => {
    const order = buildColumnMajorDownPackOrder(12, 2)
    expect(order).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11])
  })

  it('sliceFormsWholeStones accepts full stones only', () => {
    expect(sliceFormsWholeStones([0, 1, 2, 3, 4, 5])).toBe(true)
    expect(sliceFormsWholeStones([0, 1, 2, 3, 4, 11])).toBe(false)
  })

  it('findAlignedPackStart finds whole-stone alignment in serpentine order', () => {
    const pack = buildSerpentinePackOrder(12, 2)
    const p = findAlignedPackStart(pack, 0, 6, true)
    expect(p).toBe(0)
  })
})
