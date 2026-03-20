/** Client + worker: how stone slots map to the physical meter grid. */
export type MeterSlotLayout = 'row-major' | 'serpentine'

export type MeterCell = { readonly row: number; readonly col: number }

export const linearStoneToRC = (linearStone: number, cols: number): MeterCell => ({
  row: Math.floor(linearStone / cols),
  col: linearStone % cols,
})

export const rcToLinearStone = (row: number, col: number, cols: number): number => row * cols + col

export const cellKey = (c: MeterCell): string => `${c.row},${c.col}`

/** Count unordered horizontal neighbor pairs among occupied cells. */
export const horizontalAdjacencyPairCount = (cells: readonly MeterCell[]): number => {
  const set = new Set(cells.map(cellKey))
  let n = 0
  for (const c of cells) {
    if (set.has(`${c.row},${c.col + 1}`)) n += 1
  }
  return n
}

/**
 * Stone cells for `k` full stones starting at `startStone` (linear index, row-major stone order).
 * Always follows row-major L→R, top row then next row — no R→L “backward” remainder on wrapped rows.
 * Serpentine *packing* coherence (contiguous fungible tape) is handled in the VM when layout is serpentine.
 */
export const meterCellsForSerpentineFullStones = (
  startStone: number,
  k: number,
  cols: number,
): MeterCell[] => {
  const W = Math.max(1, cols)
  const out: MeterCell[] = []
  for (let i = 0; i < k; i += 1) {
    out.push(linearStoneToRC(startStone + i, W))
  }
  return out
}

/** True if cells equal forward row-major walk from startStone for k full stones. */
export const cellsMatchRowMajorWalk = (cells: readonly MeterCell[], startStone: number, k: number, cols: number): boolean => {
  if (cells.length !== k) return false
  const W = Math.max(1, cols)
  for (let i = 0; i < k; i += 1) {
    const exp = linearStoneToRC(startStone + i, W)
    if (cells[i].row !== exp.row || cells[i].col !== exp.col) return false
  }
  return true
}
