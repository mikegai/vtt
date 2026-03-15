import { describe, expect, it } from 'vitest'
import { crusaderTemplates } from '../domain/crusader-templates'
import { stoneToSixths } from '../domain/rules'
import { parseEncumbranceToSixths } from '../domain/template-catalog'

describe('crusader template ingestion', () => {
  it('parses sixth and half-stone notations', () => {
    expect(parseEncumbranceToSixths('enc. 6 4/6 st')).toBe(stoneToSixths(6) + 4)
    expect(parseEncumbranceToSixths('enc. 10 1/2 st')).toBe(stoneToSixths(10) + 3)
    expect(parseEncumbranceToSixths('8 1/6 st')).toBe(stoneToSixths(8) + 1)
  })

  it('includes all 8 crusader templates from source table', () => {
    expect(crusaderTemplates).toHaveLength(8)
    expect(crusaderTemplates[0]?.template).toBe('Hermit')
    expect(crusaderTemplates[7]?.template).toBe('Templar')
  })

  it('captures expected heavy encumbrance profile', () => {
    const exorcist = crusaderTemplates.find((template) => template.template === 'Exorcist')
    expect(exorcist).toBeDefined()
    expect(exorcist?.declaredEncumbranceSixths).toBe(stoneToSixths(10) + 3)
  })
})

