import { describe, expect, it } from 'vitest'
import { sampleState } from '../sample-data'
import { buildSceneVM, type WorkerLocalState } from '../worker/scene-vm'
import { deriveGroupMode } from '../worker/group-mode'

const makeLocalState = (overrides: Partial<WorkerLocalState> = {}): WorkerLocalState =>
  ({
    hoveredSegmentId: null,
    groupPositions: {},
    groupSizeOverrides: {},
    nodeGroupOverrides: {},
    nodePositions: {},
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
    labels: {},
    selectedLabelId: null,
    ...overrides,
  }) as WorkerLocalState

describe('group segment behavior', () => {
  it('derives group mode from contained ids only', () => {
    expect(deriveGroupMode({ nodeIds: [], freeSegmentIds: [] })).toBe('empty')
    expect(
      deriveGroupMode({ nodeIds: ['n1'], freeSegmentIds: [] }),
    ).toBe('nodes')
    expect(
      deriveGroupMode({ nodeIds: [], freeSegmentIds: ['s1'] }),
    ).toBe('segments')
  })

  it('maps group-relative segment positions into world coordinates', () => {
    const state = {
      ...sampleState,
      carryGroups: {
        ...sampleState.carryGroups,
        'cutthroat:ground': {
          id: 'cutthroat:ground',
          ownerActorId: 'cutthroat',
          name: 'Ground',
          dropped: true,
        },
      },
      inventoryEntries: {
        ...sampleState.inventoryEntries,
        cutthroatHandAxe: {
          ...sampleState.inventoryEntries.cutthroatHandAxe,
          zone: 'dropped' as const,
          carryGroupId: 'cutthroat:ground',
          state: { dropped: true },
        },
      },
    }
    const local = makeLocalState({
      customGroups: {
        'custom-group:space': { title: 'Space' },
      },
      groupPositions: {
        'custom-group:space': { x: 400, y: 500 },
      },
      groupFreeSegmentPositions: {
        'custom-group:space': {
          cutthroatHandAxe: { x: 12, y: 34 },
        },
      },
    })

    const scene = buildSceneVM(state, local)
    const group = scene.groups['custom-group:space']
    expect(group).toBeDefined()
    expect(group?.freeSegmentIds).toContain('cutthroatHandAxe')

    const free = scene.freeSegments.cutthroatHandAxe
    expect(free).toBeDefined()
    expect(free?.groupId).toBe('custom-group:space')
    expect(free?.x).toBe(12)
    expect(free?.y).toBe(34)
  })

  it('applies session title overrides for groups and nodes', () => {
    const local = makeLocalState({
      groupTitleOverrides: { party: 'Renamed Party' },
      nodeTitleOverrides: { cutthroat: 'Renamed Cutthroat' },
    })

    const scene = buildSceneVM(sampleState, local)

    expect(scene.groups.party?.title).toBe('Renamed Party')
    expect(scene.nodes.cutthroat?.title).toBe('Renamed Cutthroat')
  })

  it('uses explicit group size override when larger than content minimum', () => {
    const local = makeLocalState({
      groupSizeOverrides: {
        party: { width: 2400, height: 2400 },
      },
    })

    const scene = buildSceneVM(sampleState, local)
    expect(scene.groups.party).toBeDefined()
    expect(scene.groups.party?.width).toBe(2400)
    expect(scene.groups.party?.height).toBe(2400)
  })

  it('passes through explicit group size override without clamping (adapter clamps at display)', () => {
    const local = makeLocalState({
      groupSizeOverrides: {
        party: { width: 10, height: 10 },
      },
    })

    const scene = buildSceneVM(sampleState, local)
    expect(scene.groups.party).toBeDefined()
    expect(scene.groups.party!.width).toBe(10)
    expect(scene.groups.party!.height).toBe(10)
  })

  it('passes through tiny overrides for empty groups (adapter clamps at display)', () => {
    const local = makeLocalState({
      customGroups: {
        'custom-group:empty': { title: 'Empty' },
      },
      groupPositions: {
        'custom-group:empty': { x: 200, y: 200 },
      },
      groupSizeOverrides: {
        'custom-group:empty': { width: 1, height: 1 },
      },
    })

    const scene = buildSceneVM(sampleState, local)
    const empty = scene.groups['custom-group:empty']
    expect(empty).toBeDefined()
    expect(empty!.width).toBe(1)
    expect(empty!.height).toBe(1)
  })
})
