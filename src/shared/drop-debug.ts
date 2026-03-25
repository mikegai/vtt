/**
 * Opt-in free-drop traces: filter console for `[drop-debug]`. Each line is one JSON object.
 * Enable: `localStorage.setItem('vtt:debugDrop', '1')` then reload.
 * Disable: remove the key or set to anything other than `'1'`.
 *
 * Workers have no localStorage; the main thread passes the flag on INIT / SET_APP_ROUTE.
 */

export const DEBUG_DROP_KEY = 'vtt:debugDrop'

let workerDropDebugOverride: boolean | null = null

export function setDropDebugFromWorker(enabled: boolean): void {
  workerDropDebugOverride = enabled
}

export function readDropDebugFromStorage(): boolean {
  try {
    return typeof localStorage !== 'undefined' && localStorage.getItem(DEBUG_DROP_KEY) === '1'
  } catch {
    return false
  }
}

export function isDropDebugEnabled(): boolean {
  if (workerDropDebugOverride != null) return workerDropDebugOverride
  return readDropDebugFromStorage()
}

export function dropDebug(phase: string, payload: Record<string, unknown>): void {
  if (!isDropDebugEnabled()) return
  console.info('[drop-debug]', JSON.stringify({ phase, ...payload }))
}
