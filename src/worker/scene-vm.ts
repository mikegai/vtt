import type { ItemCategory } from '../domain/item-category'
import { SIXTHS_PER_STONE } from '../domain/types'
import {
  SLOT_START_X,
  STONE_GAP,
  STONE_H,
  STONE_ROW_GAP,
  STONE_W,
  NODE_VM_TOP_BAND_H as TOP_BAND_H,
  nodeHeightForRows,
  nodeWidthForCols,
} from '../shared/node-layout'
import { COINAGE_MERGED_DEFINITION } from '../domain/coinage'
import { groupSixthsByStone } from '../domain/segment-sixths-layout'
import { resolveFreeSegmentLayoutPosition } from './resolve-free-segment-position'
import { applyDropIntentToState } from '../vm/drop-intent'
import { buildBoardVM } from '../vm/vm'
import type { ActorRowVM } from '../vm/vm-types'
import type { CanonicalState } from '../domain/types'
import type { CanvasObjectData, DropIntent } from './protocol'
import type { SceneCanvasObjectVM, SceneFreeSegmentVM, SceneGroupVM, SceneNodeVM, SceneVM } from './protocol'

export type WorkerLocalState = {
  readonly hoveredSegmentId: string | null
  readonly groupPositions: Record<string, { x: number; y: number }>
  readonly groupSizeOverrides: Record<string, { width: number; height: number }>
  readonly groupListViewEnabled: Record<string, boolean>
  /** Group or node id → full layout (canvas-persisted). */
  readonly layoutExpanded: Record<string, boolean>
  readonly nodeGroupOverrides: Record<string, string | null>
  readonly nodePositions: Record<string, { x: number; y: number }>
  readonly groupNodePositions: Record<string, Record<string, { x: number; y: number }>>
  readonly nodeSizeOverrides: Record<string, { slotCols: number; slotRows: number }>
  readonly freeSegmentPositions: Record<string, { x: number; y: number }>
  readonly groupFreeSegmentPositions: Record<string, Record<string, { x: number; y: number }>>
  readonly groupNodeOrders: Record<string, readonly string[]>
  readonly customGroups: Record<string, { title: string }>
  readonly groupTitleOverrides: Record<string, string>
  readonly nodeTitleOverrides: Record<string, string>
  readonly dropIntent: DropIntent | null
  readonly stonesPerRow: number
  readonly filterCategory: ItemCategory | null
  readonly selectedSegmentIds: readonly string[]
  readonly selectedNodeIds: readonly string[]
  readonly selectedGroupIds: readonly string[]
  readonly selectedLabelIds: readonly string[]
  /** Cmd+V paste target for inventory ops / pasted node subtrees. */
  readonly pasteTargetNodeId: string | null
  /** Containment relation: contained node id -> container node id. */
  readonly nodeContainment: Record<string, string>
  readonly labels: Record<string, { text: string; x: number; y: number }>
  readonly canvasObjects: Record<string, {
    objectType: string; x: number; y: number; width: number; height: number
    zIndex: number; locked: boolean; data: CanvasObjectData
  }>
  readonly selectedCanvasObjectIds: readonly string[]
  readonly selectedLabelId: string | null
}

const GROUP_X = 80
const GROUP_STACK_GAP = 28
const NODE_ROW_GAP = 8
const GROUP_PADDING_X = 20
const GROUP_PADDING_TOP = 40
const GROUP_PADDING_BOTTOM = 18
const EMPTY_GROUP_MIN_WIDTH = 300
const EMPTY_GROUP_MIN_HEIGHT = 140
const NODE_INDENT = 24
const ROOT_NODE_X = 80
const ROOT_NODE_Y = 80
const ROOT_NODE_COL_GAP = 16
const ROOT_NODE_ROW_GAP = 16
const ROOT_NODE_MAX_W = 1800
const FREE_SEGMENT_STACK_GAP = 8
const CELL_H = STONE_H / 6
const SELF_WEIGHT_TOKEN_PREFIX = '__self_weight__:'
const INSTANCE_OVERRIDE_PREFIX = 'instance:'

const segmentIdToEntryId = (segmentId: string): string => segmentId.replace(/:(\d+|overflow)$/, '')
const parseInstanceOverrideBaseId = (entryId: string, itemDefId: string): string | null => {
  const prefix = `${INSTANCE_OVERRIDE_PREFIX}${entryId}:`
  return itemDefId.startsWith(prefix) ? itemDefId.slice(prefix.length) : null
}

const selfWeightStoneForActorKind = (kind: SceneNodeVM['actorKind']): number =>
  kind === 'pc' ? 15 : 100

const stoneToX = (stoneIndex: number, stonesPerRow: number): number =>
  (stoneIndex % stonesPerRow) * (STONE_W + STONE_GAP)
const stoneToY = (stoneIndex: number, stonesPerRow: number): number =>
  Math.floor(stoneIndex / stonesPerRow) * (STONE_H + STONE_ROW_GAP)
const segmentStoneSpan = (startSixth: number, sizeSixths: number): { startStone: number; endStone: number } => {
  const startStone = Math.floor(startSixth / 6)
  const endStone = Math.max(startStone + 1, Math.ceil((startSixth + sizeSixths) / 6))
  return { startStone, endStone }
}
const isMultiStone = (sizeSixths: number): boolean => sizeSixths >= 6 && sizeSixths % 6 === 0
const splitStonesAtWrap = (
  startStone: number,
  endStone: number,
  stonesPerRow: number,
): { start: number; end: number }[] => {
  const chunks: { start: number; end: number }[] = []
  let s = startStone
  while (s < endStone) {
    const rowStart = Math.floor(s / stonesPerRow) * stonesPerRow
    const rowEnd = rowStart + stonesPerRow
    const chunkEnd = Math.min(endStone, rowEnd)
    chunks.push({ start: s, end: chunkEnd })
    s = chunkEnd
  }
  return chunks
}

const segmentBoundsInNodeLocal = (
  segment: { startSixth: number; sizeSixths: number; isCoinageMerge?: boolean },
  stonesPerRow: number,
): { x: number; y: number; w: number; h: number } => {
  const { startStone, endStone } = segmentStoneSpan(segment.startSixth, segment.sizeSixths)
  if (isMultiStone(segment.sizeSixths) && !segment.isCoinageMerge) {
    const chunks = splitStonesAtWrap(startStone, endStone, stonesPerRow)
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
    chunks.forEach((chunk) => {
      const cx = SLOT_START_X + stoneToX(chunk.start, stonesPerRow)
      const cy = TOP_BAND_H + stoneToY(chunk.start, stonesPerRow)
      const cw = (chunk.end - chunk.start) * (STONE_W + STONE_GAP) - STONE_GAP
      minX = Math.min(minX, cx)
      minY = Math.min(minY, cy)
      maxX = Math.max(maxX, cx + cw)
      maxY = Math.max(maxY, cy + STONE_H)
    })
    return { x: minX, y: minY, w: maxX - minX, h: maxY - minY }
  }
  const groups = groupSixthsByStone(segment.startSixth, segment.sizeSixths)
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  groups.forEach((g) => {
    const x = stoneToX(g.stone, stonesPerRow)
    const y = stoneToY(g.stone, stonesPerRow) + g.startRow * CELL_H
    minX = Math.min(minX, x)
    minY = Math.min(minY, y)
    maxX = Math.max(maxX, x + STONE_W)
    maxY = Math.max(maxY, y + g.heightSixths * CELL_H)
  })
  return {
    x: SLOT_START_X + minX,
    y: TOP_BAND_H + minY,
    w: maxX - minX,
    h: maxY - minY,
  }
}

const subtreeSizeForUngrouped = (
  nodes: Record<string, SceneNodeVM>,
  childrenByParent: Map<string, string[]>,
  nodeId: string,
  memo: Map<string, { width: number; height: number }>,
): { width: number; height: number } => {
  const cached = memo.get(nodeId)
  if (cached) return cached
  const node = nodes[nodeId]
  if (!node) return { width: 0, height: 0 }
  const children = childrenByParent.get(nodeId) ?? []
  if (children.length === 0) {
    const leaf = { width: node.width, height: node.height }
    memo.set(nodeId, leaf)
    return leaf
  }
  let childMaxWidth = 0
  let childStackHeight = 0
  children.forEach((childId, index) => {
    const childSize = subtreeSizeForUngrouped(nodes, childrenByParent, childId, memo)
    childMaxWidth = Math.max(childMaxWidth, childSize.width)
    childStackHeight += childSize.height
    if (index < children.length - 1) childStackHeight += NODE_ROW_GAP
  })
  const size = {
    width: Math.max(node.width, NODE_INDENT + childMaxWidth),
    height: node.height + NODE_ROW_GAP + childStackHeight,
  }
  memo.set(nodeId, size)
  return size
}

const layoutUngroupedSubtree = (
  nodes: Record<string, SceneNodeVM>,
  childrenByParent: Map<string, string[]>,
  nodeId: string,
  x: number,
  y: number,
  memo: Map<string, { width: number; height: number }>,
): void => {
  const node = nodes[nodeId]
  if (!node) return
  const mutableNode = node as SceneNodeVM & { x: number; y: number }
  mutableNode.x = x
  mutableNode.y = y
  let childY = y + node.height + NODE_ROW_GAP
  const children = childrenByParent.get(nodeId) ?? []
  children.forEach((childId) => {
    layoutUngroupedSubtree(nodes, childrenByParent, childId, x + NODE_INDENT, childY, memo)
    const childSize = memo.get(childId)
    childY += (childSize?.height ?? 0) + NODE_ROW_GAP
  })
}

const flattenRows = (rows: readonly ActorRowVM[]): ActorRowVM[] => {
  const result: ActorRowVM[] = []
  const visit = (row: ActorRowVM): void => {
    result.push(row)
    row.childRows.forEach(visit)
  }
  rows.forEach(visit)
  return result
}

export const buildSceneVM = (worldState: CanonicalState, localState: WorkerLocalState): SceneVM => {
  const effectiveState = localState.dropIntent
    ? applyDropIntentToState(worldState, localState.dropIntent)
    : worldState
  const board = buildBoardVM(effectiveState)
  const movedSegmentIds = localState.dropIntent ? new Set(localState.dropIntent.segmentIds) : new Set<string>()
  const dropIntent = localState.dropIntent
  const rows = flattenRows(board.rows)
  const nodes: Record<string, SceneNodeVM> = {}
  const freeSegments: Record<string, SceneFreeSegmentVM> = {}
  const groupsById = new Map<
    string,
    { id: string; title: string; listViewEnabled: boolean; layoutExpanded: boolean; nodeIds: string[]; freeSegmentIds: string[] }
  >()
  const segmentGroupOwner = new Map<string, string>()

  for (const [groupId, positions] of Object.entries(localState.groupFreeSegmentPositions)) {
    for (const segmentId of Object.keys(positions)) {
      segmentGroupOwner.set(segmentId, groupId)
    }
  }

  for (const [groupId, group] of Object.entries(localState.customGroups)) {
    groupsById.set(groupId, {
      id: groupId,
      title: group.title,
      listViewEnabled: localState.groupListViewEnabled[groupId] === true,
      layoutExpanded: localState.layoutExpanded[groupId] === true,
      nodeIds: [],
      freeSegmentIds: [],
    })
  }

  for (const row of rows) {
    if (row.isDroppedRow) {
      // Dropped inventory lives directly on the canvas as free segments (no wrapper node).
      let yCursor = 0
      for (const segment of row.segments) {
        const entryId = segmentIdToEntryId(segment.id)
        const entry = effectiveState.inventoryEntries[entryId]
        const prototype =
          effectiveState.itemDefinitions[segment.itemDefId] ??
          (segment.itemDefId === COINAGE_MERGED_DEFINITION.id ? COINAGE_MERGED_DEFINITION : undefined)
        const overridePrototypeId = parseInstanceOverrideBaseId(entryId, segment.itemDefId) ?? undefined
        const ownerGroupId = segmentGroupOwner.get(segment.id)
        const groupRelativePos = ownerGroupId ? localState.groupFreeSegmentPositions[ownerGroupId]?.[segment.id] : undefined
        const pos =
          groupRelativePos ??
          resolveFreeSegmentLayoutPosition(localState.freeSegmentPositions, segment.id) ??
          { x: 120, y: 120 + yCursor }
        freeSegments[segment.id] = {
          id: segment.id,
          nodeId: row.id,
          groupId: ownerGroupId,
          x: pos.x,
          y: pos.y,
          segment: {
            id: segment.id,
            shortLabel: segment.labels.short,
            mediumLabel: segment.labels.medium,
            fullLabel: segment.labels.full,
            startSixth: 0,
            sizeSixths: segment.sizeSixths,
            isOverflow: segment.isOverflow,
            isDropPreview: false,
            itemDefId: segment.itemDefId,
            entryId,
            quantity: entry?.quantity ?? segment.quantity,
            zone: entry?.zone ?? segment.zone,
            state: entry?.state ?? segment.state,
            ...(prototype
              ? {
                  prototype: {
                    id: prototype.id,
                    canonicalName: prototype.canonicalName,
                    kind: prototype.kind,
                    sixthsPerUnit: prototype.sixthsPerUnit,
                    armorClass: prototype.armorClass,
                    priceInGp: prototype.priceInGp,
                    isFungibleVisual: prototype.isFungibleVisual,
                    ...(prototype.coinagePool != null && { coinagePool: prototype.coinagePool }),
                    ...(prototype.coinDenom != null && { coinDenom: prototype.coinDenom }),
                    ...(prototype.bundleSize != null && { bundleSize: prototype.bundleSize }),
                    ...(prototype.minToCount != null && { minToCount: prototype.minToCount }),
                    ...(prototype.sixthsPerBundle != null && { sixthsPerBundle: prototype.sixthsPerBundle }),
                  },
                }
              : {}),
            ...(overridePrototypeId ? { overridePrototypeId } : {}),
            category: segment.category,
            wield: segment.state?.wield,
            tooltip: segment.tooltip,
            ...(segment.isFungibleVisual != null && { isFungibleVisual: segment.isFungibleVisual }),
            ...(segment.isCoinageMerge ? { isCoinageMerge: true } : {}),
            ...(segment.coinageVisual ? { coinageVisual: segment.coinageVisual } : {}),
          },
        }
        if (ownerGroupId) {
          const existing = groupsById.get(ownerGroupId)
          if (existing) existing.freeSegmentIds.push(segment.id)
          else groupsById.set(ownerGroupId, {
            id: ownerGroupId,
            title: ownerGroupId,
            listViewEnabled: localState.groupListViewEnabled[ownerGroupId] === true,
            layoutExpanded: localState.layoutExpanded[ownerGroupId] === true,
            nodeIds: [],
            freeSegmentIds: [segment.id],
          })
        }
        yCursor += STONE_H + FREE_SEGMENT_STACK_GAP
      }
      continue
    }

    const actor = effectiveState.actors[row.actorId]
    const twoBandSlots = actor?.kind === 'animal' || actor?.kind === 'vehicle'
    const baseStoneSlots = Math.ceil(row.capacitySixths / SIXTHS_PER_STONE)
    const defaultSlotCols = Math.max(1, Math.min(baseStoneSlots, localState.stonesPerRow))
    const defaultSlotRows = Math.max(1, Math.ceil(baseStoneSlots / defaultSlotCols))
    const sizeOverride = localState.nodeSizeOverrides[row.id]
    const slotCols = Math.max(1, sizeOverride?.slotCols ?? defaultSlotCols)
    const minRowsForCapacity = Math.max(1, Math.ceil(baseStoneSlots / slotCols))
    const slotRows = Math.max(minRowsForCapacity, sizeOverride?.slotRows ?? defaultSlotRows)
    const slotCount = baseStoneSlots
    const fixedGreenStoneSlots = twoBandSlots
      ? Math.floor(slotCount / 2)
      : actor?.stats.hasLoadBearing
        ? 7
        : 5
    const clampedGreenSlots = Math.min(slotCount, Math.max(0, fixedGreenStoneSlots))
    const baseGroupId = actor?.movementGroupId ?? 'ungrouped'
    const hasOverride = Object.prototype.hasOwnProperty.call(localState.nodeGroupOverrides, row.id)
    const groupId = hasOverride ? localState.nodeGroupOverrides[row.id] : baseGroupId
    const groupTitle = groupId
      ? (localState.groupTitleOverrides[groupId] ?? localState.customGroups[groupId]?.title ?? effectiveState.movementGroups[groupId]?.name ?? groupId)
      : null
    const parentNodeId = row.parentActorId

    const mappedSegments = row.segments.map((segment) => {
      const entryId = segmentIdToEntryId(segment.id)
      const entry = effectiveState.inventoryEntries[entryId]
      const prototype =
        effectiveState.itemDefinitions[segment.itemDefId] ??
        (segment.itemDefId === COINAGE_MERGED_DEFINITION.id ? COINAGE_MERGED_DEFINITION : undefined)
      const overridePrototypeId = parseInstanceOverrideBaseId(entryId, segment.itemDefId) ?? undefined
      return {
        id: segment.id,
        shortLabel: segment.labels.short,
        mediumLabel: segment.labels.medium,
        fullLabel: segment.labels.full,
        startSixth: segment.startSixth,
        sizeSixths: segment.sizeSixths,
        isOverflow: segment.isOverflow,
        isDropPreview: dropIntent != null && movedSegmentIds.has(segment.id) && row.id === dropIntent.targetNodeId && dropIntent.sourceNodeIds[segment.id] !== dropIntent.targetNodeId,
        itemDefId: segment.itemDefId,
        entryId,
        quantity: entry?.quantity ?? segment.quantity,
        zone: entry?.zone ?? segment.zone,
        state: entry?.state ?? segment.state,
        ...(prototype
          ? {
              prototype: {
                id: prototype.id,
                canonicalName: prototype.canonicalName,
                kind: prototype.kind,
                sixthsPerUnit: prototype.sixthsPerUnit,
                armorClass: prototype.armorClass,
                priceInGp: prototype.priceInGp,
                isFungibleVisual: prototype.isFungibleVisual,
                ...(prototype.coinagePool != null && { coinagePool: prototype.coinagePool }),
                ...(prototype.coinDenom != null && { coinDenom: prototype.coinDenom }),
                ...(prototype.bundleSize != null && { bundleSize: prototype.bundleSize }),
                ...(prototype.minToCount != null && { minToCount: prototype.minToCount }),
                ...(prototype.sixthsPerBundle != null && { sixthsPerBundle: prototype.sixthsPerBundle }),
              },
            }
          : {}),
        ...(overridePrototypeId ? { overridePrototypeId } : {}),
        category: segment.category,
        wield: segment.state?.wield,
        tooltip: segment.tooltip,
        ...(segment.isFungibleVisual != null && { isFungibleVisual: segment.isFungibleVisual }),
        ...(segment.isWornPill ? { isWornPill: true } : {}),
        ...(segment.isCoinageMerge ? { isCoinageMerge: true } : {}),
        ...(segment.coinageVisual ? { coinageVisual: segment.coinageVisual } : {}),
      }
    })
    const hasWornPills = mappedSegments.some((segment) => segment.isWornPill)
    const hasTreasury = row.treasury != null

    nodes[row.id] = {
      id: row.id,
      rowId: row.id,
      actorId: row.actorId,
      groupId,
      parentNodeId,
      layoutExpanded: localState.layoutExpanded[row.id] === true,
      actorKind: actor?.kind ?? 'pc',
      title: localState.nodeTitleOverrides[row.id] ?? row.title,
      x: 0,
      y: 0,
      width: nodeWidthForCols(slotCols),
      height: nodeHeightForRows(slotRows, hasWornPills, hasTreasury),
      speedFeet: row.speed.explorationFeet,
      speedBand: row.speedBand.band,
      fixedGreenStoneSlots: clampedGreenSlots,
      slotCount,
      twoBandSlots,
      slotCols,
      slotRows,
      usedSixths: row.encumbranceSixths,
      usedStoneText: row.summary.usedStoneText,
      capacityStoneText: row.summary.capacityStoneText,
      segments: mappedSegments,
      ...(row.treasury ? { treasury: row.treasury } : {}),
    }

    if (groupId && groupTitle) {
      const existing = groupsById.get(groupId)
      if (existing) existing.nodeIds.push(row.id)
      else groupsById.set(groupId, {
        id: groupId,
        title: groupTitle,
        listViewEnabled: localState.groupListViewEnabled[groupId] === true,
        layoutExpanded: localState.layoutExpanded[groupId] === true,
        nodeIds: [row.id],
        freeSegmentIds: [],
      })
    }
  }

  const containedNodeIds = new Set(Object.keys(localState.nodeContainment))
  for (const [containedNodeId, targetNodeId] of Object.entries(localState.nodeContainment)) {
    const containedNode = nodes[containedNodeId]
    const targetNode = nodes[targetNodeId]
    if (!containedNode || !targetNode) continue
    const nextStartSixth = targetNode.segments.reduce((max, segment) => {
      if (segment.isWornPill) return max
      return Math.max(max, segment.startSixth + segment.sizeSixths)
    }, 0)
    const sizeSixths = selfWeightStoneForActorKind(containedNode.actorKind) * SIXTHS_PER_STONE
    ;(targetNode.segments as any[]).push({
      id: `${SELF_WEIGHT_TOKEN_PREFIX}${containedNodeId}`,
      shortLabel: `${containedNode.title}`,
      mediumLabel: `${containedNode.title} (contained)`,
      fullLabel: `${containedNode.title} (contained node weight)`,
      startSixth: nextStartSixth,
      sizeSixths,
      isOverflow: nextStartSixth + sizeSixths > targetNode.slotCount * SIXTHS_PER_STONE,
      itemDefId: '__contained-node-weight__',
      category: 'adventuring',
      tooltip: {
        title: `${containedNode.title} (contained)`,
        encumbranceText: `${selfWeightStoneForActorKind(containedNode.actorKind)} st`,
        zoneText: 'Contained',
        quantityText: '1',
      },
      isSelfWeightToken: true,
      locked: true,
    })
  }
  for (const containedNodeId of containedNodeIds) {
    delete nodes[containedNodeId]
  }

  const groupOrder = [...groupsById.keys()]
  const groups: Record<string, SceneGroupVM> = {}
  let flowY = 80
  for (const groupId of groupOrder) {
    const meta = groupsById.get(groupId)
    if (!meta) continue
    const preferredOrder = localState.groupNodeOrders[groupId] ?? []
    const preferredSet = new Set(preferredOrder)
    const orderedNodeIds = [
      ...preferredOrder.filter((id) => meta.nodeIds.includes(id)),
      ...meta.nodeIds.filter((id) => !preferredSet.has(id)),
    ].filter((id) => !containedNodeIds.has(id))
    meta.nodeIds = orderedNodeIds

    const pos = localState.groupPositions[groupId] ?? { x: GROUP_X, y: flowY }
    const listViewEnabled = meta.listViewEnabled
    let cursorY = pos.y + GROUP_PADDING_TOP
    let maxNodeW = 0
    let maxNodeBottom = pos.y + GROUP_PADDING_TOP

    if (listViewEnabled) {
      const nodeIdsInGroup = new Set(orderedNodeIds)
      const childrenByParent = new Map<string, string[]>()
      orderedNodeIds.forEach((nodeId) => {
        const node = nodes[nodeId]
        const parentId = node?.parentNodeId
        if (!parentId || !nodeIdsInGroup.has(parentId)) return
        const siblings = childrenByParent.get(parentId) ?? []
        siblings.push(nodeId)
        childrenByParent.set(parentId, siblings)
      })
      const orderedRoots = orderedNodeIds.filter((nodeId) => {
        const parentId = nodes[nodeId]?.parentNodeId
        return !parentId || !nodeIdsInGroup.has(parentId)
      })

      const layoutGroupSubtree = (nodeId: string, depth: number): void => {
        const node = nodes[nodeId]
        if (!node) return
        const mutableNode = node as SceneNodeVM & { x: number; y: number }
        const indentPx = depth * NODE_INDENT
        mutableNode.x = pos.x + GROUP_PADDING_X + indentPx
        mutableNode.y = cursorY
        cursorY += node.height + NODE_ROW_GAP
        maxNodeW = Math.max(maxNodeW, node.width + indentPx)
        maxNodeBottom = Math.max(maxNodeBottom, mutableNode.y + node.height)
        const children = childrenByParent.get(nodeId) ?? []
        children.forEach((childId) => layoutGroupSubtree(childId, depth + 1))
      }
      orderedRoots.forEach((rootId) => layoutGroupSubtree(rootId, 0))
    } else {
      const remembered = localState.groupNodePositions[groupId] ?? {}
      orderedNodeIds.forEach((nodeId, index) => {
        const node = nodes[nodeId]
        if (!node) return
        const mutableNode = node as SceneNodeVM & { x: number; y: number }
        const fallback = {
          x: GROUP_PADDING_X,
          y: GROUP_PADDING_TOP + index * (node.height + NODE_ROW_GAP),
        }
        const relPos = remembered[nodeId] ?? fallback
        mutableNode.x = pos.x + relPos.x
        mutableNode.y = pos.y + relPos.y
        maxNodeW = Math.max(maxNodeW, relPos.x + node.width)
        maxNodeBottom = Math.max(maxNodeBottom, mutableNode.y + node.height)
      })
    }

    const segmentIds = meta.freeSegmentIds.filter((id) => !!freeSegments[id])
    const hasSegments = segmentIds.length > 0
    let segmentWidth = 0
    let segmentHeight = 0
    if (hasSegments) {
      let maxX = 0
      let maxY = 0
      for (const segmentId of segmentIds) {
        const free = freeSegments[segmentId]
        if (!free) continue
        const bounds = segmentBoundsInNodeLocal(free.segment, localState.stonesPerRow)
        const right = free.x + bounds.x - SLOT_START_X + bounds.w
        const bottom = free.y + bounds.y - TOP_BAND_H + bounds.h
        maxX = Math.max(maxX, right)
        maxY = Math.max(maxY, bottom)
      }
      segmentWidth = maxX + GROUP_PADDING_X
      segmentHeight = maxY + GROUP_PADDING_BOTTOM
    }
    const hasNodes = orderedNodeIds.length > 0
    const nodeMinHeight = hasNodes
      ? (listViewEnabled
          ? cursorY - NODE_ROW_GAP - pos.y + GROUP_PADDING_BOTTOM
          : maxNodeBottom - pos.y + GROUP_PADDING_BOTTOM)
      : EMPTY_GROUP_MIN_HEIGHT
    const nodeMinWidth = hasNodes
      ? (listViewEnabled
          ? maxNodeW + GROUP_PADDING_X * 2
          : maxNodeW + GROUP_PADDING_X)
      : EMPTY_GROUP_MIN_WIDTH
    const contentMinHeight = Math.max(EMPTY_GROUP_MIN_HEIGHT, nodeMinHeight, hasSegments ? segmentHeight : 0)
    const contentMinWidth = Math.max(EMPTY_GROUP_MIN_WIDTH, nodeMinWidth, hasSegments ? segmentWidth : 0)
    const override = localState.groupSizeOverrides[groupId]
    const width = override ? override.width : contentMinWidth
    const height = override ? override.height : contentMinHeight
    groups[groupId] = {
      id: groupId,
      title: meta.title,
      listViewEnabled,
      layoutExpanded: meta.layoutExpanded,
      nodeIds: orderedNodeIds,
      freeSegmentIds: segmentIds,
      x: pos.x,
      y: pos.y,
      width,
      height,
    }
    if (!localState.groupPositions[groupId]) flowY = pos.y + height + GROUP_STACK_GAP
  }

  // Ungrouped nodes are freely positioned on the world canvas.
  const ungroupedNodeIds = Object.values(nodes)
    .filter((node) => node.groupId == null && !containedNodeIds.has(node.id))
    .map((node) => node.id)
  const ungroupedNodeSet = new Set(ungroupedNodeIds)
  const childrenByParent = new Map<string, string[]>()
  ungroupedNodeIds.forEach((nodeId) => {
    const node = nodes[nodeId]
    const parentId = node?.parentNodeId
    if (!parentId || !ungroupedNodeSet.has(parentId)) return
    const existing = childrenByParent.get(parentId) ?? []
    existing.push(nodeId)
    childrenByParent.set(parentId, existing)
  })
  const subtreeSizeMemo = new Map<string, { width: number; height: number }>()
  const ungroupedRoots = ungroupedNodeIds.filter((nodeId) => {
    const parentId = nodes[nodeId]?.parentNodeId
    return !parentId || !ungroupedNodeSet.has(parentId)
  })

  let rootFlowX = ROOT_NODE_X
  let rootFlowY = ROOT_NODE_Y
  let tallestInRow = 0
  for (const nodeId of ungroupedRoots) {
    const node = nodes[nodeId]
    if (!node) continue
    const preferred = localState.nodePositions[nodeId]
    const subtreeSize = subtreeSizeForUngrouped(nodes, childrenByParent, nodeId, subtreeSizeMemo)
    if (preferred) {
      layoutUngroupedSubtree(nodes, childrenByParent, nodeId, preferred.x, preferred.y, subtreeSizeMemo)
      continue
    }
    if (rootFlowX + subtreeSize.width > ROOT_NODE_MAX_W) {
      rootFlowX = ROOT_NODE_X
      rootFlowY += tallestInRow + ROOT_NODE_ROW_GAP
      tallestInRow = 0
    }
    layoutUngroupedSubtree(nodes, childrenByParent, nodeId, rootFlowX, rootFlowY, subtreeSizeMemo)
    rootFlowX += subtreeSize.width + ROOT_NODE_COL_GAP
    tallestInRow = Math.max(tallestInRow, subtreeSize.height)
  }

  return {
    partyPaceText: `${board.partyPace.explorationFeet}'/${board.partyPace.combatFeet}'/${board.partyPace.runningFeet}' • ${board.partyPace.milesPerDay} mi/day`,
    hoveredSegmentId: localState.hoveredSegmentId,
    filterCategory: localState.filterCategory,
    selectedSegmentIds: localState.selectedSegmentIds,
    selectedNodeIds: localState.selectedNodeIds.filter((id) => !!nodes[id] && !containedNodeIds.has(id)),
    selectedGroupIds: localState.selectedGroupIds.filter((id) => !!groups[id]),
    selectedLabelIds: localState.selectedLabelIds.filter((id) => !!localState.labels[id]),
    pasteTargetNodeId:
      localState.pasteTargetNodeId && nodes[localState.pasteTargetNodeId] ? localState.pasteTargetNodeId : null,
    nodes,
    freeSegments,
    groups,
    labels: Object.fromEntries(
      Object.entries(localState.labels).map(([id, l]) => [id, { id, text: l.text, x: l.x, y: l.y }]),
    ),
    canvasObjects: Object.fromEntries(
      Object.entries(localState.canvasObjects ?? {}).map(([id, o]) => [id, {
        id, objectType: o.objectType, x: o.x, y: o.y,
        width: o.width, height: o.height, zIndex: o.zIndex,
        locked: o.locked, data: o.data,
      } satisfies SceneCanvasObjectVM]),
    ),
    selectedCanvasObjectIds: (localState.selectedCanvasObjectIds ?? []).filter((id) => !!(localState.canvasObjects ?? {})[id]),
    selectedLabelId: localState.selectedLabelId,
  }
}

