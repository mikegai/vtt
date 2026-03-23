import { describe, expect, it } from 'vitest'
import { applyAddItemsOp, applySpawnItemInstance } from '../vm/spawn-item-instance'
import { minimalVmWorld } from './fixtures/minimal-vm-world'
import { makeWorkerLocalState } from './helpers/worker-local-state'

describe('spawn replay determinism', () => {
  it('SPAWN_ITEM_INSTANCE honors replay.entryIds', () => {
    const world = minimalVmWorld()
    const local = makeWorkerLocalState()
    const intent = {
      type: 'SPAWN_ITEM_INSTANCE' as const,
      itemDefId: 'handAxe',
      quantity: 2,
      targetNodeId: 'alpha',
      replay: { entryIds: ['replayEntryA', 'replayEntryB'] },
    }

    const r1 = applySpawnItemInstance(world, local, intent)
    const r2 = applySpawnItemInstance(world, local, intent)

    expect(Object.keys(r1.worldState.inventoryEntries).sort()).toEqual(['replayEntryA', 'replayEntryB'])
    expect(Object.keys(r2.worldState.inventoryEntries).sort()).toEqual(['replayEntryA', 'replayEntryB'])
    expect(r1.worldState.inventoryEntries.replayEntryA?.actorId).toBe('alpha')
    expect(r1.worldState.inventoryEntries.replayEntryB?.actorId).toBe('alpha')
  })

  it('APPLY_ADD_ITEMS_OP forwards deterministic replay ids per item', () => {
    const world = minimalVmWorld()
    const local = makeWorkerLocalState()
    const intent = {
      type: 'APPLY_ADD_ITEMS_OP' as const,
      targetNodeId: 'alpha',
      items: [
        { itemDefId: 'handAxe', itemName: 'Hand axe', quantity: 2 },
        { itemDefId: 'dagger', itemName: 'Dagger', quantity: 1 },
      ],
      replay: {
        spawnEntryIdsByItem: [
          ['spawnA1', 'spawnA2'],
          ['spawnD1'],
        ],
      },
    }

    const r1 = applyAddItemsOp(world, local, intent)
    const r2 = applyAddItemsOp(world, local, intent)
    const expectedIds = ['spawnA1', 'spawnA2', 'spawnD1']

    expect(Object.keys(r1.worldState.inventoryEntries).sort()).toEqual(expectedIds)
    expect(Object.keys(r2.worldState.inventoryEntries).sort()).toEqual(expectedIds)
    expect(r1.worldState.inventoryEntries.spawnA1?.itemDefId).toBe('handAxe')
    expect(r1.worldState.inventoryEntries.spawnD1?.itemDefId).toBe('dagger')
  })
})
