import { INVENTORY_OPS_LLM_TYPE_CONTRACTS, INVENTORY_OPS_SCHEMA_V1 } from './inventory-ops-schema'
import type { ItemCatalogRow } from './types'
import { formatSixthsAsStone } from './rules'
import instructionsMarkdown from './inventory-llm-instructions.md?raw'

export type BuildInventoryLlmPromptInput = {
  readonly userDescription: string
  readonly catalogRows: readonly ItemCatalogRow[]
}

const MAX_CATALOG_LINES = 400

const encFromSixths = (sixths: number): string => formatSixthsAsStone(sixths).replace(/\s+stone/g, ' st')

/** Tab-separated block for the prompt (world item definitions). */
export const formatWorldCatalogForPrompt = (
  rows: readonly ItemCatalogRow[],
  maxLines = MAX_CATALOG_LINES,
): string => {
  const slice = rows.slice(0, maxLines)
  const lines = slice.map((r) => {
    const enc = r.sixthsPerUnit != null ? encFromSixths(r.sixthsPerUnit) : ''
    const gp = r.priceInGp != null ? String(r.priceInGp) : ''
    return [r.canonicalName, r.id, r.kind, enc, gp].filter((c) => c.length > 0).join('\t')
  })
  const more =
    rows.length > maxLines ? `\n… (+${rows.length - maxLines} more definitions in world)` : ''
  return `## Source catalog (world, compact)\nTab-separated: canonicalName • id • kind • enc • gp (when set)\n\n${lines.join('\n')}${more}`
}

const schemaExampleBody = `{
  "schema": "${INVENTORY_OPS_SCHEMA_V1}",
  "ops": [
    {
      "op": "mutate.add-items",
      "target": { "nodeId": "TARGET_NODE_ID" },
      "applyMode": "auto-if-clean",
      "items": [
        { "text": "chain mail armor", "quantity": 1 },
        { "text": "wooden shield", "quantity": 1 },
        { "text": "armiger tunic and pants", "quantity": 1, "wornClothing": true },
        { "text": "high boots", "quantity": 1, "wornClothing": true },
        { "text": "green musty iron-class spellbook", "quantity": 1, "prototypeName": "Treatise, Apprentice" }
      ]
    }
  ]
}`

const schemaExample = ['```json', schemaExampleBody, '```'].join('\n')

export const buildInventoryLlmPrompt = ({ userDescription, catalogRows }: BuildInventoryLlmPromptInput): string => {
  const cleanDescription = userDescription.trim()
  return [
    'You are a deterministic inventory-ops JSON generator.',
    '',
    'Put your entire answer in one markdown fenced code block labeled json (```json on its own line, then the object, then ``` on its own line).',
    'That is the format ChatGPT, Claude, Copilot, etc. use for a copyable code box — the user will click Copy on that block.',
    'Inside the fence: a single JSON object only — valid for JSON.parse after the fence lines are removed (the app strips them).',
    'No prose before the opening ```json line or after the closing ``` line.',
    'No comments, trailing commas, or extra code blocks.',
    '',
    '## Instructions',
    instructionsMarkdown.trim(),
    '',
    '## Required JSON Schema',
    `Use schema: ${INVENTORY_OPS_SCHEMA_V1}`,
    '',
    '## Type Contracts (follow exactly)',
    INVENTORY_OPS_LLM_TYPE_CONTRACTS,
    '',
    '## Example Output',
    schemaExample,
    '',
    formatWorldCatalogForPrompt(catalogRows),
    '',
    '## User Description',
    cleanDescription.length > 0 ? cleanDescription : '(empty)',
  ].join('\n')
}
