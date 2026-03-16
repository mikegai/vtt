import type { ActorKind, CanonicalState, WieldGrip } from '../domain/types'
import type { ItemCategory } from '../domain/item-category'

export type SceneSegmentVM = {
  readonly id: string
  readonly shortLabel: string
  readonly mediumLabel: string
  readonly fullLabel: string
  readonly startSixth: number
  readonly sizeSixths: number
  readonly isOverflow: boolean
  /** True when this segment is the drop-preview placeholder (dashed outline). */
  readonly isDropPreview?: boolean
  readonly itemDefId: string
  readonly category: ItemCategory
  readonly wield?: WieldGrip
  readonly tooltip: {
    readonly title: string
    readonly encumbranceText: string
    readonly zoneText: string
    readonly quantityText: string
  }
}

export type SceneNodeVM = {
  readonly id: string
  readonly rowId: string
  readonly actorId: string
  readonly groupId: string | null
  /** Parent node id when nested (one-level deep). */
  readonly parentNodeId?: string
  readonly actorKind: ActorKind
  readonly title: string
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
  readonly speedFeet: number
  readonly speedBand: string
  readonly fixedGreenStoneSlots: number
  /** Total stone slots (e.g. 20 for PCs, 60 for medium riding horse). */
  readonly slotCount: number
  /** Animals and vehicles use green/orange only (50% breakpoint). */
  readonly twoBandSlots?: boolean
  readonly usedSixths: number
  readonly usedStoneText: string
  readonly capacityStoneText: string
  readonly segments: readonly SceneSegmentVM[]
}

export type SceneLabelVM = {
  readonly id: string
  readonly text: string
  readonly x: number
  readonly y: number
}

export type SceneFreeSegmentVM = {
  readonly id: string
  readonly nodeId: string
  /** Group owner when segment is dropped into a group "space". */
  readonly groupId?: string
  readonly x: number
  readonly y: number
  readonly segment: SceneSegmentVM
}

export type SceneGroupVM = {
  readonly id: string
  readonly title: string
  readonly nodeIds: readonly string[]
  readonly freeSegmentIds: readonly string[]
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
}

export type SceneVM = {
  readonly partyPaceText: string
  readonly hoveredSegmentId: string | null
  readonly filterCategory: ItemCategory | null
  readonly selectedSegmentIds: readonly string[]
  readonly nodes: Record<string, SceneNodeVM>
  readonly freeSegments: Record<string, SceneFreeSegmentVM>
  readonly groups: Record<string, SceneGroupVM>
  readonly labels: Record<string, SceneLabelVM>
  readonly selectedLabelId: string | null
}

export type ScenePatch =
  | { readonly type: 'ADD_NODE'; readonly node: SceneNodeVM }
  | { readonly type: 'REMOVE_NODE'; readonly nodeId: string }
  | { readonly type: 'UPDATE_NODE'; readonly node: SceneNodeVM }
  | { readonly type: 'UPDATE_META'; readonly partyPaceText: string; readonly hoveredSegmentId: string | null; readonly filterCategory: ItemCategory | null; readonly selectedSegmentIds: readonly string[]; readonly groups: Record<string, SceneGroupVM>; readonly freeSegments: Record<string, SceneFreeSegmentVM>; readonly labels: Record<string, SceneLabelVM>; readonly selectedLabelId: string | null }

export type DropIntent = {
  readonly segmentIds: readonly string[]
  readonly sourceNodeIds: Readonly<Record<string, string>>
  readonly targetNodeId: string | null
}

export type WorkerIntent =
  | { readonly type: 'HOVER_SEGMENT'; readonly segmentId: string | null }
  | { readonly type: 'SET_FILTER_CATEGORY'; readonly category: ItemCategory | null }
  | { readonly type: 'SET_SELECTED_SEGMENTS'; readonly segmentIds: readonly string[] }
  | { readonly type: 'SELECT_SEGMENTS_ADD'; readonly segmentIds: readonly string[] }
  | { readonly type: 'SELECT_SEGMENTS_REMOVE'; readonly segmentIds: readonly string[] }
  | { readonly type: 'SELECT_ALL_OF_TYPE'; readonly itemDefId: string; readonly nodeId?: string }
  | { readonly type: 'MOVE_GROUP'; readonly groupId: string; readonly x: number; readonly y: number }
  | { readonly type: 'ADD_GROUP'; readonly x: number; readonly y: number }
  | { readonly type: 'MOVE_NODE_TO_GROUP_INDEX'; readonly nodeId: string; readonly groupId: string; readonly index: number }
  | { readonly type: 'NEST_NODE_UNDER'; readonly nodeId: string; readonly parentNodeId: string }
  | { readonly type: 'MOVE_NODE_TO_ROOT'; readonly nodeId: string; readonly x: number; readonly y: number }
  | { readonly type: 'DRAG_SEGMENT_START'; readonly segmentIds: readonly string[] }
  | { readonly type: 'DRAG_SEGMENT_UPDATE'; readonly targetNodeId: string | null }
  | {
      readonly type: 'DRAG_SEGMENT_END'
      readonly targetNodeId: string | null
      readonly targetGroupId?: string | null
      readonly x?: number
      readonly y?: number
      readonly freeSegmentPositions?: Readonly<Record<string, { x: number; y: number }>>
    }
  | {
      readonly type: 'SPAWN_ITEM_INSTANCE'
      readonly itemDefId: string
      readonly quantity: number
      readonly targetNodeId: string | null
      readonly x?: number
      readonly y?: number
      readonly itemName?: string
      readonly sixthsPerUnit?: number
      readonly itemKind?: string
      readonly armorClass?: number
      readonly segmentIds?: readonly string[]
      readonly freeSegmentPositions?: Readonly<Record<string, { x: number; y: number }>>
    }
  | { readonly type: 'MOVE_ENTRY_TO'; readonly segmentId: string; readonly sourceNodeId: string; readonly targetNodeId: string }
  | {
      readonly type: 'MOVE_ENTRIES_TO'
      readonly moves: readonly { readonly segmentId: string; readonly sourceNodeId: string }[]
      readonly targetNodeId: string
    }
  | { readonly type: 'DELETE_ENTRY'; readonly segmentIds: readonly string[] }
  | { readonly type: 'SET_WIELD'; readonly segmentId: string; readonly wield: WieldGrip }
  | { readonly type: 'UNWIELD'; readonly segmentId: string }
  | { readonly type: 'ADD_LABEL'; readonly text: string; readonly x: number; readonly y: number }
  | { readonly type: 'UPDATE_LABEL_TEXT'; readonly labelId: string; readonly text: string }
  | { readonly type: 'MOVE_LABEL'; readonly labelId: string; readonly x: number; readonly y: number }
  | { readonly type: 'DELETE_LABEL'; readonly labelId: string }
  | { readonly type: 'SELECT_LABEL'; readonly labelId: string | null }
  | { readonly type: 'SET_WORLD_STATE'; readonly worldState: CanonicalState }

export type MainToWorkerMessage =
  | { readonly type: 'INIT'; readonly worldState: CanonicalState; readonly stonesPerRow?: number }
  | { readonly type: 'SET_STONES_PER_ROW'; readonly stonesPerRow: number }
  | { readonly type: 'INTENT'; readonly intent: WorkerIntent }

export type WorkerToMainMessage =
  | { readonly type: 'SCENE_INIT'; readonly scene: SceneVM }
  | { readonly type: 'SCENE_PATCHES'; readonly patches: readonly ScenePatch[]; readonly scene: SceneVM }
  | { readonly type: 'LOG'; readonly message: string }

