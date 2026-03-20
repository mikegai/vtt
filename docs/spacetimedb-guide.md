# SpacetimeDB Guide for This Project

## Overview

This VTT uses [SpacetimeDB](https://spacetimedb.com) as its backend. SpacetimeDB is a server-side database where the schema and logic are defined in a **module** (TypeScript in our case), published to their cloud, and clients connect via WebSocket. There is no separate REST API or server process to manage.

## Architecture

```
┌─────────────────────────────────────────────────────┐
│  Browser (main thread)                              │
│  ├─ main.ts          DOM, UI, PixiBoardAdapter      │
│  ├─ localStorage     spacetimedb_vtt_token          │
│  └─ Web Worker       vm-worker.ts                   │
│       ├─ SpacetimeDB client (WebSocket)             │
│       ├─ CanonicalState + WorkerLocalState           │
│       └─ sync.ts (diffs state → calls reducers)     │
├─────────────────────────────────────────────────────┤
│  SpacetimeDB Cloud (maincloud)                      │
│  └─ "vtt" database                                  │
│       ├─ Tables (actors, items, users, etc.)        │
│       └─ Reducers (upsert_actor, set_display_name…) │
└─────────────────────────────────────────────────────┘
```

The main thread **cannot** talk to SpacetimeDB directly. All DB communication goes through the Web Worker via `postMessage`. The worker holds the `DbConnection` and calls reducers; the main thread sends intents and receives scene diffs.

## Key Files

| File | Role |
|------|------|
| `spacetimedb/src/index.ts` | **Server module** — defines all tables, reducers, lifecycle hooks. This is what gets published. |
| `spacetimedb/package.json` | Module dependencies (just `spacetimedb` SDK). |
| `spacetime.json` | Config: `module-path: ./spacetimedb`, `server: maincloud`, `database: vtt`. |
| `src/module_bindings/` | **Auto-generated** client-side TypeScript from the published module. Never hand-edit. |
| `src/spacetimedb/client.ts` | Layer 1 — connection manager. Owns `DbConnection`, subscriptions, reconnection logic. Runs in worker. |
| `src/spacetimedb/reconstruct.ts` | Rebuilds `CanonicalState` and layout from DB table rows after subscription applied. |
| `src/spacetimedb/sync.ts` | Diffs old vs new state and calls the appropriate reducers to push changes. |
| `src/worker/vm-worker.ts` | Web Worker entry. Hosts the scene VM, dispatches intents, bridges main↔SpacetimeDB. |
| `src/worker/protocol.ts` | Message types for main↔worker communication (`MainToWorkerMessage`, `WorkerToMainMessage`). |

## The Server Module (`spacetimedb/src/index.ts`)

### Structure

1. **Table definitions** using `table()` from `spacetimedb/server`
2. **Schema export** aggregating all tables via `schema()`
3. **Lifecycle hooks**: `init`, `clientConnected`, `clientDisconnected`
4. **Reducers** using `spacetimedb.reducer()`

### Table pattern

```typescript
const my_table = table(
  { name: 'my_table', public: true },
  {
    myKey: t.string().primaryKey(),
    someField: t.f64(),
    optionalField: t.string().optional(),
  }
);
```

- Tables can have indexes: `indexes: [{ accessor: 'fieldName', name: 'idx_...', algorithm: 'btree' as const, columns: ['fieldName'] }]`
- All tables are `public: true` (visible to all connected clients).
- Every table needs a `.primaryKey()` field.

### Reducer pattern

```typescript
export const my_reducer = spacetimedb.reducer(
  { arg1: t.string(), arg2: t.f64() },       // argument schema
  (ctx, { arg1, arg2 }) => {                  // handler
    const existing = ctx.db.my_table.myKey.find(arg1);
    if (existing) {
      ctx.db.my_table.myKey.update({ ...existing, someField: arg2 });
    } else {
      ctx.db.my_table.insert({ myKey: arg1, someField: arg2 });
    }
  }
);
```

- `ctx.sender` is the calling client's `Identity`.
- `ctx.sender.toHexString()` gives the hex identity string used as user key.
- `ctx.db.<table>.<pkField>.find(key)` looks up by primary key.
- `ctx.db.<table>.<pkField>.update(row)` updates (must include PK).
- `ctx.db.<table>.<pkField>.delete(key)` deletes by PK.
- `ctx.db.<table>.insert(row)` inserts.
- `ctx.db.<table>.iter()` iterates all rows (for scans).

### Lifecycle hooks

```typescript
export const onConnect = spacetimedb.clientConnected((ctx) => {
  const hex = ctx.sender.toHexString();
  // upsert user row, set online: true
});

export const onDisconnect = spacetimedb.clientDisconnected((ctx) => {
  const hex = ctx.sender.toHexString();
  // set online: false, clean up cursors
});
```

### Schema registration

Every table must be listed in the `schema()` call and the schema must be the default export:

```typescript
const spacetimedb = schema({ table_a, table_b, ... });
export default spacetimedb;
```

## Publishing & Generating Bindings

### Prerequisites

- `spacetime` CLI installed at `~/.local/bin/spacetime` (version 2.0.5).
- Config in `spacetime.json` at project root.

### Publish the module

```bash
# From project root
spacetime publish vtt -y
```

This:
1. Builds `spacetimedb/src/index.ts` into `spacetimedb/dist/bundle.js`
2. Uploads the bundle to maincloud
3. Applies schema migrations (may require `--delete-data=on-conflict` if breaking changes)

**WARNING:** `--delete-data=always` destroys all data. Use `--delete-data=on-conflict` for additive schema changes that SpacetimeDB can't auto-migrate. Adding new tables is usually safe without any flag.

**World/canvas scope columns:** Domain and layout tables store indexed `world_slug` / `canvas_slug` (see module `table({ indexes: … })`). Existing cloud data without those columns may need `--delete-data=on-conflict` (or a backfill) when you publish; then run `npm run stdb:generate`.

### Generate client bindings

```bash
# From project root (or: npm run stdb:generate)
spacetime generate --lang typescript --out-dir src/module_bindings
```

This regenerates all files in `src/module_bindings/` from the published module. These files are auto-generated — never hand-edit them.

### npm shortcuts

- `npm run stdb:build` — `spacetime build`
- `npm run stdb:generate` — regenerate bindings
- `npm run stdb:publish` — `spacetime publish vtt -y`

### Full workflow for schema changes

1. Edit `spacetimedb/src/index.ts` (tables, reducers, indexes, scope columns).
2. `spacetime publish vtt` (add `--delete-data=on-conflict` if needed).
3. `spacetime generate --lang typescript --out-dir src/module_bindings`
4. Update client code if the public API changed.

## Client-Side Architecture

### Connection flow

1. `main.ts` checks `localStorage` for `spacetimedb_vtt_token` and sends it to the worker.
2. Worker calls `stdbConnect()` in `client.ts`, which builds a `DbConnection` with the saved token (or gets a new one).
3. On connect, the server's `clientConnected` hook fires, upserting a `users` row.
4. Client subscribes with **scoped SQL**: filters use quoted **schema field names** (`"worldSlug"`, `"canvasSlug"`) as Spacetime SQL expects, not the client binding’s `world_slug` rename; `users` stays `SELECT *` (global identities).
5. On `onApplied`, `reconstruct.ts` rebuilds `CanonicalState` + layout from the cached table data (still strips id prefixes for the active room).
6. Worker sends `SCENE_INIT` to main thread.

### Token persistence

- SpacetimeDB assigns a token on first connect (tied to an `Identity`).
- Worker sends `STORE_TOKEN` → main thread saves to `localStorage` as `spacetimedb_vtt_token`.
- On reconnect, the saved token is sent to the worker so the same Identity is reused.
- This is how "users" persist across sessions — same token = same identity = same user row.

### Subscriptions

In [`client.ts`](../src/spacetimedb/client.ts), `subscriptionQueriesForContext()` builds the query list from `currentContext` (SQL uses `world_slug` / `canvas_slug` column names). Only rows for the active world/canvas are replicated, except the full `users` table.

Indexes for those filters are declared on the module tables (e.g. composite `byWorldCanvas` on layout and presence tables, `world_slug` on domain tables).

Table callbacks (`onInsert`, `onUpdate`, `onDelete`) trigger state rebuilds.

### Syncing state changes

`sync.ts` compares old and new `CanonicalState`/`WorkerLocalState` and calls the minimal set of reducers to bring the server in sync. This is a **diff-and-push** model — the worker computes changes locally first, then pushes deltas to SpacetimeDB.

### Main↔Worker protocol

Messages are defined in `protocol.ts`:

**Main → Worker:**
- `INIT` — initial world state + settings
- `INTENT` — user action (move node, select, etc.)
- `SET_SPACETIMEDB_TOKEN` — saved auth token
- `UPDATE_CURSOR` — mouse position for presence
- `SET_DISPLAY_NAME` — user changed their name

**Worker → Main:**
- `SCENE_INIT` — full scene after subscription applied
- `SCENE_PATCHES` — incremental updates
- `PRESENCE_UPDATE` — users + cursors lists + own identity
- `CONNECTION_STATUS` — connected/disconnected/error
- `STORE_TOKEN` — save token to localStorage
- `LOG` — debug messages

## Existing Tables

### Domain tables
`actors`, `item_definitions`, `inventory_entries`, `carry_groups`, `movement_groups`

### Layout tables
`node_positions`, `group_positions`, `group_size_overrides`, `node_size_overrides`, `group_list_view`, `node_group_overrides`, `group_node_positions`, `free_segment_positions`, `group_free_segment_positions`, `group_node_orders`, `custom_groups`, `group_title_overrides`, `node_title_overrides`, `node_containment`, `labels`, `settings`

### Identity/Presence tables
- `users` — `identityHex` (PK), `displayName`, `role` ('gm'|'player'), `online`, `lastSeenMs`
- `user_cursors` — `identityHex` (PK), `x`, `y`, `viewportScale` (optional)

## Common Patterns

### Adding a new table + reducer

1. In `spacetimedb/src/index.ts`:
   - Define the table with `table()`
   - Add it to the `schema()` call
   - Export a reducer with `spacetimedb.reducer()`
2. Publish: `spacetime publish vtt`
3. Regenerate: `spacetime generate --lang typescript --out-dir src/module_bindings`
4. In `src/spacetimedb/client.ts`:
   - Add `SELECT * FROM new_table` to the subscription list
   - Add table callbacks if needed
5. In client code, call `conn.reducers.newReducerName({...})` to write data
6. Read data with `conn.db.new_table.iter()` or `conn.db.new_table.pk.find(key)`

### Identity-scoped data

For per-user data (like camera position), use `ctx.sender.toHexString()` as the key in the reducer, so users can only write their own row. Example: the `update_cursor` reducer uses this pattern.
