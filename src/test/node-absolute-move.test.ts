import { describe, expect, it } from 'vitest'
import { buildSceneVM } from '../worker/scene-vm'
import { applyVmIntent } from '../vm/vm-intent-apply'
import { minimalVmWorld } from './fixtures/minimal-vm-world'
import { makeWorkerLocalState } from './helpers/worker-local-state'

const newActorIdAfter = (before: ReturnType<typeof minimalVmWorld>, after: ReturnType<typeof minimalVmWorld>): string => {
  const prev = new Set(Object.keys(before.actors))
  for (const id of Object.keys(after.actors)) {
    if (!prev.has(id)) return id
  }
  throw new Error('expected new actor')
}

describe('node absolute position moves (via applyVmIntent)', () => {
  it('MOVE_NODE_IN_GROUP places the primary node at the given world x/y', () => {
    let world = minimalVmWorld()
    let local = makeWorkerLocalState({
      groupListViewEnabled: { party: false },
    })
    const before = buildSceneVM(world, local)
    const cut = before.nodes.alpha
    expect(cut).toBeDefined()

    const targetX = cut!.x + 42
    const targetY = cut!.y + 17

    const r = applyVmIntent(world, local, {
      type: 'MOVE_NODE_IN_GROUP',
      nodeId: 'alpha',
      groupId: 'party',
      x: targetX,
      y: targetY,
    })
    world = r.worldState
    local = r.localState

    const after = buildSceneVM(world, local)
    expect(after.nodes.alpha?.x).toBeCloseTo(targetX)
    expect(after.nodes.alpha?.y).toBeCloseTo(targetY)
  })

  it('MOVE_NODE_TO_ROOT updates ungrouped world position when moving to a new absolute point', () => {
    let world = minimalVmWorld()
    let local = makeWorkerLocalState()

    let r = applyVmIntent(world, local, { type: 'MOVE_NODE_TO_ROOT', nodeId: 'beta', x: 111, y: 222 })
    world = r.worldState
    local = r.localState

    let scene = buildSceneVM(world, local)
    expect(scene.nodes.beta?.x).toBeCloseTo(111)
    expect(scene.nodes.beta?.y).toBeCloseTo(222)

    r = applyVmIntent(world, local, { type: 'MOVE_NODE_TO_ROOT', nodeId: 'beta', x: 900, y: 450 })
    world = r.worldState
    local = r.localState

    scene = buildSceneVM(world, local)
    expect(scene.nodes.beta?.x).toBeCloseTo(900)
    expect(scene.nodes.beta?.y).toBeCloseTo(450)
  })

  it('empty-canvas ADD_INVENTORY_NODE then MOVE_NODE_TO_ROOT', () => {
    const w0 = minimalVmWorld()
    let world = w0
    let local = makeWorkerLocalState()

    let r = applyVmIntent(world, local, { type: 'ADD_INVENTORY_NODE', x: 333, y: 444, groupId: null })
    world = r.worldState
    local = r.localState
    const nodeId = newActorIdAfter(w0, world)

    let scene = buildSceneVM(world, local)
    expect(scene.nodes[nodeId]?.x).toBeCloseTo(333)
    expect(scene.nodes[nodeId]?.y).toBeCloseTo(444)

    r = applyVmIntent(world, local, { type: 'MOVE_NODE_TO_ROOT', nodeId, x: 1200, y: 80 })
    world = r.worldState
    local = r.localState

    scene = buildSceneVM(world, local)
    expect(scene.nodes[nodeId]?.x).toBeCloseTo(1200)
    expect(scene.nodes[nodeId]?.y).toBeCloseTo(80)
  })
})
