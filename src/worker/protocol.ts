import type { CanonicalState } from '../domain/types'

export type SceneSegmentVM = {
  readonly id: string
  readonly shortLabel: string
  readonly mediumLabel: string
  readonly fullLabel: string
  readonly startSixth: number
  readonly sizeSixths: number
  readonly isOverflow: boolean
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
  readonly title: string
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
  readonly speedFeet: number
  readonly speedBand: string
  readonly usedSixths: number
  readonly usedStoneText: string
  readonly capacityStoneText: string
  readonly segments: readonly SceneSegmentVM[]
}

export type SceneVM = {
  readonly partyPaceText: string
  readonly hoveredSegmentId: string | null
  readonly nodes: Record<string, SceneNodeVM>
}

export type ScenePatch =
  | { readonly type: 'ADD_NODE'; readonly node: SceneNodeVM }
  | { readonly type: 'REMOVE_NODE'; readonly nodeId: string }
  | { readonly type: 'UPDATE_NODE'; readonly node: SceneNodeVM }
  | { readonly type: 'UPDATE_META'; readonly partyPaceText: string; readonly hoveredSegmentId: string | null }

export type WorkerIntent =
  | { readonly type: 'HOVER_SEGMENT'; readonly segmentId: string | null }
  | { readonly type: 'MOVE_NODE'; readonly nodeId: string; readonly x: number; readonly y: number }
  | { readonly type: 'SET_WORLD_STATE'; readonly worldState: CanonicalState }

export type MainToWorkerMessage =
  | { readonly type: 'INIT'; readonly worldState: CanonicalState }
  | { readonly type: 'INTENT'; readonly intent: WorkerIntent }

export type WorkerToMainMessage =
  | { readonly type: 'SCENE_INIT'; readonly scene: SceneVM }
  | { readonly type: 'SCENE_PATCHES'; readonly patches: readonly ScenePatch[]; readonly scene: SceneVM }
  | { readonly type: 'LOG'; readonly message: string }

