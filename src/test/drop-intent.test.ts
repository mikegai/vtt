import { describe, expect, it } from 'vitest'
import { buildSceneVM } from '../worker/scene-vm'
import { applyVmIntent } from '../vm/vm-intent-apply'
import { minimalVmWorld } from './fixtures/minimal-vm-world'
import { makeWorkerLocalState } from './helpers/worker-local-state'

const segmentIdForItem = (nodeId: string, itemDefId: string, scene: ReturnType<typeof buildSceneVM>) =>
  scene.nodes[nodeId]?.segments.find((s) => s.itemDefId === itemDefId)?.id

const entryCount = (s: ReturnType<typeof minimalVmWorld>) => Object.keys(s.inventoryEntries).length

/**
 * Drag uses the same worker intents as the app: DRAG_SEGMENT_START → UPDATE → END.
 * Items are created only via SPAWN_ITEM_INSTANCE.
 */
describe('drag segment (intent pipeline)', () => {
  it('preserves inventory entry count when moving an item to another actor', () => {
    let world = minimalVmWorld()
    let local = makeWorkerLocalState()

    let r = applyVmIntent(world, local, {
      type: 'SPAWN_ITEM_INSTANCE',
      itemDefId: 'handAxe',
      quantity: 1,
      targetNodeId: 'alpha',
    })
    world = r.worldState
    local = r.localState

    const scene0 = buildSceneVM(world, local)
    const axeSeg = segmentIdForItem('alpha', 'handAxe', scene0)
    expect(axeSeg).toBeDefined()

    const beforeCount = entryCount(world)

    r = applyVmIntent(world, local, { type: 'DRAG_SEGMENT_START', segmentIds: [axeSeg!] })
    world = r.worldState
    local = r.localState

    r = applyVmIntent(world, local, { type: 'DRAG_SEGMENT_UPDATE', targetNodeId: 'beta' })
    world = r.worldState
    local = r.localState

    r = applyVmIntent(world, local, {
      type: 'DRAG_SEGMENT_END',
      targetNodeId: 'beta',
      targetGroupId: null,
      freeSegmentPositions: null,
    })
    world = r.worldState
    local = r.localState

    expect(entryCount(world)).toBe(beforeCount)
    expect(Object.keys(world.inventoryEntries).length).toBe(beforeCount)
    const axeEntry = Object.values(world.inventoryEntries).find((e) => e.itemDefId === 'handAxe')
    expect(axeEntry?.actorId).toBe('beta')
    expect(axeEntry?.zone).toBe('stowed')
  })

  it('clears dropIntent after DRAG_SEGMENT_END', () => {
    let world = minimalVmWorld()
    let local = makeWorkerLocalState()

    let r = applyVmIntent(world, local, {
      type: 'SPAWN_ITEM_INSTANCE',
      itemDefId: 'dagger',
      quantity: 1,
      targetNodeId: 'alpha',
    })
    world = r.worldState
    local = r.localState

    const scene0 = buildSceneVM(world, local)
    const seg = segmentIdForItem('alpha', 'dagger', scene0)
    expect(seg).toBeDefined()

    r = applyVmIntent(world, local, { type: 'DRAG_SEGMENT_START', segmentIds: [seg!] })
    world = r.worldState
    local = r.localState
    expect(local.dropIntent).not.toBeNull()

    r = applyVmIntent(world, local, {
      type: 'DRAG_SEGMENT_END',
      targetNodeId: 'beta',
      targetGroupId: null,
      freeSegmentPositions: null,
    })
    world = r.worldState
    local = r.localState

    expect(local.dropIntent).toBeNull()
  })
})
