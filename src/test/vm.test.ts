import { describe, expect, it } from 'vitest'
import { stoneToSixths } from '../domain/rules'
import type { CanonicalState } from '../domain/types'
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
    const pair = ironRationSegments.find((s) => s.tooltip.title === '2 daily iron rations')
    expect(pair?.quantity).toBe(2)
    expect(ironRationSegments.filter((s) => s.quantity === 1).length).toBe(5)
  })

  it('iron rations normalization is deterministic for 8 and 14 entries', () => {
    const board8 = buildBoardVM(stateWithCutthroatRations(8))
    const row8 = board8.rows.find((r) => r.actorId === 'cutthroat')
    const ration8 = row8!.segments.filter((s) => s.itemDefId === 'ironRationsDay')
    expect(ration8.length).toBe(7)
    expect(ration8.filter((s) => s.tooltip.title === '2 daily iron rations').length).toBe(1)

    const board14 = buildBoardVM(stateWithCutthroatRations(14))
    const row14 = board14.rows.find((r) => r.actorId === 'cutthroat')
    const ration14 = row14!.segments.filter((s) => s.itemDefId === 'ironRationsDay')
    expect(ration14.length).toBe(12)
    expect(ration14.filter((s) => s.tooltip.title === '2 daily iron rations').length).toBe(2)
  })

  it('animal row uses 50% rule: green band and base speed at ≤50% capacity', () => {
    const board = buildBoardVM(sampleState)
    const templarRow = board.rows.find((r) => r.actorId === 'templar')
    const horseRow = templarRow!.childRows.find((r) => r.actorId === 'templarHorse')
    expect(horseRow).toBeDefined()
    // Horse has 60 stone capacity; saddle(4)+saddlebag(3)+7 rations(7)=14 stone ≈23% → green
    expect(horseRow!.speed.band).toBe('green')
    expect(horseRow!.speed.explorationFeet).toBe(120)
    expect(horseRow!.speed.milesPerDay).toBe(24)
  })

  it('dropped coin lines stay separate segments (no merged coinage bar on canvas)', () => {
    const groundId = 'cutthroat:ground'
    const entries = {
      ...sampleState.inventoryEntries,
      dropGp: {
        id: 'dropGp',
        actorId: 'cutthroat',
        itemDefId: 'coinGp',
        quantity: 500,
        zone: 'dropped' as const,
        state: { dropped: true },
        carryGroupId: groundId,
      },
      dropSp: {
        id: 'dropSp',
        actorId: 'cutthroat',
        itemDefId: 'coinSp',
        quantity: 1200,
        zone: 'dropped' as const,
        state: { dropped: true },
        carryGroupId: groundId,
      },
    }
    const state: CanonicalState = {
      ...sampleState,
      carryGroups: {
        ...sampleState.carryGroups,
        [groundId]: { id: groundId, ownerActorId: 'cutthroat', name: 'Ground', dropped: true },
      },
      inventoryEntries: entries,
    }
    const board = buildBoardVM(state)
    const cutthroatRow = board.rows.find((r) => r.actorId === 'cutthroat')
    const dropped = cutthroatRow!.childRows.find((r) => r.isDroppedRow)
    expect(dropped).toBeDefined()
    expect(dropped!.segments.filter((s) => s.isCoinageMerge).length).toBe(0)
    expect(dropped!.segments.some((s) => s.itemDefId === 'coinGp')).toBe(true)
    expect(dropped!.segments.some((s) => s.itemDefId === 'coinSp')).toBe(true)
  })

  it('animal row uses 50% rule: orange band and halved speed over 50% capacity', () => {
    const entries = { ...sampleState.inventoryEntries }
    const horseEntryIds = Object.keys(entries).filter((id) => entries[id].actorId === 'templarHorse')
    horseEntryIds.forEach((id) => delete entries[id])
    entries.templarHorseHeavyLoad = {
      id: 'templarHorseHeavyLoad',
      actorId: 'templarHorse',
      itemDefId: 'laborersTools',
      quantity: 31,
      zone: 'stowed',
    }
    const stateWithHeavyHorse: CanonicalState = { ...sampleState, inventoryEntries: entries }
    const board = buildBoardVM(stateWithHeavyHorse)
    const templarRow = board.rows.find((r) => r.actorId === 'templar')
    const horseRow = templarRow!.childRows.find((r) => r.actorId === 'templarHorse')
    expect(horseRow).toBeDefined()
    // Horse 60 stone: 31 laborers tools (6 sixths each) = 186 sixths = 31 stone > 50% → orange
    expect(horseRow!.encumbranceSixths).toBe(stoneToSixths(31))
    expect(horseRow!.encumbranceSixths).toBeGreaterThan(horseRow!.capacitySixths / 2)
    expect(horseRow!.speed.band).toBe('orange')
    expect(horseRow!.speed.explorationFeet).toBe(60)
    expect(horseRow!.speed.milesPerDay).toBe(12)
  })
})
