export type LabelLadder = {
  readonly micro: string
  readonly short: string
  readonly medium: string
  readonly full: string
}

const stopwords = new Set([
  'OF',
  'THE',
  'A',
  'AN',
  'AND',
  'WITH',
  'SET',
  'PAIR',
  'ARMOR',
])

const normalizeWords = (input: string): string[] =>
  input
    .toUpperCase()
    .replace(/[^A-Z0-9\s]/g, ' ')
    .trim()
    .split(/\s+/)
    .filter((word) => word.length > 0)

export const consonantSkeleton = (input: string): string => {
  const word = input.toUpperCase().replace(/[^A-Z0-9]/g, '')
  if (word.length <= 1) return word
  const head = word[0]
  const tail = word
    .slice(1)
    .replace(/[AEIOUY]/g, '')
  const skeleton = `${head}${tail}`
  return skeleton.length === 0 ? head : skeleton
}

const clampWord = (word: string, max: number): string => word.slice(0, max)

export const buildLabelLadder = (canonicalName: string): LabelLadder => {
  const allWords = normalizeWords(canonicalName)
  const significant = allWords.filter((word) => !stopwords.has(word))
  const words = significant.length > 0 ? significant : allWords

  if (words.length === 0) {
    return { micro: '?', short: '?', medium: '?', full: '?' }
  }

  const keyNoun = words[words.length - 1]
  const keySkeleton = consonantSkeleton(keyNoun)
  const modifiers = words.slice(0, -1)

  const micro = words.length === 1 ? keyNoun[0] : clampWord(keySkeleton, 4)
  const short = words.length === 1
    ? clampWord(keySkeleton, 2)
    : `${clampWord(consonantSkeleton(modifiers[modifiers.length - 1]), 3)} ${clampWord(keySkeleton, 4)}`

  const medium = (() => {
    if (words.length === 1) {
      return keySkeleton.length >= 4 ? clampWord(keySkeleton, 4) : keyNoun
    }
    const mediumModifiers = modifiers.slice(-2).map((word) => (word.length <= 4 ? word : clampWord(word, 3)))
    return [...mediumModifiers, clampWord(keySkeleton, 4)].join(' ')
  })()

  return {
    micro,
    short,
    medium,
    full: allWords.join(' '),
  }
}
