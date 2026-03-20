import type { SceneSegmentVM } from '../worker/protocol'

/** True when segment may be visually merged with contiguous same-type segments. */
export const isEligibleForVisualGrouping = (seg: SceneSegmentVM): boolean =>
  seg.isFungibleVisual != null ? seg.isFungibleVisual : seg.sizeSixths <= 1

/** Group contiguous segments of same itemDefId that are eligible for visual merging. Excludes overflow and drop preview. */
export const groupContiguousSameType = (segments: readonly SceneSegmentVM[]): SceneSegmentVM[][] => {
  const eligible = segments
    .filter((s) => !s.isOverflow && !s.isDropPreview)
    .slice()
    .sort((a, b) => a.startSixth - b.startSixth)
  const runs: SceneSegmentVM[][] = []
  for (const seg of eligible) {
    const last = runs[runs.length - 1]
    const prevEnd = last ? last[last.length - 1].startSixth + last[last.length - 1].sizeSixths : -1
    const prevEligible = last ? isEligibleForVisualGrouping(last[last.length - 1]) : false
    const segEligible = isEligibleForVisualGrouping(seg)
    if (last && last[0].itemDefId === seg.itemDefId && prevEnd === seg.startSixth && prevEligible && segEligible) {
      last.push(seg)
    } else {
      runs.push([seg])
    }
  }
  return runs
}
