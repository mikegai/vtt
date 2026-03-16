import type { ScenePatch, SceneVM } from './protocol'

const stableNode = (node: SceneVM['nodes'][string]): string => JSON.stringify(node)

export const diffSceneVM = (prev: SceneVM | null, next: SceneVM): ScenePatch[] => {
  if (!prev) {
    return [
      ...Object.values(next.nodes).map((node) => ({ type: 'ADD_NODE', node }) as const),
      {
        type: 'UPDATE_META',
        partyPaceText: next.partyPaceText,
        hoveredSegmentId: next.hoveredSegmentId,
        filterCategory: next.filterCategory ?? null,
        selectedSegmentIds: next.selectedSegmentIds ?? [],
        groups: next.groups,
      },
    ]
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
    JSON.stringify(prev.groups) !== JSON.stringify(next.groups) ||
    (prev.selectedSegmentIds?.length ?? 0) !== (next.selectedSegmentIds?.length ?? 0) ||
    (prev.selectedSegmentIds ?? []).some((id, i) => (next.selectedSegmentIds ?? [])[i] !== id)
  ) {
    patches.push({
      type: 'UPDATE_META',
      partyPaceText: next.partyPaceText,
      hoveredSegmentId: next.hoveredSegmentId,
      filterCategory: next.filterCategory,
      selectedSegmentIds: next.selectedSegmentIds,
      groups: next.groups,
    })
  }

  return patches
}

