import { schema, t, table } from 'spacetimedb/server';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function compoundKey(a: string, b: string): string {
  return `${a}::${b}`;
}

// ─── Domain Tables ────────────────────────────────────────────────────────────

const actors = table(
  { name: 'actors', public: true },
  {
    id: t.string().primaryKey(),
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
  { name: 'item_definitions', public: true },
  {
    id: t.string().primaryKey(),
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
    indexes: [{ accessor: 'actorId', name: 'idx_entries_actor', algorithm: 'btree' as const, columns: ['actorId'] }],
  },
  {
    id: t.string().primaryKey(),
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
    indexes: [{ accessor: 'ownerActorId', name: 'idx_cg_owner', algorithm: 'btree' as const, columns: ['ownerActorId'] }],
  },
  {
    id: t.string().primaryKey(),
    ownerActorId: t.string(),
    name: t.string(),
    dropped: t.bool(),
  }
);

const movement_groups = table(
  { name: 'movement_groups', public: true },
  {
    id: t.string().primaryKey(),
    name: t.string(),
    active: t.bool(),
  }
);

// ─── Layout Tables ────────────────────────────────────────────────────────────

const node_positions = table(
  { name: 'node_positions', public: true },
  {
    nodeId: t.string().primaryKey(),
    x: t.f64(),
    y: t.f64(),
  }
);

const group_positions = table(
  { name: 'group_positions', public: true },
  {
    groupId: t.string().primaryKey(),
    x: t.f64(),
    y: t.f64(),
  }
);

const group_size_overrides = table(
  { name: 'group_size_overrides', public: true },
  {
    groupId: t.string().primaryKey(),
    width: t.f64(),
    height: t.f64(),
  }
);

const node_size_overrides = table(
  { name: 'node_size_overrides', public: true },
  {
    nodeId: t.string().primaryKey(),
    slotCols: t.u32(),
    slotRows: t.u32(),
  }
);

const group_list_view = table(
  { name: 'group_list_view', public: true },
  {
    groupId: t.string().primaryKey(),
    enabled: t.bool(),
  }
);

const node_group_overrides = table(
  { name: 'node_group_overrides', public: true },
  {
    nodeId: t.string().primaryKey(),
    groupId: t.string().optional(),
  }
);

const group_node_positions = table(
  {
    name: 'group_node_positions',
    public: true,
    indexes: [{ accessor: 'groupId', name: 'idx_gnp_group', algorithm: 'btree' as const, columns: ['groupId'] }],
  },
  {
    id: t.string().primaryKey(),
    groupId: t.string(),
    nodeId: t.string(),
    x: t.f64(),
    y: t.f64(),
  }
);

const free_segment_positions = table(
  { name: 'free_segment_positions', public: true },
  {
    segmentId: t.string().primaryKey(),
    x: t.f64(),
    y: t.f64(),
  }
);

const group_free_segment_positions = table(
  {
    name: 'group_free_segment_positions',
    public: true,
    indexes: [{ accessor: 'groupId', name: 'idx_gfsp_group', algorithm: 'btree' as const, columns: ['groupId'] }],
  },
  {
    id: t.string().primaryKey(),
    groupId: t.string(),
    segmentId: t.string(),
    x: t.f64(),
    y: t.f64(),
  }
);

const group_node_orders = table(
  { name: 'group_node_orders', public: true },
  {
    groupId: t.string().primaryKey(),
    nodeIdsJson: t.string(),
  }
);

const custom_groups = table(
  { name: 'custom_groups', public: true },
  {
    groupId: t.string().primaryKey(),
    title: t.string(),
  }
);

const group_title_overrides = table(
  { name: 'group_title_overrides', public: true },
  {
    groupId: t.string().primaryKey(),
    title: t.string(),
  }
);

const node_title_overrides = table(
  { name: 'node_title_overrides', public: true },
  {
    nodeId: t.string().primaryKey(),
    title: t.string(),
  }
);

const node_containment = table(
  { name: 'node_containment', public: true },
  {
    nodeId: t.string().primaryKey(),
    containerNodeId: t.string(),
  }
);

const labels = table(
  { name: 'labels', public: true },
  {
    labelId: t.string().primaryKey(),
    text: t.string(),
    x: t.f64(),
    y: t.f64(),
  }
);

const settings = table(
  { name: 'settings', public: true },
  {
    key: t.string().primaryKey(),
    valueNum: t.u32().optional(),
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
    indexes: [{ accessor: 'identityHex', name: 'idx_presence_identity', algorithm: 'btree' as const, columns: ['identityHex'] }],
  },
  {
    id: t.string().primaryKey(),
    identityHex: t.string(),
    worldSlug: t.string(),
    canvasSlug: t.string(),
    lastSeenMs: t.f64(),
  }
);

const user_cursors = table(
  {
    name: 'user_cursors',
    public: true,
    indexes: [{ accessor: 'identityHex', name: 'idx_cursor_identity', algorithm: 'btree' as const, columns: ['identityHex'] }],
  },
  {
    id: t.string().primaryKey(),
    identityHex: t.string(),
    worldSlug: t.string(),
    canvasSlug: t.string(),
    x: t.f64(),
    y: t.f64(),
    viewportScale: t.f64().optional(),
  }
);

const user_cameras = table(
  {
    name: 'user_cameras',
    public: true,
    indexes: [{ accessor: 'identityHex', name: 'idx_camera_identity', algorithm: 'btree' as const, columns: ['identityHex'] }],
  },
  {
    id: t.string().primaryKey(),
    identityHex: t.string(),
    worldSlug: t.string(),
    canvasSlug: t.string(),
    panX: t.f64(),
    panY: t.f64(),
    zoom: t.f64(),
  }
);

// ─── Schema ───────────────────────────────────────────────────────────────────

const spacetimedb = schema({
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
  for (const row of ctx.db.user_presences.iter()) {
    if (row.identityHex === hex) ctx.db.user_presences.id.delete(row.id);
  }
  for (const row of ctx.db.user_cursors.iter()) {
    if (row.identityHex === hex) ctx.db.user_cursors.id.delete(row.id);
  }
  for (const row of ctx.db.user_cameras.iter()) {
    if (row.identityHex === hex) ctx.db.user_cameras.id.delete(row.id);
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
  { worldSlug: t.string(), canvasSlug: t.string() },
  (ctx, { worldSlug, canvasSlug }) => {
    const hex = ctx.sender.toHexString();
    const id = compoundKey(compoundKey(worldSlug, canvasSlug), hex);
    const nowMs = Number(ctx.timestamp.toMillis());
    const existing = ctx.db.user_presences.id.find(id);
    if (existing) {
      ctx.db.user_presences.id.update({ ...existing, lastSeenMs: nowMs });
    } else {
      ctx.db.user_presences.insert({ id, identityHex: hex, worldSlug, canvasSlug, lastSeenMs: nowMs });
    }
  }
);

export const update_cursor = spacetimedb.reducer(
  { worldSlug: t.string(), canvasSlug: t.string(), x: t.f64(), y: t.f64(), viewportScale: t.f64().optional() },
  (ctx, { worldSlug, canvasSlug, x, y, viewportScale }) => {
    const hex = ctx.sender.toHexString();
    const id = compoundKey(compoundKey(worldSlug, canvasSlug), hex);
    const existing = ctx.db.user_cursors.id.find(id);
    if (existing) {
      ctx.db.user_cursors.id.update({ id, identityHex: hex, worldSlug, canvasSlug, x, y, viewportScale });
    } else {
      ctx.db.user_cursors.insert({ id, identityHex: hex, worldSlug, canvasSlug, x, y, viewportScale });
    }
    const presenceExisting = ctx.db.user_presences.id.find(id);
    const nowMs = Number(ctx.timestamp.toMillis());
    if (presenceExisting) {
      ctx.db.user_presences.id.update({ ...presenceExisting, lastSeenMs: nowMs });
    } else {
      ctx.db.user_presences.insert({ id, identityHex: hex, worldSlug, canvasSlug, lastSeenMs: nowMs });
    }
  }
);

export const update_camera = spacetimedb.reducer(
  { worldSlug: t.string(), canvasSlug: t.string(), panX: t.f64(), panY: t.f64(), zoom: t.f64() },
  (ctx, { worldSlug, canvasSlug, panX, panY, zoom }) => {
    const hex = ctx.sender.toHexString();
    const id = compoundKey(compoundKey(worldSlug, canvasSlug), hex);
    const existing = ctx.db.user_cameras.id.find(id);
    if (existing) {
      ctx.db.user_cameras.id.update({ id, identityHex: hex, worldSlug, canvasSlug, panX, panY, zoom });
    } else {
      ctx.db.user_cameras.insert({ id, identityHex: hex, worldSlug, canvasSlug, panX, panY, zoom });
    }
    const presenceExisting = ctx.db.user_presences.id.find(id);
    const nowMs = Number(ctx.timestamp.toMillis());
    if (presenceExisting) {
      ctx.db.user_presences.id.update({ ...presenceExisting, lastSeenMs: nowMs });
    } else {
      ctx.db.user_presences.insert({ id, identityHex: hex, worldSlug, canvasSlug, lastSeenMs: nowMs });
    }
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
    const existing = ctx.db.actors.id.find(args.id);
    if (existing) {
      ctx.db.actors.id.update(args);
    } else {
      ctx.db.actors.insert(args);
    }
  }
);

export const delete_actor = spacetimedb.reducer(
  { id: t.string() },
  (ctx, { id }) => {
    for (const entry of ctx.db.inventory_entries.iter()) {
      if (entry.actorId === id) ctx.db.inventory_entries.id.delete(entry.id);
    }
    for (const cg of ctx.db.carry_groups.iter()) {
      if (cg.ownerActorId === id) ctx.db.carry_groups.id.delete(cg.id);
    }
    // Clean up layout data
    ctx.db.node_positions.nodeId.delete(id);
    ctx.db.node_size_overrides.nodeId.delete(id);
    ctx.db.node_group_overrides.nodeId.delete(id);
    ctx.db.node_title_overrides.nodeId.delete(id);
    ctx.db.node_containment.nodeId.delete(id);
    for (const row of ctx.db.node_containment.iter()) {
      if (row.containerNodeId === id) ctx.db.node_containment.nodeId.delete(row.nodeId);
    }
    for (const row of ctx.db.group_node_positions.iter()) {
      if (row.nodeId === id) ctx.db.group_node_positions.id.delete(row.id);
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
    const existing = ctx.db.item_definitions.id.find(args.id);
    if (existing) {
      ctx.db.item_definitions.id.update(args);
    } else {
      ctx.db.item_definitions.insert(args);
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
    const existing = ctx.db.inventory_entries.id.find(args.id);
    if (existing) {
      ctx.db.inventory_entries.id.update(args);
    } else {
      ctx.db.inventory_entries.insert(args);
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
    for (const row of ctx.db.group_free_segment_positions.iter()) {
      if (row.segmentId === id) ctx.db.group_free_segment_positions.id.delete(row.id);
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
    const existing = ctx.db.carry_groups.id.find(args.id);
    if (existing) {
      ctx.db.carry_groups.id.update(args);
    } else {
      ctx.db.carry_groups.insert(args);
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
    const existing = ctx.db.movement_groups.id.find(args.id);
    if (existing) {
      ctx.db.movement_groups.id.update(args);
    } else {
      ctx.db.movement_groups.insert(args);
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
    const existing = ctx.db.node_positions.nodeId.find(args.nodeId);
    if (existing) {
      ctx.db.node_positions.nodeId.update(args);
    } else {
      ctx.db.node_positions.insert(args);
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
    const existing = ctx.db.group_positions.groupId.find(args.groupId);
    if (existing) {
      ctx.db.group_positions.groupId.update(args);
    } else {
      ctx.db.group_positions.insert(args);
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
    const existing = ctx.db.group_size_overrides.groupId.find(args.groupId);
    if (existing) {
      ctx.db.group_size_overrides.groupId.update(args);
    } else {
      ctx.db.group_size_overrides.insert(args);
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
    const existing = ctx.db.node_size_overrides.nodeId.find(args.nodeId);
    if (existing) {
      ctx.db.node_size_overrides.nodeId.update(args);
    } else {
      ctx.db.node_size_overrides.insert(args);
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
    const existing = ctx.db.group_list_view.groupId.find(args.groupId);
    if (existing) {
      ctx.db.group_list_view.groupId.update(args);
    } else {
      ctx.db.group_list_view.insert(args);
    }
  }
);

export const delete_group_list_view = spacetimedb.reducer(
  { groupId: t.string() },
  (ctx, { groupId }) => {
    ctx.db.group_list_view.groupId.delete(groupId);
  }
);

// ─── Node Group Override Reducers ─────────────────────────────────────────────

export const upsert_node_group_override = spacetimedb.reducer(
  { nodeId: t.string(), groupId: t.string().optional() },
  (ctx, args) => {
    const existing = ctx.db.node_group_overrides.nodeId.find(args.nodeId);
    if (existing) {
      ctx.db.node_group_overrides.nodeId.update(args);
    } else {
      ctx.db.node_group_overrides.insert(args);
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
    const id = compoundKey(groupId, nodeId);
    const existing = ctx.db.group_node_positions.id.find(id);
    if (existing) {
      ctx.db.group_node_positions.id.update({ id, groupId, nodeId, x, y });
    } else {
      ctx.db.group_node_positions.insert({ id, groupId, nodeId, x, y });
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
    for (const row of ctx.db.group_node_positions.iter()) {
      if (row.groupId === groupId) ctx.db.group_node_positions.id.delete(row.id);
    }
  }
);

// ─── Free Segment Position Reducers ───────────────────────────────────────────

export const upsert_free_segment_position = spacetimedb.reducer(
  { segmentId: t.string(), x: t.f64(), y: t.f64() },
  (ctx, args) => {
    const existing = ctx.db.free_segment_positions.segmentId.find(args.segmentId);
    if (existing) {
      ctx.db.free_segment_positions.segmentId.update(args);
    } else {
      ctx.db.free_segment_positions.insert(args);
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
    const id = compoundKey(groupId, segmentId);
    const existing = ctx.db.group_free_segment_positions.id.find(id);
    if (existing) {
      ctx.db.group_free_segment_positions.id.update({ id, groupId, segmentId, x, y });
    } else {
      ctx.db.group_free_segment_positions.insert({ id, groupId, segmentId, x, y });
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
    for (const row of ctx.db.group_free_segment_positions.iter()) {
      if (row.groupId === groupId) ctx.db.group_free_segment_positions.id.delete(row.id);
    }
  }
);

// ─── Group Node Order Reducers ────────────────────────────────────────────────

export const upsert_group_node_order = spacetimedb.reducer(
  { groupId: t.string(), nodeIdsJson: t.string() },
  (ctx, args) => {
    const existing = ctx.db.group_node_orders.groupId.find(args.groupId);
    if (existing) {
      ctx.db.group_node_orders.groupId.update(args);
    } else {
      ctx.db.group_node_orders.insert(args);
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
    const existing = ctx.db.custom_groups.groupId.find(args.groupId);
    if (existing) {
      ctx.db.custom_groups.groupId.update(args);
    } else {
      ctx.db.custom_groups.insert(args);
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
    ctx.db.group_node_orders.groupId.delete(groupId);
    ctx.db.group_title_overrides.groupId.delete(groupId);
    for (const row of ctx.db.group_node_positions.iter()) {
      if (row.groupId === groupId) ctx.db.group_node_positions.id.delete(row.id);
    }
    for (const row of ctx.db.group_free_segment_positions.iter()) {
      if (row.groupId === groupId) ctx.db.group_free_segment_positions.id.delete(row.id);
    }
  }
);

// ─── Group Title Override Reducers ────────────────────────────────────────────

export const upsert_group_title_override = spacetimedb.reducer(
  { groupId: t.string(), title: t.string() },
  (ctx, args) => {
    const existing = ctx.db.group_title_overrides.groupId.find(args.groupId);
    if (existing) {
      ctx.db.group_title_overrides.groupId.update(args);
    } else {
      ctx.db.group_title_overrides.insert(args);
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
    const existing = ctx.db.node_title_overrides.nodeId.find(args.nodeId);
    if (existing) {
      ctx.db.node_title_overrides.nodeId.update(args);
    } else {
      ctx.db.node_title_overrides.insert(args);
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
    const existing = ctx.db.node_containment.nodeId.find(args.nodeId);
    if (existing) {
      ctx.db.node_containment.nodeId.update(args);
    } else {
      ctx.db.node_containment.insert(args);
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
    const existing = ctx.db.labels.labelId.find(args.labelId);
    if (existing) {
      ctx.db.labels.labelId.update(args);
    } else {
      ctx.db.labels.insert(args);
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
  { key: t.string(), valueNum: t.u32().optional() },
  (ctx, args) => {
    const existing = ctx.db.settings.key.find(args.key);
    if (existing) {
      ctx.db.settings.key.update(args);
    } else {
      ctx.db.settings.insert(args);
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
        const speed = a.baseSpeedProfile as { explorationFeet?: number; combatFeet?: number; runningFeet?: number; milesPerDay?: number } | undefined;
        const stats = a.stats as { strengthMod?: number; hasLoadBearing?: boolean } | undefined;
        ctx.db.actors.insert({
          id: a.id as string,
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
        ctx.db.item_definitions.insert({
          id: d.id as string,
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
        const st = e.state as { worn?: boolean; attached?: boolean; heldHands?: number; dropped?: boolean; inaccessible?: boolean } | undefined;
        ctx.db.inventory_entries.insert({
          id: e.id as string,
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
        ctx.db.carry_groups.insert({
          id: cg.id as string,
          ownerActorId: cg.ownerActorId as string,
          name: cg.name as string,
          dropped: (cg.dropped ?? false) as boolean,
        });
      }
    }

    if (data.movementGroups) {
      for (const mg of data.movementGroups) {
        ctx.db.movement_groups.insert({
          id: mg.id as string,
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
        ctx.db.node_positions.insert({ nodeId, x: pos.x, y: pos.y });
      }
    }

    const gPos = data.groupPositions as Record<string, { x: number; y: number }> | undefined;
    if (gPos) {
      for (const [groupId, pos] of Object.entries(gPos)) {
        ctx.db.group_positions.insert({ groupId, x: pos.x, y: pos.y });
      }
    }

    const gSize = data.groupSizeOverrides as Record<string, { width: number; height: number }> | undefined;
    if (gSize) {
      for (const [groupId, size] of Object.entries(gSize)) {
        ctx.db.group_size_overrides.insert({ groupId, width: size.width, height: size.height });
      }
    }

    const nSize = data.nodeSizeOverrides as Record<string, { slotCols: number; slotRows: number }> | undefined;
    if (nSize) {
      for (const [nodeId, size] of Object.entries(nSize)) {
        ctx.db.node_size_overrides.insert({ nodeId, slotCols: size.slotCols, slotRows: size.slotRows });
      }
    }

    const glv = data.groupListViewEnabled as Record<string, boolean> | undefined;
    if (glv) {
      for (const [groupId, enabled] of Object.entries(glv)) {
        ctx.db.group_list_view.insert({ groupId, enabled });
      }
    }

    const ngo = data.nodeGroupOverrides as Record<string, string | null> | undefined;
    if (ngo) {
      for (const [nodeId, groupId] of Object.entries(ngo)) {
        ctx.db.node_group_overrides.insert({ nodeId, groupId: groupId ?? undefined });
      }
    }

    const gnp = data.groupNodePositions as Record<string, Record<string, { x: number; y: number }>> | undefined;
    if (gnp) {
      for (const [groupId, nodes] of Object.entries(gnp)) {
        for (const [nodeId, pos] of Object.entries(nodes)) {
          ctx.db.group_node_positions.insert({
            id: compoundKey(groupId, nodeId),
            groupId,
            nodeId,
            x: pos.x,
            y: pos.y,
          });
        }
      }
    }

    const fsp = data.freeSegmentPositions as Record<string, { x: number; y: number }> | undefined;
    if (fsp) {
      for (const [segmentId, pos] of Object.entries(fsp)) {
        ctx.db.free_segment_positions.insert({ segmentId, x: pos.x, y: pos.y });
      }
    }

    const gfsp = data.groupFreeSegmentPositions as Record<string, Record<string, { x: number; y: number }>> | undefined;
    if (gfsp) {
      for (const [groupId, segs] of Object.entries(gfsp)) {
        for (const [segmentId, pos] of Object.entries(segs)) {
          ctx.db.group_free_segment_positions.insert({
            id: compoundKey(groupId, segmentId),
            groupId,
            segmentId,
            x: pos.x,
            y: pos.y,
          });
        }
      }
    }

    const gno = data.groupNodeOrders as Record<string, readonly string[]> | undefined;
    if (gno) {
      for (const [groupId, nodeIds] of Object.entries(gno)) {
        ctx.db.group_node_orders.insert({ groupId, nodeIdsJson: JSON.stringify(nodeIds) });
      }
    }

    const cg = data.customGroups as Record<string, { title: string }> | undefined;
    if (cg) {
      for (const [groupId, group] of Object.entries(cg)) {
        ctx.db.custom_groups.insert({ groupId, title: group.title });
      }
    }

    const gto = data.groupTitleOverrides as Record<string, string> | undefined;
    if (gto) {
      for (const [groupId, title] of Object.entries(gto)) {
        ctx.db.group_title_overrides.insert({ groupId, title });
      }
    }

    const nto = data.nodeTitleOverrides as Record<string, string> | undefined;
    if (nto) {
      for (const [nodeId, title] of Object.entries(nto)) {
        ctx.db.node_title_overrides.insert({ nodeId, title });
      }
    }

    const nc = data.nodeContainment as Record<string, string> | undefined;
    if (nc) {
      for (const [nodeId, containerNodeId] of Object.entries(nc)) {
        ctx.db.node_containment.insert({ nodeId, containerNodeId });
      }
    }

    const lbl = data.labels as Record<string, { text: string; x: number; y: number }> | undefined;
    if (lbl) {
      for (const [labelId, label] of Object.entries(lbl)) {
        ctx.db.labels.insert({ labelId, text: label.text, x: label.x, y: label.y });
      }
    }

    const stonesPerRow = data.stonesPerRow as number | undefined;
    if (stonesPerRow != null) {
      ctx.db.settings.insert({ key: 'stonesPerRow', valueNum: stonesPerRow });
    }
  }
);
