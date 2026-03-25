/**
 * Server mirror + pending replay helpers for optimistic UI (see vm-worker.ts).
 */

import type { CanonicalState } from '../domain/types'
import type { PersistedLocalState } from '../persistence/backend'
import type { WorkerLocalState } from './scene-vm'

export function cloneCanonicalState(state: CanonicalState): CanonicalState {
  return structuredClone(state)
}

/** Ephemeral fields zeroed for comparing server layout-only fingerprints. */
export const ZERO_EPHEMERAL_LOCAL: WorkerLocalState = {
  hoveredSegmentId: null,
  groupPositions: {},
  groupSizeOverrides: {},
  groupListViewEnabled: {},
  layoutExpanded: {},
  nodeGroupOverrides: {},
  nodePositions: {},
  groupNodePositions: {},
  nodeSizeOverrides: {},
  freeSegmentPositions: {},
  groupFreeSegmentPositions: {},
  groupNodeOrders: {},
  customGroups: {},
  groupTitleOverrides: {},
  nodeTitleOverrides: {},
  dropIntent: null,
  stonesPerRow: 25,
  filterCategory: null,
  selectedSegmentIds: [],
  selectedNodeIds: [],
  selectedGroupIds: [],
  selectedLabelIds: [],
  pasteTargetNodeId: null,
  nodeContainment: {},
  labels: {},
  selectedLabelId: null,
}

/** Server wins on key collision; keys only present locally (optimistic drops) stay until server echoes. */
function mergeFreeSegmentPositionMaps(
  server: Readonly<Record<string, { x: number; y: number }>> | undefined,
  local: Readonly<Record<string, { x: number; y: number }>>,
): Record<string, { x: number; y: number }> {
  return { ...local, ...(server ?? {}) }
}

function mergeGroupFreeSegmentPositionMaps(
  server: WorkerLocalState['groupFreeSegmentPositions'] | undefined,
  local: WorkerLocalState['groupFreeSegmentPositions'],
): WorkerLocalState['groupFreeSegmentPositions'] {
  const s = server ?? {}
  const out: WorkerLocalState['groupFreeSegmentPositions'] = { ...local }
  for (const [gid, serverInner] of Object.entries(s)) {
    out[gid] = { ...(local[gid] ?? {}), ...serverInner }
  }
  return out
}

export function stripEphemeralLocalState(state: WorkerLocalState): PersistedLocalState {
  const {
    hoveredSegmentId: _1,
    dropIntent: _2,
    filterCategory: _3,
    selectedSegmentIds: _4,
    selectedNodeIds: _5,
    selectedGroupIds: _6,
    selectedLabelIds: _7,
    pasteTargetNodeId: _pt,
    selectedLabelId: _8,
    ...persisted
  } = state
  return persisted
}

/** Merge persisted layout from server with ephemeral fields from the current UI state. */
export function mergeServerLayoutWithEphemeral(
  layout: Partial<PersistedLocalState>,
  ephemeralSource: WorkerLocalState,
): WorkerLocalState {
  return {
    hoveredSegmentId: ephemeralSource.hoveredSegmentId,
    dropIntent: ephemeralSource.dropIntent,
    filterCategory: ephemeralSource.filterCategory,
    selectedSegmentIds: ephemeralSource.selectedSegmentIds,
    selectedNodeIds: ephemeralSource.selectedNodeIds,
    selectedGroupIds: ephemeralSource.selectedGroupIds,
    selectedLabelIds: ephemeralSource.selectedLabelIds,
    pasteTargetNodeId: ephemeralSource.pasteTargetNodeId,
    selectedLabelId: ephemeralSource.selectedLabelId,
    nodePositions: layout.nodePositions ?? {},
    groupPositions: layout.groupPositions ?? {},
    groupSizeOverrides: layout.groupSizeOverrides ?? {},
    nodeSizeOverrides: layout.nodeSizeOverrides ?? {},
    groupListViewEnabled: layout.groupListViewEnabled ?? {},
    layoutExpanded: layout.layoutExpanded ?? {},
    nodeGroupOverrides: layout.nodeGroupOverrides ?? {},
    groupNodePositions: layout.groupNodePositions ?? {},
    freeSegmentPositions: mergeFreeSegmentPositionMaps(layout.freeSegmentPositions, ephemeralSource.freeSegmentPositions),
    groupFreeSegmentPositions: mergeGroupFreeSegmentPositionMaps(
      layout.groupFreeSegmentPositions,
      ephemeralSource.groupFreeSegmentPositions,
    ),
    groupNodeOrders: layout.groupNodeOrders ?? {},
    customGroups: layout.customGroups ?? {},
    groupTitleOverrides: layout.groupTitleOverrides ?? {},
    nodeTitleOverrides: layout.nodeTitleOverrides ?? {},
    nodeContainment: layout.nodeContainment ?? {},
    labels: layout.labels ?? {},
    stonesPerRow: layout.stonesPerRow ?? ephemeralSource.stonesPerRow,
  }
}

function stableStringify(obj: unknown): string {
  if (obj === null || typeof obj !== 'object') return JSON.stringify(obj)
  if (Array.isArray(obj)) return `[${obj.map(stableStringify).join(',')}]`
  const rec = obj as Record<string, unknown>
  const keys = Object.keys(rec).sort()
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(rec[k])}`).join(',')}}`
}

export function canonicalWorldEquals(a: CanonicalState, b: CanonicalState): boolean {
  return (
    stableStringify(a.actors) === stableStringify(b.actors) &&
    stableStringify(a.inventoryEntries) === stableStringify(b.inventoryEntries) &&
    stableStringify(a.itemDefinitions) === stableStringify(b.itemDefinitions) &&
    stableStringify(a.carryGroups) === stableStringify(b.carryGroups) &&
    stableStringify(a.movementGroups) === stableStringify(b.movementGroups)
  )
}

/** Fingerprint of persisted layout from server partial (for ack). */
export function serverPersistedFingerprint(server: Partial<PersistedLocalState>): string {
  return stableStringify(stripEphemeralLocalState(mergeServerLayoutWithEphemeral(server, ZERO_EPHEMERAL_LOCAL)))
}
