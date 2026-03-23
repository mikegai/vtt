import type { CoinageMetalFraction, TreasuryTally } from '../domain/coinage'
import type { ActorKind, CarryZone, EquipmentState } from '../domain/types'
import type { ItemCategory } from '../domain/item-category'
import type { LabelLadder } from '../domain/labels'
import type { SpeedBand, SpeedProfile } from '../domain/rules'

export type TooltipVM = {
  readonly title: string
  readonly encumbranceText: string
  readonly zoneText: string
  readonly quantityText: string
}

export type SegmentVM = {
  readonly id: string
  readonly actorId: string
  readonly itemDefId: string
  readonly category: ItemCategory
  readonly quantity: number
  readonly zone: CarryZone
  readonly state: EquipmentState
  readonly startSixth: number
  readonly endSixth: number
  readonly sizeSixths: number
  readonly isOverflow: boolean
  readonly labels: LabelLadder
  readonly tooltip: TooltipVM
  /** When true, contiguous same-type segments may be visually merged. Fallback: sizeSixths <= 1. */
  readonly isFungibleVisual?: boolean
  /** Visual-only non-encumbering worn clothing rendered as pill strip under node. */
  readonly isWornPill?: boolean
  /** Merged coin/gem pool segment. */
  readonly isCoinageMerge?: boolean
  /** Metal mix for stacked coinage bar (fractions sum to ~1). */
  readonly coinageVisual?: { readonly metals: CoinageMetalFraction }
}

export type StoneSlotVM = {
  readonly stoneIndex: number
  readonly startSixth: number
  readonly endSixth: number
  readonly isExtension: boolean
  readonly filledSixths: number
}

export type SpeedBandVM = {
  readonly band: SpeedBand
  readonly speed: SpeedProfile
}

export type ActorRowVM = {
  readonly id: string
  readonly actorId: string
  readonly parentActorId?: string
  readonly title: string
  readonly kind: ActorKind
  readonly isDroppedRow: boolean
  readonly encumbranceSixths: number
  readonly capacitySixths: number
  readonly baseCapacitySixths: number
  readonly speed: SpeedProfile
  readonly speedBand: SpeedBandVM
  readonly slots: readonly StoneSlotVM[]
  readonly segments: readonly SegmentVM[]
  readonly summary: {
    readonly usedStoneText: string
    readonly capacityStoneText: string
    readonly overflowSixths: number
  }
  /** Coin/gem counts for treasury medallions (only when any coinage line exists). */
  readonly treasury?: TreasuryTally
  readonly childRows: readonly ActorRowVM[]
}

export type PartyPaceVM = {
  readonly explorationFeet: number
  readonly combatFeet: number
  readonly runningFeet: number
  readonly milesPerDay: number
  readonly limitedByActorId: string | null
}

export type BoardMetaVM = {
  readonly generatedAtIso: string
  readonly zoomDetailThresholds: {
    readonly far: number
    readonly medium: number
    readonly close: number
  }
}

export type BoardVM = {
  readonly meta: BoardMetaVM
  readonly partyPace: PartyPaceVM
  readonly rows: readonly ActorRowVM[]
}
