import type { ScenePatch, SceneVM } from './protocol'

const stableNode = (node: SceneVM['nodes'][string]): string => JSON.stringify(node)

/** Stable layout signature (ids + anchor + group); avoids JSON.stringify blind spots on free moves. */
export const freeSegmentsLayoutKey = (scene: SceneVM): string =>
  Object.values(scene.freeSegments ?? {})
    .slice()
    .sort((a, b) => a.id.localeCompare(b.id))
    .map((f) => `${f.id}:${f.x}:${f.y}:${f.groupId ?? ''}`)
    .join('|')

export const buildUpdateMetaPatch = (scene: SceneVM): Extract<ScenePatch, { type: 'UPDATE_META' }> => ({
  type: 'UPDATE_META',
  partyPaceText: scene.partyPaceText,
  hoveredSegmentId: scene.hoveredSegmentId,
  filterCategory: scene.filterCategory ?? null,
  selectedSegmentIds: scene.selectedSegmentIds ?? [],
  pasteTargetNodeId: scene.pasteTargetNodeId ?? null,
  groups: scene.groups,
  freeSegments: scene.freeSegments,
  labels: scene.labels,
  selectedLabelId: scene.selectedLabelId,
})

export const diffSceneVM = (prev: SceneVM | null, next: SceneVM): ScenePatch[] => {
  if (!prev) {
    return [...Object.values(next.nodes).map((node) => ({ type: 'ADD_NODE', node }) as const), buildUpdateMetaPatch(next)]
  }

  const patches: ScenePatch[] = []
  const prevIds = new Set(Object.keys(prev.nodes))
  const nextIds = new Set(Object.keys(next.nodes))

  for (const nodeId of nextIds) {
    const nextNode = next.nodes[nodeId]
    const prevNode = prev.nodes[nodeId]
    if (!nextNode) continue
    if (!prevNode) {
      patches.push({ type: 'ADD_NODE', node: nextNode })
      continue
    }
    if (stableNode(prevNode) !== stableNode(nextNode)) {
      patches.push({ type: 'UPDATE_NODE', node: nextNode })
    }
  }

  for (const nodeId of prevIds) {
    if (!nextIds.has(nodeId)) {
      patches.push({ type: 'REMOVE_NODE', nodeId })
    }
  }

  if (
    prev.partyPaceText !== next.partyPaceText ||
    prev.hoveredSegmentId !== next.hoveredSegmentId ||
    prev.filterCategory !== next.filterCategory ||
    prev.pasteTargetNodeId !== next.pasteTargetNodeId ||
    JSON.stringify(prev.groups) !== JSON.stringify(next.groups) ||
    JSON.stringify(prev.freeSegments) !== JSON.stringify(next.freeSegments) ||
    JSON.stringify(prev.labels) !== JSON.stringify(next.labels) ||
    prev.selectedLabelId !== next.selectedLabelId ||
    (prev.selectedSegmentIds?.length ?? 0) !== (next.selectedSegmentIds?.length ?? 0) ||
    (prev.selectedSegmentIds ?? []).some((id, i) => (next.selectedSegmentIds ?? [])[i] !== id)
  ) {
    patches.push(buildUpdateMetaPatch(next))
  }

  const hasMetaPatch = patches.some((p) => p.type === 'UPDATE_META')
  if (!hasMetaPatch && freeSegmentsLayoutKey(prev) !== freeSegmentsLayoutKey(next)) {
    patches.push(buildUpdateMetaPatch(next))
  }

  return patches
}

