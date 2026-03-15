export const SIXTHS_PER_STONE = 6
export const BASE_CAPACITY_STONE = 20
export const BASE_CAPACITY_SIXTHS = BASE_CAPACITY_STONE * SIXTHS_PER_STONE

export type ActorKind = 'pc' | 'retainer' | 'hireling' | 'animal' | 'vehicle' | 'loot-pile'

export type ItemKind = 'armor' | 'bulky' | 'standard' | 'coins'

export type CarryZone = 'worn' | 'attached' | 'accessible' | 'stowed' | 'dropped'

export type EquipmentState = {
  readonly worn?: boolean
  readonly attached?: boolean
  readonly heldHands?: 0 | 1 | 2
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
