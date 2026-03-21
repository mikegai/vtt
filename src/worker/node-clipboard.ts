import type { Actor, CanonicalState, InventoryEntry, ItemDefinition } from '../domain/types'
import { parseNodeId } from '../vm/drop-intent'
import type { SceneVM } from './protocol'
import type { WorkerLocalState } from './scene-vm'
import { VTT_CLIPBOARD_NODES_V1 } from '../domain/clipboard-nodes'

export type NodeClipboardDocV1 = {
  readonly schema: typeof VTT_CLIPBOARD_NODES_V1
  readonly rootNodeIds: readonly string[]
  readonly actors: Record<string, Actor>
  readonly inventoryEntries: Record<string, InventoryEntry>
  readonly carryGroups: Record<string, import('../domain/types').CarryGroup>
  readonly itemDefinitions: Record<string, ItemDefinition>
  readonly local: {
    readonly nodeGroupOverrides: Record<string, string | null>
    readonly nodePositions: Record<string, { x: number; y: number }>
    readonly groupNodePositions: Record<string, Record<string, { x: number; y: number }>>
    readonly nodeSizeOverrides: Record<string, { slotCols: number; slotRows: number }>
    readonly layoutExpanded: Record<string, boolean>
    readonly nodeTitleOverrides: Record<string, string>
    readonly nodeContainment: Record<string, string>
  }
}

const collectActorSubtreeIds = (state: CanonicalState, rootActorId: string): string[] => {
  const byOwner = new Map<string, string[]>()
  Object.values(state.actors).forEach((actor) => {
    if (!actor.ownerActorId) return
    const owned = byOwner.get(actor.ownerActorId) ?? []
    owned.push(actor.id)
    byOwner.set(actor.ownerActorId, owned)
  })
  const out: string[] = []
  const stack: string[] = [rootActorId]
  while (stack.length > 0) {
    const actorId = stack.pop()
    if (!actorId || out.includes(actorId)) continue
    out.push(actorId)
    const children = byOwner.get(actorId) ?? []
    for (let i = children.length - 1; i >= 0; i -= 1) stack.push(children[i])
  }
  return out
}

const collectSceneSubtreeNodeIds = (scene: SceneVM, rootNodeId: string): string[] => {
  const byParent = new Map<string, string[]>()
  Object.values(scene.nodes).forEach((node) => {
    if (!node.parentNodeId) return
    const children = byParent.get(node.parentNodeId) ?? []
    children.push(node.id)
    byParent.set(node.parentNodeId, children)
  })
  const out: string[] = []
  const stack: string[] = [rootNodeId]
  while (stack.length > 0) {
    const nodeId = stack.pop()
    if (!nodeId || out.includes(nodeId)) continue
    out.push(nodeId)
    const children = byParent.get(nodeId) ?? []
    for (let i = children.length - 1; i >= 0; i -= 1) stack.push(children[i])
  }
  return out
}

const exportRoots = (scene: SceneVM, selectedNodeIds: readonly string[]): string[] =>
  selectedNodeIds.filter((nid) => {
    const n = scene.nodes[nid]
    if (!n?.parentNodeId) return true
    return !selectedNodeIds.includes(n.parentNodeId)
  })

const allActorIdsForExport = (worldState: CanonicalState, scene: SceneVM, selectedNodeIds: readonly string[]): Set<string> => {
  const roots = exportRoots(scene, selectedNodeIds)
  const ids = new Set<string>()
  for (const root of roots) {
    const subtreeNodes = collectSceneSubtreeNodeIds(scene, root)
    for (const nid of subtreeNodes) {
      const aid = parseNodeId(nid).actorId
      if (!worldState.actors[aid]) continue
      ids.add(aid)
      collectActorSubtreeIds(worldState, aid).forEach((id) => ids.add(id))
    }
  }
  return ids
}

export const serializeNodeClipboard = (
  worldState: CanonicalState,
  localState: WorkerLocalState,
  scene: SceneVM,
  selectedNodeIds: readonly string[],
): string | null => {
  if (selectedNodeIds.length === 0) return null
  const actorIds = allActorIdsForExport(worldState, scene, selectedNodeIds)
  const nodeIdSet = new Set<string>()
  for (const id of actorIds) {
    const n = scene.nodes[id]
    if (n) nodeIdSet.add(n.id)
  }
  const actors: Record<string, Actor> = {}
  for (const id of actorIds) {
    const a = worldState.actors[id]
    if (a) actors[id] = a
  }
  const inventoryEntries: Record<string, InventoryEntry> = {}
  for (const e of Object.values(worldState.inventoryEntries)) {
    if (actorIds.has(e.actorId)) inventoryEntries[e.id] = e
  }
  const carryGroups: Record<string, import('../domain/types').CarryGroup> = {}
  for (const cg of Object.values(worldState.carryGroups)) {
    if (actorIds.has(cg.ownerActorId)) carryGroups[cg.id] = cg
  }
  const itemDefinitions: Record<string, ItemDefinition> = {}
  for (const e of Object.values(inventoryEntries)) {
    const def = worldState.itemDefinitions[e.itemDefId]
    if (def) itemDefinitions[def.id] = def
  }
  const local = {
    nodeGroupOverrides: Object.fromEntries(
      Object.entries(localState.nodeGroupOverrides).filter(([id]) => actorIds.has(id)),
    ),
    nodePositions: Object.fromEntries(Object.entries(localState.nodePositions).filter(([id]) => actorIds.has(id))),
    groupNodePositions: Object.fromEntries(
      Object.entries(localState.groupNodePositions)
        .map(([gid, pos]) => {
          const next = Object.fromEntries(Object.entries(pos).filter(([aid]) => actorIds.has(aid)))
          return [gid, next] as const
        })
        .filter(([, pos]) => Object.keys(pos).length > 0),
    ),
    nodeSizeOverrides: Object.fromEntries(
      Object.entries(localState.nodeSizeOverrides).filter(([id]) => actorIds.has(id)),
    ),
    layoutExpanded: Object.fromEntries(Object.entries(localState.layoutExpanded).filter(([id]) => actorIds.has(id))),
    nodeTitleOverrides: Object.fromEntries(
      Object.entries(localState.nodeTitleOverrides).filter(([id]) => actorIds.has(id)),
    ),
    nodeContainment: Object.fromEntries(
      Object.entries(localState.nodeContainment).filter(
        ([contained, container]) => nodeIdSet.has(contained) && nodeIdSet.has(container),
      ),
    ),
  }
  const doc: NodeClipboardDocV1 = {
    schema: VTT_CLIPBOARD_NODES_V1,
    rootNodeIds: exportRoots(scene, selectedNodeIds),
    actors,
    inventoryEntries,
    carryGroups,
    itemDefinitions,
    local,
  }
  return JSON.stringify(doc, null, 2)
}

const isRecord = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)

export const parseNodeClipboardPayload = (raw: string): NodeClipboardDocV1 | null => {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return null
  }
  if (!isRecord(parsed) || parsed.schema !== VTT_CLIPBOARD_NODES_V1) return null
  if (!Array.isArray(parsed.rootNodeIds) || !isRecord(parsed.actors) || !isRecord(parsed.inventoryEntries)) return null
  return parsed as NodeClipboardDocV1
}
