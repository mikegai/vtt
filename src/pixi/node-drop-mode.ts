export type NodeGroupDropMode = 'reorder' | 'absolute'

export const resolveNodeGroupDropMode = (listViewEnabled: boolean): NodeGroupDropMode =>
  listViewEnabled ? 'reorder' : 'absolute'

