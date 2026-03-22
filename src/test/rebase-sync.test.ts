import { describe, expect, it } from 'vitest'
import { sampleState } from '../sample-data'
import {
  canonicalWorldEquals,
  cloneCanonicalState,
  mergeServerLayoutWithEphemeral,
  serverPersistedFingerprint,
  stripEphemeralLocalState,
  ZERO_EPHEMERAL_LOCAL,
} from '../worker/vm-worker-rebase'

describe('optimistic rebase helpers', () => {
  it('canonicalWorldEquals is reflexive for sample state', () => {
    const w = cloneCanonicalState(sampleState)
    expect(canonicalWorldEquals(w, sampleState)).toBe(true)
  })

  it('canonicalWorldEquals detects inventory change', () => {
    const a = cloneCanonicalState(sampleState)
    const b = cloneCanonicalState(sampleState)
    const ids = Object.keys(b.inventoryEntries)
    const id = ids[0]
    if (!id) throw new Error('expected inventory')
    b.inventoryEntries[id] = { ...b.inventoryEntries[id]!, quantity: 999 }
    expect(canonicalWorldEquals(a, b)).toBe(false)
  })

  it('mergeServerLayoutWithEphemeral preserves ephemeral fields', () => {
    const serverLayout = { nodePositions: { a: { x: 1, y: 2 } } }
    const ep: typeof ZERO_EPHEMERAL_LOCAL = {
      ...ZERO_EPHEMERAL_LOCAL,
      hoveredSegmentId: 'seg1',
      selectedSegmentIds: ['s1'],
    }
    const merged = mergeServerLayoutWithEphemeral(serverLayout, ep as import('../worker/scene-vm').WorkerLocalState)
    expect(merged.hoveredSegmentId).toBe('seg1')
    expect(merged.selectedSegmentIds).toEqual(['s1'])
    expect(merged.nodePositions.a).toEqual({ x: 1, y: 2 })
  })

  it('serverPersistedFingerprint matches for equivalent layout', () => {
    const layout = { stonesPerRow: 25, nodePositions: {} }
    const fp1 = serverPersistedFingerprint(layout)
    const fp2 = serverPersistedFingerprint({ ...layout })
    expect(fp1).toBe(fp2)
  })

  it('stripEphemeralLocalState matches merge baseline for zero ephemeral', () => {
    const merged = mergeServerLayoutWithEphemeral({ nodePositions: { n: { x: 0, y: 0 } } }, ZERO_EPHEMERAL_LOCAL)
    const p = stripEphemeralLocalState(merged)
    expect(serverPersistedFingerprint(p)).toBe(serverPersistedFingerprint({ nodePositions: { n: { x: 0, y: 0 } } }))
  })
})
