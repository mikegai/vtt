import { stoneToSixths } from './rules'

export type StartingTemplate = {
  readonly rollMin: number
  readonly rollMax: number
  readonly template: string
  readonly proficiencies: readonly string[]
  readonly startingEquipmentText: string
  readonly declaredEncumbranceSixths: number
}

export const parseEncumbranceToSixths = (text: string): number => {
  const normalized = text.toLowerCase().replace(/\s+/g, ' ')

  const mixedMatch = normalized.match(/(\d+)\s+(\d+)\/(\d+)\s*st/)
  if (mixedMatch) {
    const whole = Number(mixedMatch[1])
    const numerator = Number(mixedMatch[2])
    const denominator = Number(mixedMatch[3])

    const fractionalSixthsRaw = (numerator * 6) / denominator
    if (!Number.isInteger(fractionalSixthsRaw)) {
      throw new Error(`Fraction cannot map to sixth-stones exactly: ${text}`)
    }

    return stoneToSixths(whole) + fractionalSixthsRaw
  }

  const wholeMatch = normalized.match(/(\d+)\s*st/)
  if (wholeMatch) {
    return stoneToSixths(Number(wholeMatch[1]))
  }

  throw new Error(`Could not parse encumbrance text: ${text}`)
}

