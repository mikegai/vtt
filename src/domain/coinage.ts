import { encumbranceCostSixths } from './rules'
import type { CanonicalState, CoinDenom, InventoryEntry, ItemDefinition } from './types'

const entryIdFromSegmentId = (segmentId: string): string => {
  const colon = segmentId.indexOf(':')
  return colon >= 0 ? segmentId.slice(0, colon) : segmentId
}

/** Coins/gems that share one merged weight pool and bar. */
export const isCoinagePooledDefinition = (def: ItemDefinition): boolean =>
  def.kind === 'coins' || (def.kind === 'standard' && def.coinagePool === true)

export const COINAGE_MERGED_DEF_ID = '__coinageMerged__'

export const COINAGE_MERGED_DEFINITION: ItemDefinition = {
  id: COINAGE_MERGED_DEF_ID,
  canonicalName: 'Coinage & gems',
  kind: 'coins',
}

export const isCoinageMergedSegmentId = (segmentId: string): boolean =>
  segmentId.endsWith(':coinageMerged')

/** Stable ids for denomination lines; catalog / Fuse use these. Order = catalog order (cp … pp). */
export const COIN_DENOM_CATALOG_ORDER: readonly string[] = [
  'coinCp',
  'coinBp',
  'coinSp',
  'coinEp',
  'coinGp',
  'coinPp',
]

const CATALOG_COIN_ID_TO_DENOM: Record<string, CoinDenom> = {
  coinCp: 'cp',
  coinBp: 'bp',
  coinSp: 'sp',
  coinEp: 'ep',
  coinGp: 'gp',
  coinPp: 'pp',
}

/** Catalog ids such as `coinGp` → `gp`; non-coin ids → `undefined`. */
export const coinDenomFromCatalogCoinId = (itemDefId: string): CoinDenom | undefined =>
  CATALOG_COIN_ID_TO_DENOM[itemDefId]

/** CP value of one unit of denomination (1 gp = 100 cp for tally). */
export const coinDenomCpValue = (d: CoinDenom): number => {
  switch (d) {
    case 'cp':
    case 'bp':
      return 1
    case 'sp':
      return 10
    case 'ep':
      return 50
    case 'gp':
      return 100
    case 'pp':
      return 500
    default: {
      const _n: never = d
      return _n
    }
  }
}

export type TreasuryTally = {
  readonly cp: number
  readonly bp: number
  readonly sp: number
  readonly ep: number
  readonly gp: number
  readonly pp: number
}

/** Sum visible coin/gem value for treasury medallions (counts per denom; gems → gp via priceInGp). */
export const tallyTreasuryForEntries = (
  entries: readonly InventoryEntry[],
  definitions: CanonicalState['itemDefinitions'],
): TreasuryTally => {
  let cp = 0
  let bp = 0
  let sp = 0
  let ep = 0
  let gp = 0
  let pp = 0
  for (const entry of entries) {
    const def = definitions[entry.itemDefId]
    if (!def || !isCoinagePooledDefinition(def)) continue
    const q = entry.quantity
    if (def.kind === 'standard' && def.coinagePool && def.priceInGp != null && !def.coinDenom) {
      gp += def.priceInGp * q
      continue
    }
    const denom = def.coinDenom
    if (!denom) continue
    if (denom === 'cp') cp += q
    else if (denom === 'bp') bp += q
    else if (denom === 'sp') sp += q
    else if (denom === 'ep') ep += q
    else if (denom === 'gp') gp += q
    else if (denom === 'pp') pp += q
  }
  return { cp, bp, sp, ep, gp, pp }
}

export type CoinageMetalFraction = {
  readonly cp: number
  readonly bp: number
  readonly sp: number
  readonly ep: number
  readonly gp: number
  readonly pp: number
}

/** Fraction of total encumbrance sixths contributed by each metal (for stacked bar). */
export const metalFractionsFromCoinageLines = (
  lines: readonly { definition: ItemDefinition; quantity: number }[],
): CoinageMetalFraction => {
  let wc = 0
  let wb = 0
  let ws = 0
  let we = 0
  let wg = 0
  let wp = 0
  let total = 0
  for (const { definition, quantity } of lines) {
    const w = encumbranceCostSixths(definition, quantity)
    if (w <= 0) continue
    total += w
    if (definition.kind === 'standard' && definition.coinagePool && definition.priceInGp != null && !definition.coinDenom) {
      wg += w
      continue
    }
    const denom = definition.coinDenom
    if (denom === 'cp') wc += w
    else if (denom === 'bp') wb += w
    else if (denom === 'sp') ws += w
    else if (denom === 'ep') we += w
    else if (denom === 'gp') wg += w
    else if (denom === 'pp') wp += w
  }
  if (total <= 0) {
    return { cp: 0, bp: 0, sp: 0, ep: 0, gp: 0, pp: 0 }
  }
  return {
    cp: wc / total,
    bp: wb / total,
    sp: ws / total,
    ep: we / total,
    gp: wg / total,
    pp: wp / total,
  }
}

export const collectCoinagePoolEntryIds = (
  state: CanonicalState,
  actorId: string,
  carryGroupId: string | undefined,
  includeDropped: boolean,
): string[] => {
  const ids: string[] = []
  for (const entry of Object.values(state.inventoryEntries)) {
    if (entry.actorId !== actorId) continue
    if (carryGroupId) {
      if (entry.carryGroupId !== carryGroupId) continue
    } else if (entry.carryGroupId) {
      continue
    }
    const dropped = entry.zone === 'dropped' || !!entry.state?.dropped
    if (includeDropped !== dropped) continue
    const def = state.itemDefinitions[entry.itemDefId]
    if (!def || !isCoinagePooledDefinition(def)) continue
    ids.push(entry.id)
  }
  ids.sort((a, b) => a.localeCompare(b))
  return ids
}

/** Expand segment id to all inventory entry ids affected (coinage merge → every pooled line). */
/** Resolve segment id(s) to inventory entry ids (expands merged coinage). */
export const entryIdsForSegmentMutation = (state: CanonicalState, segmentId: string): string[] => {
  if (!isCoinageMergedSegmentId(segmentId)) {
    return [entryIdFromSegmentId(segmentId)]
  }
  const anchorId = entryIdFromSegmentId(segmentId)
  const entry = state.inventoryEntries[anchorId]
  if (!entry) return [anchorId]
  const includeDropped = entry.zone === 'dropped' || !!entry.state?.dropped
  return expandSegmentIdsForCoinageMerge(
    state,
    [segmentId],
    entry.actorId,
    entry.carryGroupId,
    includeDropped,
  )
}

export const expandSegmentIdsForCoinageMerge = (
  state: CanonicalState,
  segmentIds: readonly string[],
  actorId: string,
  carryGroupId: string | undefined,
  includeDropped: boolean,
): string[] => {
  const out: string[] = []
  const seen = new Set<string>()
  for (const sid of segmentIds) {
    if (isCoinageMergedSegmentId(sid)) {
      for (const id of collectCoinagePoolEntryIds(state, actorId, carryGroupId, includeDropped)) {
        if (!seen.has(id)) {
          seen.add(id)
          out.push(id)
        }
      }
    } else {
      const eid = entryIdFromSegmentId(sid)
      if (!seen.has(eid)) {
        seen.add(eid)
        out.push(eid)
      }
    }
  }
  return out
}

/** Groups pooled coin/gem lines that share the same stack key (for merge-on-drop / consolidate). */
export const pooledCoinageStateFingerprint = (e: Pick<InventoryEntry, 'state' | 'zone'>): string => {
  if (e.zone === 'dropped') return 'd'
  if (e.zone === 'worn') return 'w'
  if (e.state?.dropped) return 'd'
  if (e.state?.worn) return 'w'
  return ''
}

/**
 * Find an existing pooled coin/gem stack to add quantity to (inventory rows only).
 * Dropped piles (canvas / group free space) never merge — each drop stays its own block.
 */
export const findPooledCoinageStackToMerge = (
  ws: CanonicalState,
  actorId: string,
  carryGroupId: string | undefined,
  zone: InventoryEntry['zone'],
  state: InventoryEntry['state'] | undefined,
  itemDefId: string,
  itemDef: ItemDefinition,
): InventoryEntry | undefined => {
  if (!isCoinagePooledDefinition(itemDef)) return undefined
  if (zone === 'dropped') return undefined
  const finger = pooledCoinageStateFingerprint({ zone, state })
  const candidates = Object.values(ws.inventoryEntries).filter((e) => {
    if (e.actorId !== actorId) return false
    if (carryGroupId) {
      if (e.carryGroupId !== carryGroupId) return false
    } else if (e.carryGroupId) {
      return false
    }
    if (e.zone !== zone) return false
    if (e.itemDefId !== itemDefId) return false
    return pooledCoinageStateFingerprint(e) === finger
  })
  candidates.sort((a, b) => a.id.localeCompare(b.id))
  return candidates[0]
}

export type ConsolidatePooledCoinageResult = {
  readonly worldState: CanonicalState
  readonly removedEntryIds: readonly string[]
  /** Removed inventory entry id → keeper id (for remapping free-segment keys after a canvas drop). */
  readonly entryRemapToKeeper: ReadonlyMap<string, string>
}

/**
 * Merge duplicate pooled coin/gem rows on inventory nodes only.
 * Skips `zone: 'dropped'` so separate piles on the canvas or in groups stay distinct.
 */
export const consolidatePooledCoinageInInventory = (ws: CanonicalState): ConsolidatePooledCoinageResult => {
  const groups = new Map<string, InventoryEntry[]>()
  for (const entry of Object.values(ws.inventoryEntries)) {
    const def = ws.itemDefinitions[entry.itemDefId]
    if (!def || !isCoinagePooledDefinition(def)) continue
    if (entry.zone === 'dropped') continue
    const key = `${entry.actorId}|${entry.carryGroupId ?? ''}|${entry.zone}|${entry.itemDefId}|${pooledCoinageStateFingerprint(entry)}`
    const list = groups.get(key)
    if (list) list.push(entry)
    else groups.set(key, [entry])
  }

  const entryRemapToKeeper = new Map<string, string>()
  let inventoryEntries = { ...ws.inventoryEntries }
  let actors = { ...ws.actors }
  const removedEntryIds: string[] = []

  for (const list of groups.values()) {
    if (list.length < 2) continue
    list.sort((a, b) => a.id.localeCompare(b.id))
    const keeper = list[0]!
    const totalQty = list.reduce((s, e) => s + Math.max(1, Math.floor(e.quantity)), 0)
    inventoryEntries[keeper.id] = { ...keeper, quantity: totalQty }
    for (let i = 1; i < list.length; i++) {
      const rid = list[i]!.id
      entryRemapToKeeper.set(rid, keeper.id)
      removedEntryIds.push(rid)
      const { [rid]: _deleted, ...rest } = inventoryEntries
      inventoryEntries = rest
      for (const aid of Object.keys(actors)) {
        const a = actors[aid]!
        if (a.leftWieldingEntryId === rid || a.rightWieldingEntryId === rid) {
          actors[aid] = {
            ...a,
            leftWieldingEntryId: a.leftWieldingEntryId === rid ? undefined : a.leftWieldingEntryId,
            rightWieldingEntryId: a.rightWieldingEntryId === rid ? undefined : a.rightWieldingEntryId,
          }
        }
      }
    }
  }

  if (removedEntryIds.length === 0) {
    return { worldState: ws, removedEntryIds, entryRemapToKeeper }
  }
  return { worldState: { ...ws, inventoryEntries, actors }, removedEntryIds, entryRemapToKeeper }
}
