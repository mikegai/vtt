import { findPooledCoinageStackToMerge, isCoinagePooledDefinition } from '../domain/coinage'
import type { CanonicalState, CarryZone, InventoryEntry, ItemDefinition, ItemKind } from '../domain/types'
import { snapshotDuplicateEntryReplay, snapshotDuplicateNodeReplay } from '../vm/duplicate-intents'
import { parseNodeId } from '../vm/drop-intent'
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

type SpawnItemInstanceIntent = Extract<WorkerIntent, { type: 'SPAWN_ITEM_INSTANCE' }>
type AddItemsRow = Extract<WorkerIntent, { type: 'APPLY_ADD_ITEMS_OP' }>['items'][number]

const resolveSpawnItemDefinition = (ws: CanonicalState, intent: SpawnItemInstanceIntent): ItemDefinition | undefined => {
  const existing = ws.itemDefinitions[intent.itemDefId]
  if (existing) return existing
  if (!intent.itemName) return undefined
  const kind = (intent.itemKind as ItemKind) ?? 'standard'
  return {
    id: intent.itemDefId,
    canonicalName: intent.itemName,
    kind,
    sixthsPerUnit: intent.sixthsPerUnit ?? 1,
    armorClass: intent.armorClass,
    ...(kind === 'bundled'
      ? {
          bundleSize: intent.bundleSize ?? 20,
          minToCount: intent.minToCount ?? 1,
          sixthsPerBundle: intent.sixthsPerBundle ?? 1,
        }
      : {}),
    ...((kind === 'standard' || kind === 'coins') && {
      ...(intent.coinagePool !== undefined ? { coinagePool: intent.coinagePool } : {}),
      ...(intent.coinDenom !== undefined ? { coinDenom: intent.coinDenom } : {}),
    }),
  }
}

const resolveAddItemRowDefinition = (ws: CanonicalState, item: AddItemsRow): ItemDefinition | undefined => {
  const existing = ws.itemDefinitions[item.itemDefId]
  if (existing) return existing
  const kind = (item.itemKind as ItemKind) ?? 'standard'
  return {
    id: item.itemDefId,
    canonicalName: item.itemName,
    kind,
    sixthsPerUnit: item.sixthsPerUnit ?? 1,
    armorClass: item.armorClass,
    ...(kind === 'bundled'
      ? {
          bundleSize: item.bundleSize ?? 20,
          minToCount: item.minToCount ?? 1,
          sixthsPerBundle: item.sixthsPerBundle ?? 1,
        }
      : {}),
    ...((kind === 'standard' || kind === 'coins') && {
      ...(item.coinagePool !== undefined ? { coinagePool: item.coinagePool } : {}),
      ...(item.coinDenom !== undefined ? { coinDenom: item.coinDenom } : {}),
    }),
  }
}

export const canonicalizeIntentForReplay = (
  intent: WorkerIntent,
  options: CanonicalizeOptions,
): WorkerIntent => {
  const now = options.now ?? Date.now
  const random = options.random ?? Math.random

  // NOTE: DRAG_SEGMENT_END is not a sync intent — it emits APPLY_DROP_RESULT
  // instead.  APPLY_DROP_RESULT carries all data inline, no canonicalization needed.

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
    if (intent.replay?.entryIds !== undefined) return intent
    const base = options.deriveReplayBase()
    if (!base) return intent
    const qty = Math.max(1, Math.floor(intent.quantity))
    const def = resolveSpawnItemDefinition(base.worldState, intent)
    if (def && isCoinagePooledDefinition(def)) {
      if (intent.targetNodeId) {
        const target = parseNodeId(intent.targetNodeId)
        if (target.actorId && base.worldState.actors[target.actorId]) {
          const shouldDrop = !!target.carryGroupId
          const zone: CarryZone = shouldDrop ? 'dropped' : intent.wornClothing ? 'worn' : (intent.zoneHint ?? 'stowed')
          const state: InventoryEntry['state'] | undefined = shouldDrop
            ? { dropped: true }
            : intent.wornClothing
              ? { worn: true }
              : undefined
          const existing = findPooledCoinageStackToMerge(
            base.worldState,
            target.actorId,
            target.carryGroupId,
            zone,
            state,
            intent.itemDefId,
            def,
          )
          if (existing) {
            return {
              ...intent,
              replay: {
                ...(intent.replay ?? {}),
                entryIds: [],
              },
            }
          }
        }
      }
      const allocated = reserveSpawnEntryIds(base.worldState, intent.itemDefId, 1)
      return {
        ...intent,
        replay: {
          ...(intent.replay ?? {}),
          entryIds: allocated.ids,
        },
      }
    }
    const allocated = reserveSpawnEntryIds(base.worldState, intent.itemDefId, qty)
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
    let simEntries: Record<string, InventoryEntry> = { ...base.worldState.inventoryEntries }
    const spawnEntryIdsByItem: string[][] = []
    for (const item of intent.items) {
      const def = resolveAddItemRowDefinition(nextWorld, item)
      const rowQty = Math.max(1, Math.floor(item.quantity))
      if (def && isCoinagePooledDefinition(def) && intent.targetNodeId) {
        const target = parseNodeId(intent.targetNodeId)
        if (target.actorId && base.worldState.actors[target.actorId]) {
          const shouldDrop = !!target.carryGroupId
          const zone: CarryZone = shouldDrop ? 'dropped' : item.wornClothing ? 'worn' : (item.zoneHint ?? 'stowed')
          const state: InventoryEntry['state'] | undefined = shouldDrop
            ? { dropped: true }
            : item.wornClothing
              ? { worn: true }
              : undefined
          const simWs: CanonicalState = { ...base.worldState, inventoryEntries: simEntries }
          const existing = findPooledCoinageStackToMerge(
            simWs,
            target.actorId,
            target.carryGroupId,
            zone,
            state,
            item.itemDefId,
            def,
          )
          if (existing) {
            spawnEntryIdsByItem.push([])
            const ex = simEntries[existing.id]!
            simEntries = {
              ...simEntries,
              [existing.id]: { ...ex, quantity: Math.max(1, Math.floor(ex.quantity)) + rowQty },
            }
            continue
          }
          const allocated = reserveSpawnEntryIds(nextWorld, item.itemDefId, 1)
          nextWorld = allocated.worldState
          spawnEntryIdsByItem.push(allocated.ids)
          const newId = allocated.ids[0]!
          simEntries = {
            ...simEntries,
            [newId]: {
              id: newId,
              actorId: target.actorId,
              itemDefId: item.itemDefId,
              quantity: rowQty,
              zone,
              carryGroupId: target.carryGroupId,
              state,
            },
          }
          continue
        }
      }
      if (def && isCoinagePooledDefinition(def)) {
        const allocated = reserveSpawnEntryIds(nextWorld, item.itemDefId, 1)
        nextWorld = allocated.worldState
        spawnEntryIdsByItem.push(allocated.ids)
        continue
      }
      const allocated = reserveSpawnEntryIds(nextWorld, item.itemDefId, rowQty)
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
        newEntryIds: newEntryIds ?? undefined,
      },
    }
  }

  return intent
}

