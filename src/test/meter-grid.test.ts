import { describe, expect, it } from 'vitest'
import {
  cellsMatchRowMajorWalk,
  horizontalAdjacencyPairCount,
  linearStoneToRC,
  meterCellsForSerpentineFullStones,
  rcToLinearStone,
} from '../shared/meter-grid'

describe('meter-grid', () => {
  it('linearStoneToRC matches row-major indexing', () => {
    expect(linearStoneToRC(0, 10)).toEqual({ row: 0, col: 0 })
    expect(linearStoneToRC(10, 10)).toEqual({ row: 1, col: 0 })
    expect(linearStoneToRC(25, 10)).toEqual({ row: 2, col: 5 })
  })

  it('rcToLinearStone inverts linearStoneToRC', () => {
    const cols = 7
    for (let s = 0; s < 40; s += 1) {
      const { row, col } = linearStoneToRC(s, cols)
      expect(rcToLinearStone(row, col, cols)).toBe(s)
    }
  })

  it('meterCellsForSerpentineFullStones returns k cells with forward remainder on tie', () => {
    const cells = meterCellsForSerpentineFullStones(2, 5, 6)
    expect(cells).toHaveLength(5)
    expect(cells[0]).toEqual({ row: 0, col: 2 })
    expect(cells[1]).toEqual({ row: 0, col: 3 })
    expect(cells[2]).toEqual({ row: 0, col: 4 })
    expect(cells[3]).toEqual({ row: 0, col: 5 })
    expect(cells[4]).toEqual({ row: 1, col: 0 })
  })

  it('cellsMatchRowMajorWalk detects identical forward layout', () => {
    const cells = [linearStoneToRC(3, 8), linearStoneToRC(4, 8), linearStoneToRC(5, 8)]
    expect(cellsMatchRowMajorWalk(cells, 3, 3, 8)).toBe(true)
  })

  it('horizontalAdjacencyPairCount counts same-row neighbors', () => {
    const cells = [
      { row: 0, col: 0 },
      { row: 0, col: 1 },
      { row: 1, col: 0 },
    ]
    expect(horizontalAdjacencyPairCount(cells)).toBe(1)
  })
})
