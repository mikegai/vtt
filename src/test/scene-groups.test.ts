import { describe, expect, it } from 'vitest'
import { sampleState } from '../sample-data'
import { buildSceneVM, type WorkerLocalState } from '../worker/scene-vm'
import { deriveGroupMode } from '../worker/group-mode'

const makeLocalState = (overrides: Partial<WorkerLocalState> = {}): WorkerLocalState =>
  ({
    hoveredSegmentId: null,
    groupPositions: {},
    groupSizeOverrides: {},
    groupListViewEnabled: {},
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
    ...overrides,
  }) as WorkerLocalState

describe('group segment behavior', () => {
  it('defaults list view off for groups', () => {
    const scene = buildSceneVM(sampleState, makeLocalState())
    expect(scene.groups.party).toBeDefined()
    expect((scene.groups.party as any).listViewEnabled).toBe(false)
  })

  it('uses remembered absolute node position when list view is off', () => {
    const local = makeLocalState({
      // New state key introduced by list/absolute group behavior.
      groupNodePositions: {
        party: {
          cutthroat: { x: 333, y: 444 },
        },
      },
      groupListViewEnabled: {
        party: false,
      },
    } as any)

    const scene = buildSceneVM(sampleState, local)
    const group = scene.groups.party
    expect(group).toBeDefined()
    expect(scene.nodes.cutthroat).toBeDefined()
    expect(scene.nodes.cutthroat?.x).toBe((group?.x ?? 0) + 333)
    expect(scene.nodes.cutthroat?.y).toBe((group?.y ?? 0) + 444)
  })

  it('keeps mixed nodes + free segments in the same group without auto-switching list mode', () => {
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
      groupFreeSegmentPositions: {
        party: {
          cutthroatHandAxe: { x: 40, y: 40 },
        },
      },
      groupListViewEnabled: {
        party: false,
      },
    })
    const scene = buildSceneVM(state, local)
    expect(scene.groups.party?.nodeIds.length).toBeGreaterThan(0)
    expect(scene.groups.party?.freeSegmentIds).toContain('cutthroatHandAxe')
    expect(scene.groups.party?.listViewEnabled).toBe(false)
  })

  it('restores remembered absolute node position after list view is turned off', () => {
    const baseLocal = makeLocalState({
      groupNodePositions: {
        party: {
          cutthroat: { x: 210, y: 260 },
        },
      },
    })
    const listOn = buildSceneVM(sampleState, {
      ...baseLocal,
      groupListViewEnabled: { party: true },
    })
    const listOff = buildSceneVM(sampleState, {
      ...baseLocal,
      groupListViewEnabled: { party: false },
    })
    expect(listOn.groups.party?.listViewEnabled).toBe(true)
    expect(listOff.groups.party?.listViewEnabled).toBe(false)
    expect(listOff.nodes.cutthroat?.x).toBe((listOff.groups.party?.x ?? 0) + 210)
    expect(listOff.nodes.cutthroat?.y).toBe((listOff.groups.party?.y ?? 0) + 260)
  })

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

  it('keeps node size overrides in slot units and clamps rows to fit node capacity', () => {
    const local = makeLocalState({
      nodeSizeOverrides: {
        cutthroat: { slotCols: 7, slotRows: 1 },
      },
    })
    const scene = buildSceneVM(sampleState, local)
    const node = scene.nodes.cutthroat
    expect(node).toBeDefined()
    expect(node.slotCols).toBe(7)
    // 20 stone capacity requires at least 3 rows at 7 columns.
    expect(node.slotRows).toBe(3)
    expect(node.slotCount).toBe(20)
  })
})
