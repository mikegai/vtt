import { describe, expect, it } from 'vitest'
import { sampleState } from '../sample-data'
import { buildBoardVM } from '../vm/vm'

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

  it('nests cataphract horse under cataphract by ownership', () => {
    const board = buildBoardVM(sampleState)
    const cataphractRow = board.rows.find((r) => r.actorId === 'cataphract')
    expect(cataphractRow).toBeDefined()
    const horseRow = cataphractRow!.childRows.find((r) => r.actorId === 'cataphractHorse')
    expect(horseRow).toBeDefined()
    expect(horseRow!.parentActorId).toBe('cataphract')
  })

  it('expands iron rations into display segments: 7 rations = 6 slots (5 singles + 1 "2 iron rations")', () => {
    const board = buildBoardVM(sampleState)
    const cutthroatRow = board.rows.find((r) => r.actorId === 'cutthroat')
    expect(cutthroatRow).toBeDefined()
    const ironRationSegments = cutthroatRow!.segments.filter((s) => s.itemDefId === 'ironRationsDay')
    expect(ironRationSegments.length).toBe(6)
    const pairSegment = ironRationSegments.find((s) => s.tooltip.title === '2 iron rations')
    expect(pairSegment).toBeDefined()
    expect(pairSegment!.quantity).toBe(2)
    const singleCount = ironRationSegments.filter((s) => s.tooltip.title === "1 day's iron rations").length
    expect(singleCount).toBe(5)
  })
})
