import { parseInventoryText, type ParsedInventoryBatch } from './inventory-text-parser'
import type { SourceItemSearchIndex } from './item-source-search'

export type ImportContainerKind = 'character' | 'loot-pile' | 'space'

export type ParsedImportContainer = {
  readonly id: string
  readonly kind: ImportContainerKind
  readonly label: string
  readonly sourceText: string
  readonly inventory: ParsedInventoryBatch
}

export type ParsedImportPlan = {
  readonly rawInput: string
  readonly containers: readonly ParsedImportContainer[]
}

const slugify = (value: string): string =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')

const inferContainerKind = (label: string): ImportContainerKind => {
  const normalized = label.toLowerCase()
  if (/(loot|pile|cache|treasure|chest|corpse|ground)/.test(normalized)) return 'loot-pile'
  if (/(space|room|area|zone|hex|location)/.test(normalized)) return 'space'
  return 'character'
}

const parseBlock = (
  block: string,
  index: number,
): {
  label: string
  body: string
} => {
  const lines = block
    .split(/\n+/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)

  if (lines.length === 0) {
    return {
      label: `Inventory ${index + 1}`,
      body: '',
    }
  }

  const first = lines[0]
  const colonMatch = first.match(/^([^:]+):\s*(.*)$/)
  if (colonMatch) {
    const label = colonMatch[1].trim()
    const firstBody = colonMatch[2]?.trim() ?? ''
    const body = [firstBody, ...lines.slice(1)].filter((x) => x.length > 0).join(', ')
    return {
      label: label.length > 0 ? label : `Inventory ${index + 1}`,
      body,
    }
  }

  if (lines.length >= 2 && !/[,\d]/.test(first)) {
    return {
      label: first,
      body: lines.slice(1).join(', '),
    }
  }

  return {
    label: `Inventory ${index + 1}`,
    body: lines.join(', '),
  }
}

export const parseInventoryImportPlan = (
  input: string,
  searchIndex: SourceItemSearchIndex,
): ParsedImportPlan => {
  const blocks = input
    .split(/\n\s*\n+/)
    .map((block) => block.trim())
    .filter((block) => block.length > 0)

  const containers = blocks.map((block, idx) => {
    const parsed = parseBlock(block, idx)
    const kind = inferContainerKind(parsed.label)
    return {
      id: `${kind}:${slugify(parsed.label || `inventory-${idx + 1}`)}:${idx}`,
      kind,
      label: parsed.label,
      sourceText: parsed.body,
      inventory: parseInventoryText(parsed.body, searchIndex),
    }
  })

  return {
    rawInput: input,
    containers,
  }
}

