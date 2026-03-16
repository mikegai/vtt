import { describe, expect, it } from 'vitest'
import { fighterTemplates } from '../domain/fighter-templates'
import { parseEncumbranceToSixths } from '../domain/template-catalog'
import { stoneToSixths } from '../domain/rules'

describe('fighter template ingestion', () => {
  it('includes all 8 fighter templates from source table', () => {
    expect(fighterTemplates).toHaveLength(8)
    expect(fighterTemplates[0]?.template).toBe('Thug')
    expect(fighterTemplates[7]?.template).toBe('Cataphract')
  })

  it('parses declared encumbrance for each template', () => {
    for (const template of fighterTemplates) {
      expect(template.declaredEncumbranceSixths).toBeGreaterThan(0)
      expect(template.declaredEncumbranceSixths).toBeLessThanOrEqual(stoneToSixths(15))
    }
  })

  it('includes Legionary with heavy encumbrance', () => {
    const legionary = fighterTemplates.find((t) => t.template === 'Legionary')
    expect(legionary?.declaredEncumbranceSixths).toBe(parseEncumbranceToSixths('enc. 10 st'))
  })

  it('includes Cataphract with horse-mounted encumbrance', () => {
    const cataphract = fighterTemplates.find((t) => t.template === 'Cataphract')
    expect(cataphract?.declaredEncumbranceSixths).toBe(
      parseEncumbranceToSixths('enc. 7 2/6 st with rations on horse'),
    )
  })
})
