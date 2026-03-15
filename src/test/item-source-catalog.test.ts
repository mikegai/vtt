import { describe, expect, it } from 'vitest'
import {
  allSourceItems,
  armorAndBardingSourceItems,
  itemSourceCatalog,
  parseSourceEncumbrance,
} from '../domain/item-source-catalog'
import { stoneToSixths } from '../domain/rules'

describe('item source catalog', () => {
  it('parses fixed, range, at-least, and by-weight encumbrance expressions', () => {
    expect(parseSourceEncumbrance('1/6')).toEqual({ kind: 'fixed', sixths: 1 })
    expect(parseSourceEncumbrance('1/2')).toEqual({ kind: 'fixed', sixths: 3 })
    expect(parseSourceEncumbrance('15 - 30')).toEqual({
      kind: 'range',
      minSixths: stoneToSixths(15),
      maxSixths: stoneToSixths(30),
    })
    expect(parseSourceEncumbrance('1+')).toEqual({ kind: 'at-least', minSixths: stoneToSixths(1) })
    expect(parseSourceEncumbrance('By Weight')).toEqual({ kind: 'by-weight' })
  })

  it('includes helmet special rule metadata', () => {
    const helmets = armorAndBardingSourceItems.filter((item) => item.name.startsWith('Helmet'))
    expect(helmets).toHaveLength(2)
    for (const helmet of helmets) {
      expect(helmet.tags).toContain('optional-helmet')
      expect(helmet.tags).toContain('not-included-in-suit-default')
    }
  })

  it('keeps a substantial catalog for drag source hydration', () => {
    expect(itemSourceCatalog.armorAndBarding.length).toBeGreaterThan(20)
    expect(itemSourceCatalog.weapons.length).toBeGreaterThan(30)
    expect(itemSourceCatalog.adventuringEquipment.length).toBeGreaterThan(80)
    expect(allSourceItems.length).toBeGreaterThan(130)
  })
})

