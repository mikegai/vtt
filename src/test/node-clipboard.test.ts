import { describe, expect, it } from 'vitest'
import { VTT_CLIPBOARD_NODES_V1 } from '../domain/clipboard-nodes'
import { parseNodeClipboardPayload } from '../worker/node-clipboard'

describe('node clipboard', () => {
  it('parses v1 payload envelope', () => {
    const raw = JSON.stringify({
      schema: VTT_CLIPBOARD_NODES_V1,
      rootNodeIds: ['a'],
      actors: {},
      inventoryEntries: {},
      carryGroups: {},
      itemDefinitions: {},
      local: {
        nodeGroupOverrides: {},
        nodePositions: {},
        groupNodePositions: {},
        nodeSizeOverrides: {},
        layoutExpanded: {},
        nodeTitleOverrides: {},
        nodeContainment: {},
      },
    })
    const doc = parseNodeClipboardPayload(raw)
    expect(doc).not.toBeNull()
    expect(doc!.rootNodeIds).toEqual(['a'])
  })
})
