export const SIXTHS_PER_STONE = 6
export const BASE_CAPACITY_STONE = 20
export const BASE_CAPACITY_SIXTHS = BASE_CAPACITY_STONE * SIXTHS_PER_STONE

export type ActorKind = 'pc' | 'retainer' | 'hireling' | 'animal' | 'vehicle' | 'loot-pile'

export type ItemKind = 'armor' | 'bulky' | 'standard' | 'coins' | 'bundled'

/** For coin/gem lines that participate in treasury display. */
export type CoinDenom = 'cp' | 'bp' | 'sp' | 'ep' | 'gp' | 'pp'

export type CarryZone = 'worn' | 'attached' | 'accessible' | 'stowed' | 'dropped'

export type WieldGrip = 'left' | 'right' | 'both'

export type EquipmentState = {
  readonly worn?: boolean
  readonly attached?: boolean
  readonly heldHands?: 0 | 1 | 2
  readonly wield?: WieldGrip
  readonly dropped?: boolean
  readonly inaccessible?: boolean
}

export type ItemDefinition = {
  readonly id: string
  readonly canonicalName: string
  readonly kind: ItemKind
  readonly sixthsPerUnit?: number
  readonly armorClass?: number
  /** Price in gp (1 pp = 10 gp = 100 sp = 1000 cp). Convert for display only. */
  readonly priceInGp?: number
  /** When true, contiguous same-type segments may be visually merged. Fallback: sizeSixths <= 1. */
  readonly isFungibleVisual?: boolean
  /** When true with kind standard (or coins), weight uses coin pool (1000 units ≈ 1 stone). */
  readonly coinagePool?: boolean
  /** Denomination for coin lines (treasury + bar color). Gems may omit and use priceInGp only. */
  readonly coinDenom?: CoinDenom
  /** Pieces per encumbrance step (e.g. 20 arrows = one sixth). */
  readonly bundleSize?: number
  /** First N-1 pieces incur no encumbrance (default 1). */
  readonly minToCount?: number
  /** Sixths per full bundle step (default 1). */
  readonly sixthsPerBundle?: number
}

/** Snapshot of item definitions for LLM prompt + add-items exact matching (main ↔ worker). */
export type ItemCatalogRow = {
  readonly id: string
  readonly canonicalName: string
  readonly kind: ItemKind
  readonly sixthsPerUnit?: number
  readonly armorClass?: number
  readonly priceInGp?: number
  readonly coinagePool?: boolean
  readonly coinDenom?: CoinDenom
  readonly bundleSize?: number
  readonly minToCount?: number
  readonly sixthsPerBundle?: number
}

export type InventoryEntry = {
  readonly id: string
  readonly actorId: string
  readonly itemDefId: string
  readonly quantity: number
  readonly zone: CarryZone
  readonly state?: EquipmentState
  readonly carryGroupId?: string
}

export type ActorStats = {
  readonly strengthMod: number
  readonly hasLoadBearing: boolean
}

export type Actor = {
  readonly id: string
  readonly name: string
  readonly kind: ActorKind
  readonly stats: ActorStats
  readonly movementGroupId: string
  readonly active: boolean
  /** For animals/henchmen: the actor who owns or rides them. */
  readonly ownerActorId?: string
  /** For animals: total capacity in stone (e.g. mule 50, medium riding horse 60). */
  readonly capacityStone?: number
  /** For animals/vehicles: base speed when unencumbered (100% at ≤50% capacity, 50% when over). */
  readonly baseSpeedProfile?: {
    readonly explorationFeet: number
    readonly combatFeet: number
    readonly runningFeet: number
    readonly milesPerDay: number
  }
  /** Entry id wielded in left hand. Mutually exclusive with right; both can point to same 2-handed item. */
  readonly leftWieldingEntryId?: string
  /** Entry id wielded in right hand. A 2-handed item loses both if either hand is reassigned. */
  readonly rightWieldingEntryId?: string
}

export type CarryGroup = {
  readonly id: string
  readonly ownerActorId: string
  readonly name: string
  readonly dropped: boolean
}

export type MovementGroup = {
  readonly id: string
  readonly name: string
  readonly active: boolean
}

export type CanonicalState = {
  readonly actors: Record<string, Actor>
  readonly itemDefinitions: Record<string, ItemDefinition>
  readonly inventoryEntries: Record<string, InventoryEntry>
  readonly carryGroups: Record<string, CarryGroup>
  readonly movementGroups: Record<string, MovementGroup>
}
