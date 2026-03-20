import { SIXTHS_PER_STONE } from './types'

/** Must match default meter width used in Pixi for inventory rows (see PixiBoardAdapter DEFAULT_STONES_PER_ROW). */
export const DEFAULT_PACK_STONES_PER_ROW = 25

/** Column-major traversal: every column fills top→bottom within each stone (no upward flows). */
export const buildColumnMajorDownPackOrder = (capacitySixths: number, stonesPerRow: number): number[] => {
  const order: number[] = []
  const numStones = capacitySixths / SIXTHS_PER_STONE
  if (!Number.isInteger(numStones)) {
    throw new Error('capacitySixths must be a multiple of SIXTHS_PER_STONE')
  }
  for (let col = 0; col < stonesPerRow; col += 1) {
    for (let row = 0; ; row += 1) {
      const stone = row * stonesPerRow + col
      if (stone >= numStones) break
      for (let r = 0; r < SIXTHS_PER_STONE; r += 1) {
        order.push(stone * SIXTHS_PER_STONE + r)
      }
    }
  }
  return order
}

/** Serpentine column-major traversal: fill each stone column before the next; even columns top→bottom within stone, odd columns bottom→top. */
export const buildSerpentinePackOrder = (capacitySixths: number, stonesPerRow: number): number[] => {
  const order: number[] = []
  const numStones = capacitySixths / SIXTHS_PER_STONE
  if (!Number.isInteger(numStones)) {
    throw new Error('capacitySixths must be a multiple of SIXTHS_PER_STONE')
  }
  for (let col = 0; col < stonesPerRow; col += 1) {
    const down = col % 2 === 0
    for (let row = 0; ; row += 1) {
      const stone = row * stonesPerRow + col
      if (stone >= numStones) break
      if (down) {
        for (let r = 0; r < SIXTHS_PER_STONE; r += 1) {
          order.push(stone * SIXTHS_PER_STONE + r)
        }
      } else {
        for (let r = SIXTHS_PER_STONE - 1; r >= 0; r -= 1) {
          order.push(stone * SIXTHS_PER_STONE + r)
        }
      }
    }
  }
  return order
}

export const sliceFormsWholeStones = (sixths: readonly number[]): boolean => {
  if (sixths.length % SIXTHS_PER_STONE !== 0) return false
  const byStone = new Map<number, Set<number>>()
  for (const s of sixths) {
    const st = Math.floor(s / SIXTHS_PER_STONE)
    const row = s % SIXTHS_PER_STONE
    if (!byStone.has(st)) byStone.set(st, new Set())
    byStone.get(st)!.add(row)
  }
  if (byStone.size !== sixths.length / SIXTHS_PER_STONE) return false
  for (const rows of byStone.values()) {
    if (rows.size !== SIXTHS_PER_STONE) return false
  }
  return true
}

export const findAlignedPackStart = (
  packOrder: readonly number[],
  cursor: number,
  placeableCost: number,
  requireWholeStones: boolean,
): number | null => {
  if (placeableCost <= 0 || cursor > packOrder.length) return null
  const maxStart = packOrder.length - placeableCost
  if (maxStart < cursor) return null
  if (!requireWholeStones) return cursor <= maxStart ? cursor : null
  for (let p = cursor; p <= maxStart; p += 1) {
    if (sliceFormsWholeStones(packOrder.slice(p, p + placeableCost))) return p
  }
  return null
}
