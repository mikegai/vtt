import { allSourceItems, type EncumbranceExpr, type SourceItemGroup } from './item-source-catalog'
import { INVENTORY_OPS_SCHEMA_V1 } from './inventory-ops-schema'
import instructionsMarkdown from './inventory-llm-instructions.md?raw'

export type BuildInventoryLlmPromptInput = {
  readonly userDescription: string
}

const MAX_CATALOG_LINES = 400

const groupCode = (g: SourceItemGroup): string => {
  if (g === 'armor-and-barding') return 'arm'
  if (g === 'weapons') return 'wpn'
  return 'adv'
}

const encShort = (e: EncumbranceExpr): string => {
  switch (e.kind) {
    case 'fixed': {
      const s = e.sixths
      const whole = Math.floor(s / 6)
      const frac = s % 6
      if (frac === 0) return whole === 0 ? '0' : String(whole)
      if (whole === 0) return `${frac}/6`
      return `${whole} ${frac}/6`
    }
    case 'range':
      return `${encShort({ kind: 'fixed', sixths: e.minSixths })}-${encShort({ kind: 'fixed', sixths: e.maxSixths })}`
    case 'at-least':
      return `${encShort({ kind: 'fixed', sixths: e.minSixths })}+`
    case 'by-weight':
      return 'wt'
    case 'varies':
      return 'var'
    case 'not-carried':
      return '-'
  }
}

const buildCompactCatalogSection = (): string => {
  const slice = allSourceItems.slice(0, MAX_CATALOG_LINES)
  const lines = slice.map((item) => `${item.name}\t${groupCode(item.group)}\t${encShort(item.encumbrance)}`)
  const more = allSourceItems.length > MAX_CATALOG_LINES
    ? `\n… (+${allSourceItems.length - MAX_CATALOG_LINES} more in app)`
    : ''
  return `## Source catalog (compact)\nTab-separated: name\tgroup\tenc (stone, sixths as n/6, wt=by weight, var, -)\n\n${lines.join('\n')}${more}`
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

const typeContracts = `type InventoryOpsDocumentV1 = {
  schema: "vtt.inventory.ops.v1";
  ops: InventoryOpV1[];
};

type InventoryOpV1 =
  | QueryNodesOp
  | QueryGroupsOp
  | QueryEntriesOp
  | MutateAddItemsOp
  | MutateAddNodesOp
  | MutateAddGroupsOp
  | MutateMoveEntriesToGroundOp;

type QueryNodesOp = {
  op: "query.nodes";
  into: string;
  where?: {
    partyId?: string;
    nameContains?: string;
    kinds?: ("pc"|"retainer"|"hireling"|"animal"|"vehicle"|"loot-pile"|"space")[];
    groupId?: string;
  };
};

type QueryGroupsOp = {
  op: "query.groups";
  into: string;
  where?: { titleContains?: string };
};

type QueryEntriesOp = {
  op: "query.entries";
  into: string;
  from: { ref: string };
  where?: { zone?: "worn"|"attached"|"accessible"|"stowed"|"dropped"; nameContains?: string };
};

type MutateAddItemsOp = {
  op: "mutate.add-items";
  target: { nodeId: string } | { groupId: string } | { ref: string; selector?: "first"|"all" };
  applyMode?: "auto-if-clean" | "manual";
  items: InventoryItemInput[];
};

type InventoryItemInput = {
  text: string;
  quantity?: number;
  encumbranceStone?: number;
  valueGp?: number;
  /** Catalog-style base name when text is ornate; helps matching. Omit for multi-item comma lines in text. */
  prototypeName?: string;
  zoneHint?: "worn"|"attached"|"accessible"|"stowed"|"dropped";
  wornClothing?: boolean;
};

type MutateAddNodesOp = {
  op: "mutate.add-nodes";
  nodes: {
    kind: "pc"|"retainer"|"hireling"|"animal"|"vehicle"|"loot-pile"|"space";
    name: string;
    x?: number;
    y?: number;
    groupId?: string;
  }[];
};

type MutateAddGroupsOp = {
  op: "mutate.add-groups";
  groups: { title: string; x?: number; y?: number; width?: number; height?: number }[];
};

type MutateMoveEntriesToGroundOp = {
  op: "mutate.move-entries-to-ground";
  from: { ref: string };
  placement: "near-owner" | "at-position";
  x?: number;
  y?: number;
};`

export const buildInventoryLlmPrompt = ({ userDescription }: BuildInventoryLlmPromptInput): string => {
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
    typeContracts,
    '',
    '## Example Output',
    schemaExample,
    '',
    buildCompactCatalogSection(),
    '',
    '## User Description',
    cleanDescription.length > 0 ? cleanDescription : '(empty)',
  ].join('\n')
}

