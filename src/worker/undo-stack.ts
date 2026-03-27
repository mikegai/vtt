import type { CanonicalState } from '../domain/types'
import type { PersistedLocalState } from '../persistence/backend'
import type { WorkerLocalState } from './scene-vm'

export type UndoEntry = {
  readonly beforeWorld: CanonicalState
  readonly beforeLocal: PersistedLocalState
  readonly afterWorld: CanonicalState
  readonly afterLocal: PersistedLocalState
  readonly label: string
}

export type UndoStack = {
  entries: UndoEntry[]
  redoEntries: UndoEntry[]
  readonly maxSize: number
}

export function createUndoStack(maxSize = 50): UndoStack {
  return { entries: [], redoEntries: [], maxSize }
}

export function pushUndo(stack: UndoStack, entry: UndoEntry): void {
  stack.entries.push(entry)
  stack.redoEntries.length = 0
  if (stack.entries.length > stack.maxSize) {
    stack.entries.shift()
  }
}

export function popUndo(stack: UndoStack): UndoEntry | null {
  const entry = stack.entries.pop() ?? null
  if (entry) stack.redoEntries.push(entry)
  return entry
}

export function popRedo(stack: UndoStack): UndoEntry | null {
  const entry = stack.redoEntries.pop() ?? null
  if (entry) stack.entries.push(entry)
  return entry
}

export function clearUndoStack(stack: UndoStack): void {
  stack.entries.length = 0
  stack.redoEntries.length = 0
}

// ── Selective restore ──────────────────────────────────────────────

/**
 * For keys that differ between `source` and `target`, apply `target`'s
 * version to `current`.  Keys unchanged between source/target are left
 * as-is in current (preserving concurrent edits by other users).
 */
function selectiveRestore<T>(
  current: Readonly<Record<string, T>>,
  source: Readonly<Record<string, T>>,
  target: Readonly<Record<string, T>>,
): Record<string, T> {
  const result = { ...current }
  const allKeys = new Set([...Object.keys(source), ...Object.keys(target)])

  for (const key of allKeys) {
    const inSource = key in source
    const inTarget = key in target

    if (inSource && !inTarget) {
      // This action added the key (source=after has it, target=before doesn't) → delete it
      delete result[key]
    } else if (!inSource && inTarget) {
      // This action removed the key → restore it
      result[key] = structuredClone(target[key])
    } else if (inSource && inTarget) {
      if (JSON.stringify(source[key]) !== JSON.stringify(target[key])) {
        result[key] = structuredClone(target[key])
      }
    }
  }

  return result
}

export function applyUndoEntry(
  currentWorld: CanonicalState,
  currentLocal: WorkerLocalState,
  entry: UndoEntry,
  direction: 'undo' | 'redo',
): { worldState: CanonicalState; localState: WorkerLocalState } {
  // source = what the entry says the state looked like at the "from" side
  // target = what we want to restore to
  const source = direction === 'undo' ? entry.afterWorld : entry.beforeWorld
  const target = direction === 'undo' ? entry.beforeWorld : entry.afterWorld
  const localSource = direction === 'undo' ? entry.afterLocal : entry.beforeLocal
  const localTarget = direction === 'undo' ? entry.beforeLocal : entry.afterLocal

  const worldState: CanonicalState = {
    actors: selectiveRestore(currentWorld.actors, source.actors, target.actors),
    itemDefinitions: selectiveRestore(currentWorld.itemDefinitions, source.itemDefinitions, target.itemDefinitions),
    inventoryEntries: selectiveRestore(currentWorld.inventoryEntries, source.inventoryEntries, target.inventoryEntries),
    carryGroups: selectiveRestore(currentWorld.carryGroups, source.carryGroups, target.carryGroups),
    movementGroups: selectiveRestore(currentWorld.movementGroups, source.movementGroups, target.movementGroups),
  }

  // Selectively restore persisted local state fields (all Record<string, ...>)
  const localState: WorkerLocalState = {
    ...currentLocal,
    groupPositions: selectiveRestore(currentLocal.groupPositions, localSource.groupPositions, localTarget.groupPositions),
    groupSizeOverrides: selectiveRestore(currentLocal.groupSizeOverrides, localSource.groupSizeOverrides, localTarget.groupSizeOverrides),
    groupListViewEnabled: selectiveRestore(currentLocal.groupListViewEnabled, localSource.groupListViewEnabled, localTarget.groupListViewEnabled),
    layoutExpanded: selectiveRestore(currentLocal.layoutExpanded, localSource.layoutExpanded, localTarget.layoutExpanded),
    nodeGroupOverrides: selectiveRestore(currentLocal.nodeGroupOverrides, localSource.nodeGroupOverrides, localTarget.nodeGroupOverrides),
    nodePositions: selectiveRestore(currentLocal.nodePositions, localSource.nodePositions, localTarget.nodePositions),
    groupNodePositions: selectiveRestore(currentLocal.groupNodePositions, localSource.groupNodePositions, localTarget.groupNodePositions),
    nodeSizeOverrides: selectiveRestore(currentLocal.nodeSizeOverrides, localSource.nodeSizeOverrides, localTarget.nodeSizeOverrides),
    freeSegmentPositions: selectiveRestore(currentLocal.freeSegmentPositions, localSource.freeSegmentPositions, localTarget.freeSegmentPositions),
    groupFreeSegmentPositions: selectiveRestore(currentLocal.groupFreeSegmentPositions, localSource.groupFreeSegmentPositions, localTarget.groupFreeSegmentPositions),
    groupNodeOrders: selectiveRestore(currentLocal.groupNodeOrders, localSource.groupNodeOrders, localTarget.groupNodeOrders),
    customGroups: selectiveRestore(currentLocal.customGroups, localSource.customGroups, localTarget.customGroups),
    groupTitleOverrides: selectiveRestore(currentLocal.groupTitleOverrides, localSource.groupTitleOverrides, localTarget.groupTitleOverrides),
    nodeTitleOverrides: selectiveRestore(currentLocal.nodeTitleOverrides, localSource.nodeTitleOverrides, localTarget.nodeTitleOverrides),
    nodeContainment: selectiveRestore(currentLocal.nodeContainment, localSource.nodeContainment, localTarget.nodeContainment),
    labels: selectiveRestore(currentLocal.labels, localSource.labels, localTarget.labels),
    canvasObjects: selectiveRestore(currentLocal.canvasObjects, localSource.canvasObjects, localTarget.canvasObjects),
    stonesPerRow: localTarget.stonesPerRow,
  }

  return { worldState, localState }
}
