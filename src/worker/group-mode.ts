import type { SceneGroupVM } from './protocol'

export type GroupContentMode = 'empty' | 'nodes' | 'segments'

export const deriveGroupMode = (group: Pick<SceneGroupVM, 'nodeIds' | 'freeSegmentIds'>): GroupContentMode => {
  if (group.nodeIds.length > 0) return 'nodes'
  if (group.freeSegmentIds.length > 0) return 'segments'
  return 'empty'
}
