export const STONE_W = 36
export const STONE_H = 54
export const STONE_GAP = 3
export const STONE_ROW_GAP = 3
export const SLOT_START_X = 10
export const NODE_VM_TOP_BAND_H = 34
export const NODE_VM_BOTTOM_PADDING = 6
export const NODE_VM_WORN_PILL_STRIP_H = 18
/** Row under title for coin/gem treasury medallions. */
export const NODE_VM_TREASURY_STRIP_H = 20
export const NODE_WIDTH_RIGHT_PAD = 20

export const meterWidthForCols = (slotCols: number): number =>
  Math.max(1, slotCols) * (STONE_W + STONE_GAP) - STONE_GAP

export const slotAreaHeightForRows = (slotRows: number): number =>
  Math.max(1, slotRows) * (STONE_H + STONE_ROW_GAP) - STONE_ROW_GAP

export const nodeWidthForCols = (slotCols: number): number =>
  SLOT_START_X + meterWidthForCols(slotCols) + NODE_WIDTH_RIGHT_PAD

export const nodeHeightForRows = (
  slotRows: number,
  hasWornPills: boolean,
  hasTreasury = false,
): number =>
  NODE_VM_TOP_BAND_H +
  slotAreaHeightForRows(slotRows) +
  NODE_VM_BOTTOM_PADDING +
  (hasTreasury ? NODE_VM_TREASURY_STRIP_H : 0) +
  (hasWornPills ? NODE_VM_WORN_PILL_STRIP_H : 0)
