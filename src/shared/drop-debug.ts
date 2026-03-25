/**
 * Free-drop diagnosis: filter the browser / worker console for `[drop-debug]`.
 * Each line is one JSON object (easy to copy as one block).
 */
export function dropDebug(phase: string, payload: Record<string, unknown>): void {
  console.info('[drop-debug]', JSON.stringify({ phase, ...payload }))
}
