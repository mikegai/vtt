import { describe, expect, it } from 'vitest'
import { assassinTemplates } from '../domain/assassin-templates'
import { stoneToSixths } from '../domain/rules'
import { parseEncumbranceToSixths } from '../domain/template-catalog'

describe('assassin template ingestion', () => {
  it('parses mixed and whole stone encumbrance text', () => {
    expect(parseEncumbranceToSixths('enc. 5 3/6 st')).toBe(33)
    expect(parseEncumbranceToSixths('enc. 6 1/6 st')).toBe(37)
    expect(parseEncumbranceToSixths('enc. 5 st')).toBe(stoneToSixths(5))
  })

  it('includes all 8 assassin templates from source table', () => {
    expect(assassinTemplates).toHaveLength(8)
    expect(assassinTemplates[0]?.template).toBe('Cutthroat')
    expect(assassinTemplates[7]?.template).toBe('Cult Deathbringer')
  })

  it('keeps declared encumbrance in expected ACKS bounds', () => {
    for (const template of assassinTemplates) {
      expect(template.declaredEncumbranceSixths).toBeGreaterThan(0)
      expect(template.declaredEncumbranceSixths).toBeLessThanOrEqual(stoneToSixths(7))
    }
  })
})

