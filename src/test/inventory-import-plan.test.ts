import { describe, expect, it } from 'vitest'
import { parseInventoryImportPlan } from '../domain/inventory-import-plan'
import { createSourceItemSearchIndex } from '../domain/item-source-search'

describe('inventory import plan', () => {
  const index = createSourceItemSearchIndex()

  it('parses multiple blocks into containers with inferred kinds', () => {
    const input = `
Fighter:
plate armor, shield, short sword

Loot Pile - Crypt Chest:
2 sacks, 14 torches and 3 flasks of oil
`.trim()

    const plan = parseInventoryImportPlan(input, index)
    expect(plan.containers).toHaveLength(2)
    expect(plan.containers[0]?.kind).toBe('character')
    expect(plan.containers[1]?.kind).toBe('loot-pile')
    expect(plan.containers[0]?.inventory.chunks.length).toBeGreaterThan(0)
    expect(plan.containers[1]?.inventory.chunks.length).toBeGreaterThan(0)
  })

  it('supports unlabeled freeform lists as generic containers', () => {
    const plan = parseInventoryImportPlan('plate armor, shield, short sword', index)
    expect(plan.containers).toHaveLength(1)
    expect(plan.containers[0]?.label).toContain('Inventory')
  })
})

