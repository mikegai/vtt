import { describe, expect, it } from 'vitest'
import { sampleState } from '../sample-data'
import { addInventoryNodeToState } from '../worker/inventory-node'
import type { WorkerLocalState } from '../worker/scene-vm'

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

describe('addInventoryNodeToState', () => {
  it('creates an ungrouped inventory node at the clicked position', () => {
    const localState = makeLocalState()
    const result = addInventoryNodeToState({
      worldState: sampleState,
      localState,
      x: 321,
      y: 654,
      groupId: null,
      now: () => 1234,
      random: () => 0.5,
    })

    const actor = result.worldState.actors[result.newActorId]
    expect(actor).toBeDefined()
    expect(actor.name).toBe('Inventory 1')
    expect(actor.kind).toBe('pc')
    expect(actor.stats.strengthMod).toBe(0)
    expect(actor.stats.hasLoadBearing).toBe(false)
    expect(result.localState.nodeGroupOverrides[result.newActorId]).toBeNull()
    expect(result.localState.nodePositions[result.newActorId]).toEqual({ x: 321, y: 654 })
  })

  it('creates a grouped inventory node and appends ordering in that group', () => {
    const localState = makeLocalState({
      customGroups: { 'custom-group:test': { title: 'Test Group' } },
      groupNodeOrders: { 'custom-group:test': ['cutthroat'] },
    })
    const result = addInventoryNodeToState({
      worldState: sampleState,
      localState,
      x: 10,
      y: 20,
      groupId: 'custom-group:test',
      now: () => 1234,
      random: () => 0.25,
    })

    const actor = result.worldState.actors[result.newActorId]
    expect(actor).toBeDefined()
    expect(actor.movementGroupId).toBe('custom-group:test')
    expect(result.localState.nodeGroupOverrides[result.newActorId]).toBe('custom-group:test')
    expect(result.localState.groupNodeOrders['custom-group:test']).toEqual(['cutthroat', result.newActorId])
    expect(result.localState.nodePositions[result.newActorId]).toBeUndefined()
  })
})
