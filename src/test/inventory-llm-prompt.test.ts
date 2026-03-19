import { describe, expect, it } from 'vitest'
import { buildInventoryLlmPrompt } from '../domain/inventory-llm-prompt'

describe('inventory llm prompt', () => {
  it('composes instructions, schema, and user description', () => {
    const prompt = buildInventoryLlmPrompt({
      userDescription: 'armiger with tunic, belt, boots, chain mail, and shield',
    })

    expect(prompt).toContain('vtt.inventory.ops.v1')
    expect(prompt).toContain('non-encumbering clothing')
    expect(prompt).toContain('armiger with tunic')
    expect(prompt).toContain('Return JSON only')
    expect(prompt).toContain('cut-and-pasteable')
    expect(prompt).toContain('Begin with "{" and end with "}"')
    expect(prompt).toContain('type InventoryOpsDocumentV1')
    expect(prompt).toContain('type InventoryItemInput')
  })
})
