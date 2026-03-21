import type { CanonicalState } from '../domain/types'
import type { WorkerLocalState } from '../worker/scene-vm'

export type PersistedLocalState = Omit<
  WorkerLocalState,
  | 'hoveredSegmentId'
  | 'dropIntent'
  | 'filterCategory'
  | 'selectedSegmentIds'
  | 'selectedNodeIds'
  | 'selectedGroupIds'
  | 'selectedLabelIds'
  | 'pasteTargetNodeId'
  | 'selectedLabelId'
>

export interface PersistenceBackend {
  loadWorldState(): Promise<CanonicalState | null>
  saveWorldState(state: CanonicalState): Promise<void>
  loadLocalState(): Promise<Partial<PersistedLocalState> | null>
  saveLocalState(state: PersistedLocalState): Promise<void>
  clear(): Promise<void>
}
