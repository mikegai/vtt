export const SIXTHS_PER_STONE = 6
export const BASE_CAPACITY_STONE = 20
export const BASE_CAPACITY_SIXTHS = BASE_CAPACITY_STONE * SIXTHS_PER_STONE

export type ActorKind = 'pc' | 'retainer' | 'hireling' | 'animal' | 'vehicle' | 'loot-pile'

export type ItemKind = 'armor' | 'bulky' | 'standard' | 'coins'

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
