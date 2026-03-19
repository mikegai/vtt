import { INVENTORY_OPS_SCHEMA_V1 } from './inventory-ops-schema'
import instructionsMarkdown from './inventory-llm-instructions.md?raw'

export type BuildInventoryLlmPromptInput = {
  readonly userDescription: string
}

const schemaExample = `{
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
        { "text": "high boots", "quantity": 1, "wornClothing": true }
      ]
    }
  ]
}`

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
    'Return a single raw JSON object only.',
    'The response must be immediately cut-and-pasteable into the app JSON box.',
    'No markdown fences, no comments, no prose, no trailing text.',
    'Begin with "{" and end with "}".',
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
    '## User Description',
    cleanDescription.length > 0 ? cleanDescription : '(empty)',
  ].join('\n')
}

