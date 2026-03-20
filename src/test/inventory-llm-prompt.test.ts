import { describe, expect, it } from 'vitest'
import { buildInventoryLlmPrompt } from '../domain/inventory-llm-prompt'
import type { ItemCatalogRow } from '../domain/types'

const stubCatalog: readonly ItemCatalogRow[] = [
  {
    id: 'weapons:short-sword',
    canonicalName: 'Short Sword',
    kind: 'standard',
    sixthsPerUnit: 1,
  },
]

describe('inventory llm prompt', () => {
  it('composes instructions, schema, and user description', () => {
    const prompt = buildInventoryLlmPrompt({
      userDescription: 'armiger with tunic, belt, boots, chain mail, and shield',
      catalogRows: stubCatalog,
    })

    expect(prompt).toContain('vtt.inventory.ops.v1')
    expect(prompt).toContain('non-encumbering clothing')
    expect(prompt).toContain('armiger with tunic')
    expect(prompt).toContain('one JSON object')
    expect(prompt).toContain('```json')
    expect(prompt).toContain('code box')
    expect(prompt).toContain('Copy')
    expect(prompt).toContain('type InventoryOpsDocumentV1')
    expect(prompt).toContain('type InventoryItemInput')
    expect(prompt).toContain('## Source catalog (world, compact)')
    expect(prompt).toContain('Short Sword')
    expect(prompt).toContain('prototypeName')
  })
})
