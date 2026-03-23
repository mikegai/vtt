import { describe, expect, it } from 'vitest'
import type { CanonicalState } from '../domain/types'
import { applyVmIntent } from '../vm/vm-intent-apply'
import { canonicalizeIntentForReplay } from '../worker/replay-canonicalize'
import type { WorkerIntent } from '../worker/protocol'
import type { WorkerLocalState } from '../worker/scene-vm'
import {
  canonicalWorldEquals,
  cloneCanonicalState,
  mergeServerLayoutWithEphemeral,
  serverPersistedFingerprint,
  stripEphemeralLocalState,
} from '../worker/vm-worker-rebase'
import { minimalVmWorld } from './fixtures/minimal-vm-world'
import { makeWorkerLocalState } from './helpers/worker-local-state'

type Sim = {
  serverWorld: CanonicalState
  serverLocal: WorkerLocalState
  clientWorld: CanonicalState
  clientLocal: WorkerLocalState
  pending: WorkerIntent[]
}

const deriveClientFromServerAndPending = (sim: Sim): { worldState: CanonicalState; localState: WorkerLocalState } => {
  let worldState = cloneCanonicalState(sim.serverWorld)
  let localState = mergeServerLayoutWithEphemeral(stripEphemeralLocalState(sim.serverLocal), sim.clientLocal)
  for (const pending of sim.pending) {
    const r = applyVmIntent(worldState, localState, pending)
    worldState = r.worldState
    localState = r.localState
  }
  return { worldState, localState }
}

const maybeAckPending = (sim: Sim): void => {
  const replay = deriveClientFromServerAndPending(sim)
  sim.clientWorld = replay.worldState
  sim.clientLocal = replay.localState
  const replayPersisted = stripEphemeralLocalState(replay.localState)
  const serverPersisted = stripEphemeralLocalState(sim.serverLocal)
  if (
    canonicalWorldEquals(replay.worldState, sim.serverWorld) &&
    serverPersistedFingerprint(replayPersisted) === serverPersistedFingerprint(serverPersisted)
  ) {
    sim.pending = []
  }
}

const enqueueSyncIntent = (sim: Sim, intent: WorkerIntent): WorkerIntent => {
  const stored = canonicalizeIntentForReplay(intent, {
    localDropIntent: sim.clientLocal.dropIntent,
    deriveReplayBase: () => deriveClientFromServerAndPending(sim),
  })
  sim.pending.push(stored)
  const replay = deriveClientFromServerAndPending(sim)
  sim.clientWorld = replay.worldState
  sim.clientLocal = replay.localState
  return stored
}

const echoOneFromPseudoServer = (sim: Sim, echoedIntent: WorkerIntent): void => {
  const applied = applyVmIntent(sim.serverWorld, sim.serverLocal, echoedIntent)
  sim.serverWorld = applied.worldState
  sim.serverLocal = applied.localState
  maybeAckPending(sim)
}

describe('pseudo-server sync replay simulation', () => {
  it('does not amplify spawned inventory while pending intents replay', () => {
    const initialWorld = minimalVmWorld()
    const initialLocal = makeWorkerLocalState()
    const sim: Sim = {
      serverWorld: cloneCanonicalState(initialWorld),
      serverLocal: initialLocal,
      clientWorld: cloneCanonicalState(initialWorld),
      clientLocal: initialLocal,
      pending: [],
    }

    const queued: WorkerIntent[] = []
    queued.push(
      enqueueSyncIntent(sim, {
        type: 'SPAWN_ITEM_INSTANCE',
        itemDefId: 'handAxe',
        quantity: 2,
        targetNodeId: 'alpha',
      }),
    )
    queued.push(
      enqueueSyncIntent(sim, {
        type: 'APPLY_ADD_ITEMS_OP',
        targetNodeId: 'alpha',
        items: [
          { itemDefId: 'dagger', itemName: 'Dagger', quantity: 2 },
          { itemDefId: 'handAxe', itemName: 'Hand axe', quantity: 1 },
        ],
      }),
    )

    // Echo server reducers in order (like reducer transport snapshots arriving back).
    queued.forEach((intent) => echoOneFromPseudoServer(sim, intent))

    expect(sim.pending.length).toBe(0)
    expect(canonicalWorldEquals(sim.clientWorld, sim.serverWorld)).toBe(true)
    const entryCount = Object.keys(sim.serverWorld.inventoryEntries).length
    expect(entryCount).toBe(5)
  })

  it('does not duplicate ADD_INVENTORY_NODE across replay+echo cycles', () => {
    const initialWorld = minimalVmWorld()
    const initialLocal = makeWorkerLocalState()
    const sim: Sim = {
      serverWorld: cloneCanonicalState(initialWorld),
      serverLocal: initialLocal,
      clientWorld: cloneCanonicalState(initialWorld),
      clientLocal: initialLocal,
      pending: [],
    }

    const queued: WorkerIntent[] = []
    queued.push(
      enqueueSyncIntent(sim, {
        type: 'ADD_INVENTORY_NODE',
        x: 200,
        y: 240,
        groupId: null,
      }),
    )
    queued.push(
      enqueueSyncIntent(sim, {
        type: 'ADD_INVENTORY_NODE',
        x: 320,
        y: 360,
        groupId: null,
      }),
    )

    queued.forEach((intent) => echoOneFromPseudoServer(sim, intent))

    expect(sim.pending.length).toBe(0)
    expect(canonicalWorldEquals(sim.clientWorld, sim.serverWorld)).toBe(true)
    expect(Object.keys(sim.serverWorld.actors).length).toBe(Object.keys(initialWorld.actors).length + 2)
  })

  it('does not amplify DUPLICATE_NODE when the same node is duplicated back-to-back before server ack', () => {
    const initialWorld = minimalVmWorld()
    const initialLocal = makeWorkerLocalState()
    const sim: Sim = {
      serverWorld: cloneCanonicalState(initialWorld),
      serverLocal: initialLocal,
      clientWorld: cloneCanonicalState(initialWorld),
      clientLocal: initialLocal,
      pending: [],
    }

    const spawn = enqueueSyncIntent(sim, {
      type: 'SPAWN_ITEM_INSTANCE',
      itemDefId: 'handAxe',
      quantity: 1,
      targetNodeId: 'alpha',
    })
    echoOneFromPseudoServer(sim, spawn)

    const dup1 = enqueueSyncIntent(sim, { type: 'DUPLICATE_NODE', nodeId: 'alpha' })
    const dup2 = enqueueSyncIntent(sim, { type: 'DUPLICATE_NODE', nodeId: 'alpha' })
    echoOneFromPseudoServer(sim, dup1)
    echoOneFromPseudoServer(sim, dup2)

    expect(sim.pending.length).toBe(0)
    expect(canonicalWorldEquals(sim.clientWorld, sim.serverWorld)).toBe(true)
    expect(Object.keys(sim.serverWorld.actors).length).toBe(Object.keys(initialWorld.actors).length + 2)
    expect(Object.keys(sim.serverWorld.inventoryEntries).length).toBe(3)
  })
})

