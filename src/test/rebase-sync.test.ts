import { describe, expect, it } from 'vitest'
import { sampleState } from '../sample-data'
import type { WorkerLocalState } from '../worker/scene-vm'
import { effectiveDropIntentForDragSegmentEnd } from '../worker/protocol'
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
    const merged = mergeServerLayoutWithEphemeral(serverLayout, ep as WorkerLocalState)
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

  it('mergeServerLayoutWithEphemeral uses server freeSegmentPositions over stale local ephemeral', () => {
    const serverLayout = { freeSegmentPositions: { a: { x: 1, y: 1 } } }
    const ep: typeof ZERO_EPHEMERAL_LOCAL = {
      ...ZERO_EPHEMERAL_LOCAL,
      freeSegmentPositions: { a: { x: 99, y: 99 } },
    }
    const merged = mergeServerLayoutWithEphemeral(serverLayout, ep as WorkerLocalState)
    expect(merged.freeSegmentPositions.a).toEqual({ x: 1, y: 1 })
  })

  it('mergeServerLayoutWithEphemeral does not copy local-only freeSegmentPositions missing from server', () => {
    const serverLayout = { freeSegmentPositions: { other: { x: 0, y: 0 } } }
    const ep: typeof ZERO_EPHEMERAL_LOCAL = {
      ...ZERO_EPHEMERAL_LOCAL,
      freeSegmentPositions: {
        other: { x: 0, y: 0 },
        justDropped: { x: 400, y: 300 },
      },
    }
    const merged = mergeServerLayoutWithEphemeral(serverLayout, ep as WorkerLocalState)
    expect(merged.freeSegmentPositions.other).toEqual({ x: 0, y: 0 })
    expect(merged.freeSegmentPositions.justDropped).toBeUndefined()
  })

  it('mergeServerLayoutWithEphemeral uses server groupFreeSegmentPositions over stale local ephemeral', () => {
    const serverLayout = {
      groupFreeSegmentPositions: { g1: { s1: { x: 1, y: 1 } } },
    }
    const ep: typeof ZERO_EPHEMERAL_LOCAL = {
      ...ZERO_EPHEMERAL_LOCAL,
      groupFreeSegmentPositions: { g1: { s1: { x: 99, y: 99 } } },
    }
    const merged = mergeServerLayoutWithEphemeral(serverLayout, ep as WorkerLocalState)
    expect(merged.groupFreeSegmentPositions.g1!.s1).toEqual({ x: 1, y: 1 })
  })

  it('after server-wins merge, replay-style intent patch restores optimistic freeSegmentPositions', () => {
    const serverLayout = { freeSegmentPositions: { segA: { x: 1, y: 1 } } }
    const ep: typeof ZERO_EPHEMERAL_LOCAL = {
      ...ZERO_EPHEMERAL_LOCAL,
      freeSegmentPositions: { segA: { x: 99, y: 99 } },
    }
    let merged = mergeServerLayoutWithEphemeral(serverLayout, ep as WorkerLocalState)
    expect(merged.freeSegmentPositions.segA).toEqual({ x: 1, y: 1 })

    // Mirrors deriveWorkingFromServerAndPending: merge first, then pending DRAG_SEGMENT_END applies
    // explicit coordinates (same spread as vm-worker DRAG_SEGMENT_END when intent.freeSegmentPositions is set).
    const intentFreeSegmentPositions = { segA: { x: 50, y: 60 } }
    merged = {
      ...merged,
      freeSegmentPositions: {
        ...merged.freeSegmentPositions,
        ...intentFreeSegmentPositions,
      },
    }
    expect(merged.freeSegmentPositions.segA).toEqual({ x: 50, y: 60 })
  })

  it('effectiveDropIntentForDragSegmentEnd prefers live dropIntent when replay fields are null', () => {
    const live = {
      segmentIds: ['cutthroatHandAxe'],
      sourceNodeIds: { cutthroatHandAxe: 'cutthroat' },
      targetNodeId: 'cutthroat',
    } as const
    const intent = {
      type: 'DRAG_SEGMENT_END' as const,
      targetNodeId: null,
      freeSegmentPositions: { cutthroatHandAxe: { x: 10, y: 20 } },
      replaySegmentIds: ['wrong'],
      replaySourceNodeIds: { wrong: 'x' },
    }
    expect(effectiveDropIntentForDragSegmentEnd(live, intent)).toBe(live)
  })

  it('effectiveDropIntentForDragSegmentEnd restores from replay snapshot when dropIntent is null', () => {
    const intent = {
      type: 'DRAG_SEGMENT_END' as const,
      targetNodeId: null,
      x: 100,
      y: 200,
      freeSegmentPositions: { segA: { x: 50, y: 60 } },
      replaySegmentIds: ['segA'],
      replaySourceNodeIds: { segA: 'cutthroat' },
    }
    const e = effectiveDropIntentForDragSegmentEnd(null, intent)
    expect(e).not.toBeNull()
    expect(e!.segmentIds).toEqual(['segA'])
    expect(e!.sourceNodeIds).toEqual({ segA: 'cutthroat' })
    expect(e!.targetNodeId).toBeNull()
  })

  it('effectiveDropIntentForDragSegmentEnd returns null when replay snapshot is incomplete', () => {
    const intent = {
      type: 'DRAG_SEGMENT_END' as const,
      targetNodeId: null,
      replaySegmentIds: ['segA'],
      // missing replaySourceNodeIds
    }
    expect(effectiveDropIntentForDragSegmentEnd(null, intent)).toBeNull()
  })
})
