import { describe, expect, it } from 'vitest'
import { sampleState } from '../sample-data'
import { buildBoardVM } from '../vm/vm'

describe('board view model', () => {
  it('builds rows and party pace from canonical state', () => {
    const board = buildBoardVM(sampleState)
    expect(board.rows.length).toBe(4)
    expect(board.partyPace.explorationFeet).toBe(60)
    expect(board.partyPace.limitedByActorId).toBe('exorcist')
  })

  it('uses template names from sample actors', () => {
    const board = buildBoardVM(sampleState)
    const rowTitles = board.rows.map((row) => row.title)
    expect(rowTitles).toContain('Cutthroat')
    expect(rowTitles).toContain('Prophet')
    expect(rowTitles).toContain('Exorcist')
    expect(rowTitles).toContain('Templar')
  })
})
