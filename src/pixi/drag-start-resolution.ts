export type DragStartResolution =
  | { type: 'group'; groupId: string }
  | { type: 'node' }
  | { type: 'segment' }

export const resolveDragStartFromSegment = (
  sourceNodeId: string,
  sourceGroupId: string | null,
  selectedNodeIds: readonly string[],
  selectedGroupIds: readonly string[],
): DragStartResolution => {
  if (sourceGroupId && selectedGroupIds.includes(sourceGroupId)) {
    return { type: 'group', groupId: sourceGroupId }
  }
  if (selectedNodeIds.includes(sourceNodeId)) {
    return { type: 'node' }
  }
  return { type: 'segment' }
}

