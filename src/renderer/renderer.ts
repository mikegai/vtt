import type { BoardPatch } from '../vm/diff'
import type { BoardVM } from '../vm/vm-types'

export type VttIntent =
  | { readonly type: 'SELECT_ACTOR'; readonly actorId: string }
  | { readonly type: 'HOVER_SEGMENT'; readonly segmentId: string }
  | { readonly type: 'DROP_CARRY_GROUP'; readonly actorId: string; readonly carryGroupId: string }
  | { readonly type: 'PICK_UP_CARRY_GROUP'; readonly actorId: string; readonly carryGroupId: string }
  | { readonly type: 'MOVE_ITEM'; readonly inventoryEntryId: string; readonly zone: string }
  | { readonly type: 'SET_HELD_HANDS'; readonly inventoryEntryId: string; readonly hands: 0 | 1 | 2 }

export type RendererAdapter = {
  fullRebuild(board: BoardVM): void
  applyPatch(patch: BoardPatch): void
}

export type IntentSink = (intent: VttIntent) => void
