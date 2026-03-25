import { describe, expect, it } from 'vitest'
import { buildUpdateMetaPatch, diffSceneVM, freeSegmentsLayoutKey } from '../worker/scene-diff'
import type { SceneSegmentVM, SceneVM } from '../worker/protocol'

const seg = (id: string): SceneSegmentVM =>
  ({
    id,
    shortLabel: '',
    mediumLabel: '',
    fullLabel: '',
    startSixth: 0,
    sizeSixths: 6,
    isOverflow: false,
    isDropPreview: false,
    itemDefId: 'x',
    entryId: id,
    quantity: 1,
    zone: 'stowed',
  }) as unknown as SceneSegmentVM

const baseScene = (free: SceneVM['freeSegments']): SceneVM => ({
  partyPaceText: '',
  hoveredSegmentId: null,
  filterCategory: null,
  selectedSegmentIds: [],
  selectedNodeIds: [],
  selectedGroupIds: [],
  selectedLabelIds: [],
  pasteTargetNodeId: null,
  nodes: {},
  freeSegments: free,
  groups: {},
  labels: {},
  selectedLabelId: null,
})

describe('freeSegmentsLayoutKey', () => {
  it('changes when a free segment anchor moves', () => {
    const a = baseScene({ s1: { id: 's1', nodeId: 'n', x: 1, y: 2, segment: seg('s1') } })
    const b = baseScene({ s1: { id: 's1', nodeId: 'n', x: 9, y: 2, segment: seg('s1') } })
    expect(freeSegmentsLayoutKey(a)).not.toBe(freeSegmentsLayoutKey(b))
  })
})

describe('buildUpdateMetaPatch', () => {
  it('includes freeSegments from scene', () => {
    const scene = baseScene({ z: { id: 'z', nodeId: 'n', x: 3, y: 4, segment: seg('z') } })
    const p = buildUpdateMetaPatch(scene)
    expect(p.type).toBe('UPDATE_META')
    expect(p.freeSegments.z?.x).toBe(3)
  })
})

describe('diffSceneVM', () => {
  it('includes UPDATE_META when free segments appear on canvas', () => {
    const prev = baseScene({})
    const next = baseScene({
      s1: { id: 's1', nodeId: 'row', x: 100, y: 200, segment: seg('s1') },
    })
    const patches = diffSceneVM(prev, next)
    expect(patches.filter((p) => p.type === 'UPDATE_META').length).toBe(1)
  })
})
