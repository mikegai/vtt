import { describe, expect, it } from 'vitest'
import { sampleState } from '../sample-data'
import { buildSceneVM, type WorkerLocalState } from '../worker/scene-vm'
import { deriveGroupMode } from '../worker/group-mode'

const makeLocalState = (): WorkerLocalState =>
  ({
    hoveredSegmentId: null,
    groupPositions: {},
    nodeGroupOverrides: {},
    nodePositions: {},
    freeSegmentPositions: {},
    groupNodeOrders: {},
    customGroups: {},
    dropIntent: null,
    stonesPerRow: 25,
    filterCategory: null,
    selectedSegmentIds: [],
    labels: {},
    selectedLabelId: null,
  }) as WorkerLocalState

describe('group segment behavior', () => {
  it('derives group mode from contained ids only', () => {
    expect(deriveGroupMode({ id: 'a', title: 'A', x: 0, y: 0, width: 1, height: 1, nodeIds: [], freeSegmentIds: [] })).toBe('empty')
    expect(
      deriveGroupMode({ id: 'a', title: 'A', x: 0, y: 0, width: 1, height: 1, nodeIds: ['n1'], freeSegmentIds: [] }),
    ).toBe('nodes')
    expect(
      deriveGroupMode({ id: 'a', title: 'A', x: 0, y: 0, width: 1, height: 1, nodeIds: [], freeSegmentIds: ['s1'] }),
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
          zone: 'dropped',
          carryGroupId: 'cutthroat:ground',
          state: { dropped: true },
        },
      },
    }
    const local = makeLocalState()
    local.customGroups = {
      'custom-group:space': { title: 'Space' },
    }
    local.groupPositions = {
      'custom-group:space': { x: 400, y: 500 },
    }
    ;(local as WorkerLocalState & {
      groupFreeSegmentPositions: Record<string, Record<string, { x: number; y: number }>>
    }).groupFreeSegmentPositions = {
      'custom-group:space': {
        cutthroatHandAxe: { x: 12, y: 34 },
      },
    }

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
})
