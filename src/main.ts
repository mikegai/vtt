import './style.css'
import { parseInventoryImportPlan } from './domain/inventory-import-plan'
import { parseInventoryText } from './domain/inventory-text-parser'
import { allSourceItems, itemSourceCatalog, type EncumbranceExpr, type SourceItem } from './domain/item-source-catalog'
import { formatSixthsAsStone, stoneToSixths } from './domain/rules'
import { createSourceItemSearchIndex } from './domain/item-source-search'
import { getWieldOptions } from './domain/weapon-metadata'
import { PixiBoardAdapter } from './pixi/PixiBoardAdapter'
import { sampleState } from './sample-data'
import type { ActorKind } from './domain/types'
import type { MainToWorkerMessage, SceneSegmentVM, SceneVM, WorkerToMainMessage } from './worker/protocol'
import type { ItemCategory } from './domain/item-category'

const app = document.querySelector<HTMLDivElement>('#app')
if (!app) throw new Error('App root missing')

// Temporary visual marker to confirm this exact VTT bundle is loaded.
const debugBuildMarker = 'VTT DEBUG BUILD LOADED (marker: 2026-03-16-01)'
const debugBadge = document.createElement('div')
debugBadge.textContent = debugBuildMarker
Object.assign(debugBadge.style, {
  position: 'fixed',
  right: '12px',
  bottom: '12px',
  zIndex: '2147483647',
  background: '#10161fcc',
  color: '#8ff7bf',
  border: '1px solid #8ff7bf66',
  borderRadius: '6px',
  padding: '6px 10px',
  fontFamily: 'monospace',
  fontSize: '11px',
  letterSpacing: '0.02em',
  pointerEvents: 'none',
} as Partial<CSSStyleDeclaration>)
document.body.appendChild(debugBadge)

const sourceItemSearch = createSourceItemSearchIndex()

const formatEncumbrance = (enc: EncumbranceExpr): string => {
  const st = (s: string) => s.replace(' stone', ' st')
  if (enc.kind === 'fixed') return st(formatSixthsAsStone(enc.sixths))
  if (enc.kind === 'range') return `${st(formatSixthsAsStone(enc.minSixths))}–${st(formatSixthsAsStone(enc.maxSixths))}`
  if (enc.kind === 'at-least') return st(formatSixthsAsStone(enc.minSixths)) + '+'
  if (enc.kind === 'by-weight') return 'By weight'
  if (enc.kind === 'varies') return 'Varies'
  return '-'
}

app.innerHTML = `
  <div id="category-bar" class="category-bar">
    <button type="button" class="category-btn" data-category="armor-and-barding">Armor</button>
    <button type="button" class="category-btn" data-category="weapons">Weapons</button>
    <button type="button" class="category-btn" data-category="adventuring-equipment">Adventuring</button>
    <button type="button" class="category-btn category-btn-all" data-category="">All</button>
  </div>
  <button id="left-drawer-toggle" class="left-drawer-toggle" aria-label="Open palette">Palette</button>
  <div id="left-drawer" class="left-drawer">
    <div class="left-drawer-header">
      <h2>Palette</h2>
      <button id="left-drawer-close" class="drawer-close" aria-label="Close palette">&times;</button>
    </div>
    <div class="left-drawer-body">
      <section class="tool-panel">
        <label class="tool-label">Drawing Tools</label>
        <button id="tool-text" class="palette-tool-btn" type="button">Text</button>
        <div class="palette-help">Choose Text, then click on the canvas to place a label.</div>
      </section>
    </div>
  </div>
  <div id="canvas-host"></div>

  <button id="drawer-toggle" class="drawer-toggle" aria-label="Toggle tools panel">
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none"><rect y="3" width="20" height="2" rx="1" fill="currentColor"/><rect y="9" width="20" height="2" rx="1" fill="currentColor"/><rect y="15" width="20" height="2" rx="1" fill="currentColor"/></svg>
  </button>

  <div id="drawer" class="drawer">
    <div class="drawer-header">
      <h2>Tools</h2>
      <button id="drawer-close" class="drawer-close" aria-label="Close">&times;</button>
    </div>
    <div class="drawer-body">
      <section class="tool-panel">
        <label for="search-input" class="tool-label">Source Search</label>
        <input id="search-input" class="tool-input" placeholder="Search items, category:weapons, enc:by-weight" />
        <div id="search-chips" class="chips"></div>
        <div id="search-suggestions" class="suggestions"></div>
        <ul id="search-results" class="results"></ul>
      </section>

      <section class="tool-panel">
        <label for="parse-input" class="tool-label">Paste Inventory</label>
        <textarea id="parse-input" class="tool-textarea" rows="3" placeholder="2 sacks, 14 torches and 3 flasks of oil"></textarea>
        <div id="parse-results" class="parsed-list"></div>
      </section>

      <section class="tool-panel">
        <label for="bulk-input" class="tool-label">Bulk Import</label>
        <textarea id="bulk-input" class="tool-textarea" rows="6" placeholder="Fighter: plate armor, shield, short sword&#10;&#10;Loot Pile - Crypt Chest: 2 sacks, 14 torches"></textarea>
        <div id="bulk-results" class="parsed-list"></div>
      </section>

      <section class="tool-panel">
        <label for="label-edit-input" class="tool-label">Label Inspector</label>
        <div id="label-editor" class="label-editor">
          <input id="label-edit-input" class="tool-input" placeholder="Select a label to edit" />
          <div class="label-editor-actions">
            <button id="label-save-btn" class="tool-button" type="button">Save Text</button>
            <button id="label-delete-btn" class="tool-button tool-button-danger" type="button">Delete Label</button>
          </div>
        </div>
      </section>

      <section class="tool-panel">
        <label for="label-min-visible-px" class="tool-label">Settings</label>
        <select id="label-min-visible-px" class="tool-input">
          <option value="4">Label minimum text size: 4 px</option>
          <option value="5">Label minimum text size: 5 px</option>
          <option value="6" selected>Label minimum text size: 6 px</option>
          <option value="7">Label minimum text size: 7 px</option>
          <option value="8">Label minimum text size: 8 px</option>
          <option value="9">Label minimum text size: 9 px</option>
          <option value="10">Label minimum text size: 10 px</option>
        </select>
        <select id="stones-per-row" class="tool-input" style="margin-top: 8px">
          <option value="10">Stones per row: 10</option>
          <option value="15">Stones per row: 15</option>
          <option value="20">Stones per row: 20</option>
          <option value="25" selected>Stones per row: 25</option>
          <option value="30">Stones per row: 30</option>
          <option value="40">Stones per row: 40</option>
          <option value="50">Stones per row: 50</option>
        </select>
      </section>

      <div class="tool-meta">
        ${allSourceItems.length} source items &bull; ${itemSourceCatalog.armorAndBarding.length} armor &bull; ${itemSourceCatalog.weapons.length} weapons &bull; ${itemSourceCatalog.adventuringEquipment.length} gear
      </div>
    </div>
  </div>

  <div id="hud-bar" class="hud-bar"></div>

  <div id="context-menu" class="context-menu" hidden></div>
`

const canvasHost = document.querySelector<HTMLElement>('#canvas-host')!
const leftDrawerEl = document.querySelector<HTMLElement>('#left-drawer')!
const leftDrawerToggle = document.querySelector<HTMLElement>('#left-drawer-toggle')!
const leftDrawerClose = document.querySelector<HTMLElement>('#left-drawer-close')!
const toolTextBtnEl = document.querySelector<HTMLButtonElement>('#tool-text')!
const drawerEl = document.querySelector<HTMLElement>('#drawer')!
const drawerToggle = document.querySelector<HTMLElement>('#drawer-toggle')!
const drawerClose = document.querySelector<HTMLElement>('#drawer-close')!
const parseInputEl = document.querySelector<HTMLTextAreaElement>('#parse-input')!
const parseResultsEl = document.querySelector<HTMLElement>('#parse-results')!

drawerToggle.addEventListener('click', () => drawerEl.classList.toggle('open'))
drawerClose.addEventListener('click', () => drawerEl.classList.remove('open'))
leftDrawerToggle.addEventListener('click', () => leftDrawerEl.classList.toggle('open'))
leftDrawerClose.addEventListener('click', () => leftDrawerEl.classList.remove('open'))

const categoryBar = document.querySelector<HTMLElement>('#category-bar')!
categoryBar.querySelectorAll<HTMLButtonElement>('.category-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    const raw = btn.dataset.category ?? ''
    const category = raw === '' ? null : (raw as 'armor-and-barding' | 'weapons' | 'adventuring-equipment')
    postToWorker({
      type: 'INTENT',
      intent: { type: 'SET_FILTER_CATEGORY', category },
    })
    categoryBar.querySelectorAll('.category-btn').forEach((b) => b.classList.remove('active'))
    if (category) btn.classList.add('active')
    else categoryBar.querySelector('.category-btn-all')?.classList.add('active')
  })
})

const vmWorker = new Worker(new URL('./worker/vm-worker.ts', import.meta.url), { type: 'module' })
const postToWorker = (message: MainToWorkerMessage): void => {
  vmWorker.postMessage(message)
}

let currentScene: SceneVM | null = null
const renderCanvasToolUI = (): void => {
  toolTextBtnEl.classList.toggle('active', activeCanvasTool === 'text')
  canvasHost.classList.toggle('tool-text-mode', activeCanvasTool === 'text')
}

const contextMenuEl = document.querySelector<HTMLElement>('#context-menu')!

let activeContextMenuClose: ((e: Event) => void) | null = null

const closeContextMenu = (): void => {
  contextMenuEl.hidden = true
  contextMenuEl.innerHTML = ''
  if (activeContextMenuClose) {
    document.removeEventListener('click', activeContextMenuClose)
    document.removeEventListener('contextmenu', activeContextMenuClose)
    activeContextMenuClose = null
  }
}

/** Resolve segmentId -> nodeId from the current scene. */
const getNodeIdForSegment = (scene: SceneVM, segmentId: string): string | null => {
  for (const node of Object.values(scene.nodes)) {
    if (node.segments.some((s) => s.id === segmentId)) return node.id
  }
  return scene.freeSegments?.[segmentId]?.nodeId ?? null
}

const showContextMenu = (
  segmentId: string,
  _nodeId: string,
  itemDefId: string,
  clientX: number,
  clientY: number,
): void => {
  // Always tear down old menu + listeners first
  closeContextMenu()

  if (!currentScene) return

  let segment = Object.values(currentScene.nodes)
    .flatMap((n) => n.segments)
    .find((s) => s.id === segmentId)
  if (!segment && currentScene.freeSegments?.[segmentId]) {
    segment = currentScene.freeSegments[segmentId].segment
  }
  if (!segment) return

  // Multi-select: if right-clicked segment is in selection and multiple selected, apply to all
  const selectedIds = currentScene.selectedSegmentIds ?? []
  const effectiveSegmentIds =
    selectedIds.includes(segmentId) && selectedIds.length > 1 ? [...selectedIds] : [segmentId]

  const itemDef = sampleState.itemDefinitions[itemDefId]
  const isFreeSegment = !!currentScene.freeSegments?.[segmentId]
  const wieldOptions = !isFreeSegment && itemDef ? getWieldOptions(itemDef) : []

  const groupOrder: ActorKind[] = ['pc', 'retainer', 'hireling', 'animal', 'vehicle', 'loot-pile']

  const sourceNodeIds = new Map<string, string>()
  for (const sid of effectiveSegmentIds) {
    const nid = getNodeIdForSegment(currentScene, sid)
    if (nid) sourceNodeIds.set(sid, nid)
  }

  const targetNodes = Object.values(currentScene.nodes)
    .filter((n) => !effectiveSegmentIds.some((sid) => sourceNodeIds.get(sid) === n.id))
    .sort((a, b) => {
      const ai = groupOrder.indexOf(a.actorKind)
      const bi = groupOrder.indexOf(b.actorKind)
      if (ai !== bi) return ai - bi
      return a.title.localeCompare(b.title)
    })

  const moveItems = targetNodes.map(
    (n) =>
      `<button class="context-menu-item" data-action="move" data-target="${escapeAttr(n.id)}" type="button">${escapeHtml(n.title)}</button>`,
  )

  const wieldItems =
    wieldOptions.length > 0
      ? [
          ...(segment.wield
            ? [
                `<button class="context-menu-item" data-action="unwield" type="button">Unwield</button>`,
              ]
            : []),
          ...wieldOptions.map((w) => {
          const label =
            w === 'left' ? 'Wield left' : w === 'right' ? 'Wield right' : 'Wield 2-handed'
          return `<button class="context-menu-item" data-action="wield" data-wield="${w}" type="button">${escapeHtml(label)}</button>`
          }),
        ]
      : []

  let html = ''
  if (moveItems.length > 0) {
    const submenuId = 'ctx-move-sub'
    html += `<div class="context-menu-submenu-wrap"><div class="context-menu-submenu-trigger" data-submenu="${submenuId}">Move to</div><div id="${submenuId}" class="context-menu-submenu">${moveItems.join('')}</div></div>`
  }
  if (wieldItems.length > 0) {
    const submenuId = 'ctx-wield-sub'
    html += `<div class="context-menu-submenu-wrap"><div class="context-menu-submenu-trigger" data-submenu="${submenuId}">Wield</div><div id="${submenuId}" class="context-menu-submenu">${wieldItems.join('')}</div></div>`
  }
  html += `<button class="context-menu-item" data-action="duplicate" type="button">Duplicate</button>`
  html += `<button class="context-menu-item context-menu-item-danger" data-action="delete" type="button">Delete</button>`

  if (!html) return

  contextMenuEl.innerHTML = html
  contextMenuEl.hidden = false

  const padding = 8
  const maxX = window.innerWidth - contextMenuEl.offsetWidth - padding
  const maxY = window.innerHeight - contextMenuEl.offsetHeight - padding
  contextMenuEl.style.left = `${Math.min(clientX, maxX)}px`
  contextMenuEl.style.top = `${Math.min(clientY, maxY)}px`

  contextMenuEl.querySelectorAll('.context-menu-submenu-trigger').forEach((el) => {
    el.addEventListener('mouseenter', () => {
      contextMenuEl.querySelectorAll('.context-menu-submenu').forEach((s) => s.classList.remove('open'))
      const subId = (el as HTMLElement).dataset.submenu
      if (subId) document.getElementById(subId)?.classList.add('open')
    })
  })

  contextMenuEl.querySelectorAll('.context-menu-item').forEach((btn) => {
    const b = btn as HTMLButtonElement
    b.addEventListener('click', (e) => {
      e.stopPropagation()
      const action = b.dataset.action
      if (action === 'move') {
        const target = b.dataset.target
        if (target) {
          const moves = effectiveSegmentIds
            .map((sid) => ({ segmentId: sid, sourceNodeId: sourceNodeIds.get(sid) }))
            .filter((m): m is { segmentId: string; sourceNodeId: string } => !!m.sourceNodeId)
          if (moves.length === 1) {
            postToWorker({
              type: 'INTENT',
              intent: { type: 'MOVE_ENTRY_TO', segmentId: moves[0].segmentId, sourceNodeId: moves[0].sourceNodeId, targetNodeId: target },
            })
          } else if (moves.length > 1) {
            postToWorker({
              type: 'INTENT',
              intent: { type: 'MOVE_ENTRIES_TO', moves, targetNodeId: target },
            })
          }
        }
      } else if (action === 'wield') {
        const wield = b.dataset.wield as 'left' | 'right' | 'both'
        if (wield) {
          postToWorker({
            type: 'INTENT',
            intent: { type: 'SET_WIELD', segmentId, wield },
          })
        }
      } else if (action === 'unwield') {
        postToWorker({
          type: 'INTENT',
          intent: { type: 'UNWIELD', segmentId },
        })
      } else if (action === 'duplicate') {
        postToWorker({
          type: 'INTENT',
          intent: { type: 'DUPLICATE_ENTRY', segmentIds: effectiveSegmentIds },
        })
      } else if (action === 'delete') {
        postToWorker({
          type: 'INTENT',
          intent: { type: 'DELETE_ENTRY', segmentIds: effectiveSegmentIds },
        })
      }
      setTimeout(closeContextMenu, 0)
    })
  })

  setTimeout(() => {
    activeContextMenuClose = (event: Event): void => {
      const target = event.target
      if (target instanceof Node && contextMenuEl.contains(target)) return
      closeContextMenu()
    }
    document.addEventListener('click', activeContextMenuClose)
    document.addEventListener('contextmenu', activeContextMenuClose)
  }, 0)
}

const showGroupContextMenu = (groupId: string, clientX: number, clientY: number): void => {
  closeContextMenu()

  contextMenuEl.innerHTML = [
    `<button class="context-menu-item context-menu-item-danger" data-action="delete-group" type="button">Delete Group</button>`,
  ].join('')
  contextMenuEl.hidden = false

  const padding = 8
  const maxX = window.innerWidth - contextMenuEl.offsetWidth - padding
  const maxY = window.innerHeight - contextMenuEl.offsetHeight - padding
  contextMenuEl.style.left = `${Math.min(clientX, maxX)}px`
  contextMenuEl.style.top = `${Math.min(clientY, maxY)}px`

  contextMenuEl.querySelectorAll('.context-menu-item').forEach((btn) => {
    const b = btn as HTMLButtonElement
    b.addEventListener('click', (e) => {
      e.stopPropagation()
      if (b.dataset.action === 'delete-group') {
        postToWorker({ type: 'INTENT', intent: { type: 'DELETE_GROUP', groupId } })
      }
      setTimeout(closeContextMenu, 0)
    })
  })

  setTimeout(() => {
    activeContextMenuClose = (event: Event): void => {
      const target = event.target
      if (target instanceof Node && contextMenuEl.contains(target)) return
      closeContextMenu()
    }
    document.addEventListener('click', activeContextMenuClose)
    document.addEventListener('contextmenu', activeContextMenuClose)
  }, 0)
}

const showNodeContextMenu = (nodeId: string, clientX: number, clientY: number): void => {
  closeContextMenu()

  contextMenuEl.innerHTML = [
    `<button class="context-menu-item" data-action="duplicate-node" type="button">Duplicate Node</button>`,
    `<button class="context-menu-item context-menu-item-danger" data-action="delete-node" type="button">Delete Node</button>`,
  ].join('')
  contextMenuEl.hidden = false

  const padding = 8
  const maxX = window.innerWidth - contextMenuEl.offsetWidth - padding
  const maxY = window.innerHeight - contextMenuEl.offsetHeight - padding
  contextMenuEl.style.left = `${Math.min(clientX, maxX)}px`
  contextMenuEl.style.top = `${Math.min(clientY, maxY)}px`

  contextMenuEl.querySelectorAll('.context-menu-item').forEach((btn) => {
    const b = btn as HTMLButtonElement
    b.addEventListener('click', (e) => {
      e.stopPropagation()
      if (b.dataset.action === 'duplicate-node') {
        postToWorker({ type: 'INTENT', intent: { type: 'DUPLICATE_NODE', nodeId } })
      } else if (b.dataset.action === 'delete-node') {
        postToWorker({ type: 'INTENT', intent: { type: 'DELETE_NODE', nodeId } })
      }
      setTimeout(closeContextMenu, 0)
    })
  })

  setTimeout(() => {
    activeContextMenuClose = (event: Event): void => {
      const target = event.target
      if (target instanceof Node && contextMenuEl.contains(target)) return
      closeContextMenu()
    }
    document.addEventListener('click', activeContextMenuClose)
    document.addEventListener('contextmenu', activeContextMenuClose)
  }, 0)
}

const showCanvasContextMenu = (
  worldX: number,
  worldY: number,
  clientX: number,
  clientY: number,
  groupId: string | null,
): void => {
  closeContextMenu()

  contextMenuEl.innerHTML = [
    `<button class="context-menu-item" data-action="add-inventory-node" type="button">Add Inventory Node</button>`,
    `<button class="context-menu-item" data-action="add-group" type="button">Add Group</button>`,
  ].join('')
  contextMenuEl.hidden = false

  const padding = 8
  const maxX = window.innerWidth - contextMenuEl.offsetWidth - padding
  const maxY = window.innerHeight - contextMenuEl.offsetHeight - padding
  contextMenuEl.style.left = `${Math.min(clientX, maxX)}px`
  contextMenuEl.style.top = `${Math.min(clientY, maxY)}px`

  contextMenuEl.querySelectorAll('.context-menu-item').forEach((btn) => {
    const b = btn as HTMLButtonElement
    b.addEventListener('click', (e) => {
      e.stopPropagation()
      if (b.dataset.action === 'add-inventory-node') {
        postToWorker({
          type: 'INTENT',
          intent: { type: 'ADD_INVENTORY_NODE', x: worldX, y: worldY, groupId },
        })
      } else if (b.dataset.action === 'add-group') {
        postToWorker({
          type: 'INTENT',
          intent: { type: 'ADD_GROUP', x: worldX, y: worldY },
        })
      }
      setTimeout(closeContextMenu, 0)
    })
  })

  setTimeout(() => {
    activeContextMenuClose = (event: Event): void => {
      const target = event.target
      if (target instanceof Node && contextMenuEl.contains(target)) return
      closeContextMenu()
    }
    document.addEventListener('click', activeContextMenuClose)
    document.addEventListener('contextmenu', activeContextMenuClose)
  }, 0)
}

const escapeAttr = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

const CUSTOM_ITEM_ID = '__custom__'
const slugify = (s: string): string =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')

type ParsedSpawnItem = {
  id: string
  raw: string
  status: 'resolved' | 'ambiguous' | 'unknown'
  confidence: number
  quantity: number
  itemDefId: string | null
  itemName: string
  sizeSixths: number
  sixthsPerUnit?: number
  alternatives: readonly { itemId: string; itemName: string }[]
}

const sourceItemById = new Map(allSourceItems.map((item) => [item.id, item]))
const encumbranceToSixths = (enc: EncumbranceExpr): number => {
  if (enc.kind === 'fixed') return Math.max(1, enc.sixths)
  if (enc.kind === 'range') return Math.max(1, enc.minSixths)
  if (enc.kind === 'at-least') return Math.max(1, enc.minSixths)
  return 1
}

/** Per-unit sixths for source items. Handles bundle notation (e.g. "Iron Spikes (6)" = 1 stone for 6). */
const perUnitSixthsFromSource = (sourceItem: SourceItem): number => {
  const totalSixths = encumbranceToSixths(sourceItem.encumbrance)
  const bundleMatch = sourceItem.name.match(/\((\d+)\)/)
  if (bundleMatch) {
    const bundleSize = Number(bundleMatch[1])
    if (bundleSize > 0) return Math.max(1, Math.round(totalSixths / bundleSize))
  }
  return totalSixths
}

const SIXTHS_PER_STONE = 6

const deriveItemKind = (source: SourceItem): { kind: string; sixthsPerUnit: number; armorClass?: number } => {
  const perUnit = perUnitSixthsFromSource(source)
  const name = source.name.toLowerCase()
  if (source.group === 'armor-and-barding') {
    if (name.includes('shield') && perUnit === SIXTHS_PER_STONE) {
      return { kind: 'bulky', sixthsPerUnit: perUnit }
    }
    if (!name.includes('shield') && !name.includes('helmet') && perUnit >= SIXTHS_PER_STONE) {
      return { kind: 'armor', sixthsPerUnit: perUnit, armorClass: perUnit / SIXTHS_PER_STONE }
    }
  }
  if (source.group === 'weapons' && perUnit === SIXTHS_PER_STONE) {
    return { kind: 'bulky', sixthsPerUnit: perUnit }
  }
  return { kind: 'standard', sixthsPerUnit: perUnit }
}

const consumedParsedIds = new Set<string>()
let parsedSpawnItems: ParsedSpawnItem[] = []
let activeParsedDrag: {
  parsedItem: ParsedSpawnItem
  ghost: HTMLElement
  enteredCanvas: boolean
} | null = null

type ActiveInlineTitleEditor = {
  readonly input: HTMLInputElement
  cancel(): void
}

type InlineTitleOverlay = {
  readonly left: number
  readonly top: number
  readonly width: number
  readonly height: number
  readonly fontSizePx: number
}

let activeInlineTitleEditor: ActiveInlineTitleEditor | null = null
const INLINE_EDITOR_NUDGE_X_PX = 2
const INLINE_EDITOR_NUDGE_Y_PX = 1

const closeInlineTitleEditor = (): void => {
  if (!activeInlineTitleEditor) return
  activeInlineTitleEditor.cancel()
  activeInlineTitleEditor = null
}

const startInlineTitleEditor = (
  target: { type: 'node'; id: string } | { type: 'group'; id: string },
  currentTitle: string,
  overlay: InlineTitleOverlay,
): void => {
  closeInlineTitleEditor()
  pixiAdapter.setEditingTitle(target)

  const input = document.createElement('input')
  input.type = 'text'
  input.className = 'canvas-inline-editor'
  input.value = currentTitle
  input.style.left = `${Math.max(8, overlay.left + INLINE_EDITOR_NUDGE_X_PX)}px`
  input.style.top = `${Math.max(8, overlay.top + INLINE_EDITOR_NUDGE_Y_PX)}px`
  input.style.width = `${Math.max(80, overlay.width)}px`
  input.style.height = `${Math.max(18, overlay.height)}px`
  input.style.fontSize = `${Math.max(10, overlay.fontSizePx)}px`
  document.body.appendChild(input)

  let cancelled = false
  let cleanedUp = false
  const cleanup = (): void => {
    if (cleanedUp) return
    cleanedUp = true
    pixiAdapter.setEditingTitle(null)
    if (input.parentElement) input.remove()
    if (activeInlineTitleEditor?.input === input) {
      activeInlineTitleEditor = null
    }
  }

  input.addEventListener('blur', () => {
    if (!cancelled) {
      const title = input.value.trim()
      if (title.length > 0 && title !== currentTitle) {
        if (target.type === 'node') {
          postToWorker({ type: 'INTENT', intent: { type: 'UPDATE_NODE_TITLE', nodeId: target.id, title } })
        } else {
          postToWorker({ type: 'INTENT', intent: { type: 'UPDATE_GROUP_TITLE', groupId: target.id, title } })
        }
      }
    }
    cleanup()
  })

  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault()
      input.blur()
    } else if (event.key === 'Escape') {
      event.preventDefault()
      cancelled = true
      input.blur()
    }
  })

  input.focus()
  input.select()
  activeInlineTitleEditor = {
    input,
    cancel: () => {
      cancelled = true
      cleanup()
    },
  }
}

const pixiAdapter = new PixiBoardAdapter(canvasHost, {
  onHoverSegment(segmentId) {
    postToWorker({ type: 'INTENT', intent: { type: 'HOVER_SEGMENT', segmentId } })
  },
  onMoveGroup(groupId, x, y) {
    postToWorker({ type: 'INTENT', intent: { type: 'MOVE_GROUP', groupId, x, y } })
  },
  onResizeGroup(groupId, width, height) {
    postToWorker({ type: 'INTENT', intent: { type: 'RESIZE_GROUP', groupId, width, height } })
  },
  onSetGroupListView(groupId, enabled) {
    postToWorker({ type: 'INTENT', intent: { type: 'SET_GROUP_LIST_VIEW', groupId, enabled } })
  },
  onResizeNode(nodeId, slotCols, slotRows) {
    postToWorker({ type: 'INTENT', intent: { type: 'RESIZE_NODE', nodeId, slotCols, slotRows } })
  },
  onMoveNodeToGroupIndex(nodeId, groupId, index) {
    postToWorker({ type: 'INTENT', intent: { type: 'MOVE_NODE_TO_GROUP_INDEX', nodeId, groupId, index } })
  },
  onMoveNodeInGroup(nodeId, groupId, x, y) {
    postToWorker({ type: 'INTENT', intent: { type: 'MOVE_NODE_IN_GROUP', nodeId, groupId, x, y } })
  },
  onDropNodeIntoNode(nodeId, targetNodeId) {
    postToWorker({ type: 'INTENT', intent: { type: 'DROP_NODE_INTO_NODE', nodeId, targetNodeId } })
  },
  onConnectNodeParent(nodeId, parentNodeId) {
    postToWorker({ type: 'INTENT', intent: { type: 'CONNECT_NODE_PARENT', nodeId, parentNodeId } })
  },
  onNestNodeUnder(nodeId, parentNodeId) {
    postToWorker({ type: 'INTENT', intent: { type: 'NEST_NODE_UNDER', nodeId, parentNodeId } })
  },
  onMoveNodeToRoot(nodeId, x, y) {
    console.info('[main node] post MOVE_NODE_TO_ROOT', { nodeId, x, y })
    postToWorker({ type: 'INTENT', intent: { type: 'MOVE_NODE_TO_ROOT', nodeId, x, y } })
  },
  onZoomChange(_zoom) {},
  onDragSegmentStart(segmentIds) {
    postToWorker({ type: 'INTENT', intent: { type: 'DRAG_SEGMENT_START', segmentIds } })
  },
  onDragSegmentUpdate(targetNodeId) {
    postToWorker({ type: 'INTENT', intent: { type: 'DRAG_SEGMENT_UPDATE', targetNodeId } })
  },
  onDragSegmentEnd(targetNodeId, targetGroupId, x, y, freeSegmentPositions) {
    postToWorker({
      type: 'INTENT',
      intent: { type: 'DRAG_SEGMENT_END', targetNodeId, targetGroupId, x, y, freeSegmentPositions },
    })
  },
  onMoveLabel(labelId, x, y) {
    postToWorker({ type: 'INTENT', intent: { type: 'MOVE_LABEL', labelId, x, y } })
  },
  onSelectLabel(labelId) {
    selectedLabelId = labelId
    postToWorker({ type: 'INTENT', intent: { type: 'SELECT_LABEL', labelId } })
    syncLabelEditor()
  },
  onEditNodeTitleRequest(nodeId, currentTitle, overlay) {
    startInlineTitleEditor({ type: 'node', id: nodeId }, currentTitle, overlay)
  },
  onEditGroupTitleRequest(groupId, currentTitle, overlay) {
    startInlineTitleEditor({ type: 'group', id: groupId }, currentTitle, overlay)
  },
  onCanvasWorldClick(x, y) {
    if (activeCanvasTool !== 'text') return false
    focusLabelEditorOnSelect = true
    postToWorker({ type: 'INTENT', intent: { type: 'ADD_LABEL', text: 'Text', x, y } })
    activeCanvasTool = 'select'
    renderCanvasToolUI()
    return true
  },
  onContextMenu(segmentId, nodeId, clientX, clientY) {
    let segment = currentScene
      ? Object.values(currentScene.nodes)
          .flatMap((n) => n.segments)
          .find((s) => s.id === segmentId)
      : null
    if (!segment && currentScene?.freeSegments?.[segmentId]) {
      segment = currentScene.freeSegments[segmentId].segment
    }
    if (segment) {
      showContextMenu(segmentId, nodeId, segment.itemDefId, clientX, clientY)
    }
  },
  onNodeContextMenu(nodeId, clientX, clientY) {
    showNodeContextMenu(nodeId, clientX, clientY)
  },
  onGroupContextMenu(groupId, clientX, clientY) {
    showGroupContextMenu(groupId, clientX, clientY)
  },
  onCanvasContextMenu(worldX, worldY, clientX, clientY) {
    const groupId = pixiAdapter.getGroupIdAtPoint(worldX, worldY)
    showCanvasContextMenu(worldX, worldY, clientX, clientY, groupId)
  },
  onSegmentClick(segmentId, _nodeId, addToSelection) {
    if (addToSelection) {
      const selected = currentScene?.selectedSegmentIds ?? []
      if (selected.includes(segmentId)) {
        postToWorker({ type: 'INTENT', intent: { type: 'SELECT_SEGMENTS_REMOVE', segmentIds: [segmentId] } })
      } else {
        postToWorker({ type: 'INTENT', intent: { type: 'SELECT_SEGMENTS_ADD', segmentIds: [segmentId] } })
      }
    } else {
      postToWorker({ type: 'INTENT', intent: { type: 'SET_SELECTED_SEGMENTS', segmentIds: [segmentId] } })
    }
  },
  onSegmentDoubleClick(_segmentId, itemDefId, nodeId) {
    postToWorker({ type: 'INTENT', intent: { type: 'SELECT_ALL_OF_TYPE', itemDefId, nodeId } })
  },
  onMarqueeSelect(selection, addToSelection) {
    postToWorker({ type: 'INTENT', intent: { type: 'SET_MARQUEE_SELECTION', selection, addToSelection } })
  },
  onExternalDragEnd(targetNodeId, x, y, cancelled, freeSegmentPositions) {
    parseResultsEl.querySelectorAll('.parsed-item-dragging').forEach((el) => el.classList.remove('parsed-item-dragging'))
    if (cancelled || !activeParsedDrag) {
      activeParsedDrag = null
      return
    }
    const item = activeParsedDrag.parsedItem
    activeParsedDrag = null
    if (!item.itemDefId) return
    if (!targetNodeId && (x == null || y == null)) return
    const sourceItem = item.itemDefId.startsWith('custom:') ? null : sourceItemById.get(item.itemDefId)
    const derived = sourceItem
      ? deriveItemKind(sourceItem)
      : { kind: 'standard' as const, sixthsPerUnit: item.sixthsPerUnit ?? SIXTHS_PER_STONE }
    const segmentIds = freeSegmentPositions
      ? Array.from({ length: item.quantity }, (_, i) => `ext-${item.id}-${i}`)
      : undefined
    postToWorker({
      type: 'INTENT',
      intent: {
        type: 'SPAWN_ITEM_INSTANCE',
        itemDefId: item.itemDefId,
        quantity: item.quantity,
        targetNodeId,
        x,
        y,
        itemName: item.itemName,
        sixthsPerUnit: item.sixthsPerUnit ?? derived.sixthsPerUnit,
        itemKind: derived.kind,
        armorClass: derived.armorClass,
        segmentIds,
        freeSegmentPositions,
      },
    })
    consumedParsedIds.add(item.id)
    renderParsed(parseInputEl.value)
  },
})

vmWorker.onmessage = (event: MessageEvent<WorkerToMainMessage>) => {
  const msg = event.data
  if (msg.type === 'SCENE_INIT') {
    closeInlineTitleEditor()
    currentScene = msg.scene
    selectedLabelId = msg.scene.selectedLabelId ?? null
    pixiAdapter.applyInit(msg.scene)
    syncLabelEditor()
    return
  }
  if (msg.type === 'SCENE_PATCHES') {
    closeInlineTitleEditor()
    currentScene = msg.scene
    selectedLabelId = msg.scene.selectedLabelId ?? null
    pixiAdapter.applyPatches(msg.patches, msg.scene)
    syncLabelEditor()
    return
  }
  if (msg.type === 'LOG') {
    console.info('[worker]', msg.message)
  }
}

const inputEl = document.querySelector<HTMLInputElement>('#search-input')!
const chipsEl = document.querySelector<HTMLElement>('#search-chips')!
const suggestionsEl = document.querySelector<HTMLElement>('#search-suggestions')!
const resultsEl = document.querySelector<HTMLElement>('#search-results')!
const bulkInputEl = document.querySelector<HTMLTextAreaElement>('#bulk-input')!
const bulkResultsEl = document.querySelector<HTMLElement>('#bulk-results')!
const labelEditInputEl = document.querySelector<HTMLInputElement>('#label-edit-input')!
const labelSaveBtnEl = document.querySelector<HTMLButtonElement>('#label-save-btn')!
const labelDeleteBtnEl = document.querySelector<HTMLButtonElement>('#label-delete-btn')!
const labelMinVisiblePxEl = document.querySelector<HTMLSelectElement>('#label-min-visible-px')!
const stonesPerRowEl = document.querySelector<HTMLSelectElement>('#stones-per-row')!
let selectedLabelId: string | null = null
let activeCanvasTool: 'select' | 'text' = 'select'
let focusLabelEditorOnSelect = false

const initialStonesPerRow = Number(stonesPerRowEl.value ?? 25)
pixiAdapter.setStonesPerRow(initialStonesPerRow)
postToWorker({
  type: 'INIT',
  worldState: sampleState,
  stonesPerRow: initialStonesPerRow,
})

const escapeRegex = (v: string): string => v.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const appendToken = (q: string, t: string): string => (q.trim().length === 0 ? `${t} ` : `${q.trim()} ${t} `)
const removeTokenFromQuery = (q: string, t: string): string =>
  q.replace(new RegExp(`(^|\\s)${escapeRegex(t)}(?=\\s|$)`, 'i'), ' ').replace(/\s+/g, ' ').trimStart()

const renderSearch = (query: string): void => {
  const analyzed = sourceItemSearch.analyzeQuery(query)
  const suggestions = sourceItemSearch.suggest(query, 6)
  const results = sourceItemSearch.search(query, 20)

  chipsEl.innerHTML = analyzed.activeTags
    .map((tag, i) => `<button class="chip chip-remove" data-index="${i}" type="button"><span>${tag.token}</span><span class="chip-x">&times;</span></button>`)
    .join('')

  chipsEl.querySelectorAll<HTMLButtonElement>('button.chip-remove').forEach((btn) => {
    const tag = analyzed.activeTags[Number(btn.dataset.index)]
    if (!tag) return
    btn.addEventListener('click', () => {
      inputEl.value = removeTokenFromQuery(inputEl.value, tag.token)
      renderSearch(inputEl.value)
      inputEl.focus()
    })
  })

  suggestionsEl.innerHTML = suggestions.map((s, i) => `<button class="suggestion" data-index="${i}" type="button">${s.label}</button>`).join('')
  suggestionsEl.querySelectorAll<HTMLButtonElement>('button.suggestion').forEach((btn) => {
    const s = suggestions[Number(btn.dataset.index)]
    if (!s) return
    btn.addEventListener('click', () => {
      inputEl.value = appendToken(inputEl.value, s.token)
      renderSearch(inputEl.value)
      inputEl.focus()
    })
  })

  resultsEl.innerHTML = results
    .map((hit) => `<li class="result-item"><div class="result-title">${hit.item.name}</div><div class="result-meta">${hit.item.group} &bull; ${formatEncumbrance(hit.item.encumbrance)}</div></li>`)
    .join('')
}

/** Disambiguation overrides: raw chunk text -> selected itemId */
const disambiguationOverrides: Record<string, string> = {}

const renderParsed = (text: string): void => {
  const parsed = parseInventoryText(text, sourceItemSearch)
  parsedSpawnItems = parsed.chunks.map((c, idx) => {
    const override = disambiguationOverrides[c.raw]
    const isCustom = override === CUSTOM_ITEM_ID
    let customSlug = slugify(c.candidateName) || slugify(c.raw) || 'custom-item'
    if (isCustom && c.stoneOverride != null) {
      const sixths = Math.round(stoneToSixths(c.stoneOverride))
      customSlug = `${customSlug}-${sixths}`
    }
    const customDefId = `custom:${customSlug}`

    let itemDefId: string | null
    let itemName: string
    let perUnitSixths: number
    let sixthsPerUnit: number | undefined

    if (isCustom) {
      itemDefId = customDefId
      itemName = c.candidateName || c.raw || 'Custom item'
      if (c.stoneOverride != null) {
        perUnitSixths = Math.max(1, Math.round(stoneToSixths(c.stoneOverride)))
      } else if (c.alternatives.length > 0) {
        const best = sourceItemById.get(c.alternatives[0].itemId)
        perUnitSixths = best ? perUnitSixthsFromSource(best) : SIXTHS_PER_STONE
      } else {
        perUnitSixths = SIXTHS_PER_STONE
      }
      sixthsPerUnit = perUnitSixths
    } else {
      itemDefId = override ?? c.resolvedItemId ?? null
      itemName = override
        ? (c.alternatives.find((a) => a.itemId === override)?.itemName ?? c.candidateName)
        : (c.resolvedItemName ?? c.candidateName)
      const sourceItem = itemDefId ? sourceItemById.get(itemDefId) : null
      perUnitSixths = sourceItem ? perUnitSixthsFromSource(sourceItem) : 1
    }

    const alts = c.alternatives.map((a) => ({ itemId: a.itemId, itemName: a.itemName }))
    return {
      id: `${idx}`,
      raw: c.raw,
      status: override ? 'resolved' : c.status,
      confidence: c.confidence,
      quantity: c.quantity,
      itemDefId,
      itemName,
      sizeSixths: Math.max(1, perUnitSixths * c.quantity),
      ...(sixthsPerUnit != null && { sixthsPerUnit }),
      alternatives: alts,
    }
  })

  parseResultsEl.innerHTML = parsedSpawnItems
    .filter((item) => !consumedParsedIds.has(item.id))
    .map((item) => {
      const catalogPills = item.alternatives
        .map(
          (a) =>
            `<button class="alt-pill ${a.itemId === item.itemDefId ? 'alt-pill-selected' : ''}" data-raw="${escapeHtml(item.raw)}" data-item-id="${escapeHtml(a.itemId)}" type="button">${escapeHtml(a.itemName)}</button>`,
        )
        .join('')
      const customPill = `<button class="alt-pill ${item.itemDefId?.startsWith('custom:') ? 'alt-pill-selected' : ''}" data-raw="${escapeHtml(item.raw)}" data-item-id="${escapeHtml(CUSTOM_ITEM_ID)}" type="button">As-is</button>`
      const altsHtml = `<div class="alt-pills">${catalogPills}${customPill}</div>`
      const draggableClass = item.itemDefId ? ' parsed-item-draggable' : ''
      return `<div class="parsed-item${draggableClass} status-${item.status}" data-parsed-id="${escapeAttr(item.id)}" data-raw="${escapeHtml(item.raw)}">
        <div class="parsed-head">
          <span class="parsed-status">${item.status}</span>
          <span class="parsed-qty">qty ${item.quantity}</span>
          <span class="parsed-conf">${Math.round(item.confidence * 100)}%</span>
        </div>
        <div class="parsed-text">${escapeHtml(item.raw)}</div>
        <div class="parsed-candidate">
          <span class="parsed-display-name">${escapeHtml(item.itemName)}</span>
          ${altsHtml}
        </div>
      </div>`
    })
    .join('')
}

const escapeHtml = (s: string): string =>
  s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')

const renderBulkImport = (text: string): void => {
  const plan = parseInventoryImportPlan(text, sourceItemSearch)
  bulkResultsEl.innerHTML = plan.containers
    .map((container) => {
      const counts = container.inventory.chunks.reduce(
        (acc, c) => { acc.total += 1; acc[c.status] += 1; return acc },
        { total: 0, resolved: 0, ambiguous: 0, unknown: 0 },
      )
      return `<div class="parsed-item status-${container.kind === 'loot-pile' ? 'ambiguous' : 'resolved'}"><div class="parsed-head"><span class="parsed-status">${container.kind}</span><span class="parsed-qty">${container.label}</span><span class="parsed-conf">${counts.resolved}/${counts.total} ok</span></div><div class="parsed-candidate">ambiguous ${counts.ambiguous} &bull; unknown ${counts.unknown}</div></div>`
    })
    .join('')
}

inputEl.value = 'shield'
renderSearch(inputEl.value)
inputEl.addEventListener('input', () => renderSearch(inputEl.value))

parseInputEl.value = '2 sacks, 14 torches and 3 flasks of oil'
renderParsed(parseInputEl.value)
parseInputEl.addEventListener('input', () => {
  consumedParsedIds.clear()
  renderParsed(parseInputEl.value)
})

parseResultsEl.addEventListener('click', (e) => {
  const target = e.target as HTMLElement
  const pill = target.closest('.alt-pill')
  if (pill) {
    const raw = pill.getAttribute('data-raw')
    const itemId = pill.getAttribute('data-item-id')
    if (raw && itemId) {
      disambiguationOverrides[raw] = itemId
      renderParsed(parseInputEl.value)
    }
  }
})

const DRAG_THRESHOLD = 5
let parsedPointerDownState: {
  parsedItem: ParsedSpawnItem
  startX: number
  startY: number
  el: HTMLElement
} | null = null

parseResultsEl.addEventListener('pointerdown', (e) => {
  const target = e.target as HTMLElement
  if (target.closest('.alt-pill')) return
  const itemEl = target.closest<HTMLElement>('.parsed-item-draggable[data-parsed-id]')
  if (!itemEl) return
  const parsedId = itemEl.dataset.parsedId
  if (!parsedId) return
  const item = parsedSpawnItems.find((p) => p.id === parsedId)
  if (!item || !item.itemDefId) return
  e.preventDefault()
  parsedPointerDownState = { parsedItem: item, startX: e.clientX, startY: e.clientY, el: itemEl }
})

document.addEventListener('pointermove', (e) => {
  if (parsedPointerDownState && !activeParsedDrag) {
    const dx = e.clientX - parsedPointerDownState.startX
    const dy = e.clientY - parsedPointerDownState.startY
    if (Math.abs(dx) + Math.abs(dy) < DRAG_THRESHOLD) return
    const ghost = parsedPointerDownState.el.cloneNode(true) as HTMLElement
    ghost.className = 'parsed-drag-ghost'
    ghost.style.left = `${e.clientX}px`
    ghost.style.top = `${e.clientY}px`
    ghost.style.width = `${parsedPointerDownState.el.offsetWidth}px`
    document.body.appendChild(ghost)
    parsedPointerDownState.el.classList.add('parsed-item-dragging')
    activeParsedDrag = {
      parsedItem: parsedPointerDownState.parsedItem,
      ghost,
      enteredCanvas: false,
    }
    parsedPointerDownState = null
    return
  }
  if (!activeParsedDrag) return
  if (!activeParsedDrag.enteredCanvas) {
    activeParsedDrag.ghost.style.left = `${e.clientX}px`
    activeParsedDrag.ghost.style.top = `${e.clientY}px`
    const canvasRect = canvasHost.getBoundingClientRect()
    if (
      e.clientX >= canvasRect.left &&
      e.clientX <= canvasRect.right &&
      e.clientY >= canvasRect.top &&
      e.clientY <= canvasRect.bottom
    ) {
      activeParsedDrag.ghost.remove()
      activeParsedDrag.enteredCanvas = true
      const item = activeParsedDrag.parsedItem
      const sourceItem = item.itemDefId?.startsWith('custom:') ? null : (item.itemDefId ? sourceItemById.get(item.itemDefId) : null)
      const perUnitSixths = sourceItem
        ? perUnitSixthsFromSource(sourceItem)
        : (item.sixthsPerUnit ?? SIXTHS_PER_STONE)
      const syntheticSegments: SceneSegmentVM[] = []
      for (let i = 0; i < item.quantity; i++) {
        syntheticSegments.push({
          id: `ext-${item.id}-${i}`,
          shortLabel: item.itemName.slice(0, 3),
          mediumLabel: item.itemName.slice(0, 10),
          fullLabel: item.itemName,
          startSixth: 0,
          sizeSixths: perUnitSixths,
          isOverflow: false,
          itemDefId: item.itemDefId!,
          category: (sourceItem?.group ?? 'adventuring-equipment') as ItemCategory,
          tooltip: {
            title: item.itemName,
            encumbranceText: formatSixthsAsStone(perUnitSixths),
            zoneText: '',
            quantityText: `qty ${item.quantity}`,
          },
        })
      }
      const layout = pixiAdapter.computeVirtualSegmentLayout(syntheticSegments)
      pixiAdapter.beginExternalDrag(syntheticSegments, e.clientX, e.clientY, layout)
    }
  }
})

document.addEventListener('pointerup', () => {
  parsedPointerDownState = null
  if (!activeParsedDrag) return
  if (!activeParsedDrag.enteredCanvas) {
    activeParsedDrag.ghost.remove()
    parseResultsEl.querySelectorAll('.parsed-item-dragging').forEach((el) => el.classList.remove('parsed-item-dragging'))
    activeParsedDrag = null
  }
})

bulkInputEl.value = `Fighter:\nplate armor, shield, short sword\n\nLoot Pile - Crypt Chest:\n2 sacks, 14 torches and 3 flasks of oil`
renderBulkImport(bulkInputEl.value)
bulkInputEl.addEventListener('input', () => renderBulkImport(bulkInputEl.value))

pixiAdapter.setLabelMinVisiblePx(Number(labelMinVisiblePxEl.value))
labelMinVisiblePxEl.addEventListener('change', () => {
  pixiAdapter.setLabelMinVisiblePx(Number(labelMinVisiblePxEl.value))
})

stonesPerRowEl.addEventListener('change', () => {
  const v = Number(stonesPerRowEl.value)
  pixiAdapter.setStonesPerRow(v)
  postToWorker({ type: 'SET_STONES_PER_ROW', stonesPerRow: v })
})

const syncLabelEditor = (): void => {
  const selected = selectedLabelId && currentScene ? currentScene.labels[selectedLabelId] : null
  if (selected) {
    labelEditInputEl.value = selected.text
    labelEditInputEl.disabled = false
    labelSaveBtnEl.disabled = false
    labelDeleteBtnEl.disabled = false
    if (focusLabelEditorOnSelect) {
      focusLabelEditorOnSelect = false
      labelEditInputEl.focus()
      labelEditInputEl.select()
    }
  } else {
    labelEditInputEl.value = ''
    labelEditInputEl.disabled = true
    labelSaveBtnEl.disabled = true
    labelDeleteBtnEl.disabled = true
    focusLabelEditorOnSelect = false
  }
}

labelSaveBtnEl.addEventListener('click', () => {
  if (!selectedLabelId) return
  const text = labelEditInputEl.value.trim()
  if (!text) return
  postToWorker({ type: 'INTENT', intent: { type: 'UPDATE_LABEL_TEXT', labelId: selectedLabelId, text } })
})

labelDeleteBtnEl.addEventListener('click', () => {
  if (!selectedLabelId) return
  postToWorker({ type: 'INTENT', intent: { type: 'DELETE_LABEL', labelId: selectedLabelId } })
  selectedLabelId = null
  syncLabelEditor()
})

toolTextBtnEl.addEventListener('click', () => {
  activeCanvasTool = activeCanvasTool === 'text' ? 'select' : 'text'
  renderCanvasToolUI()
})

window.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') {
    if (pixiAdapter.isMarqueeActive()) {
      event.preventDefault()
      pixiAdapter.cancelMarquee()
    } else if (activeCanvasTool === 'text') {
      activeCanvasTool = 'select'
      renderCanvasToolUI()
    }
  }
  if ((event.key === 'Delete' || event.key === 'Backspace') && currentScene?.selectedSegmentIds?.length) {
    const active = document.activeElement
    if (active?.tagName === 'INPUT' || active?.tagName === 'TEXTAREA') return
    event.preventDefault()
    postToWorker({
      type: 'INTENT',
      intent: { type: 'DELETE_ENTRY', segmentIds: currentScene.selectedSegmentIds },
    })
  }
})

labelEditInputEl.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') {
    event.preventDefault()
    labelSaveBtnEl.click()
  }
})

renderCanvasToolUI()
syncLabelEditor()
