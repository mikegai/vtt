import type { CanonicalState } from '../domain/types'

/** Unique id for spawned or duplicated inventory entries (matches worker behavior). */
export const createInventoryEntryId = (state: CanonicalState, itemDefId: string, index?: number): string => {
  const safeDefId = itemDefId.replace(/:/g, '_')
  const base = `spawn_${safeDefId}`
  let attempt = 0
  while (attempt < 1000) {
    const suffix =
      attempt === 0
        ? `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}${index != null ? `_${index}` : ''}`
        : `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}_${attempt}${index != null ? `_${index}` : ''}`
    const nextId = `${base}_${suffix}`
    if (!state.inventoryEntries[nextId]) return nextId
    attempt += 1
  }
  return `${base}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}_fallback`
}
