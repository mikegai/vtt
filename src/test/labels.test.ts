import { describe, expect, it } from 'vitest'
import { buildLabelLadder, consonantSkeleton } from '../domain/labels'

describe('label engine', () => {
  it('builds consonant skeletons', () => {
    expect(consonantSkeleton('Torch')).toBe('TRCH')
    expect(consonantSkeleton('Leather')).toBe('LTHR')
    expect(consonantSkeleton('Cloth')).toBe('CLTH')
    expect(consonantSkeleton('Varangian')).toBe('VRNGN')
  })

  it('generates torch label ladder', () => {
    expect(buildLabelLadder('Torch')).toEqual({
      micro: 'T',
      short: 'TR',
      medium: 'TRCH',
      full: 'TORCH',
    })
  })

  it('generates plate armor ladder', () => {
    expect(buildLabelLadder('Plate Armor')).toEqual({
      micro: 'P',
      short: 'PL',
      medium: 'PLATE',
      full: 'PLATE ARMOR',
    })
  })

  it('generates varangian silk cloth ladder', () => {
    expect(buildLabelLadder('Varangian Silk Cloth')).toEqual({
      micro: 'CLTH',
      short: 'SLK CLTH',
      medium: 'VAR SILK CLTH',
      full: 'VARANGIAN SILK CLOTH',
    })
  })
})
