import { describe, expect, it } from 'vitest'
import type { CanonicalState } from '../domain/types'
import type { SceneVM } from '../worker/protocol'
import { segmentIdToEntryId } from '../vm/drop-intent'
import { buildSceneVM } from '../worker/scene-vm'
import { applyVmIntent } from '../vm/vm-intent-apply'
import { minimalVmWorld } from './fixtures/minimal-vm-world'
import { makeWorkerLocalState } from './helpers/worker-local-state'

const segmentIdForItem = (
  scene: SceneVM,
  nodeId: string,
  itemDefId: string,
): string | undefined => scene.nodes[nodeId]?.segments.find((s) => s.itemDefId === itemDefId)?.id

const newActorIdAfter = (before: CanonicalState, after: CanonicalState): string => {
  const prev = new Set(Object.keys(before.actors))
  for (const id of Object.keys(after.actors)) {
    if (!prev.has(id)) return id
  }
  throw new Error('expected new actor')
}

/**
 * Every mutation is a `WorkerIntent` through `applyVmIntent` (same primitives as `vm-worker`).
 * World starts with no inventory; items come from spawn / add-items / drag only.
 */
describe('integrated scenarios (intent-only VM)', () => {
  it('stash: group + inventory node, move beta in, spawn axe on alpha, drag to stash, add-items rations', () => {
    const g = 'custom-group:integ-stash'
    const w0 = minimalVmWorld()
    let world = w0
    let local = makeWorkerLocalState({
      customGroups: { [g]: { title: 'Stash' } },
      groupPositions: { [g]: { x: 50, y: 50 } },
      groupNodeOrders: { [g]: [] },
    })

    let r = applyVmIntent(world, local, { type: 'ADD_INVENTORY_NODE', x: 10, y: 10, groupId: g })
    world = r.worldState
    local = r.localState
    const stashId = newActorIdAfter(w0, world)

    r = applyVmIntent(world, local, { type: 'MOVE_NODE_TO_GROUP_INDEX', nodeId: 'beta', groupId: g, index: 0 })
    world = r.worldState
    local = r.localState

    r = applyVmIntent(world, local, {
      type: 'SPAWN_ITEM_INSTANCE',
      itemDefId: 'handAxe',
      quantity: 1,
      targetNodeId: 'alpha',
    })
    world = r.worldState
    local = r.localState

    let scene = buildSceneVM(world, local)
    const axeSeg = segmentIdForItem(scene, 'alpha', 'handAxe')
    expect(axeSeg).toBeDefined()

    r = applyVmIntent(world, local, { type: 'DRAG_SEGMENT_START', segmentIds: [axeSeg!] })
    world = r.worldState
    local = r.localState

    r = applyVmIntent(world, local, { type: 'DRAG_SEGMENT_UPDATE', targetNodeId: stashId })
    world = r.worldState
    local = r.localState

    r = applyVmIntent(world, local, {
      type: 'DRAG_SEGMENT_END',
      targetNodeId: stashId,
      targetGroupId: null,
      freeSegmentPositions: null,
    })
    world = r.worldState
    local = r.localState

    r = applyVmIntent(world, local, {
      type: 'APPLY_ADD_ITEMS_OP',
      targetNodeId: stashId,
      items: [{ itemDefId: 'ironRationsDay', itemName: 'Daily iron rations', quantity: 1 }],
    })
    world = r.worldState
    local = r.localState

    scene = buildSceneVM(world, local)
    expect(scene.groups[g]?.nodeIds).toContain('beta')
    expect(scene.groups[g]?.nodeIds).toContain(stashId)
    const stashNode = scene.nodes[stashId]
    expect(stashNode?.segments.some((s) => s.itemDefId === 'handAxe')).toBe(true)
    expect(stashNode?.segments.some((s) => s.itemDefId === 'ironRationsDay')).toBe(true)
  })

  it('canvas: ungrouped inventory node, move root, spawn + drag dagger from alpha', () => {
    const w0 = minimalVmWorld()
    let world = w0
    let local = makeWorkerLocalState()

    let r = applyVmIntent(world, local, { type: 'ADD_INVENTORY_NODE', x: 10, y: 20, groupId: null })
    world = r.worldState
    local = r.localState
    const canvasId = newActorIdAfter(w0, world)

    r = applyVmIntent(world, local, { type: 'MOVE_NODE_TO_ROOT', nodeId: canvasId, x: 777, y: 888 })
    world = r.worldState
    local = r.localState

    r = applyVmIntent(world, local, {
      type: 'SPAWN_ITEM_INSTANCE',
      itemDefId: 'ironRationsDay',
      quantity: 1,
      targetNodeId: canvasId,
    })
    world = r.worldState
    local = r.localState

    r = applyVmIntent(world, local, {
      type: 'SPAWN_ITEM_INSTANCE',
      itemDefId: 'dagger',
      quantity: 1,
      targetNodeId: 'alpha',
    })
    world = r.worldState
    local = r.localState

    let scene = buildSceneVM(world, local)
    const daggerSeg = segmentIdForItem(scene, 'alpha', 'dagger')
    expect(daggerSeg).toBeDefined()

    r = applyVmIntent(world, local, { type: 'DRAG_SEGMENT_START', segmentIds: [daggerSeg!] })
    world = r.worldState
    local = r.localState
    r = applyVmIntent(world, local, { type: 'DRAG_SEGMENT_UPDATE', targetNodeId: canvasId })
    world = r.worldState
    local = r.localState
    r = applyVmIntent(world, local, {
      type: 'DRAG_SEGMENT_END',
      targetNodeId: canvasId,
      targetGroupId: null,
      freeSegmentPositions: null,
    })
    world = r.worldState
    local = r.localState

    scene = buildSceneVM(world, local)
    const canvasNode = scene.nodes[canvasId]
    expect(canvasNode?.x).toBeCloseTo(777)
    expect(canvasNode?.y).toBeCloseTo(888)
    expect(canvasNode?.segments.some((s) => s.itemDefId === 'dagger')).toBe(true)
    expect(canvasNode?.segments.some((s) => s.itemDefId === 'ironRationsDay')).toBe(true)
  })

  it('grouped absolute move: inventory node in custom group then MOVE_NODE_IN_GROUP', () => {
    const g = 'custom-group:integ-move'
    const w0 = minimalVmWorld()
    let world = w0
    let local = makeWorkerLocalState({
      customGroups: { [g]: { title: 'Move' } },
      groupPositions: { [g]: { x: 100, y: 100 } },
      groupNodeOrders: { [g]: [] },
      groupListViewEnabled: { [g]: false },
    })

    let r = applyVmIntent(world, local, { type: 'ADD_INVENTORY_NODE', x: 5, y: 5, groupId: g })
    world = r.worldState
    local = r.localState
    const nodeId = newActorIdAfter(w0, world)

    let scene = buildSceneVM(world, local)
    const n = scene.nodes[nodeId]
    expect(n).toBeDefined()
    const targetX = n!.x + 30
    const targetY = n!.y + 40

    r = applyVmIntent(world, local, {
      type: 'MOVE_NODE_IN_GROUP',
      nodeId,
      groupId: g,
      x: targetX,
      y: targetY,
    })
    world = r.worldState
    local = r.localState

    scene = buildSceneVM(world, local)
    expect(scene.nodes[nodeId]?.x).toBeCloseTo(targetX)
    expect(scene.nodes[nodeId]?.y).toBeCloseTo(targetY)
  })

  it('moves gamma between two custom groups (MOVE_NODE_TO_GROUP_INDEX only)', () => {
    const g1 = 'custom-group:two-a'
    const g2 = 'custom-group:two-b'
    let world = minimalVmWorld()
    let local = makeWorkerLocalState({
      customGroups: {
        [g1]: { title: 'Alpha' },
        [g2]: { title: 'Beta' },
      },
      groupPositions: {
        [g1]: { x: 0, y: 0 },
        [g2]: { x: 500, y: 0 },
      },
    })

    let r = applyVmIntent(world, local, { type: 'MOVE_NODE_TO_GROUP_INDEX', nodeId: 'gamma', groupId: g1, index: 0 })
    world = r.worldState
    local = r.localState
    expect(world.actors.gamma?.movementGroupId).toBe(g1)

    r = applyVmIntent(world, local, { type: 'MOVE_NODE_TO_GROUP_INDEX', nodeId: 'gamma', groupId: g2, index: 0 })
    world = r.worldState
    local = r.localState

    expect(world.actors.gamma?.movementGroupId).toBe(g2)
    const scene = buildSceneVM(world, local)
    expect(scene.groups[g2]?.nodeIds).toContain('gamma')
    expect(scene.groups[g1]?.nodeIds ?? []).not.toContain('gamma')
  })

  it('spawns four iron rations on alpha via single SPAWN_ITEM_INSTANCE (quantity 4)', () => {
    let world = minimalVmWorld()
    let local = makeWorkerLocalState()

    const r = applyVmIntent(world, local, {
      type: 'SPAWN_ITEM_INSTANCE',
      itemDefId: 'ironRationsDay',
      quantity: 4,
      targetNodeId: 'alpha',
    })
    world = r.worldState
    local = r.localState

    const scene = buildSceneVM(world, local)
    const segs = scene.nodes.alpha?.segments.filter((s) => s.itemDefId === 'ironRationsDay') ?? []
    const total = segs.reduce((sum, s) => sum + (s.quantity ?? 0), 0)
    expect(total).toBeGreaterThanOrEqual(4)
  })

  it('fuse-style add-items: new item def + rations on a grouped inventory node', () => {
    const groupId = 'custom-group:fuse'
    const w0 = minimalVmWorld()
    let world = w0
    let local = makeWorkerLocalState({
      customGroups: { [groupId]: { title: 'Fuse target' } },
      groupPositions: { [groupId]: { x: 200, y: 200 } },
      groupNodeOrders: { [groupId]: [] },
    })

    let r = applyVmIntent(world, local, { type: 'ADD_INVENTORY_NODE', x: 30, y: 40, groupId })
    world = r.worldState
    local = r.localState
    const targetNodeId = newActorIdAfter(w0, world)

    r = applyVmIntent(world, local, {
      type: 'APPLY_ADD_ITEMS_OP',
      targetNodeId,
      items: [
        {
          itemDefId: 'fuse_test_wand_1',
          itemName: 'Wand of scenario tests',
          quantity: 1,
          sixthsPerUnit: 1,
          itemKind: 'standard',
        },
        {
          itemDefId: 'ironRationsDay',
          itemName: 'Daily iron rations',
          quantity: 2,
        },
      ],
    })
    world = r.worldState
    local = r.localState

    expect(world.itemDefinitions.fuse_test_wand_1?.canonicalName).toBe('Wand of scenario tests')

    const scene = buildSceneVM(world, local)
    const node = scene.nodes[targetNodeId]
    expect(node).toBeDefined()
    const entryIds = new Set(
      node!.segments
        .map((s) => segmentIdToEntryId(s.id))
        .filter((id) => world.inventoryEntries[id]?.actorId === targetNodeId),
    )
    expect(entryIds.size).toBeGreaterThanOrEqual(2)
  })
})
