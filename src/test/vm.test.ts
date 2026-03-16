import { describe, expect, it } from 'vitest'
import { sampleState } from '../sample-data'
import { buildBoardVM } from '../vm/vm'

const stateWithCutthroatRations = (count: number) => {
  const entries = Object.fromEntries(
    Object.entries(sampleState.inventoryEntries).filter(([id]) => !id.startsWith('cutthroatRations')),
  )
  for (let i = 1; i <= count; i += 1) {
    entries[`cutthroatRations${i}`] = {
      id: `cutthroatRations${i}`,
      actorId: 'cutthroat',
      itemDefId: 'ironRationsDay',
      quantity: 1,
      zone: 'stowed',
    }
  }
  return { ...sampleState, inventoryEntries: entries }
}

describe('board view model', () => {
  it('builds rows and party pace from canonical state', () => {
    const board = buildBoardVM(sampleState)
    expect(board.rows.length).toBe(8)
    // Templar's saddle/saddlebag/rations moved to horse, so he's lighter; slowest is now a different PC
    expect([30, 60]).toContain(board.partyPace.explorationFeet)
    expect(board.partyPace.limitedByActorId).toBeDefined()
  })

  it('uses template names from sample actors', () => {
    const board = buildBoardVM(sampleState)
    const rowTitles = board.rows.map((row) => row.title)
    expect(rowTitles).toContain('Cutthroat')
    expect(rowTitles).toContain('Prophet')
    expect(rowTitles).toContain('Exorcist')
    expect(rowTitles).toContain('Templar')
    expect(rowTitles).toContain('Thug')
    expect(rowTitles).toContain('Corsair')
    expect(rowTitles).toContain('Legionary')
    expect(rowTitles).toContain('Cataphract')
  })

  it('nests templar horse under templar by ownership', () => {
    const board = buildBoardVM(sampleState)
    const templarRow = board.rows.find((r) => r.actorId === 'templar')
    expect(templarRow).toBeDefined()
    const horseRow = templarRow!.childRows.find((r) => r.actorId === 'templarHorse')
    expect(horseRow).toBeDefined()
    expect(horseRow!.parentActorId).toBe('templar')
    expect(horseRow!.title).toBe('Medium riding horse')
  })

  it('iron rations: 7 entries normalize into 6 segments (5 singles + 1 paired)', () => {
    const board = buildBoardVM(stateWithCutthroatRations(7))
    const cutthroatRow = board.rows.find((r) => r.actorId === 'cutthroat')
    expect(cutthroatRow).toBeDefined()
    const ironRationSegments = cutthroatRow!.segments.filter((s) => s.itemDefId === 'ironRationsDay')
    expect(ironRationSegments.length).toBe(6)
    const pair = ironRationSegments.find((s) => s.tooltip.title === '2 iron rations')
    expect(pair?.quantity).toBe(2)
    expect(ironRationSegments.filter((s) => s.quantity === 1).length).toBe(5)
  })

  it('iron rations normalization is deterministic for 8 and 14 entries', () => {
    const board8 = buildBoardVM(stateWithCutthroatRations(8))
    const row8 = board8.rows.find((r) => r.actorId === 'cutthroat')
    const ration8 = row8!.segments.filter((s) => s.itemDefId === 'ironRationsDay')
    expect(ration8.length).toBe(7)
    expect(ration8.filter((s) => s.tooltip.title === '2 iron rations').length).toBe(1)

    const board14 = buildBoardVM(stateWithCutthroatRations(14))
    const row14 = board14.rows.find((r) => r.actorId === 'cutthroat')
    const ration14 = row14!.segments.filter((s) => s.itemDefId === 'ironRationsDay')
    expect(ration14.length).toBe(12)
    expect(ration14.filter((s) => s.tooltip.title === '2 iron rations').length).toBe(2)
  })

})
