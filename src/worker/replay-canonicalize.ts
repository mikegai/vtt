import type { CanonicalState, InventoryEntry } from '../domain/types'
import { snapshotDuplicateEntryReplay, snapshotDuplicateNodeReplay } from '../vm/duplicate-intents'
import { createInventoryEntryId } from '../vm/inventory-ids'
import type { DropIntent, WorkerIntent } from './protocol'
import { createInventoryActorId, nextInventoryName } from './inventory-node'
import type { WorkerLocalState } from './scene-vm'

type ReplayBase = { worldState: CanonicalState; localState: WorkerLocalState }

type CanonicalizeOptions = {
  readonly deriveReplayBase: () => ReplayBase | null
  readonly localDropIntent: DropIntent | null
  readonly now?: () => number
  readonly random?: () => number
}

const createReplayToken = (prefix: string, now: () => number, random: () => number): string =>
  `${prefix}:${now().toString(36)}:${random().toString(36).slice(2, 7)}`

const reserveSpawnEntryIds = (
  baseWorld: CanonicalState,
  itemDefId: string,
  quantity: number,
): { ids: string[]; worldState: CanonicalState } => {
  let ws = baseWorld
  const ids: string[] = []
  const units = Math.max(1, Math.floor(quantity))
  for (let i = 0; i < units; i += 1) {
    const id = createInventoryEntryId(ws, itemDefId, i)
    ids.push(id)
    ws = {
      ...ws,
      inventoryEntries: {
        ...ws.inventoryEntries,
        [id]: {
          id,
          actorId: '__replay__',
          itemDefId,
          quantity: 1,
          zone: 'stowed',
        } as InventoryEntry,
      },
    }
  }
  return { ids, worldState: ws }
}

export const canonicalizeIntentForReplay = (
  intent: WorkerIntent,
  options: CanonicalizeOptions,
): WorkerIntent => {
  const now = options.now ?? Date.now
  const random = options.random ?? Math.random

  if (intent.type === 'DRAG_SEGMENT_END' && options.localDropIntent) {
    return {
      ...intent,
      replay: {
        ...(intent.replay ?? {}),
        segmentIds: options.localDropIntent.segmentIds,
        sourceNodeIds: options.localDropIntent.sourceNodeIds,
      },
    }
  }

  if (intent.type === 'ADD_INVENTORY_NODE') {
    if ((intent.replay?.actorId ?? intent.replayActorId) && (intent.replay?.actorName ?? intent.replayActorName)) {
      return intent
    }
    const base = options.deriveReplayBase()
    if (!base) return intent
    return {
      ...intent,
      replay: {
        ...(intent.replay ?? {}),
        actorId: createInventoryActorId(base.worldState, now, random),
        actorName: nextInventoryName(base.worldState),
      },
    }
  }

  if (intent.type === 'ADD_GROUP') {
    if (intent.replay?.groupId && intent.replay?.groupTitle) return intent
    const base = options.deriveReplayBase()
    if (!base) return intent
    return {
      ...intent,
      replay: {
        ...(intent.replay ?? {}),
        groupId: createReplayToken('custom-group', now, random),
        groupTitle: `Group ${Object.keys(base.localState.customGroups).length + 1}`,
      },
    }
  }

  if (intent.type === 'ADD_LABEL') {
    if (intent.replay?.labelId) return intent
    return {
      ...intent,
      replay: {
        ...(intent.replay ?? {}),
        labelId: createReplayToken('label', now, random),
      },
    }
  }

  if (intent.type === 'SPAWN_ITEM_INSTANCE') {
    if (intent.replay?.entryIds?.length) return intent
    const base = options.deriveReplayBase()
    if (!base) return intent
    const allocated = reserveSpawnEntryIds(base.worldState, intent.itemDefId, intent.quantity)
    return {
      ...intent,
      replay: {
        ...(intent.replay ?? {}),
        entryIds: allocated.ids,
      },
    }
  }

  if (intent.type === 'APPLY_ADD_ITEMS_OP') {
    if (intent.replay?.spawnEntryIdsByItem?.length === intent.items.length) return intent
    const base = options.deriveReplayBase()
    if (!base) return intent
    let nextWorld = base.worldState
    const spawnEntryIdsByItem: string[][] = []
    for (const item of intent.items) {
      const allocated = reserveSpawnEntryIds(nextWorld, item.itemDefId, item.quantity)
      spawnEntryIdsByItem.push(allocated.ids)
      nextWorld = allocated.worldState
    }
    return {
      ...intent,
      replay: {
        ...(intent.replay ?? {}),
        spawnEntryIdsByItem,
      },
    }
  }

  if (intent.type === 'DUPLICATE_NODE') {
    if (
      intent.replay?.newActorId &&
      intent.replay?.newActorName &&
      intent.replay?.entryIdsBySourceEntryId
    ) {
      return intent
    }
    const base = options.deriveReplayBase()
    if (!base) return intent
    const snap = snapshotDuplicateNodeReplay(base.worldState, intent, now, random)
    if (!snap) return intent
    return {
      ...intent,
      replay: {
        ...(intent.replay ?? {}),
        ...snap,
      },
    }
  }

  if (intent.type === 'DUPLICATE_ENTRY') {
    if (intent.replay?.newEntryIds !== undefined) return intent
    const base = options.deriveReplayBase()
    if (!base) return intent
    const newEntryIds = snapshotDuplicateEntryReplay(base.worldState, intent)
    return {
      ...intent,
      replay: {
        ...(intent.replay ?? {}),
        newEntryIds,
      },
    }
  }

  return intent
}

