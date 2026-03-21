import { describe, expect, it } from 'vitest'
import { sampleState } from '../sample-data'
import { buildSceneVM, type WorkerLocalState } from '../worker/scene-vm'

const makeLocalState = (overrides: Partial<WorkerLocalState> = {}): WorkerLocalState =>
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

describe('node containment', () => {
  it('hides contained nodes and injects locked self-weight segments into target inventory', () => {
    const local = makeLocalState({
      nodeContainment: {
        cutthroat: 'templar',
        templarHorse: 'templar',
      },
    })
    const scene = buildSceneVM(sampleState, local)
    expect(scene.nodes.cutthroat).toBeUndefined()
    expect(scene.nodes.templarHorse).toBeUndefined()
    const templar = scene.nodes.templar
    expect(templar).toBeDefined()
    const selfTokens = templar.segments.filter((s) => s.isSelfWeightToken)
    expect(selfTokens.length).toBe(2)
    const cutthroatToken = selfTokens.find((s) => s.id === '__self_weight__:cutthroat')
    const horseToken = selfTokens.find((s) => s.id === '__self_weight__:templarHorse')
    expect(cutthroatToken?.sizeSixths).toBe(15 * 6)
    expect(horseToken?.sizeSixths).toBe(100 * 6)
    expect(cutthroatToken?.locked).toBe(true)
    expect(horseToken?.locked).toBe(true)
  })
})

