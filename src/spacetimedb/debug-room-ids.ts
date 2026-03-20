/**
 * Opt-in traces for slug → world/canvas UUID → subscription SQL scope.
 * Enable: `localStorage.setItem('vtt:debugRoomIds', '1')` then reload.
 * Disable: remove the key or set to anything other than '1'.
 */

export const DEBUG_ROOM_IDS_KEY = 'vtt:debugRoomIds'

/** Set from the worker INIT / SET_APP_ROUTE message (workers have no localStorage). */
let workerDebugOverride: boolean | null = null

export function setRoomIdDebugFromWorker(enabled: boolean): void {
  workerDebugOverride = enabled
}

/** Main thread: read flag from localStorage. */
export function readRoomIdDebugFromStorage(): boolean {
  try {
    return typeof localStorage !== 'undefined' && localStorage.getItem(DEBUG_ROOM_IDS_KEY) === '1'
  } catch {
    return false
  }
}

export function isRoomIdDebugEnabled(): boolean {
  if (workerDebugOverride != null) return workerDebugOverride
  return readRoomIdDebugFromStorage()
}

export function logRoomDebug(phase: string, data: Record<string, unknown>): void {
  if (!isRoomIdDebugEnabled()) return
  console.info(`[vtt:room] ${phase}`, data)
}

/** Enable: `localStorage.setItem('vtt:debugCamera', '1')` — traces camera restore vs fitAll on main thread. */
export const DEBUG_CAMERA_KEY = 'vtt:debugCamera'

export function isCameraDebugEnabled(): boolean {
  try {
    return typeof localStorage !== 'undefined' && localStorage.getItem(DEBUG_CAMERA_KEY) === '1'
  } catch {
    return false
  }
}

export function logCameraDebug(phase: string, data: Record<string, unknown>): void {
  if (!isCameraDebugEnabled()) return
  console.info(`[vtt:camera] ${phase}`, data)
}
