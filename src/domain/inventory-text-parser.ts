import { createSourceItemSearchIndex, type SourceItemSearchIndex } from './item-source-search'

export type ParsedChunkStatus = 'resolved' | 'ambiguous' | 'unknown'

export type ParsedChunkAlternative = {
  readonly itemId: string
  readonly itemName: string
  readonly score: number
}

export type ParsedInventoryChunk = {
  readonly raw: string
  readonly quantity: number
  readonly candidateName: string
  readonly stoneOverride?: number
  readonly status: ParsedChunkStatus
  readonly confidence: number
  readonly resolvedItemId?: string
  readonly resolvedItemName?: string
  readonly alternatives: readonly ParsedChunkAlternative[]
}

export type ParsedInventoryBatch = {
  readonly input: string
  readonly chunks: readonly ParsedInventoryChunk[]
}

const resolvedScoreThreshold = 0.2
const ambiguousScoreThreshold = 0.45

const wrappers = [
  /^(?:roll|rolls|flask|flasks|sack|sacks|case|cases|quiver|quivers|vial|vials|pouch|pouches|bag|bags)\s+of\s+/i,
  /^(?:pair|pairs)\s+of\s+/i,
  /^(?:case|quiver)\s+with\s+\d+\s+/i,
]

const normalizeSeparators = (input: string): string =>
  input
    .replace(/[;\n]+/g, ',')
    .replace(/\s+and\s+/gi, ', ')
    .replace(/\s*,\s*/g, ', ')
    .replace(/\s+/g, ' ')
    .trim()

export const splitInventoryClauses = (input: string): readonly string[] => {
  const normalized = normalizeSeparators(input)
  if (normalized.length === 0) return []
  return normalized
    .split(',')
    .map((part) => part.trim())
    .filter((part) => part.length > 0)
}

/** Match "stone" or "st" - use stone first to avoid matching "st" inside "stone". */
const STONE_UNIT = /(?:stone|st\.?)s?/i

/** Stone patterns: (4 st.), (4 stone), weighing 4 stone, 2 stone, 1/6 stone. Returns [stoneValue, phraseToStrip]. */
const extractStoneFromText = (text: string): { stone: number; phrase: string } | null => {
  // Parenthetical: (4 st.), (4 stone), (1/6 st.)
  const parenWhole = text.match(new RegExp(`\\(\\s*(\\d+)\\s*` + STONE_UNIT.source + `\\s*\\)`, 'i'))
  if (parenWhole) return { stone: Number(parenWhole[1]), phrase: parenWhole[0] }

  const parenFrac = text.match(new RegExp(`\\(\\s*(\\d+)\\s*/\\s*(\\d+)\\s*` + STONE_UNIT.source + `\\s*\\)`, 'i'))
  if (parenFrac) {
    const num = Number(parenFrac[1])
    const den = Number(parenFrac[2])
    if (den > 0) return { stone: num / den, phrase: parenFrac[0] }
  }

  // "weighing N stone" / "weighing N st"
  const weighWhole = text.match(new RegExp(`weighing\\s+(\\d+)\\s*` + STONE_UNIT.source, 'i'))
  if (weighWhole) return { stone: Number(weighWhole[1]), phrase: weighWhole[0] }

  const weighFrac = text.match(new RegExp(`weighing\\s+(\\d+)\\s*/\\s*(\\d+)\\s*` + STONE_UNIT.source, 'i'))
  if (weighFrac) {
    const num = Number(weighFrac[1])
    const den = Number(weighFrac[2])
    if (den > 0) return { stone: num / den, phrase: weighFrac[0] }
  }

  // Trailing: "2 stone", "1/6 st" (at end of string) - try fractional before whole to avoid "1/6" matching "6"
  const trailFrac = text.match(new RegExp(`(\\d+)\\s*/\\s*(\\d+)\\s*` + STONE_UNIT.source + `\\s*$`, 'i'))
  if (trailFrac) {
    const num = Number(trailFrac[1])
    const den = Number(trailFrac[2])
    if (den > 0) return { stone: num / den, phrase: trailFrac[0].trim() }
  }

  const trailWhole = text.match(new RegExp(`(\\d+)\\s*` + STONE_UNIT.source + `\\s*$`, 'i'))
  if (trailWhole) return { stone: Number(trailWhole[1]), phrase: trailWhole[0].trim() }

  return null
}

export const extractQuantityAndName = (
  chunk: string,
): { quantity: number; candidateName: string; stoneOverride?: number } => {
  const trimmed = chunk.trim()
  const match = trimmed.match(/^(?:(\d+)|a|an|one)\b\s*(.*)$/i)
  const quantity = match
    ? (match[1] ? Number(match[1]) : 1)
    : 1
  let candidate = match ? match[2] : trimmed
  candidate = candidate.trim()

  for (const pattern of wrappers) {
    candidate = candidate.replace(pattern, '').trim()
  }

  // "120 arrows" -> "arrows"; also handles accidental "of"
  candidate = candidate.replace(/^of\s+/i, '').trim()

  // Extract and strip stone/weight notation
  let stoneOverride: number | undefined
  const stoneMatch = extractStoneFromText(candidate)
  if (stoneMatch) {
    stoneOverride = stoneMatch.stone
    candidate = candidate.replace(stoneMatch.phrase, '').trim().replace(/\s+/g, ' ').trim()
  }

  return {
    quantity: Math.max(1, quantity),
    candidateName: candidate.length > 0 ? candidate : trimmed,
    ...(stoneOverride != null && { stoneOverride }),
  }
}

const singularize = (value: string): string => {
  if (value.endsWith('ies')) return `${value.slice(0, -3)}y`
  if (value.endsWith('es')) return value.slice(0, -2)
  if (value.endsWith('s')) return value.slice(0, -1)
  return value
}

const resolveCandidate = (
  candidateName: string,
  index: SourceItemSearchIndex,
): {
  status: ParsedChunkStatus
  confidence: number
  resolvedItemId?: string
  resolvedItemName?: string
  alternatives: readonly ParsedChunkAlternative[]
} => {
  const query = `name:"${candidateName}"`
  const hits = index.search(query, 5)
  const singularHits = hits.length > 0 ? hits : index.search(`name:"${singularize(candidateName)}"`, 5)

  if (singularHits.length === 0) {
    return {
      status: 'unknown',
      confidence: 0,
      alternatives: [],
    }
  }

  const alternatives = singularHits.slice(0, 3).map((hit) => ({
    itemId: hit.item.id,
    itemName: hit.item.name,
    score: hit.score,
  }))
  const top = alternatives[0]
  if (!top) {
    return {
      status: 'unknown',
      confidence: 0,
      alternatives: [],
    }
  }

  const confidence = Math.max(0, 1 - top.score)
  if (top.score <= resolvedScoreThreshold) {
    return {
      status: 'resolved',
      confidence,
      resolvedItemId: top.itemId,
      resolvedItemName: top.itemName,
      alternatives,
    }
  }

  if (top.score <= ambiguousScoreThreshold) {
    return {
      status: 'ambiguous',
      confidence,
      alternatives,
    }
  }

  return {
    status: 'unknown',
    confidence,
    alternatives,
  }
}

export const parseInventoryText = (
  input: string,
  index: SourceItemSearchIndex = createSourceItemSearchIndex(),
): ParsedInventoryBatch => {
  const clauses = splitInventoryClauses(input)
  const chunks: ParsedInventoryChunk[] = clauses.map((raw) => {
    const extracted = extractQuantityAndName(raw)
    const resolved = resolveCandidate(extracted.candidateName, index)
    return {
      raw,
      quantity: extracted.quantity,
      candidateName: extracted.candidateName,
      ...(extracted.stoneOverride != null && { stoneOverride: extracted.stoneOverride }),
      status: resolved.status,
      confidence: resolved.confidence,
      resolvedItemId: resolved.resolvedItemId,
      resolvedItemName: resolved.resolvedItemName,
      alternatives: resolved.alternatives,
    }
  })

  return {
    input,
    chunks,
  }
}

