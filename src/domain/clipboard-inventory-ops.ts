import { INVENTORY_OPS_SCHEMA_V1 } from './inventory-ops-schema'
import type { InventoryItemInput, InventoryOpsDocumentV1 } from './inventory-ops-schema'
import type { SceneSegmentVM, SceneVM } from '../worker/protocol'

/** Replaced at paste time with the resolved inventory node id (or stripped for external LLM use). */
export const CLIPBOARD_PLACEHOLDER_NODE_ID = '__vtt_clipboard_target__'

const segmentIdToEntryId = (segmentId: string): string => segmentId.replace(/:(\d+|overflow)$/, '')

const isRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value)

const findSegment = (scene: SceneVM, segmentId: string): SceneSegmentVM | null => {
  for (const n of Object.values(scene.nodes)) {
    const s = n.segments.find((x) => x.id === segmentId)
    if (s) return s
  }
  const free = scene.freeSegments?.[segmentId]
  return free ? free.segment : null
}

/**
 * Build LLM-compatible inventory ops JSON from selected segments (deduped by entry id).
 */
export const buildInventoryOpsClipboardFromSegments = (
  scene: SceneVM,
  segmentIds: readonly string[],
): InventoryOpsDocumentV1 | null => {
  const byEntry = new Map<string, SceneSegmentVM>()
  for (const segId of segmentIds) {
    const seg = findSegment(scene, segId)
    if (!seg || seg.locked || seg.isSelfWeightToken || seg.isDropPreview) continue
    const eid = seg.entryId ?? segmentIdToEntryId(seg.id)
    if (!byEntry.has(eid)) byEntry.set(eid, seg)
  }
  const items: InventoryItemInput[] = []
  for (const seg of byEntry.values()) {
    const text = seg.fullLabel.trim() || seg.mediumLabel.trim() || seg.shortLabel.trim()
    if (!text) continue
    items.push({
      text,
      quantity: Math.max(1, seg.quantity ?? 1),
      ...(seg.zone ? { zoneHint: seg.zone } : {}),
      ...(seg.isWornPill ? { wornClothing: true as const } : {}),
      ...(seg.overridePrototypeId && seg.prototype?.canonicalName
        ? { prototypeName: seg.prototype.canonicalName }
        : {}),
    })
  }
  if (items.length === 0) return null
  return {
    schema: INVENTORY_OPS_SCHEMA_V1,
    ops: [
      {
        op: 'mutate.add-items',
        target: { nodeId: CLIPBOARD_PLACEHOLDER_NODE_ID },
        applyMode: 'auto-if-clean',
        items,
      },
    ],
  }
}

/**
 * Force `mutate.add-items` targets to the given node so in-app paste respects the current paste target
 * (replaces placeholders and LLM-supplied node ids).
 */
export const applyPasteTargetToInventoryOpsDoc = (parsed: unknown, targetNodeId: string): unknown => {
  if (!isRecord(parsed) || parsed.schema !== INVENTORY_OPS_SCHEMA_V1 || !Array.isArray(parsed.ops)) {
    return parsed
  }
  const ops = parsed.ops.map((op) => {
    if (!isRecord(op) || op.op !== 'mutate.add-items') return op
    return { ...op, target: { nodeId: targetNodeId } }
  })
  return { ...parsed, ops }
}
