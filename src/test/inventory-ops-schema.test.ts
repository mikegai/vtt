import { describe, expect, it } from 'vitest'
import {
  INVENTORY_OPS_SCHEMA_V1,
  parseInventoryOpsDocument,
  unwrapPastedInventoryJson,
  type InventoryOpsDocumentV1,
} from '../domain/inventory-ops-schema'

describe('inventory ops schema', () => {
  it('unwrapPastedInventoryJson strips a single json fence', () => {
    const inner = `{\n  "schema": "${INVENTORY_OPS_SCHEMA_V1}",\n  "ops": []\n}`
    expect(unwrapPastedInventoryJson('```json\n' + inner + '\n```')).toBe(inner)
    expect(unwrapPastedInventoryJson('```\n' + inner + '\n```')).toBe(inner)
    expect(unwrapPastedInventoryJson(`  \`\`\`json\n${inner}\n\`\`\`  `)).toBe(inner)
    expect(unwrapPastedInventoryJson(inner)).toBe(inner)
  })

  it('accepts deterministic query + mutation pipelines', () => {
    const input: InventoryOpsDocumentV1 = {
      schema: INVENTORY_OPS_SCHEMA_V1,
      ops: [
        {
          op: 'query.nodes',
          into: 'partyNodes',
          where: {
            partyId: 'party:red-lions',
          },
        },
        {
          op: 'query.entries',
          from: {
            ref: 'partyNodes',
          },
          into: 'partyEntries',
        },
        {
          op: 'mutate.move-entries-to-ground',
          from: {
            ref: 'partyEntries',
          },
          placement: 'near-owner',
        },
      ],
    }

    const parsed = parseInventoryOpsDocument(input)
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return

    expect(parsed.value.ops).toHaveLength(3)
    expect(parsed.value.ops[0]?.op).toBe('query.nodes')
    expect(parsed.value.ops[1]?.op).toBe('query.entries')
    expect(parsed.value.ops[2]?.op).toBe('mutate.move-entries-to-ground')
  })

  it('rejects unknown schema versions', () => {
    const parsed = parseInventoryOpsDocument({
      schema: 'vtt.inventory.ops.v0',
      ops: [],
    })
    expect(parsed.ok).toBe(false)
    if (parsed.ok) return
    expect(parsed.error).toContain('schema')
  })

  it('rejects non deterministic query references', () => {
    const parsed = parseInventoryOpsDocument({
      schema: INVENTORY_OPS_SCHEMA_V1,
      ops: [
        {
          op: 'query.entries',
          from: {
            ref: '',
          },
          into: 'entries',
        },
      ],
    })

    expect(parsed.ok).toBe(false)
    if (parsed.ok) return
    expect(parsed.error).toContain('ref')
  })

  it('rejects empty prototypeName on add-items lines', () => {
    const parsed = parseInventoryOpsDocument({
      schema: INVENTORY_OPS_SCHEMA_V1,
      ops: [
        {
          op: 'mutate.add-items',
          target: { nodeId: 'n1' },
          items: [{ text: 'shield', prototypeName: '   ' }],
        },
      ],
    })
    expect(parsed.ok).toBe(false)
    if (parsed.ok) return
    expect(parsed.error).toContain('prototypeName')
  })

  it('accepts optional prototypeName on add-items lines', () => {
    const parsed = parseInventoryOpsDocument({
      schema: INVENTORY_OPS_SCHEMA_V1,
      ops: [
        {
          op: 'mutate.add-items',
          target: { nodeId: 'n1' },
          items: [{ text: 'ornate dagger', quantity: 1, prototypeName: 'Dagger' }],
        },
      ],
    })
    expect(parsed.ok).toBe(true)
  })
})
