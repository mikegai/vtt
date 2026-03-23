import { schema, t, table } from 'spacetimedb/server';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function compoundKey(a: string, b: string): string {
  return `${a}::${b}`;
}

const UUID_IN_PREFIX = '([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})';

/** `w__{worldId}__…` → world UUID (canvas-scoped ids also start this way). */
function worldIdFromWorldScopedId(id: string): string | null {
  const m = id.match(new RegExp(`^w__${UUID_IN_PREFIX}__`, 'i'));
  return m ? m[1] : null;
}

/** `w__{worldId}__c__{canvasId}__…` */
function scopeFromCanvasScopedId(id: string): { worldId: string; canvasId: string } | null {
  const m = id.match(new RegExp(`^w__${UUID_IN_PREFIX}__c__${UUID_IN_PREFIX}__`, 'i'));
  if (!m) return null;
  return { worldId: m[1], canvasId: m[2] };
}

function requireWorldId(id: string, label: string): string {
  const w = worldIdFromWorldScopedId(id);
  if (w == null) throw new Error(`${label}: expected world-scoped id, got ${id}`);
  return w;
}

function requireCanvasScope(id: string, label: string): { worldId: string; canvasId: string } {
  const s = scopeFromCanvasScopedId(id);
  if (s == null) throw new Error(`${label}: expected canvas-scoped id, got ${id}`);
  return s;
}

// ─── World / canvas registry ─────────────────────────────────────────────────

const worlds = table(
  {
    name: 'worlds',
    public: true,
    indexes: [{ accessor: 'slug', name: 'idx_worlds_slug', algorithm: 'btree' as const, columns: ['slug'] }],
  },
  {
    id: t.string().primaryKey(),
    slug: t.string(),
    displayName: t.string(),
    description: t.string().optional(),
  }
);

const world_slug_history = table(
  {
    name: 'world_slug_history',
    public: true,
    indexes: [{ accessor: 'slug', name: 'idx_wsh_slug', algorithm: 'btree' as const, columns: ['slug'] }],
  },
  {
    id: t.string().primaryKey(),
    worldId: t.string(),
    slug: t.string(),
    retiredAtMs: t.f64(),
  }
);

const canvases = table(
  {
    name: 'canvases',
    public: true,
    indexes: [
      {
        accessor: 'byWorldSlug',
        name: 'idx_canvas_world_slug',
        algorithm: 'btree' as const,
        columns: ['worldId', 'slug'],
      },
    ],
  },
  {
    id: t.string().primaryKey(),
    worldId: t.string(),
    slug: t.string(),
    displayName: t.string().optional(),
  }
);

const canvas_slug_history = table(
  {
    name: 'canvas_slug_history',
    public: true,
    indexes: [
      {
        accessor: 'byWorldSlug',
        name: 'idx_csh_world_slug',
        algorithm: 'btree' as const,
        columns: ['worldId', 'slug'],
      },
    ],
  },
  {
    id: t.string().primaryKey(),
    canvasId: t.string(),
    worldId: t.string(),
    slug: t.string(),
    retiredAtMs: t.f64(),
  }
);

// ─── Domain Tables ────────────────────────────────────────────────────────────

const actors = table(
  {
    name: 'actors',
    public: true,
    indexes: [
      { accessor: 'worldId', name: 'idx_actors_world', algorithm: 'btree' as const, columns: ['worldId'] },
      { accessor: 'byWorldCanvas', name: 'idx_actors_room', algorithm: 'btree' as const, columns: ['worldId', 'canvasId'] },
    ],
  },
  {
    id: t.string().primaryKey(),
    worldId: t.string(),
    canvasId: t.string(),
    name: t.string(),
    kind: t.string(),
    strengthMod: t.i32(),
    hasLoadBearing: t.bool(),
    movementGroupId: t.string(),
    active: t.bool(),
    ownerActorId: t.string().optional(),
    capacityStone: t.u32().optional(),
    baseExplorationFeet: t.u32().optional(),
    baseCombatFeet: t.u32().optional(),
    baseRunningFeet: t.u32().optional(),
    baseMilesPerDay: t.u32().optional(),
    leftWieldingEntryId: t.string().optional(),
    rightWieldingEntryId: t.string().optional(),
  }
);

const item_definitions = table(
  {
    name: 'item_definitions',
    public: true,
    indexes: [{ accessor: 'worldId', name: 'idx_itemdef_world', algorithm: 'btree' as const, columns: ['worldId'] }],
  },
  {
    id: t.string().primaryKey(),
    worldId: t.string(),
    canonicalName: t.string(),
    kind: t.string(),
    sixthsPerUnit: t.u32().optional(),
    armorClass: t.u32().optional(),
    priceInGp: t.f64().optional(),
    isFungibleVisual: t.bool().optional(),
  }
);

const inventory_entries = table(
  {
    name: 'inventory_entries',
    public: true,
    indexes: [
      { accessor: 'actorId', name: 'idx_entries_actor', algorithm: 'btree' as const, columns: ['actorId'] },
      { accessor: 'worldId', name: 'idx_entries_world', algorithm: 'btree' as const, columns: ['worldId'] },
      { accessor: 'byWorldCanvas', name: 'idx_entries_room', algorithm: 'btree' as const, columns: ['worldId', 'canvasId'] },
    ],
  },
  {
    id: t.string().primaryKey(),
    worldId: t.string(),
    canvasId: t.string(),
    actorId: t.string(),
    itemDefId: t.string(),
    quantity: t.u32(),
    zone: t.string(),
    stateWorn: t.bool().optional(),
    stateAttached: t.bool().optional(),
    stateHeldHands: t.u32().optional(),
    stateDropped: t.bool().optional(),
    stateInaccessible: t.bool().optional(),
    carryGroupId: t.string().optional(),
  }
);

const carry_groups = table(
  {
    name: 'carry_groups',
    public: true,
    indexes: [
      { accessor: 'ownerActorId', name: 'idx_cg_owner', algorithm: 'btree' as const, columns: ['ownerActorId'] },
      { accessor: 'worldId', name: 'idx_cg_world', algorithm: 'btree' as const, columns: ['worldId'] },
      { accessor: 'byWorldCanvas', name: 'idx_cg_room', algorithm: 'btree' as const, columns: ['worldId', 'canvasId'] },
    ],
  },
  {
    id: t.string().primaryKey(),
    worldId: t.string(),
    canvasId: t.string(),
    ownerActorId: t.string(),
    name: t.string(),
    dropped: t.bool(),
  }
);

const movement_groups = table(
  {
    name: 'movement_groups',
    public: true,
    indexes: [
      { accessor: 'worldId', name: 'idx_mg_world', algorithm: 'btree' as const, columns: ['worldId'] },
      { accessor: 'byWorldCanvas', name: 'idx_mg_room', algorithm: 'btree' as const, columns: ['worldId', 'canvasId'] },
    ],
  },
  {
    id: t.string().primaryKey(),
    worldId: t.string(),
    canvasId: t.string(),
    name: t.string(),
    active: t.bool(),
  }
);

// ─── Layout Tables ────────────────────────────────────────────────────────────

const node_positions = table(
  {
    name: 'node_positions',
    public: true,
    indexes: [
      { accessor: 'byWorldCanvas', name: 'idx_npos_room', algorithm: 'btree' as const, columns: ['worldId', 'canvasId'] },
    ],
  },
  {
    nodeId: t.string().primaryKey(),
    worldId: t.string(),
    canvasId: t.string(),
    x: t.f64(),
    y: t.f64(),
  }
);

const group_positions = table(
  {
    name: 'group_positions',
    public: true,
    indexes: [
      { accessor: 'byWorldCanvas', name: 'idx_gpos_room', algorithm: 'btree' as const, columns: ['worldId', 'canvasId'] },
    ],
  },
  {
    groupId: t.string().primaryKey(),
    worldId: t.string(),
    canvasId: t.string(),
    x: t.f64(),
    y: t.f64(),
  }
);

const group_size_overrides = table(
  {
    name: 'group_size_overrides',
    public: true,
    indexes: [
      { accessor: 'byWorldCanvas', name: 'idx_gso_room', algorithm: 'btree' as const, columns: ['worldId', 'canvasId'] },
    ],
  },
  {
    groupId: t.string().primaryKey(),
    worldId: t.string(),
    canvasId: t.string(),
    width: t.f64(),
    height: t.f64(),
  }
);

const node_size_overrides = table(
  {
    name: 'node_size_overrides',
    public: true,
    indexes: [
      { accessor: 'byWorldCanvas', name: 'idx_nso_room', algorithm: 'btree' as const, columns: ['worldId', 'canvasId'] },
    ],
  },
  {
    nodeId: t.string().primaryKey(),
    worldId: t.string(),
    canvasId: t.string(),
    slotCols: t.u32(),
    slotRows: t.u32(),
  }
);

const group_list_view = table(
  {
    name: 'group_list_view',
    public: true,
    indexes: [
      { accessor: 'byWorldCanvas', name: 'idx_glv_room', algorithm: 'btree' as const, columns: ['worldId', 'canvasId'] },
    ],
  },
  {
    groupId: t.string().primaryKey(),
    worldId: t.string(),
    canvasId: t.string(),
    enabled: t.bool(),
  }
);

/** Group or node id: full layout vs fit-to-content (canvas-persisted). */
const layout_expanded = table(
  {
    name: 'layout_expanded',
    public: true,
    indexes: [
      { accessor: 'byWorldCanvas', name: 'idx_lex_room', algorithm: 'btree' as const, columns: ['worldId', 'canvasId'] },
    ],
  },
  {
    containerId: t.string().primaryKey(),
    worldId: t.string(),
    canvasId: t.string(),
    expanded: t.bool(),
  }
);

const node_group_overrides = table(
  {
    name: 'node_group_overrides',
    public: true,
    indexes: [
      { accessor: 'byWorldCanvas', name: 'idx_ngo_room', algorithm: 'btree' as const, columns: ['worldId', 'canvasId'] },
    ],
  },
  {
    nodeId: t.string().primaryKey(),
    worldId: t.string(),
    canvasId: t.string(),
    groupId: t.string().optional(),
  }
);

const group_node_positions = table(
  {
    name: 'group_node_positions',
    public: true,
    indexes: [
      { accessor: 'groupId', name: 'idx_gnp_group', algorithm: 'btree' as const, columns: ['groupId'] },
      { accessor: 'nodeId', name: 'idx_gnp_node', algorithm: 'btree' as const, columns: ['nodeId'] },
      {
        accessor: 'byWorldCanvas',
        name: 'idx_gnp_room',
        algorithm: 'btree' as const,
        columns: ['worldId', 'canvasId'],
      },
    ],
  },
  {
    id: t.string().primaryKey(),
    groupId: t.string(),
    nodeId: t.string(),
    worldId: t.string(),
    canvasId: t.string(),
    x: t.f64(),
    y: t.f64(),
  }
);

const free_segment_positions = table(
  {
    name: 'free_segment_positions',
    public: true,
    indexes: [
      { accessor: 'byWorldCanvas', name: 'idx_fsp_room', algorithm: 'btree' as const, columns: ['worldId', 'canvasId'] },
    ],
  },
  {
    segmentId: t.string().primaryKey(),
    worldId: t.string(),
    canvasId: t.string(),
    x: t.f64(),
    y: t.f64(),
  }
);

const group_free_segment_positions = table(
  {
    name: 'group_free_segment_positions',
    public: true,
    indexes: [
      { accessor: 'groupId', name: 'idx_gfsp_group', algorithm: 'btree' as const, columns: ['groupId'] },
      { accessor: 'segmentId', name: 'idx_gfsp_segment', algorithm: 'btree' as const, columns: ['segmentId'] },
      {
        accessor: 'byWorldCanvas',
        name: 'idx_gfsp_room',
        algorithm: 'btree' as const,
        columns: ['worldId', 'canvasId'],
      },
    ],
  },
  {
    id: t.string().primaryKey(),
    groupId: t.string(),
    segmentId: t.string(),
    worldId: t.string(),
    canvasId: t.string(),
    x: t.f64(),
    y: t.f64(),
  }
);

const group_node_orders = table(
  {
    name: 'group_node_orders',
    public: true,
    indexes: [
      { accessor: 'byWorldCanvas', name: 'idx_gno_room', algorithm: 'btree' as const, columns: ['worldId', 'canvasId'] },
    ],
  },
  {
    groupId: t.string().primaryKey(),
    worldId: t.string(),
    canvasId: t.string(),
    nodeIdsJson: t.string(),
  }
);

const custom_groups = table(
  {
    name: 'custom_groups',
    public: true,
    indexes: [
      { accessor: 'byWorldCanvas', name: 'idx_cg_custom_room', algorithm: 'btree' as const, columns: ['worldId', 'canvasId'] },
    ],
  },
  {
    groupId: t.string().primaryKey(),
    worldId: t.string(),
    canvasId: t.string(),
    title: t.string(),
  }
);

const group_title_overrides = table(
  {
    name: 'group_title_overrides',
    public: true,
    indexes: [
      { accessor: 'byWorldCanvas', name: 'idx_gto_room', algorithm: 'btree' as const, columns: ['worldId', 'canvasId'] },
    ],
  },
  {
    groupId: t.string().primaryKey(),
    worldId: t.string(),
    canvasId: t.string(),
    title: t.string(),
  }
);

const node_title_overrides = table(
  {
    name: 'node_title_overrides',
    public: true,
    indexes: [
      { accessor: 'byWorldCanvas', name: 'idx_nto_room', algorithm: 'btree' as const, columns: ['worldId', 'canvasId'] },
    ],
  },
  {
    nodeId: t.string().primaryKey(),
    worldId: t.string(),
    canvasId: t.string(),
    title: t.string(),
  }
);

const node_containment = table(
  {
    name: 'node_containment',
    public: true,
    indexes: [
      { accessor: 'containerNodeId', name: 'idx_nc_container', algorithm: 'btree' as const, columns: ['containerNodeId'] },
      { accessor: 'byWorldCanvas', name: 'idx_nc_room', algorithm: 'btree' as const, columns: ['worldId', 'canvasId'] },
    ],
  },
  {
    nodeId: t.string().primaryKey(),
    containerNodeId: t.string(),
    worldId: t.string(),
    canvasId: t.string(),
  }
);

const labels = table(
  {
    name: 'labels',
    public: true,
    indexes: [
      { accessor: 'byWorldCanvas', name: 'idx_lbl_room', algorithm: 'btree' as const, columns: ['worldId', 'canvasId'] },
    ],
  },
  {
    labelId: t.string().primaryKey(),
    worldId: t.string(),
    canvasId: t.string(),
    text: t.string(),
    x: t.f64(),
    y: t.f64(),
  }
);

const settings = table(
  {
    name: 'settings',
    public: true,
    indexes: [
      { accessor: 'byWorldCanvas', name: 'idx_settings_room', algorithm: 'btree' as const, columns: ['worldId', 'canvasId'] },
    ],
  },
  {
    key: t.string().primaryKey(),
    worldId: t.string(),
    canvasId: t.string(),
    valueNum: t.u32().optional(),
    valueText: t.string().optional(),
  }
);

// ─── Identity / Presence Tables ──────────────────────────────────────────────

const users = table(
  { name: 'users', public: true },
  {
    identityHex: t.string().primaryKey(),
    displayName: t.string(),
    role: t.string(),   // 'gm' | 'player'
    online: t.bool(),
    lastSeenMs: t.f64(),
  }
);

const user_presences = table(
  {
    name: 'user_presences',
    public: true,
    indexes: [
      { accessor: 'identityHex', name: 'idx_presence_identity', algorithm: 'btree' as const, columns: ['identityHex'] },
      {
        accessor: 'byWorldCanvas',
        name: 'idx_presence_room',
        algorithm: 'btree' as const,
        columns: ['worldId', 'canvasId'],
      },
    ],
  },
  {
    id: t.string().primaryKey(),
    identityHex: t.string(),
    worldId: t.string(),
    canvasId: t.string(),
    lastSeenMs: t.f64(),
  }
);

const user_cursors = table(
  {
    name: 'user_cursors',
    public: true,
    indexes: [
      { accessor: 'identityHex', name: 'idx_cursor_identity', algorithm: 'btree' as const, columns: ['identityHex'] },
      {
        accessor: 'byWorldCanvas',
        name: 'idx_cursor_room',
        algorithm: 'btree' as const,
        columns: ['worldId', 'canvasId'],
      },
    ],
  },
  {
    id: t.string().primaryKey(),
    identityHex: t.string(),
    worldId: t.string(),
    canvasId: t.string(),
    x: t.f64(),
    y: t.f64(),
    viewportScale: t.f64().optional(),
  }
);

const user_cameras = table(
  {
    name: 'user_cameras',
    public: true,
    indexes: [
      { accessor: 'identityHex', name: 'idx_camera_identity', algorithm: 'btree' as const, columns: ['identityHex'] },
      {
        accessor: 'byWorldCanvas',
        name: 'idx_camera_room',
        algorithm: 'btree' as const,
        columns: ['worldId', 'canvasId'],
      },
    ],
  },
  {
    id: t.string().primaryKey(),
    identityHex: t.string(),
    worldId: t.string(),
    canvasId: t.string(),
    panX: t.f64(),
    panY: t.f64(),
    zoom: t.f64(),
  }
);

// ─── Schema ───────────────────────────────────────────────────────────────────

const spacetimedb = schema({
  worlds,
  world_slug_history,
  canvases,
  canvas_slug_history,
  actors,
  item_definitions,
  inventory_entries,
  carry_groups,
  movement_groups,
  node_positions,
  group_positions,
  group_size_overrides,
  node_size_overrides,
  group_list_view,
  layout_expanded,
  node_group_overrides,
  group_node_positions,
  free_segment_positions,
  group_free_segment_positions,
  group_node_orders,
  custom_groups,
  group_title_overrides,
  node_title_overrides,
  node_containment,
  labels,
  settings,
  users,
  user_presences,
  user_cursors,
  user_cameras,
});
export default spacetimedb;

// ─── Lifecycle ────────────────────────────────────────────────────────────────

export const init = spacetimedb.init(_ctx => {});

export const onConnect = spacetimedb.clientConnected((ctx) => {
  const hex = ctx.sender.toHexString();
  const nowMs = Number(ctx.timestamp.toMillis());
  const existing = ctx.db.users.identityHex.find(hex);
  if (existing) {
    ctx.db.users.identityHex.update({ ...existing, online: true, lastSeenMs: nowMs });
  } else {
    const hasAnyUser = [...ctx.db.users.iter()].length > 0;
    ctx.db.users.insert({
      identityHex: hex,
      displayName: `User-${hex.slice(0, 6)}`,
      role: hasAnyUser ? 'player' : 'gm',
      online: true,
      lastSeenMs: nowMs,
    });
  }
});

export const onDisconnect = spacetimedb.clientDisconnected((ctx) => {
  const hex = ctx.sender.toHexString();
  const nowMs = Number(ctx.timestamp.toMillis());
  const existing = ctx.db.users.identityHex.find(hex);
  if (existing) {
    ctx.db.users.identityHex.update({ ...existing, online: false, lastSeenMs: nowMs });
  }
  for (const row of ctx.db.user_presences.identityHex.filter(hex)) {
    ctx.db.user_presences.id.delete(row.id);
  }
  for (const row of ctx.db.user_cursors.identityHex.filter(hex)) {
    ctx.db.user_cursors.id.delete(row.id);
  }
  for (const row of ctx.db.user_cameras.identityHex.filter(hex)) {
    ctx.db.user_cameras.id.delete(row.id);
  }
});

// ─── Identity & Presence Reducers ─────────────────────────────────────────────

function requireGm(ctx: { sender: { toHexString(): string }; db: { users: { identityHex: { find(key: string): { role: string } | null } } } }): void {
  const hex = ctx.sender.toHexString();
  const user = ctx.db.users.identityHex.find(hex);
  if (!user || user.role !== 'gm') {
    throw new Error('Permission denied: only the GM can perform this action');
  }
}

export const set_display_name = spacetimedb.reducer(
  { displayName: t.string() },
  (ctx, { displayName }) => {
    const hex = ctx.sender.toHexString();
    const existing = ctx.db.users.identityHex.find(hex);
    if (existing) {
      ctx.db.users.identityHex.update({ ...existing, displayName });
    }
  }
);

export const set_user_role = spacetimedb.reducer(
  { targetIdentityHex: t.string(), role: t.string() },
  (ctx, { targetIdentityHex, role }) => {
    requireGm(ctx);
    if (role !== 'gm' && role !== 'player') throw new Error(`Invalid role: ${role}`);
    const target = ctx.db.users.identityHex.find(targetIdentityHex);
    if (target) {
      ctx.db.users.identityHex.update({ ...target, role });
    }
  }
);

export const set_presence = spacetimedb.reducer(
  { worldId: t.string(), canvasId: t.string() },
  (ctx, { worldId, canvasId }) => {
    const hex = ctx.sender.toHexString();
    const id = compoundKey(compoundKey(worldId, canvasId), hex);
    const nowMs = Number(ctx.timestamp.toMillis());
    const existing = ctx.db.user_presences.id.find(id);
    if (existing) {
      ctx.db.user_presences.id.update({ ...existing, lastSeenMs: nowMs });
    } else {
      ctx.db.user_presences.insert({ id, identityHex: hex, worldId, canvasId, lastSeenMs: nowMs });
    }
  }
);

export const update_cursor = spacetimedb.reducer(
  { worldId: t.string(), canvasId: t.string(), x: t.f64(), y: t.f64(), viewportScale: t.f64().optional() },
  (ctx, { worldId, canvasId, x, y, viewportScale }) => {
    const hex = ctx.sender.toHexString();
    const id = compoundKey(compoundKey(worldId, canvasId), hex);
    const existing = ctx.db.user_cursors.id.find(id);
    if (existing) {
      ctx.db.user_cursors.id.update({ id, identityHex: hex, worldId, canvasId, x, y, viewportScale });
    } else {
      ctx.db.user_cursors.insert({ id, identityHex: hex, worldId, canvasId, x, y, viewportScale });
    }
    const presenceExisting = ctx.db.user_presences.id.find(id);
    const nowMs = Number(ctx.timestamp.toMillis());
    if (presenceExisting) {
      ctx.db.user_presences.id.update({ ...presenceExisting, lastSeenMs: nowMs });
    } else {
      ctx.db.user_presences.insert({ id, identityHex: hex, worldId, canvasId, lastSeenMs: nowMs });
    }
  }
);

export const update_camera = spacetimedb.reducer(
  { worldId: t.string(), canvasId: t.string(), panX: t.f64(), panY: t.f64(), zoom: t.f64() },
  (ctx, { worldId, canvasId, panX, panY, zoom }) => {
    const hex = ctx.sender.toHexString();
    const id = compoundKey(compoundKey(worldId, canvasId), hex);
    const existing = ctx.db.user_cameras.id.find(id);
    if (existing) {
      ctx.db.user_cameras.id.update({ id, identityHex: hex, worldId, canvasId, panX, panY, zoom });
    } else {
      ctx.db.user_cameras.insert({ id, identityHex: hex, worldId, canvasId, panX, panY, zoom });
    }
    const presenceExisting = ctx.db.user_presences.id.find(id);
    const nowMs = Number(ctx.timestamp.toMillis());
    if (presenceExisting) {
      ctx.db.user_presences.id.update({ ...presenceExisting, lastSeenMs: nowMs });
    } else {
      ctx.db.user_presences.insert({ id, identityHex: hex, worldId, canvasId, lastSeenMs: nowMs });
    }
  }
);

export const ensure_world = spacetimedb.reducer(
  { id: t.string(), slug: t.string(), displayName: t.string(), description: t.string().optional() },
  (ctx, row) => {
    const existingId = ctx.db.worlds.id.find(row.id);
    if (existingId) return;
    for (const w of ctx.db.worlds.iter()) {
      // Slug owned by another row: another client created this world first — do not insert; client adopts id from subscription.
      if (w.slug === row.slug) return;
    }
    ctx.db.worlds.insert({ id: row.id, slug: row.slug, displayName: row.displayName, description: row.description });
  }
);

export const ensure_canvas = spacetimedb.reducer(
  { id: t.string(), worldId: t.string(), slug: t.string(), displayName: t.string().optional() },
  (ctx, row) => {
    if (!ctx.db.worlds.id.find(row.worldId)) throw new Error('ensure_canvas: world not found');
    if (ctx.db.canvases.id.find(row.id)) return;
    for (const c of ctx.db.canvases.iter()) {
      if (c.worldId === row.worldId && c.slug === row.slug) {
        return;
      }
    }
    ctx.db.canvases.insert({ id: row.id, worldId: row.worldId, slug: row.slug, displayName: row.displayName });
  }
);

export const rename_world = spacetimedb.reducer(
  {
    worldId: t.string(),
    newSlug: t.string(),
    displayName: t.string().optional(),
    description: t.string().optional(),
  },
  (ctx, { worldId, newSlug, displayName, description }) => {
    const w = ctx.db.worlds.id.find(worldId);
    if (!w) throw new Error('rename_world: world not found');
    for (const o of ctx.db.worlds.iter()) {
      if (o.id !== worldId && o.slug === newSlug) throw new Error('rename_world: slug taken');
    }
    const nowMs = Number(ctx.timestamp.toMillis());
    if (newSlug !== w.slug) {
      ctx.db.world_slug_history.insert({
        id: compoundKey(compoundKey(worldId, w.slug), String(nowMs)),
        worldId,
        slug: w.slug,
        retiredAtMs: nowMs,
      });
    }
    ctx.db.worlds.id.update({
      ...w,
      slug: newSlug,
      displayName: displayName ?? w.displayName,
      description: description !== undefined ? description : w.description,
    });
  }
);

export const rename_canvas = spacetimedb.reducer(
  { canvasId: t.string(), newSlug: t.string(), displayName: t.string().optional() },
  (ctx, { canvasId, newSlug, displayName }) => {
    const c = ctx.db.canvases.id.find(canvasId);
    if (!c) throw new Error('rename_canvas: canvas not found');
    for (const o of ctx.db.canvases.iter()) {
      if (o.id !== canvasId && o.worldId === c.worldId && o.slug === newSlug) {
        throw new Error('rename_canvas: slug taken in this world');
      }
    }
    const nowMs = Number(ctx.timestamp.toMillis());
    if (newSlug !== c.slug) {
      ctx.db.canvas_slug_history.insert({
        id: compoundKey(compoundKey(canvasId, c.slug), String(nowMs)),
        canvasId,
        worldId: c.worldId,
        slug: c.slug,
        retiredAtMs: nowMs,
      });
    }
    ctx.db.canvases.id.update({
      ...c,
      slug: newSlug,
      displayName: displayName !== undefined ? displayName : c.displayName,
    });
  }
);

// ─── Actor Reducers ───────────────────────────────────────────────────────────

export const upsert_actor = spacetimedb.reducer(
  {
    id: t.string(),
    name: t.string(),
    kind: t.string(),
    strengthMod: t.i32(),
    hasLoadBearing: t.bool(),
    movementGroupId: t.string(),
    active: t.bool(),
    ownerActorId: t.string().optional(),
    capacityStone: t.u32().optional(),
    baseExplorationFeet: t.u32().optional(),
    baseCombatFeet: t.u32().optional(),
    baseRunningFeet: t.u32().optional(),
    baseMilesPerDay: t.u32().optional(),
    leftWieldingEntryId: t.string().optional(),
    rightWieldingEntryId: t.string().optional(),
  },
  (ctx, args) => {
    const { worldId, canvasId } = requireCanvasScope(args.id, 'actors');
    const row = { ...args, worldId, canvasId };
    const existing = ctx.db.actors.id.find(args.id);
    if (existing) {
      ctx.db.actors.id.update(row);
    } else {
      ctx.db.actors.insert(row);
    }
  }
);

export const delete_actor = spacetimedb.reducer(
  { id: t.string() },
  (ctx, { id }) => {
    for (const entry of ctx.db.inventory_entries.actorId.filter(id)) {
      ctx.db.inventory_entries.id.delete(entry.id);
    }
    for (const cg of ctx.db.carry_groups.ownerActorId.filter(id)) {
      ctx.db.carry_groups.id.delete(cg.id);
    }
    // Clean up layout data
    ctx.db.node_positions.nodeId.delete(id);
    ctx.db.node_size_overrides.nodeId.delete(id);
    ctx.db.node_group_overrides.nodeId.delete(id);
    ctx.db.node_title_overrides.nodeId.delete(id);
    ctx.db.node_containment.nodeId.delete(id);
    for (const row of ctx.db.node_containment.containerNodeId.filter(id)) {
      ctx.db.node_containment.nodeId.delete(row.nodeId);
    }
    for (const row of ctx.db.group_node_positions.nodeId.filter(id)) {
      ctx.db.group_node_positions.id.delete(row.id);
    }
    for (const row of ctx.db.group_node_orders.iter()) {
      const nodeIds: string[] = JSON.parse(row.nodeIdsJson);
      if (nodeIds.includes(id)) {
        ctx.db.group_node_orders.groupId.update({
          ...row,
          nodeIdsJson: JSON.stringify(nodeIds.filter((n: string) => n !== id)),
        });
      }
    }
    ctx.db.actors.id.delete(id);
  }
);

// ─── Item Definition Reducers ─────────────────────────────────────────────────

export const upsert_item_definition = spacetimedb.reducer(
  {
    id: t.string(),
    canonicalName: t.string(),
    kind: t.string(),
    sixthsPerUnit: t.u32().optional(),
    armorClass: t.u32().optional(),
    priceInGp: t.f64().optional(),
    isFungibleVisual: t.bool().optional(),
  },
  (ctx, args) => {
    const worldId = requireWorldId(args.id, 'item_definitions');
    const row = { ...args, worldId };
    const existing = ctx.db.item_definitions.id.find(args.id);
    if (existing) {
      ctx.db.item_definitions.id.update(row);
    } else {
      ctx.db.item_definitions.insert(row);
    }
  }
);

export const delete_item_definition = spacetimedb.reducer(
  { id: t.string() },
  (ctx, { id }) => {
    ctx.db.item_definitions.id.delete(id);
  }
);

// ─── Inventory Entry Reducers ─────────────────────────────────────────────────

export const upsert_inventory_entry = spacetimedb.reducer(
  {
    id: t.string(),
    actorId: t.string(),
    itemDefId: t.string(),
    quantity: t.u32(),
    zone: t.string(),
    stateWorn: t.bool().optional(),
    stateAttached: t.bool().optional(),
    stateHeldHands: t.u32().optional(),
    stateDropped: t.bool().optional(),
    stateInaccessible: t.bool().optional(),
    carryGroupId: t.string().optional(),
  },
  (ctx, args) => {
    const { worldId, canvasId } = requireCanvasScope(args.id, 'inventory_entries');
    const row = { ...args, worldId, canvasId };
    const existing = ctx.db.inventory_entries.id.find(args.id);
    if (existing) {
      ctx.db.inventory_entries.id.update(row);
    } else {
      ctx.db.inventory_entries.insert(row);
    }
  }
);

export const delete_inventory_entry = spacetimedb.reducer(
  { id: t.string() },
  (ctx, { id }) => {
    const entry = ctx.db.inventory_entries.id.find(id);
    if (!entry) return;
    // Clear wield references on the owning actor
    const actor = ctx.db.actors.id.find(entry.actorId);
    if (actor && (actor.leftWieldingEntryId === id || actor.rightWieldingEntryId === id)) {
      ctx.db.actors.id.update({
        ...actor,
        leftWieldingEntryId: actor.leftWieldingEntryId === id ? undefined : actor.leftWieldingEntryId,
        rightWieldingEntryId: actor.rightWieldingEntryId === id ? undefined : actor.rightWieldingEntryId,
      });
    }
    // Clean up free segment positions
    ctx.db.free_segment_positions.segmentId.delete(id);
    for (const row of ctx.db.group_free_segment_positions.segmentId.filter(id)) {
      ctx.db.group_free_segment_positions.id.delete(row.id);
    }
    ctx.db.inventory_entries.id.delete(id);
  }
);

// ─── Carry Group Reducers ─────────────────────────────────────────────────────

export const upsert_carry_group = spacetimedb.reducer(
  {
    id: t.string(),
    ownerActorId: t.string(),
    name: t.string(),
    dropped: t.bool(),
  },
  (ctx, args) => {
    const { worldId, canvasId } = requireCanvasScope(args.id, 'carry_groups');
    const row = { ...args, worldId, canvasId };
    const existing = ctx.db.carry_groups.id.find(args.id);
    if (existing) {
      ctx.db.carry_groups.id.update(row);
    } else {
      ctx.db.carry_groups.insert(row);
    }
  }
);

export const delete_carry_group = spacetimedb.reducer(
  { id: t.string() },
  (ctx, { id }) => {
    ctx.db.carry_groups.id.delete(id);
  }
);

// ─── Movement Group Reducers ──────────────────────────────────────────────────

export const upsert_movement_group = spacetimedb.reducer(
  {
    id: t.string(),
    name: t.string(),
    active: t.bool(),
  },
  (ctx, args) => {
    const { worldId, canvasId } = requireCanvasScope(args.id, 'movement_groups');
    const row = { ...args, worldId, canvasId };
    const existing = ctx.db.movement_groups.id.find(args.id);
    if (existing) {
      ctx.db.movement_groups.id.update(row);
    } else {
      ctx.db.movement_groups.insert(row);
    }
  }
);

export const delete_movement_group = spacetimedb.reducer(
  { id: t.string() },
  (ctx, { id }) => {
    ctx.db.movement_groups.id.delete(id);
  }
);

// ─── Node Position Reducers ───────────────────────────────────────────────────

export const upsert_node_position = spacetimedb.reducer(
  { nodeId: t.string(), x: t.f64(), y: t.f64() },
  (ctx, args) => {
    const { worldId, canvasId } = requireCanvasScope(args.nodeId, 'node_positions');
    const row = { ...args, worldId, canvasId };
    const existing = ctx.db.node_positions.nodeId.find(args.nodeId);
    if (existing) {
      ctx.db.node_positions.nodeId.update(row);
    } else {
      ctx.db.node_positions.insert(row);
    }
  }
);

export const delete_node_position = spacetimedb.reducer(
  { nodeId: t.string() },
  (ctx, { nodeId }) => {
    ctx.db.node_positions.nodeId.delete(nodeId);
  }
);

// ─── Group Position Reducers ──────────────────────────────────────────────────

export const upsert_group_position = spacetimedb.reducer(
  { groupId: t.string(), x: t.f64(), y: t.f64() },
  (ctx, args) => {
    const { worldId, canvasId } = requireCanvasScope(args.groupId, 'group_positions');
    const row = { ...args, worldId, canvasId };
    const existing = ctx.db.group_positions.groupId.find(args.groupId);
    if (existing) {
      ctx.db.group_positions.groupId.update(row);
    } else {
      ctx.db.group_positions.insert(row);
    }
  }
);

export const delete_group_position = spacetimedb.reducer(
  { groupId: t.string() },
  (ctx, { groupId }) => {
    ctx.db.group_positions.groupId.delete(groupId);
  }
);

// ─── Group Size Override Reducers ─────────────────────────────────────────────

export const upsert_group_size_override = spacetimedb.reducer(
  { groupId: t.string(), width: t.f64(), height: t.f64() },
  (ctx, args) => {
    const { worldId, canvasId } = requireCanvasScope(args.groupId, 'group_size_overrides');
    const row = { ...args, worldId, canvasId };
    const existing = ctx.db.group_size_overrides.groupId.find(args.groupId);
    if (existing) {
      ctx.db.group_size_overrides.groupId.update(row);
    } else {
      ctx.db.group_size_overrides.insert(row);
    }
  }
);

export const delete_group_size_override = spacetimedb.reducer(
  { groupId: t.string() },
  (ctx, { groupId }) => {
    ctx.db.group_size_overrides.groupId.delete(groupId);
  }
);

// ─── Node Size Override Reducers ──────────────────────────────────────────────

export const upsert_node_size_override = spacetimedb.reducer(
  { nodeId: t.string(), slotCols: t.u32(), slotRows: t.u32() },
  (ctx, args) => {
    const { worldId, canvasId } = requireCanvasScope(args.nodeId, 'node_size_overrides');
    const row = { ...args, worldId, canvasId };
    const existing = ctx.db.node_size_overrides.nodeId.find(args.nodeId);
    if (existing) {
      ctx.db.node_size_overrides.nodeId.update(row);
    } else {
      ctx.db.node_size_overrides.insert(row);
    }
  }
);

export const delete_node_size_override = spacetimedb.reducer(
  { nodeId: t.string() },
  (ctx, { nodeId }) => {
    ctx.db.node_size_overrides.nodeId.delete(nodeId);
  }
);

// ─── Group List View Reducers ─────────────────────────────────────────────────

export const upsert_group_list_view = spacetimedb.reducer(
  { groupId: t.string(), enabled: t.bool() },
  (ctx, args) => {
    const { worldId, canvasId } = requireCanvasScope(args.groupId, 'group_list_view');
    const row = { ...args, worldId, canvasId };
    const existing = ctx.db.group_list_view.groupId.find(args.groupId);
    if (existing) {
      ctx.db.group_list_view.groupId.update(row);
    } else {
      ctx.db.group_list_view.insert(row);
    }
  }
);

export const delete_group_list_view = spacetimedb.reducer(
  { groupId: t.string() },
  (ctx, { groupId }) => {
    ctx.db.group_list_view.groupId.delete(groupId);
  }
);

// ─── Layout expand (group or node container) Reducers ────────────────────────

export const upsert_layout_expanded = spacetimedb.reducer(
  { containerId: t.string(), expanded: t.bool() },
  (ctx, args) => {
    const { worldId, canvasId } = requireCanvasScope(args.containerId, 'layout_expanded');
    const row = { ...args, worldId, canvasId };
    const existing = ctx.db.layout_expanded.containerId.find(args.containerId);
    if (existing) {
      ctx.db.layout_expanded.containerId.update(row);
    } else {
      ctx.db.layout_expanded.insert(row);
    }
  }
);

export const delete_layout_expanded = spacetimedb.reducer(
  { containerId: t.string() },
  (ctx, { containerId }) => {
    ctx.db.layout_expanded.containerId.delete(containerId);
  }
);

// ─── Node Group Override Reducers ─────────────────────────────────────────────

export const upsert_node_group_override = spacetimedb.reducer(
  { nodeId: t.string(), groupId: t.string().optional() },
  (ctx, args) => {
    const { worldId, canvasId } = requireCanvasScope(args.nodeId, 'node_group_overrides');
    const row = { ...args, worldId, canvasId };
    const existing = ctx.db.node_group_overrides.nodeId.find(args.nodeId);
    if (existing) {
      ctx.db.node_group_overrides.nodeId.update(row);
    } else {
      ctx.db.node_group_overrides.insert(row);
    }
  }
);

export const delete_node_group_override = spacetimedb.reducer(
  { nodeId: t.string() },
  (ctx, { nodeId }) => {
    ctx.db.node_group_overrides.nodeId.delete(nodeId);
  }
);

// ─── Group Node Position Reducers ─────────────────────────────────────────────

export const upsert_group_node_position = spacetimedb.reducer(
  { groupId: t.string(), nodeId: t.string(), x: t.f64(), y: t.f64() },
  (ctx, { groupId, nodeId, x, y }) => {
    const { worldId, canvasId } = requireCanvasScope(groupId, 'group_node_positions');
    const id = compoundKey(groupId, nodeId);
    const row = { id, groupId, nodeId, x, y, worldId, canvasId };
    const existing = ctx.db.group_node_positions.id.find(id);
    if (existing) {
      ctx.db.group_node_positions.id.update(row);
    } else {
      ctx.db.group_node_positions.insert(row);
    }
  }
);

export const delete_group_node_position = spacetimedb.reducer(
  { groupId: t.string(), nodeId: t.string() },
  (ctx, { groupId, nodeId }) => {
    ctx.db.group_node_positions.id.delete(compoundKey(groupId, nodeId));
  }
);

export const delete_group_node_positions_by_group = spacetimedb.reducer(
  { groupId: t.string() },
  (ctx, { groupId }) => {
    for (const row of ctx.db.group_node_positions.groupId.filter(groupId)) {
      ctx.db.group_node_positions.id.delete(row.id);
    }
  }
);

// ─── Free Segment Position Reducers ───────────────────────────────────────────

export const upsert_free_segment_position = spacetimedb.reducer(
  { segmentId: t.string(), x: t.f64(), y: t.f64() },
  (ctx, args) => {
    const { worldId, canvasId } = requireCanvasScope(args.segmentId, 'free_segment_positions');
    const row = { ...args, worldId, canvasId };
    const existing = ctx.db.free_segment_positions.segmentId.find(args.segmentId);
    if (existing) {
      ctx.db.free_segment_positions.segmentId.update(row);
    } else {
      ctx.db.free_segment_positions.insert(row);
    }
  }
);

export const delete_free_segment_position = spacetimedb.reducer(
  { segmentId: t.string() },
  (ctx, { segmentId }) => {
    ctx.db.free_segment_positions.segmentId.delete(segmentId);
  }
);

// ─── Group Free Segment Position Reducers ─────────────────────────────────────

export const upsert_group_free_segment_position = spacetimedb.reducer(
  { groupId: t.string(), segmentId: t.string(), x: t.f64(), y: t.f64() },
  (ctx, { groupId, segmentId, x, y }) => {
    const { worldId, canvasId } = requireCanvasScope(groupId, 'group_free_segment_positions');
    const id = compoundKey(groupId, segmentId);
    const row = { id, groupId, segmentId, x, y, worldId, canvasId };
    const existing = ctx.db.group_free_segment_positions.id.find(id);
    if (existing) {
      ctx.db.group_free_segment_positions.id.update(row);
    } else {
      ctx.db.group_free_segment_positions.insert(row);
    }
  }
);

export const delete_group_free_segment_position = spacetimedb.reducer(
  { groupId: t.string(), segmentId: t.string() },
  (ctx, { groupId, segmentId }) => {
    ctx.db.group_free_segment_positions.id.delete(compoundKey(groupId, segmentId));
  }
);

export const delete_group_free_segment_positions_by_group = spacetimedb.reducer(
  { groupId: t.string() },
  (ctx, { groupId }) => {
    for (const row of ctx.db.group_free_segment_positions.groupId.filter(groupId)) {
      ctx.db.group_free_segment_positions.id.delete(row.id);
    }
  }
);

// ─── Group Node Order Reducers ────────────────────────────────────────────────

export const upsert_group_node_order = spacetimedb.reducer(
  { groupId: t.string(), nodeIdsJson: t.string() },
  (ctx, args) => {
    const { worldId, canvasId } = requireCanvasScope(args.groupId, 'group_node_orders');
    const row = { ...args, worldId, canvasId };
    const existing = ctx.db.group_node_orders.groupId.find(args.groupId);
    if (existing) {
      ctx.db.group_node_orders.groupId.update(row);
    } else {
      ctx.db.group_node_orders.insert(row);
    }
  }
);

export const delete_group_node_order = spacetimedb.reducer(
  { groupId: t.string() },
  (ctx, { groupId }) => {
    ctx.db.group_node_orders.groupId.delete(groupId);
  }
);

// ─── Custom Group Reducers ────────────────────────────────────────────────────

export const upsert_custom_group = spacetimedb.reducer(
  { groupId: t.string(), title: t.string() },
  (ctx, args) => {
    const { worldId, canvasId } = requireCanvasScope(args.groupId, 'custom_groups');
    const row = { ...args, worldId, canvasId };
    const existing = ctx.db.custom_groups.groupId.find(args.groupId);
    if (existing) {
      ctx.db.custom_groups.groupId.update(row);
    } else {
      ctx.db.custom_groups.insert(row);
    }
  }
);

export const delete_custom_group = spacetimedb.reducer(
  { groupId: t.string() },
  (ctx, { groupId }) => {
    ctx.db.custom_groups.groupId.delete(groupId);
    ctx.db.group_positions.groupId.delete(groupId);
    ctx.db.group_size_overrides.groupId.delete(groupId);
    ctx.db.group_list_view.groupId.delete(groupId);
    ctx.db.layout_expanded.containerId.delete(groupId);
    ctx.db.group_node_orders.groupId.delete(groupId);
    ctx.db.group_title_overrides.groupId.delete(groupId);
    for (const row of ctx.db.group_node_positions.groupId.filter(groupId)) {
      ctx.db.group_node_positions.id.delete(row.id);
    }
    for (const row of ctx.db.group_free_segment_positions.groupId.filter(groupId)) {
      ctx.db.group_free_segment_positions.id.delete(row.id);
    }
  }
);

// ─── Group Title Override Reducers ────────────────────────────────────────────

export const upsert_group_title_override = spacetimedb.reducer(
  { groupId: t.string(), title: t.string() },
  (ctx, args) => {
    const { worldId, canvasId } = requireCanvasScope(args.groupId, 'group_title_overrides');
    const row = { ...args, worldId, canvasId };
    const existing = ctx.db.group_title_overrides.groupId.find(args.groupId);
    if (existing) {
      ctx.db.group_title_overrides.groupId.update(row);
    } else {
      ctx.db.group_title_overrides.insert(row);
    }
  }
);

export const delete_group_title_override = spacetimedb.reducer(
  { groupId: t.string() },
  (ctx, { groupId }) => {
    ctx.db.group_title_overrides.groupId.delete(groupId);
  }
);

// ─── Node Title Override Reducers ─────────────────────────────────────────────

export const upsert_node_title_override = spacetimedb.reducer(
  { nodeId: t.string(), title: t.string() },
  (ctx, args) => {
    const { worldId, canvasId } = requireCanvasScope(args.nodeId, 'node_title_overrides');
    const row = { ...args, worldId, canvasId };
    const existing = ctx.db.node_title_overrides.nodeId.find(args.nodeId);
    if (existing) {
      ctx.db.node_title_overrides.nodeId.update(row);
    } else {
      ctx.db.node_title_overrides.insert(row);
    }
  }
);

export const delete_node_title_override = spacetimedb.reducer(
  { nodeId: t.string() },
  (ctx, { nodeId }) => {
    ctx.db.node_title_overrides.nodeId.delete(nodeId);
  }
);

// ─── Node Containment Reducers ────────────────────────────────────────────────

export const upsert_node_containment = spacetimedb.reducer(
  { nodeId: t.string(), containerNodeId: t.string() },
  (ctx, args) => {
    const { worldId, canvasId } = requireCanvasScope(args.nodeId, 'node_containment');
    const row = { ...args, worldId, canvasId };
    const existing = ctx.db.node_containment.nodeId.find(args.nodeId);
    if (existing) {
      ctx.db.node_containment.nodeId.update(row);
    } else {
      ctx.db.node_containment.insert(row);
    }
  }
);

export const delete_node_containment = spacetimedb.reducer(
  { nodeId: t.string() },
  (ctx, { nodeId }) => {
    ctx.db.node_containment.nodeId.delete(nodeId);
  }
);

// ─── Label Reducers ───────────────────────────────────────────────────────────

export const upsert_label = spacetimedb.reducer(
  { labelId: t.string(), text: t.string(), x: t.f64(), y: t.f64() },
  (ctx, args) => {
    const { worldId, canvasId } = requireCanvasScope(args.labelId, 'labels');
    const row = { ...args, worldId, canvasId };
    const existing = ctx.db.labels.labelId.find(args.labelId);
    if (existing) {
      ctx.db.labels.labelId.update(row);
    } else {
      ctx.db.labels.insert(row);
    }
  }
);

export const delete_label = spacetimedb.reducer(
  { labelId: t.string() },
  (ctx, { labelId }) => {
    ctx.db.labels.labelId.delete(labelId);
  }
);

// ─── Settings Reducers ────────────────────────────────────────────────────────

export const upsert_setting = spacetimedb.reducer(
  { key: t.string(), valueNum: t.u32().optional(), valueText: t.string().optional() },
  (ctx, args) => {
    const { worldId, canvasId } = requireCanvasScope(args.key, 'settings');
    const row = { ...args, worldId, canvasId };
    const existing = ctx.db.settings.key.find(args.key);
    if (existing) {
      ctx.db.settings.key.update(row);
    } else {
      ctx.db.settings.insert(row);
    }
  }
);

export const delete_setting = spacetimedb.reducer(
  { key: t.string() },
  (ctx, { key }) => {
    ctx.db.settings.key.delete(key);
  }
);

// ─── Bulk Operations ──────────────────────────────────────────────────────────

export const clear_all_tables = spacetimedb.reducer(
  {},
  (ctx) => {
    for (const r of ctx.db.user_presences.iter()) ctx.db.user_presences.id.delete(r.id);
    for (const r of ctx.db.user_cursors.iter()) ctx.db.user_cursors.id.delete(r.id);
    for (const r of ctx.db.user_cameras.iter()) ctx.db.user_cameras.id.delete(r.id);
    for (const r of ctx.db.canvas_slug_history.iter()) ctx.db.canvas_slug_history.id.delete(r.id);
    for (const r of ctx.db.canvases.iter()) ctx.db.canvases.id.delete(r.id);
    for (const r of ctx.db.world_slug_history.iter()) ctx.db.world_slug_history.id.delete(r.id);
    for (const r of ctx.db.worlds.iter()) ctx.db.worlds.id.delete(r.id);
    for (const r of ctx.db.actors.iter()) ctx.db.actors.id.delete(r.id);
    for (const r of ctx.db.item_definitions.iter()) ctx.db.item_definitions.id.delete(r.id);
    for (const r of ctx.db.inventory_entries.iter()) ctx.db.inventory_entries.id.delete(r.id);
    for (const r of ctx.db.carry_groups.iter()) ctx.db.carry_groups.id.delete(r.id);
    for (const r of ctx.db.movement_groups.iter()) ctx.db.movement_groups.id.delete(r.id);
    for (const r of ctx.db.node_positions.iter()) ctx.db.node_positions.nodeId.delete(r.nodeId);
    for (const r of ctx.db.group_positions.iter()) ctx.db.group_positions.groupId.delete(r.groupId);
    for (const r of ctx.db.group_size_overrides.iter()) ctx.db.group_size_overrides.groupId.delete(r.groupId);
    for (const r of ctx.db.node_size_overrides.iter()) ctx.db.node_size_overrides.nodeId.delete(r.nodeId);
    for (const r of ctx.db.group_list_view.iter()) ctx.db.group_list_view.groupId.delete(r.groupId);
    for (const r of ctx.db.layout_expanded.iter()) ctx.db.layout_expanded.containerId.delete(r.containerId);
    for (const r of ctx.db.node_group_overrides.iter()) ctx.db.node_group_overrides.nodeId.delete(r.nodeId);
    for (const r of ctx.db.group_node_positions.iter()) ctx.db.group_node_positions.id.delete(r.id);
    for (const r of ctx.db.free_segment_positions.iter()) ctx.db.free_segment_positions.segmentId.delete(r.segmentId);
    for (const r of ctx.db.group_free_segment_positions.iter()) ctx.db.group_free_segment_positions.id.delete(r.id);
    for (const r of ctx.db.group_node_orders.iter()) ctx.db.group_node_orders.groupId.delete(r.groupId);
    for (const r of ctx.db.custom_groups.iter()) ctx.db.custom_groups.groupId.delete(r.groupId);
    for (const r of ctx.db.group_title_overrides.iter()) ctx.db.group_title_overrides.groupId.delete(r.groupId);
    for (const r of ctx.db.node_title_overrides.iter()) ctx.db.node_title_overrides.nodeId.delete(r.nodeId);
    for (const r of ctx.db.node_containment.iter()) ctx.db.node_containment.nodeId.delete(r.nodeId);
    for (const r of ctx.db.labels.iter()) ctx.db.labels.labelId.delete(r.labelId);
    for (const r of ctx.db.settings.iter()) ctx.db.settings.key.delete(r.key);
  }
);

export const set_world_state = spacetimedb.reducer(
  { dataJson: t.string() },
  (ctx, { dataJson }) => {
    const data = JSON.parse(dataJson) as {
      actors?: Array<Record<string, unknown>>;
      itemDefinitions?: Array<Record<string, unknown>>;
      inventoryEntries?: Array<Record<string, unknown>>;
      carryGroups?: Array<Record<string, unknown>>;
      movementGroups?: Array<Record<string, unknown>>;
    };

    // Clear existing domain data
    for (const r of ctx.db.actors.iter()) ctx.db.actors.id.delete(r.id);
    for (const r of ctx.db.item_definitions.iter()) ctx.db.item_definitions.id.delete(r.id);
    for (const r of ctx.db.inventory_entries.iter()) ctx.db.inventory_entries.id.delete(r.id);
    for (const r of ctx.db.carry_groups.iter()) ctx.db.carry_groups.id.delete(r.id);
    for (const r of ctx.db.movement_groups.iter()) ctx.db.movement_groups.id.delete(r.id);

    if (data.actors) {
      for (const a of data.actors) {
        const aid = a.id as string;
        const { worldId, canvasId } = requireCanvasScope(aid, 'set_world_state actors');
        const speed = a.baseSpeedProfile as { explorationFeet?: number; combatFeet?: number; runningFeet?: number; milesPerDay?: number } | undefined;
        const stats = a.stats as { strengthMod?: number; hasLoadBearing?: boolean } | undefined;
        ctx.db.actors.insert({
          id: aid,
          worldId,
          canvasId,
          name: a.name as string,
          kind: a.kind as string,
          strengthMod: (stats?.strengthMod ?? 0) as number,
          hasLoadBearing: (stats?.hasLoadBearing ?? false) as boolean,
          movementGroupId: a.movementGroupId as string,
          active: (a.active ?? true) as boolean,
          ownerActorId: a.ownerActorId as string | undefined,
          capacityStone: a.capacityStone as number | undefined,
          baseExplorationFeet: speed?.explorationFeet as number | undefined,
          baseCombatFeet: speed?.combatFeet as number | undefined,
          baseRunningFeet: speed?.runningFeet as number | undefined,
          baseMilesPerDay: speed?.milesPerDay as number | undefined,
          leftWieldingEntryId: a.leftWieldingEntryId as string | undefined,
          rightWieldingEntryId: a.rightWieldingEntryId as string | undefined,
        });
      }
    }

    if (data.itemDefinitions) {
      for (const d of data.itemDefinitions) {
        const did = d.id as string;
        const worldId = requireWorldId(did, 'set_world_state item_definitions');
        ctx.db.item_definitions.insert({
          id: did,
          worldId,
          canonicalName: d.canonicalName as string,
          kind: d.kind as string,
          sixthsPerUnit: d.sixthsPerUnit as number | undefined,
          armorClass: d.armorClass as number | undefined,
          priceInGp: d.priceInGp as number | undefined,
          isFungibleVisual: d.isFungibleVisual as boolean | undefined,
        });
      }
    }

    if (data.inventoryEntries) {
      for (const e of data.inventoryEntries) {
        const eid = e.id as string;
        const { worldId, canvasId } = requireCanvasScope(eid, 'set_world_state inventory_entries');
        const st = e.state as { worn?: boolean; attached?: boolean; heldHands?: number; dropped?: boolean; inaccessible?: boolean } | undefined;
        ctx.db.inventory_entries.insert({
          id: eid,
          worldId,
          canvasId,
          actorId: e.actorId as string,
          itemDefId: e.itemDefId as string,
          quantity: (e.quantity ?? 1) as number,
          zone: e.zone as string,
          stateWorn: st?.worn,
          stateAttached: st?.attached,
          stateHeldHands: st?.heldHands as number | undefined,
          stateDropped: st?.dropped,
          stateInaccessible: st?.inaccessible,
          carryGroupId: e.carryGroupId as string | undefined,
        });
      }
    }

    if (data.carryGroups) {
      for (const cg of data.carryGroups) {
        const cid = cg.id as string;
        const { worldId, canvasId } = requireCanvasScope(cid, 'set_world_state carry_groups');
        ctx.db.carry_groups.insert({
          id: cid,
          worldId,
          canvasId,
          ownerActorId: cg.ownerActorId as string,
          name: cg.name as string,
          dropped: (cg.dropped ?? false) as boolean,
        });
      }
    }

    if (data.movementGroups) {
      for (const mg of data.movementGroups) {
        const mid = mg.id as string;
        const { worldId, canvasId } = requireCanvasScope(mid, 'set_world_state movement_groups');
        ctx.db.movement_groups.insert({
          id: mid,
          worldId,
          canvasId,
          name: mg.name as string,
          active: (mg.active ?? true) as boolean,
        });
      }
    }
  }
);

export const set_layout_state = spacetimedb.reducer(
  { dataJson: t.string() },
  (ctx, { dataJson }) => {
    const data = JSON.parse(dataJson) as Record<string, unknown>;

    // Clear existing layout data
    for (const r of ctx.db.node_positions.iter()) ctx.db.node_positions.nodeId.delete(r.nodeId);
    for (const r of ctx.db.group_positions.iter()) ctx.db.group_positions.groupId.delete(r.groupId);
    for (const r of ctx.db.group_size_overrides.iter()) ctx.db.group_size_overrides.groupId.delete(r.groupId);
    for (const r of ctx.db.node_size_overrides.iter()) ctx.db.node_size_overrides.nodeId.delete(r.nodeId);
    for (const r of ctx.db.group_list_view.iter()) ctx.db.group_list_view.groupId.delete(r.groupId);
    for (const r of ctx.db.layout_expanded.iter()) ctx.db.layout_expanded.containerId.delete(r.containerId);
    for (const r of ctx.db.node_group_overrides.iter()) ctx.db.node_group_overrides.nodeId.delete(r.nodeId);
    for (const r of ctx.db.group_node_positions.iter()) ctx.db.group_node_positions.id.delete(r.id);
    for (const r of ctx.db.free_segment_positions.iter()) ctx.db.free_segment_positions.segmentId.delete(r.segmentId);
    for (const r of ctx.db.group_free_segment_positions.iter()) ctx.db.group_free_segment_positions.id.delete(r.id);
    for (const r of ctx.db.group_node_orders.iter()) ctx.db.group_node_orders.groupId.delete(r.groupId);
    for (const r of ctx.db.custom_groups.iter()) ctx.db.custom_groups.groupId.delete(r.groupId);
    for (const r of ctx.db.group_title_overrides.iter()) ctx.db.group_title_overrides.groupId.delete(r.groupId);
    for (const r of ctx.db.node_title_overrides.iter()) ctx.db.node_title_overrides.nodeId.delete(r.nodeId);
    for (const r of ctx.db.node_containment.iter()) ctx.db.node_containment.nodeId.delete(r.nodeId);
    for (const r of ctx.db.labels.iter()) ctx.db.labels.labelId.delete(r.labelId);
    for (const r of ctx.db.settings.iter()) ctx.db.settings.key.delete(r.key);

    const positions = data.nodePositions as Record<string, { x: number; y: number }> | undefined;
    if (positions) {
      for (const [nodeId, pos] of Object.entries(positions)) {
        const { worldId, canvasId } = requireCanvasScope(nodeId, 'set_layout_state node_positions');
        ctx.db.node_positions.insert({ nodeId, x: pos.x, y: pos.y, worldId, canvasId });
      }
    }

    const gPos = data.groupPositions as Record<string, { x: number; y: number }> | undefined;
    if (gPos) {
      for (const [groupId, pos] of Object.entries(gPos)) {
        const { worldId, canvasId } = requireCanvasScope(groupId, 'set_layout_state group_positions');
        ctx.db.group_positions.insert({ groupId, x: pos.x, y: pos.y, worldId, canvasId });
      }
    }

    const gSize = data.groupSizeOverrides as Record<string, { width: number; height: number }> | undefined;
    if (gSize) {
      for (const [groupId, size] of Object.entries(gSize)) {
        const { worldId, canvasId } = requireCanvasScope(groupId, 'set_layout_state group_size_overrides');
        ctx.db.group_size_overrides.insert({ groupId, width: size.width, height: size.height, worldId, canvasId });
      }
    }

    const nSize = data.nodeSizeOverrides as Record<string, { slotCols: number; slotRows: number }> | undefined;
    if (nSize) {
      for (const [nodeId, size] of Object.entries(nSize)) {
        const { worldId, canvasId } = requireCanvasScope(nodeId, 'set_layout_state node_size_overrides');
        ctx.db.node_size_overrides.insert({ nodeId, slotCols: size.slotCols, slotRows: size.slotRows, worldId, canvasId });
      }
    }

    const glv = data.groupListViewEnabled as Record<string, boolean> | undefined;
    if (glv) {
      for (const [groupId, enabled] of Object.entries(glv)) {
        const { worldId, canvasId } = requireCanvasScope(groupId, 'set_layout_state group_list_view');
        ctx.db.group_list_view.insert({ groupId, enabled, worldId, canvasId });
      }
    }

    const legacyGroupEx = data.groupExpanded as Record<string, boolean> | undefined;
    const legacyNodeEx = data.nodeExpanded as Record<string, boolean> | undefined;
    const layoutEx = data.layoutExpanded as Record<string, boolean> | undefined;
    const mergedLayoutEx = { ...legacyGroupEx, ...legacyNodeEx, ...layoutEx };
    if (Object.keys(mergedLayoutEx).length > 0) {
      for (const [containerId, expanded] of Object.entries(mergedLayoutEx)) {
        const { worldId, canvasId } = requireCanvasScope(containerId, 'set_layout_state layout_expanded');
        ctx.db.layout_expanded.insert({ containerId, expanded, worldId, canvasId });
      }
    }

    const ngo = data.nodeGroupOverrides as Record<string, string | null> | undefined;
    if (ngo) {
      for (const [nodeId, groupId] of Object.entries(ngo)) {
        const { worldId, canvasId } = requireCanvasScope(nodeId, 'set_layout_state node_group_overrides');
        ctx.db.node_group_overrides.insert({ nodeId, groupId: groupId ?? undefined, worldId, canvasId });
      }
    }

    const gnp = data.groupNodePositions as Record<string, Record<string, { x: number; y: number }>> | undefined;
    if (gnp) {
      for (const [groupId, nodes] of Object.entries(gnp)) {
        const { worldId, canvasId } = requireCanvasScope(groupId, 'set_layout_state group_node_positions');
        for (const [nodeId, pos] of Object.entries(nodes)) {
          ctx.db.group_node_positions.insert({
            id: compoundKey(groupId, nodeId),
            groupId,
            nodeId,
            x: pos.x,
            y: pos.y,
            worldId,
            canvasId,
          });
        }
      }
    }

    const fsp = data.freeSegmentPositions as Record<string, { x: number; y: number }> | undefined;
    if (fsp) {
      for (const [segmentId, pos] of Object.entries(fsp)) {
        const { worldId, canvasId } = requireCanvasScope(segmentId, 'set_layout_state free_segment_positions');
        ctx.db.free_segment_positions.insert({ segmentId, x: pos.x, y: pos.y, worldId, canvasId });
      }
    }

    const gfsp = data.groupFreeSegmentPositions as Record<string, Record<string, { x: number; y: number }>> | undefined;
    if (gfsp) {
      for (const [groupId, segs] of Object.entries(gfsp)) {
        const { worldId, canvasId } = requireCanvasScope(groupId, 'set_layout_state group_free_segment_positions');
        for (const [segmentId, pos] of Object.entries(segs)) {
          ctx.db.group_free_segment_positions.insert({
            id: compoundKey(groupId, segmentId),
            groupId,
            segmentId,
            x: pos.x,
            y: pos.y,
            worldId,
            canvasId,
          });
        }
      }
    }

    const gno = data.groupNodeOrders as Record<string, readonly string[]> | undefined;
    if (gno) {
      for (const [groupId, nodeIds] of Object.entries(gno)) {
        const { worldId, canvasId } = requireCanvasScope(groupId, 'set_layout_state group_node_orders');
        ctx.db.group_node_orders.insert({ groupId, nodeIdsJson: JSON.stringify(nodeIds), worldId, canvasId });
      }
    }

    const cg = data.customGroups as Record<string, { title: string }> | undefined;
    if (cg) {
      for (const [groupId, group] of Object.entries(cg)) {
        const { worldId, canvasId } = requireCanvasScope(groupId, 'set_layout_state custom_groups');
        ctx.db.custom_groups.insert({ groupId, title: group.title, worldId, canvasId });
      }
    }

    const gto = data.groupTitleOverrides as Record<string, string> | undefined;
    if (gto) {
      for (const [groupId, title] of Object.entries(gto)) {
        const { worldId, canvasId } = requireCanvasScope(groupId, 'set_layout_state group_title_overrides');
        ctx.db.group_title_overrides.insert({ groupId, title, worldId, canvasId });
      }
    }

    const nto = data.nodeTitleOverrides as Record<string, string> | undefined;
    if (nto) {
      for (const [nodeId, title] of Object.entries(nto)) {
        const { worldId, canvasId } = requireCanvasScope(nodeId, 'set_layout_state node_title_overrides');
        ctx.db.node_title_overrides.insert({ nodeId, title, worldId, canvasId });
      }
    }

    const nc = data.nodeContainment as Record<string, string> | undefined;
    if (nc) {
      for (const [nodeId, containerNodeId] of Object.entries(nc)) {
        const { worldId, canvasId } = requireCanvasScope(nodeId, 'set_layout_state node_containment');
        ctx.db.node_containment.insert({ nodeId, containerNodeId, worldId, canvasId });
      }
    }

    const lbl = data.labels as Record<string, { text: string; x: number; y: number }> | undefined;
    if (lbl) {
      for (const [labelId, label] of Object.entries(lbl)) {
        const { worldId, canvasId } = requireCanvasScope(labelId, 'set_layout_state labels');
        ctx.db.labels.insert({ labelId, text: label.text, x: label.x, y: label.y, worldId, canvasId });
      }
    }

    const stonesPerRow = data.stonesPerRow as number | undefined;
    if (stonesPerRow != null) {
      const anchor =
        (positions && Object.keys(positions)[0]) ??
        (gPos && Object.keys(gPos)[0]) ??
        (gSize && Object.keys(gSize)[0]) ??
        (nSize && Object.keys(nSize)[0]) ??
        null;
      if (anchor) {
        const { worldId, canvasId } = requireCanvasScope(anchor, 'set_layout_state settings');
        const key = `w__${worldId}__c__${canvasId}__settings:stonesPerRow`;
        ctx.db.settings.insert({ key, valueNum: stonesPerRow, valueText: undefined, worldId, canvasId });
      }
    }
  }
);
