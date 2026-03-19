# Intent-Driven SpacetimeDB Architecture

## Current Architecture (CRUD Reducers)

```
Client A                        SpacetimeDB                         Client B
────────                        ───────────                         ────────
1. User action
2. applyIntent() locally
   (optimistic, ~2000 lines
    of logic in vm-worker.ts)
3. Diff old vs new state
4. Fire N separate CRUD         5. Dumb upsert/delete
   reducer calls via sync.ts      (no domain logic,
   (can partially fail)            no validation)
                                6. Broadcast table updates ───────> 7. rebuild() from tables
                                   back to originator too ────────> 8. Reconcile optimistic state
```

**Problems:**
- `sync.ts` is a fragile diff layer that translates state changes into ~30 individual reducer calls
- A single intent (e.g. MOVE_NODE_TO_ROOT) touches 4+ tables via separate fire-and-forget calls that can partially fail
- Server blindly trusts whatever the client sends — no validation, no domain logic
- Reducer calls return `Promise<void>` — failures were previously invisible (now caught via `safe()` wrapper)
- Two sources of truth: client state (authoritative for UX) vs server tables (authoritative for sync)

## Target Architecture (Intent Reducers)

```
Client A                        SpacetimeDB                         Client B
────────                        ───────────                         ────────
1. User action
2. applyIntent() locally
   (optimistic, shared logic)
3. Send intent directly ──────> 4. Intent reducer runs:
   conn.reducers                   - Reads current tables
     .moveNodeToRoot(...)          - Validates (can reject)
                                   - Applies domain logic
                                   - Writes across N tables
                                   - ALL ATOMIC (one tx)
                                5. Broadcasts table updates ──────> 6. rebuild() from tables
                                   back to originator too ────────> 7. Optimistic state matches
                                                                      server = visual no-op
```

**Benefits:**
- One reducer call per intent — atomic multi-table transaction
- Server validates and gates — can reject invalid moves, enforce roles
- No diff layer needed — `sync.ts` goes away
- Single source of truth for domain logic (shared between client and server)
- Failures are immediate and visible (promise rejects)

## Implementation Plan

### 1. Extract shared intent logic

Create pure functions that operate on a table abstraction, importable by both the worker and the server:

```
shared/intents/move-node-to-root.ts
shared/intents/move-node-to-group.ts
shared/intents/drop-node-into-node.ts
...
```

Each function takes a "table accessor" interface and intent args, reads current state, and produces mutations. The interface is implemented differently on client (reads from in-memory state) vs server (reads from `ctx.db`).

### 2. Create server-side intent reducers

```typescript
// spacetimedb/src/index.ts
export const move_node_to_root = spacetimedb.reducer(
  { nodeId: t.string(), x: t.f64(), y: t.f64() },
  (ctx, { nodeId, x, y }) => {
    // Read actor from ctx.db.actors
    // Clear ownerActorId
    // Collect subtree node IDs
    // Update node_positions, node_group_overrides, node_containment
    // All in one atomic transaction
  }
);
```

### 3. Client sends intents directly

Replace the current flow:

```typescript
// OLD: applyIntent → diff → 5+ CRUD calls via sync.ts
const oldWorld = worldState
const oldLocal = localState
applyIntent(message.intent)
syncToSpacetimeDB(oldWorld, oldLocal)

// NEW: applyIntent locally (optimistic) + send intent to server
applyIntent(message.intent)  // still optimistic
conn.reducers.moveNodeToRoot({ nodeId, x, y })  // single call
```

### 4. Incremental migration

Migrate one intent at a time. Start with a simple one (e.g. `MOVE_GROUP`), verify the pattern end-to-end, then migrate the rest. The CRUD reducers and `sync.ts` can coexist during migration — intents that have been migrated use the new path, others still go through the old diff layer.

## Intent Types to Migrate

From `src/worker/protocol.ts` — these are the `WorkerIntent` types that modify persisted state:

### Layout intents (modify localState)
- `MOVE_GROUP` — group position
- `RESIZE_GROUP` — group size override
- `SET_GROUP_LIST_VIEW` — group list view toggle
- `RESIZE_NODE` — node size override
- `MOVE_NODE_TO_GROUP_INDEX` / `MOVE_NODES_TO_GROUP_INDEX` — node ordering within group
- `MOVE_NODE_IN_GROUP` / `MOVE_NODES_IN_GROUP` — node position within group
- `MOVE_NODE_TO_ROOT` / `MOVE_NODES_TO_ROOT` — node position + group override + containment
- `UPDATE_GROUP_TITLE` — group title override
- `UPDATE_NODE_TITLE` — node title override
- `MOVE_LABEL` — label position
- `UPDATE_LABEL_TEXT` — label text

### Domain intents (modify worldState)
- `ADD_GROUP` — create custom group
- `DELETE_GROUP` — delete custom group + cleanup layout
- `ADD_INVENTORY_NODE` — create actor + entry
- `DELETE_NODE` — delete actor + cascade cleanup
- `DUPLICATE_NODE` — clone actor + entries
- `DROP_NODE_INTO_NODE` / `DROP_NODES_INTO_NODE` — set containment
- `CONNECT_NODE_PARENT` / `NEST_NODE_UNDER` — set ownerActorId / containment
- `ADD_LABEL` / `DELETE_LABEL` — label CRUD
- `SELECT_LABEL` — (ephemeral, no sync needed)

### Segment/entry intents (modify worldState + localState)
- `DRAG_SEGMENT_END` — move entries between nodes, update free segment positions
- `SPAWN_ITEM_INSTANCE` — create item def + entry + free segment positions
- `MOVE_ENTRY_TO` / `MOVE_ENTRIES_TO` — move entries between actors
- `DELETE_ENTRY` / `DUPLICATE_ENTRY` — entry CRUD
- `SET_WIELD` / `UNWIELD` — actor wield state

### Ephemeral intents (no server sync needed)
- `HOVER_SEGMENT` / `SET_FILTER_CATEGORY` / `SET_SELECTED_SEGMENTS` / `SELECT_SEGMENTS_ADD` / `SELECT_SEGMENTS_REMOVE` / `SET_MARQUEE_SELECTION` / `SELECT_ALL_OF_TYPE` / `DRAG_SEGMENT_START` / `DRAG_SEGMENT_UPDATE` / `DRAG_START` / `DRAG_END`

## Key Files

| File | Role |
|------|------|
| `src/worker/protocol.ts` | Intent type definitions (`WorkerIntent`) |
| `src/worker/vm-worker.ts` | Client-side `applyIntent()` — all intent handler logic |
| `spacetimedb/src/index.ts` | Server-side reducers (currently CRUD, target: intent-based) |
| `src/spacetimedb/sync.ts` | Diff layer (to be removed after full migration) |
| `src/spacetimedb/client.ts` | SpacetimeDB connection, subscriptions, table callbacks |
| `src/spacetimedb/reconstruct.ts` | Rebuild client state from SpacetimeDB table cache |
