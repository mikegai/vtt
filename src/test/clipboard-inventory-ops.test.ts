import { describe, expect, it } from 'vitest'
import {
  applyPasteTargetToInventoryOpsDoc,
  buildInventoryOpsClipboardFromSegments,
  CLIPBOARD_PLACEHOLDER_NODE_ID,
} from '../domain/clipboard-inventory-ops'
import { INVENTORY_OPS_SCHEMA_V1, parseInventoryOpsDocument } from '../domain/inventory-ops-schema'
import type { SceneSegmentVM, SceneVM } from '../worker/protocol'

const seg = (partial: Partial<SceneSegmentVM> & Pick<SceneSegmentVM, 'id'>): SceneSegmentVM =>
  ({
    shortLabel: 'x',
    mediumLabel: 'x',
    fullLabel: 'Iron sword',
    startSixth: 0,
    sizeSixths: 6,
    isOverflow: false,
    itemDefId: 'sword',
    category: 'weapon',
    tooltip: { title: '', encumbranceText: '', zoneText: '', quantityText: '' },
    ...partial,
  }) as SceneSegmentVM

describe('clipboard inventory ops', () => {
  it('builds mutate.add-items with placeholder target', () => {
    const scene: SceneVM = {
      partyPaceText: '',
      hoveredSegmentId: null,
      filterCategory: null,
      selectedSegmentIds: ['e1'],
      selectedNodeIds: [],
      selectedGroupIds: [],
      selectedLabelIds: [],
      pasteTargetNodeId: null,
      nodes: {
        n1: {
          id: 'n1',
          rowId: 'n1',
          actorId: 'a1',
          groupId: null,
          layoutExpanded: true,
          actorKind: 'pc',
          title: 'PC',
          x: 0,
          y: 0,
          width: 100,
          height: 100,
          speedFeet: 40,
          speedBand: 'green',
          fixedGreenStoneSlots: 5,
          slotCount: 20,
          slotCols: 5,
          slotRows: 4,
          usedSixths: 0,
          usedStoneText: '',
          capacityStoneText: '',
          segments: [seg({ id: 'e1', fullLabel: 'Iron sword', quantity: 2, itemDefId: 'sword' })],
        },
      },
      freeSegments: {},
      groups: {},
      labels: {},
      selectedLabelId: null,
      canvasObjects: {},
      selectedCanvasObjectIds: [],
    }
    const doc = buildInventoryOpsClipboardFromSegments(scene, ['e1'])
    expect(doc).not.toBeNull()
    expect(doc!.schema).toBe(INVENTORY_OPS_SCHEMA_V1)
    const add = doc!.ops[0]
    expect(add?.op).toBe('mutate.add-items')
    if (add?.op === 'mutate.add-items') {
      expect(add.target).toEqual({ nodeId: CLIPBOARD_PLACEHOLDER_NODE_ID })
      expect(add.items[0]?.text).toBe('Iron sword')
      expect(add.items[0]?.quantity).toBe(2)
    }
  })

  it('applyPasteTargetToInventoryOpsDoc forces node id for paste', () => {
    const raw = {
      schema: INVENTORY_OPS_SCHEMA_V1,
      ops: [
        {
          op: 'mutate.add-items',
          target: { nodeId: 'some-llm-id' },
          items: [{ text: 'Rope', quantity: 1 }],
        },
      ],
    }
    const fixed = applyPasteTargetToInventoryOpsDoc(raw, 'node-99')
    const parsed = parseInventoryOpsDocument(fixed)
    expect(parsed.ok).toBe(true)
    if (parsed.ok && parsed.value.ops[0]?.op === 'mutate.add-items') {
      expect(parsed.value.ops[0].target).toEqual({ nodeId: 'node-99' })
    }
  })
})
