import type { CoinageMetalFraction, TreasuryTally } from '../domain/coinage'
import type {
  ActorKind,
  CanonicalState,
  CarryZone,
  CoinDenom,
  EquipmentState,
  ItemCatalogRow,
  ItemDefinition,
  ItemKind,
  WieldGrip,
} from '../domain/types'
import type { ItemCategory } from '../domain/item-category'
import type { AppRoute, WorldCanvasContext } from '../spacetimedb/context'
import type { RegistryAdjust } from '../spacetimedb/registry-reconcile'
import type { WorldHubSnapshot } from '../spacetimedb/world-hub-snapshot'

export type { ItemCatalogRow }

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
  readonly entryId?: string
  readonly quantity?: number
  readonly zone?: CarryZone
  readonly state?: EquipmentState
  readonly prototype?: {
    readonly id: string
    readonly canonicalName: string
    readonly kind: ItemKind
    readonly sixthsPerUnit?: number
    readonly armorClass?: number
    readonly priceInGp?: number
    readonly isFungibleVisual?: boolean
    readonly coinagePool?: boolean
    readonly coinDenom?: CoinDenom
    readonly bundleSize?: number
    readonly minToCount?: number
    readonly sixthsPerBundle?: number
  }
  /** When present, this segment's entry uses an instance-level override of a base prototype id. */
  readonly overridePrototypeId?: string
  readonly category: ItemCategory
  readonly wield?: WieldGrip
  readonly tooltip: {
    readonly title: string
    readonly encumbranceText: string
    readonly zoneText: string
    readonly quantityText: string
  }
  /** When true, contiguous same-type segments may be visually merged. Fallback: sizeSixths <= 1. */
  readonly isFungibleVisual?: boolean
  /** Synthetic non-removable segment representing a contained node's own weight. */
  readonly isSelfWeightToken?: boolean
  /** Segment is immutable in UI actions (move/delete/duplicate). */
  readonly locked?: boolean
  /** Visual-only non-encumbering worn clothing rendered as pill strip under node. */
  readonly isWornPill?: boolean
  readonly isCoinageMerge?: boolean
  readonly coinageVisual?: { readonly metals: CoinageMetalFraction }
}

export type SceneNodeVM = {
  readonly id: string
  readonly rowId: string
  readonly actorId: string
  readonly groupId: string | null
  /** Parent node id when nested (one-level deep). */
  readonly parentNodeId?: string
  /** Canvas-persisted: full slot grid vs collapsed visible slots. */
  readonly layoutExpanded: boolean
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
  /** Current expanded grid width in stone slots. */
  readonly slotCols: number
  /** Current expanded grid height in stone slots. */
  readonly slotRows: number
  /** Animals and vehicles use green/orange only (50% breakpoint). */
  readonly twoBandSlots?: boolean
  readonly usedSixths: number
  readonly usedStoneText: string
  readonly capacityStoneText: string
  readonly segments: readonly SceneSegmentVM[]
  readonly treasury?: TreasuryTally
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
  readonly listViewEnabled: boolean
  /** Canvas-persisted: full layout size vs fit-to-content chrome. */
  readonly layoutExpanded: boolean
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
  readonly selectedNodeIds: readonly string[]
  readonly selectedGroupIds: readonly string[]
  readonly selectedLabelIds: readonly string[]
  /** Keyboard paste target for Cmd+V (inventory ops / node blob). */
  readonly pasteTargetNodeId: string | null
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
  | {
      readonly type: 'UPDATE_META'
      readonly partyPaceText: string
      readonly hoveredSegmentId: string | null
      readonly filterCategory: ItemCategory | null
      readonly selectedSegmentIds: readonly string[]
      readonly pasteTargetNodeId: string | null
      readonly groups: Record<string, SceneGroupVM>
      readonly freeSegments: Record<string, SceneFreeSegmentVM>
      readonly labels: Record<string, SceneLabelVM>
      readonly selectedLabelId: string | null
    }

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
  | {
      readonly type: 'SET_MARQUEE_SELECTION'
      readonly selection: {
        readonly segmentIds: readonly string[]
        readonly nodeIds: readonly string[]
        readonly groupIds: readonly string[]
        readonly labelIds: readonly string[]
      }
      readonly addToSelection: boolean
    }
  | { readonly type: 'SELECT_ALL_OF_TYPE'; readonly itemDefId: string; readonly nodeId?: string }
  | { readonly type: 'SET_PASTE_TARGET_NODE'; readonly nodeId: string | null }
  | { readonly type: 'MOVE_GROUP'; readonly groupId: string; readonly x: number; readonly y: number }
  | { readonly type: 'RESIZE_GROUP'; readonly groupId: string; readonly width: number; readonly height: number }
  | { readonly type: 'SET_GROUP_LIST_VIEW'; readonly groupId: string; readonly enabled: boolean }
  | { readonly type: 'SET_LAYOUT_EXPANDED'; readonly containerId: string; readonly expanded: boolean }
  | { readonly type: 'RESIZE_NODE'; readonly nodeId: string; readonly slotCols: number; readonly slotRows: number }
  | {
      readonly type: 'ADD_GROUP'
      readonly x: number
      readonly y: number
      readonly replay?: {
        readonly groupId?: string
        readonly groupTitle?: string
      }
    }
  | { readonly type: 'DELETE_GROUP'; readonly groupId: string }
  | {
      readonly type: 'ADD_INVENTORY_NODE'
      readonly x: number
      readonly y: number
      readonly groupId?: string | null
      readonly replay?: {
        /** Deterministic replay values computed when queueing. */
        readonly actorId?: string
        readonly actorName?: string
      }
      /** Legacy replay fields (back-compat for tests/queued payloads). */
      readonly replayActorId?: string
      readonly replayActorName?: string
    }
  | { readonly type: 'UPDATE_GROUP_TITLE'; readonly groupId: string; readonly title: string }
  | { readonly type: 'MOVE_NODE_TO_GROUP_INDEX'; readonly nodeId: string; readonly groupId: string; readonly index: number }
  | {
      readonly type: 'MOVE_NODES_TO_GROUP_INDEX'
      readonly moves: readonly { readonly nodeId: string; readonly groupId: string; readonly index: number }[]
    }
  | { readonly type: 'MOVE_NODE_IN_GROUP'; readonly nodeId: string; readonly groupId: string; readonly x: number; readonly y: number }
  | {
      readonly type: 'MOVE_NODES_IN_GROUP'
      readonly moves: readonly { readonly nodeId: string; readonly groupId: string; readonly x: number; readonly y: number }[]
    }
  | { readonly type: 'DROP_NODE_INTO_NODE'; readonly nodeId: string; readonly targetNodeId: string }
  | { readonly type: 'DROP_NODES_INTO_NODE'; readonly nodeIds: readonly string[]; readonly targetNodeId: string }
  | { readonly type: 'CONNECT_NODE_PARENT'; readonly nodeId: string; readonly parentNodeId: string }
  | { readonly type: 'NEST_NODE_UNDER'; readonly nodeId: string; readonly parentNodeId: string }
  | { readonly type: 'MOVE_NODE_TO_ROOT'; readonly nodeId: string; readonly x: number; readonly y: number }
  | {
      readonly type: 'MOVE_NODES_TO_ROOT'
      readonly moves: readonly { readonly nodeId: string; readonly x: number; readonly y: number }[]
    }
  | { readonly type: 'UPDATE_NODE_TITLE'; readonly nodeId: string; readonly title: string }
  | { readonly type: 'DRAG_SEGMENT_START'; readonly segmentIds: readonly string[] }
  | { readonly type: 'DRAG_SEGMENT_UPDATE'; readonly targetNodeId: string | null }
  | {
      readonly type: 'DRAG_SEGMENT_END'
      readonly targetNodeId: string | null
      readonly targetGroupId?: string | null
      readonly x?: number
      readonly y?: number
      /** Present and complete for free/canvas drops; null when dropping into a node (renderer does not send a map). */
      readonly freeSegmentPositions?: Readonly<Record<string, { x: number; y: number }>> | null
      readonly replay?: {
        /** Snapshotted from dropIntent at queue time for replay-safety (worker-internal). */
        readonly segmentIds?: readonly string[]
        readonly sourceNodeIds?: Readonly<Record<string, string>>
      }
      /** Legacy replay fields (back-compat for tests/queued payloads). */
      readonly replaySegmentIds?: readonly string[]
      readonly replaySourceNodeIds?: Readonly<Record<string, string>>
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
      readonly zoneHint?: CarryZone
      readonly wornClothing?: boolean
      readonly segmentIds?: readonly string[]
      readonly freeSegmentPositions?: Readonly<Record<string, { x: number; y: number }>>
      readonly coinagePool?: boolean
      readonly coinDenom?: CoinDenom
      readonly bundleSize?: number
      readonly minToCount?: number
      readonly sixthsPerBundle?: number
      readonly replay?: {
        /**
         * Deterministic entry ids. Non-pooled: one per quantity unit.
         * Pooled coin/gem: single id for a new stack, or `[]` when quantity merges into an existing stack.
         */
        readonly entryIds?: readonly string[]
      }
    }
  | {
      readonly type: 'APPLY_ADD_ITEMS_OP'
      readonly targetNodeId: string
      readonly items: readonly {
        readonly itemDefId: string
        readonly itemName: string
        readonly quantity: number
        readonly sixthsPerUnit?: number
        readonly itemKind?: string
        readonly armorClass?: number
        readonly wornClothing?: boolean
        readonly zoneHint?: CarryZone
        readonly coinagePool?: boolean
        readonly coinDenom?: CoinDenom
        readonly bundleSize?: number
        readonly minToCount?: number
        readonly sixthsPerBundle?: number
      }[]
      readonly replay?: {
        /**
         * Per-item deterministic entry ids for replay. `spawnEntryIdsByItem[i]`
         * corresponds to `items[i]`. Non-pooled items: one id per quantity unit.
         * Pooled coin/gem rows: one id when a new stack is created, or `[]` when merged into an existing stack.
         */
        readonly spawnEntryIdsByItem?: readonly (readonly string[])[]
      }
    }
  | { readonly type: 'MOVE_ENTRY_TO'; readonly segmentId: string; readonly sourceNodeId: string; readonly targetNodeId: string }
  | {
      readonly type: 'MOVE_ENTRIES_TO'
      readonly moves: readonly { readonly segmentId: string; readonly sourceNodeId: string }[]
      readonly targetNodeId: string
    }
  | { readonly type: 'DELETE_ENTRY'; readonly segmentIds: readonly string[] }
  | {
      readonly type: 'DUPLICATE_ENTRY'
      readonly segmentIds: readonly string[]
      readonly replay?: {
        /** One new entry id per duplicated row, in nested-loop order (same as apply). */
        readonly newEntryIds?: readonly string[]
      }
    }
  | { readonly type: 'DELETE_NODE'; readonly nodeId: string }
  | {
      readonly type: 'DUPLICATE_NODE'
      readonly nodeId: string
      readonly replay?: {
        readonly newActorId?: string
        readonly newActorName?: string
        /** Map source inventory entry id → new entry id for the duplicated actor. */
        readonly entryIdsBySourceEntryId?: Readonly<Record<string, string>>
      }
    }
  | {
      readonly type: 'PASTE_NODE_CLIPBOARD'
      readonly payload: string
      readonly targetNodeId: string | null
      readonly worldX?: number
      readonly worldY?: number
    }
  | { readonly type: 'SET_WIELD'; readonly segmentId: string; readonly wield: WieldGrip }
  | { readonly type: 'UNWIELD'; readonly segmentId: string }
  | {
      readonly type: 'ADD_LABEL'
      readonly text: string
      readonly x: number
      readonly y: number
      readonly replay?: {
        readonly labelId?: string
      }
    }
  | { readonly type: 'UPDATE_LABEL_TEXT'; readonly labelId: string; readonly text: string }
  | { readonly type: 'MOVE_LABEL'; readonly labelId: string; readonly x: number; readonly y: number }
  | { readonly type: 'DELETE_LABEL'; readonly labelId: string }
  | { readonly type: 'SELECT_LABEL'; readonly labelId: string | null }
  | {
      readonly type: 'SAVE_ITEM_EDITOR'
      readonly segmentId: string
      readonly target: 'prototype' | 'instance'
      readonly quantity: number
      readonly zone: CarryZone
      readonly state: EquipmentState
      readonly basePrototypeId: string
      readonly instanceOverrideEnabled: boolean
      readonly prototypePatch: {
        readonly canonicalName: string
        readonly kind: ItemKind
        readonly sixthsPerUnit?: number
        readonly armorClass?: number
        readonly priceInGp?: number
        readonly isFungibleVisual?: boolean
      }
    }
  | { readonly type: 'SET_WORLD_STATE'; readonly worldState: CanonicalState }
  | { readonly type: 'CATALOG_UPSERT_DEFINITION'; readonly definition: ItemDefinition }
  | { readonly type: 'CATALOG_REMOVE_DEFINITION'; readonly id: string }
  | { readonly type: 'DRAG_START' }
  | { readonly type: 'DRAG_END' }
  | {
      /**
       * Replayable sync intent emitted by DRAG_SEGMENT_END after resolving the
       * complex drop logic.  Captures the minimal, idempotent worldState +
       * localState mutations so they survive `deriveWorkingFromServerAndPending`.
       *
       * TODO: long-term, the renderer should emit a high-level "move items to
       * location" intent directly, rather than DRAG_SEGMENT_END.  This intermediate
       * intent bridges the gap until that refactor.
       */
      readonly type: 'APPLY_DROP_RESULT'
      /** Entry mutations: zone, actorId, carryGroupId changes. */
      readonly entryUpdates: Readonly<
        Record<
          string,
          {
            readonly actorId: string
            readonly carryGroupId?: string
            readonly zone: CarryZone
            readonly state?: EquipmentState
          }
        >
      >
      /** Entry IDs removed by coinage consolidation. */
      readonly deleteEntryIds: readonly string[]
      /** Quantity overrides for coinage keeper entries after consolidation. */
      readonly quantityUpdates: Readonly<Record<string, number>>
      /** Wield slots to clear (entry was wielded before the drop). */
      readonly clearWields: readonly { readonly actorId: string; readonly entryId: string }[]
      /** Dropped carry groups to ensure exist. */
      readonly ensureGroups: readonly {
        readonly id: string
        readonly ownerActorId: string
      }[]
      /** Free segment positions to set (canvas drops). */
      readonly freeSegmentPositions: Readonly<Record<string, { x: number; y: number }>>
      /** Group-scoped free segment positions to set. */
      readonly groupFreeSegmentPositions: Readonly<
        Record<string, Record<string, { x: number; y: number }>>
      >
      /** Segment IDs to remove from old free/group positions. */
      readonly removeFromFreePositions: readonly string[]
    }

export type DragSegmentEndIntent = Extract<WorkerIntent, { type: 'DRAG_SEGMENT_END' }>

/** Resolve drop context for DRAG_SEGMENT_END: live dropIntent, or replay snapshot when ephemeral was cleared. */
export function effectiveDropIntentForDragSegmentEnd(
  localDropIntent: DropIntent | null,
  intent: DragSegmentEndIntent,
): DropIntent | null {
  if (localDropIntent) return localDropIntent
  const replaySegmentIds = intent.replay?.segmentIds ?? intent.replaySegmentIds
  const replaySourceNodeIds = intent.replay?.sourceNodeIds ?? intent.replaySourceNodeIds
  if (replaySegmentIds && replaySourceNodeIds) {
    return {
      segmentIds: replaySegmentIds,
      sourceNodeIds: replaySourceNodeIds,
      targetNodeId: intent.targetNodeId,
    }
  }
  return null
}

export interface ConnectedUser {
  identityHex: string
  displayName: string
  role: 'gm' | 'player'
  online: boolean
}

export interface RemoteCursor {
  identityHex: string
  x: number
  y: number
}

export type MainToWorkerMessage =
  | {
      readonly type: 'INIT'
      readonly worldState: CanonicalState
      readonly stonesPerRow?: number
      readonly token?: string
      readonly context: WorldCanvasContext
      readonly appRoute: AppRoute
      /** When true, worker logs `[vtt:room]` traces (mirrors localStorage vtt:debugRoomIds). */
      readonly debugRoomIds?: boolean
      /** When true, worker logs `[drop-debug]` traces (mirrors localStorage vtt:debugDrop). */
      readonly debugDrop?: boolean
    }
  | { readonly type: 'RESET'; readonly worldState: CanonicalState; readonly stonesPerRow?: number }
  | {
      readonly type: 'SET_APP_ROUTE'
      readonly appRoute: AppRoute
      readonly context: WorldCanvasContext
      readonly debugRoomIds?: boolean
      /** When true, worker logs `[drop-debug]` traces (mirrors localStorage vtt:debugDrop). */
      readonly debugDrop?: boolean
    }
  | { readonly type: 'SET_STONES_PER_ROW'; readonly stonesPerRow: number }
  | { readonly type: 'INTENT'; readonly intent: WorkerIntent }
  | { readonly type: 'SET_SPACETIMEDB_TOKEN'; readonly token: string }
  | { readonly type: 'UPDATE_CURSOR'; readonly x: number; readonly y: number }
  | { readonly type: 'SET_DISPLAY_NAME'; readonly name: string }
  | { readonly type: 'SET_WORLD_DISPLAY_NAME'; readonly displayName: string }
  | { readonly type: 'UPDATE_CAMERA'; readonly panX: number; readonly panY: number; readonly zoom: number }
  | { readonly type: 'GET_ITEM_CATALOG'; readonly requestId: string }
  | { readonly type: 'GET_WORLD_HUB'; readonly requestId: string }
  | { readonly type: 'CLIPBOARD_EXPORT'; readonly requestId: string }
  | { readonly type: 'UNDO' }
  | { readonly type: 'REDO' }

export type WorkerToMainMessage =
  | { readonly type: 'REGISTRY_RECONCILE'; readonly adjust: RegistryAdjust }
  | { readonly type: 'SCENE_INIT'; readonly scene: SceneVM }
  | {
      readonly type: 'SCENE_PATCHES'
      readonly patches: readonly ScenePatch[]
      readonly scene: SceneVM
      /** Segment ids the originating client treats as local "originator" (snap until stable); others may still spring. */
      readonly snapSegmentIds?: readonly string[]
      /** Node ids same provenance as snapSegmentIds for pasted/moved inventory panels. */
      readonly snapNodeIds?: readonly string[]
    }
  | { readonly type: 'LOG'; readonly message: string }
  | { readonly type: 'CONNECTION_STATUS'; readonly status: 'connected' | 'disconnected' | 'error' }
  | { readonly type: 'STORE_TOKEN'; readonly token: string }
  | { readonly type: 'PRESENCE_UPDATE'; readonly users: ConnectedUser[]; readonly cursors: RemoteCursor[]; readonly myIdentityHex: string }
  | { readonly type: 'CAMERA_RESTORE'; readonly panX: number; readonly panY: number; readonly zoom: number }
  | { readonly type: 'ITEM_CATALOG'; readonly requestId: string; readonly definitions: readonly ItemCatalogRow[] }
  | { readonly type: 'WORLD_HUB'; readonly requestId: string | null; readonly snapshot: WorldHubSnapshot }
  | { readonly type: 'CLIPBOARD_EXPORT_RESULT'; readonly requestId: string; readonly payload: string }

