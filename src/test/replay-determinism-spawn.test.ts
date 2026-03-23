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

  it('SPAWN_ITEM_INSTANCE stacks pooled coinage as one entry (quantity on one row)', () => {
    const w0 = minimalVmWorld()
    const world = {
      ...w0,
      itemDefinitions: {
        ...w0.itemDefinitions,
        coinGp: {
          id: 'coinGp',
          canonicalName: 'gp',
          kind: 'standard' as const,
          sixthsPerUnit: 1,
          coinagePool: true,
          coinDenom: 'gp' as const,
        },
      },
    }
    const local = makeWorkerLocalState()
    const intent = {
      type: 'SPAWN_ITEM_INSTANCE' as const,
      itemDefId: 'coinGp',
      quantity: 500,
      targetNodeId: 'alpha',
    }
    const r = applySpawnItemInstance(world, local, intent)
    const coinRows = Object.values(r.worldState.inventoryEntries).filter((e) => e.itemDefId === 'coinGp')
    expect(coinRows.length).toBe(1)
    expect(coinRows[0]?.quantity).toBe(500)
  })

  it('SPAWN_ITEM_INSTANCE merges pooled coinage into an existing stack on the same node', () => {
    const w0 = minimalVmWorld()
    const base = {
      ...w0,
      itemDefinitions: {
        ...w0.itemDefinitions,
        coinGp: {
          id: 'coinGp',
          canonicalName: 'gp',
          kind: 'standard' as const,
          sixthsPerUnit: 1,
          coinagePool: true,
          coinDenom: 'gp' as const,
        },
      },
      inventoryEntries: {
        existingGp: {
          id: 'existingGp',
          actorId: 'alpha',
          itemDefId: 'coinGp',
          quantity: 200,
          zone: 'stowed' as const,
        },
      },
    }
    const local = makeWorkerLocalState()
    const r = applySpawnItemInstance(base, local, {
      type: 'SPAWN_ITEM_INSTANCE',
      itemDefId: 'coinGp',
      quantity: 100,
      targetNodeId: 'alpha',
    })
    const gp = Object.values(r.worldState.inventoryEntries).filter((e) => e.itemDefId === 'coinGp')
    expect(gp.length).toBe(1)
    expect(gp[0]?.quantity).toBe(300)
  })

  it('SPAWN_ITEM_INSTANCE keeps separate dropped piles (canvas/group) — no merge across drops', () => {
    const w0 = minimalVmWorld()
    const world: typeof w0 = {
      ...w0,
      itemDefinitions: {
        ...w0.itemDefinitions,
        coinGp: {
          id: 'coinGp',
          canonicalName: 'gp',
          kind: 'standard' as const,
          sixthsPerUnit: 1,
          coinagePool: true,
          coinDenom: 'gp' as const,
        },
      },
      carryGroups: {
        g1: { id: 'g1', ownerActorId: 'alpha', name: 'Pile zone', dropped: true },
      },
    }
    const local = makeWorkerLocalState()
    const dropTarget = 'alpha:dropped:g1'
    let ws = world
    ws = applySpawnItemInstance(ws, local, {
      type: 'SPAWN_ITEM_INSTANCE',
      itemDefId: 'coinGp',
      quantity: 200,
      targetNodeId: dropTarget,
    }).worldState
    ws = applySpawnItemInstance(ws, local, {
      type: 'SPAWN_ITEM_INSTANCE',
      itemDefId: 'coinGp',
      quantity: 500,
      targetNodeId: dropTarget,
    }).worldState
    const gp = Object.values(ws.inventoryEntries).filter((e) => e.itemDefId === 'coinGp' && e.zone === 'dropped')
    expect(gp.length).toBe(2)
    const qs = gp.map((e) => e.quantity).sort((a, b) => a - b)
    expect(qs).toEqual([200, 500])
  })
})
