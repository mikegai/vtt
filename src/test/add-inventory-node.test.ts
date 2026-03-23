import { describe, expect, it } from 'vitest'
import { sampleState } from '../sample-data'
import { addInventoryNodeToState } from '../worker/inventory-node'
import { applyDropIntentToState } from '../vm/drop-intent'
import type { WorkerLocalState } from '../worker/scene-vm'

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

  it('uses a node id shape that remains valid drop target actor id', () => {
    const localState = makeLocalState()
    const created = addInventoryNodeToState({
      worldState: sampleState,
      localState,
      x: 100,
      y: 200,
      groupId: null,
      now: () => 1234,
      random: () => 0.5,
    })

    const moved = applyDropIntentToState(created.worldState, {
      segmentIds: ['cutthroatHandAxe'],
      sourceNodeIds: { cutthroatHandAxe: 'cutthroat' },
      targetNodeId: created.newActorId,
    })

    expect(moved.inventoryEntries.cutthroatHandAxe?.actorId).toBe(created.newActorId)
  })

  it('uses replayActorId and replayActorName instead of generating id/name', () => {
    const localState = makeLocalState()
    const result = addInventoryNodeToState({
      worldState: sampleState,
      localState,
      x: 1,
      y: 2,
      groupId: null,
      replayActorId: 'inventory_replay_test',
      replayActorName: 'Inventory 42',
    })
    expect(result.newActorId).toBe('inventory_replay_test')
    expect(result.worldState.actors.inventory_replay_test?.name).toBe('Inventory 42')
  })

  it('replay fields make id/name stable across calls from the same base world', () => {
    const base = sampleState
    const r1 = addInventoryNodeToState({
      worldState: base,
      localState: makeLocalState(),
      x: 10,
      y: 20,
      groupId: null,
      replayActorId: 'inventory_deterministic',
      replayActorName: 'Inventory 7',
    })
    const r2 = addInventoryNodeToState({
      worldState: base,
      localState: makeLocalState(),
      x: 10,
      y: 20,
      groupId: null,
      replayActorId: 'inventory_deterministic',
      replayActorName: 'Inventory 7',
    })
    expect(r1.newActorId).toBe('inventory_deterministic')
    expect(r2.newActorId).toBe(r1.newActorId)
  })
})
