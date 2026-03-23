import type { WorkerLocalState } from '../../worker/scene-vm'

/** Default `WorkerLocalState` for VM integration tests (matches worker initial layout keys). */
export const makeWorkerLocalState = (overrides: Partial<WorkerLocalState> = {}): WorkerLocalState =>
  ({
    hoveredSegmentId: null,
    groupPositions: {},
    groupSizeOverrides: {},
    groupListViewEnabled: {},
    layoutExpanded: {},
    nodeGroupOverrides: {},
    nodePositions: {},
    groupNodePositions: {},
    nodeSizeOverrides: {},
    freeSegmentPositions: {},
    groupFreeSegmentPositions: {},
    groupNodeOrders: {},
    customGroups: {},
    groupTitleOverrides: {},
    nodeTitleOverrides: {},
    dropIntent: null,
    stonesPerRow: 25,
    filterCategory: null,
    selectedSegmentIds: [],
    selectedNodeIds: [],
    selectedGroupIds: [],
    selectedLabelIds: [],
    nodeContainment: {},
    labels: {},
    selectedLabelId: null,
    pasteTargetNodeId: null,
    ...overrides,
  }) as WorkerLocalState
