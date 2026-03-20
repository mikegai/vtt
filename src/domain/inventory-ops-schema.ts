import type { ActorKind, CarryZone } from './types'

export const INVENTORY_OPS_SCHEMA_V1 = 'vtt.inventory.ops.v1'

export type InventorySerializableNodeKind = ActorKind | 'space'

export type InventoryOpsResultRef = string

export type InventoryTargetRef =
  | { readonly nodeId: string }
  | { readonly groupId: string }
  | { readonly ref: InventoryOpsResultRef; readonly selector?: 'first' | 'all' }

export type InventoryNodeInput = {
  readonly kind: InventorySerializableNodeKind
  readonly name: string
  readonly x?: number
  readonly y?: number
  readonly groupId?: string
}

export type InventoryGroupInput = {
  readonly title: string
  readonly x?: number
  readonly y?: number
  readonly width?: number
  readonly height?: number
}

export type InventoryItemInput = {
  readonly text: string
  readonly quantity?: number
  readonly encumbranceStone?: number
  readonly valueGp?: number
  /** Catalog-style base name when text is ornate; improves matching. */
  readonly prototypeName?: string
  readonly zoneHint?: CarryZone
  /** Non-encumbering worn clothing displayed as pills. */
  readonly wornClothing?: boolean
}

export type QueryNodesOp = {
  readonly op: 'query.nodes'
  readonly into: InventoryOpsResultRef
  readonly where?: {
    readonly partyId?: string
    readonly nameContains?: string
    readonly kinds?: readonly InventorySerializableNodeKind[]
    readonly groupId?: string
  }
}

export type QueryGroupsOp = {
  readonly op: 'query.groups'
  readonly into: InventoryOpsResultRef
  readonly where?: {
    readonly titleContains?: string
  }
}

export type QueryEntriesOp = {
  readonly op: 'query.entries'
  readonly into: InventoryOpsResultRef
  readonly from: { readonly ref: InventoryOpsResultRef }
  readonly where?: {
    readonly zone?: CarryZone
    readonly nameContains?: string
  }
}

export type MutateAddItemsOp = {
  readonly op: 'mutate.add-items'
  readonly target: InventoryTargetRef
  readonly items: readonly InventoryItemInput[]
  readonly applyMode?: 'auto-if-clean' | 'manual'
}

export type MutateAddNodesOp = {
  readonly op: 'mutate.add-nodes'
  readonly nodes: readonly InventoryNodeInput[]
}

export type MutateAddGroupsOp = {
  readonly op: 'mutate.add-groups'
  readonly groups: readonly InventoryGroupInput[]
}

/** Future op supported by schema now; implementation can be added later. */
export type MutateMoveEntriesToGroundOp = {
  readonly op: 'mutate.move-entries-to-ground'
  readonly from: { readonly ref: InventoryOpsResultRef }
  readonly placement: 'near-owner' | 'at-position'
  readonly x?: number
  readonly y?: number
}

export type InventoryOpV1 =
  | QueryNodesOp
  | QueryGroupsOp
  | QueryEntriesOp
  | MutateAddItemsOp
  | MutateAddNodesOp
  | MutateAddGroupsOp
  | MutateMoveEntriesToGroundOp

export type InventoryOpsDocumentV1 = {
  readonly schema: typeof INVENTORY_OPS_SCHEMA_V1
  readonly ops: readonly InventoryOpV1[]
}

/** TypeScript-shaped contract block embedded in the inventory LLM prompt (keep in sync with types above). */
export const INVENTORY_OPS_LLM_TYPE_CONTRACTS = `type InventoryOpsDocumentV1 = {
  readonly schema: "${INVENTORY_OPS_SCHEMA_V1}";
  readonly ops: readonly InventoryOpV1[];
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
  readonly op: "query.nodes";
  readonly into: string;
  readonly where?: {
    readonly partyId?: string;
    readonly nameContains?: string;
    readonly kinds?: readonly ("pc"|"retainer"|"hireling"|"animal"|"vehicle"|"loot-pile"|"space")[];
    readonly groupId?: string;
  };
};

type QueryGroupsOp = {
  readonly op: "query.groups";
  readonly into: string;
  readonly where?: { readonly titleContains?: string };
};

type QueryEntriesOp = {
  readonly op: "query.entries";
  readonly into: string;
  readonly from: { readonly ref: string };
  readonly where?: {
    readonly zone?: "worn"|"attached"|"accessible"|"stowed"|"dropped";
    readonly nameContains?: string;
  };
};

type MutateAddItemsOp = {
  readonly op: "mutate.add-items";
  readonly target:
    | { readonly nodeId: string }
    | { readonly groupId: string }
    | { readonly ref: string; readonly selector?: "first"|"all" };
  readonly items: readonly InventoryItemInput[];
  readonly applyMode?: "auto-if-clean" | "manual";
};

type InventoryItemInput = {
  readonly text: string;
  readonly quantity?: number;
  readonly encumbranceStone?: number;
  readonly valueGp?: number;
  /** Catalog-style base name when text is ornate; improves matching. */
  readonly prototypeName?: string;
  readonly zoneHint?: "worn"|"attached"|"accessible"|"stowed"|"dropped";
  /** Non-encumbering worn clothing displayed as pills. */
  readonly wornClothing?: boolean;
};

type MutateAddNodesOp = {
  readonly op: "mutate.add-nodes";
  readonly nodes: readonly {
    readonly kind: "pc"|"retainer"|"hireling"|"animal"|"vehicle"|"loot-pile"|"space";
    readonly name: string;
    readonly x?: number;
    readonly y?: number;
    readonly groupId?: string;
  }[];
};

type MutateAddGroupsOp = {
  readonly op: "mutate.add-groups";
  readonly groups: readonly {
    readonly title: string;
    readonly x?: number;
    readonly y?: number;
    readonly width?: number;
    readonly height?: number;
  }[];
};

type MutateMoveEntriesToGroundOp = {
  readonly op: "mutate.move-entries-to-ground";
  readonly from: { readonly ref: string };
  readonly placement: "near-owner" | "at-position";
  readonly x?: number;
  readonly y?: number;
};
`

type ParseOk<T> = { readonly ok: true; readonly value: T }
type ParseErr = { readonly ok: false; readonly error: string }
export type ParseResult<T> = ParseOk<T> | ParseErr

const fail = (error: string): ParseErr => ({ ok: false, error })
const ok = <T>(value: T): ParseOk<T> => ({ ok: true, value })

const isRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value)

const isNonEmptyString = (value: unknown): value is string =>
  typeof value === 'string' && value.trim().length > 0

/**
 * Chat UIs often wrap the assistant reply in a single markdown ` ```json ` … ` ``` ` block.
 * Strip that wrapper so `JSON.parse` accepts the paste; if there is no fence, return trimmed input.
 */
export const unwrapPastedInventoryJson = (input: string): string => {
  const t = input.trim()
  if (!t.startsWith('```')) return t
  const inner = t.replace(/^```(?:json)?\r?\n?/i, '')
  const close = inner.lastIndexOf('```')
  if (close === -1) return t
  return inner.slice(0, close).trim()
}

const validNodeKinds: readonly InventorySerializableNodeKind[] = [
  'pc',
  'retainer',
  'hireling',
  'animal',
  'vehicle',
  'loot-pile',
  'space',
]

const validZones: readonly CarryZone[] = ['worn', 'attached', 'accessible', 'stowed', 'dropped']

const validateTarget = (value: unknown, path: string): ParseErr | null => {
  if (!isRecord(value)) return fail(`${path} must be an object`)
  const nodeId = value.nodeId
  const groupId = value.groupId
  const ref = value.ref
  if (nodeId != null) return isNonEmptyString(nodeId) ? null : fail(`${path}.nodeId must be non-empty`)
  if (groupId != null) return isNonEmptyString(groupId) ? null : fail(`${path}.groupId must be non-empty`)
  if (ref != null) return isNonEmptyString(ref) ? null : fail(`${path}.ref must be non-empty`)
  return fail(`${path} must include nodeId, groupId, or ref`)
}

const validateItems = (items: unknown, path: string): ParseErr | null => {
  if (!Array.isArray(items) || items.length === 0) return fail(`${path} must be a non-empty array`)
  for (let i = 0; i < items.length; i += 1) {
    const item = items[i]
    if (!isRecord(item)) return fail(`${path}[${i}] must be an object`)
    if (!isNonEmptyString(item.text)) return fail(`${path}[${i}].text must be non-empty`)
    if (item.prototypeName != null) {
      if (typeof item.prototypeName !== 'string' || item.prototypeName.trim().length === 0) {
        return fail(`${path}[${i}].prototypeName must be non-empty when set`)
      }
    }
    if (item.quantity != null && (!Number.isFinite(item.quantity) || Number(item.quantity) <= 0)) {
      return fail(`${path}[${i}].quantity must be > 0`)
    }
    if (item.zoneHint != null && (!isNonEmptyString(item.zoneHint) || !validZones.includes(item.zoneHint as CarryZone))) {
      return fail(`${path}[${i}].zoneHint is invalid`)
    }
    if (item.encumbranceStone != null && (!Number.isFinite(item.encumbranceStone) || Number(item.encumbranceStone) < 0)) {
      return fail(`${path}[${i}].encumbranceStone must be >= 0`)
    }
    if (item.valueGp != null && (!Number.isFinite(item.valueGp) || Number(item.valueGp) < 0)) {
      return fail(`${path}[${i}].valueGp must be >= 0`)
    }
  }
  return null
}

const validateOp = (op: unknown, index: number): ParseErr | null => {
  const path = `ops[${index}]`
  if (!isRecord(op)) return fail(`${path} must be an object`)
  if (!isNonEmptyString(op.op)) return fail(`${path}.op must be a non-empty string`)

  switch (op.op) {
    case 'query.nodes': {
      if (!isNonEmptyString(op.into)) return fail(`${path}.into must be non-empty`)
      if (op.where != null && !isRecord(op.where)) return fail(`${path}.where must be an object`)
      if (isRecord(op.where) && op.where.kinds != null) {
        if (!Array.isArray(op.where.kinds)) return fail(`${path}.where.kinds must be an array`)
        const invalid = op.where.kinds.find((kind) => !validNodeKinds.includes(kind as InventorySerializableNodeKind))
        if (invalid) return fail(`${path}.where.kinds contains invalid kind`)
      }
      return null
    }
    case 'query.groups': {
      if (!isNonEmptyString(op.into)) return fail(`${path}.into must be non-empty`)
      return null
    }
    case 'query.entries': {
      if (!isNonEmptyString(op.into)) return fail(`${path}.into must be non-empty`)
      if (!isRecord(op.from) || !isNonEmptyString(op.from.ref)) return fail(`${path}.from.ref must be non-empty`)
      if (op.where != null && !isRecord(op.where)) return fail(`${path}.where must be an object`)
      if (isRecord(op.where) && op.where.zone != null && (!isNonEmptyString(op.where.zone) || !validZones.includes(op.where.zone as CarryZone))) {
        return fail(`${path}.where.zone is invalid`)
      }
      return null
    }
    case 'mutate.add-items': {
      const targetErr = validateTarget(op.target, `${path}.target`)
      if (targetErr) return targetErr
      return validateItems(op.items, `${path}.items`)
    }
    case 'mutate.add-nodes': {
      if (!Array.isArray(op.nodes) || op.nodes.length === 0) return fail(`${path}.nodes must be a non-empty array`)
      for (let i = 0; i < op.nodes.length; i += 1) {
        const node = op.nodes[i]
        if (!isRecord(node)) return fail(`${path}.nodes[${i}] must be an object`)
        if (!isNonEmptyString(node.name)) return fail(`${path}.nodes[${i}].name must be non-empty`)
        if (!isNonEmptyString(node.kind) || !validNodeKinds.includes(node.kind as InventorySerializableNodeKind)) {
          return fail(`${path}.nodes[${i}].kind is invalid`)
        }
      }
      return null
    }
    case 'mutate.add-groups': {
      if (!Array.isArray(op.groups) || op.groups.length === 0) return fail(`${path}.groups must be a non-empty array`)
      for (let i = 0; i < op.groups.length; i += 1) {
        const group = op.groups[i]
        if (!isRecord(group)) return fail(`${path}.groups[${i}] must be an object`)
        if (!isNonEmptyString(group.title)) return fail(`${path}.groups[${i}].title must be non-empty`)
      }
      return null
    }
    case 'mutate.move-entries-to-ground': {
      if (!isRecord(op.from) || !isNonEmptyString(op.from.ref)) return fail(`${path}.from.ref must be non-empty`)
      if (op.placement !== 'near-owner' && op.placement !== 'at-position') {
        return fail(`${path}.placement must be near-owner or at-position`)
      }
      if (op.placement === 'at-position') {
        if (!Number.isFinite(op.x) || !Number.isFinite(op.y)) {
          return fail(`${path}.x and ${path}.y must be finite for at-position placement`)
        }
      }
      return null
    }
    default:
      return fail(`${path}.op is unsupported`)
  }
}

export const parseInventoryOpsDocument = (input: unknown): ParseResult<InventoryOpsDocumentV1> => {
  if (!isRecord(input)) return fail('document must be an object')
  if (input.schema !== INVENTORY_OPS_SCHEMA_V1) {
    return fail(`schema must be ${INVENTORY_OPS_SCHEMA_V1}`)
  }
  if (!Array.isArray(input.ops)) return fail('ops must be an array')

  for (let i = 0; i < input.ops.length; i += 1) {
    const err = validateOp(input.ops[i], i)
    if (err) return err
  }

  return ok(input as InventoryOpsDocumentV1)
}

