import './style.css'
import { parseInventoryImportPlan } from './domain/inventory-import-plan'
import { parseInventoryText } from './domain/inventory-text-parser'
import { allSourceItems, itemSourceCatalog, type EncumbranceExpr } from './domain/item-source-catalog'
import { formatSixthsAsStone } from './domain/rules'
import { createSourceItemSearchIndex } from './domain/item-source-search'
import { PixiBoardAdapter } from './pixi/PixiBoardAdapter'
import { sampleState } from './sample-data'
import type { MainToWorkerMessage, WorkerToMainMessage } from './worker/protocol'

const app = document.querySelector<HTMLDivElement>('#app')
if (!app) throw new Error('App root missing')

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
        <textarea id="bulk-input" class="tool-textarea" rows="6" placeholder="Fighter: plate armor, shield, spear&#10;&#10;Loot Pile - Crypt Chest: 2 sacks, 14 torches"></textarea>
        <div id="bulk-results" class="parsed-list"></div>
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
      </section>

      <div class="tool-meta">
        ${allSourceItems.length} source items &bull; ${itemSourceCatalog.armorAndBarding.length} armor &bull; ${itemSourceCatalog.weapons.length} weapons &bull; ${itemSourceCatalog.adventuringEquipment.length} gear
      </div>
    </div>
  </div>

  <div id="hud-bar" class="hud-bar"></div>
`

const canvasHost = document.querySelector<HTMLElement>('#canvas-host')!
const drawerEl = document.querySelector<HTMLElement>('#drawer')!
const drawerToggle = document.querySelector<HTMLElement>('#drawer-toggle')!
const drawerClose = document.querySelector<HTMLElement>('#drawer-close')!

drawerToggle.addEventListener('click', () => drawerEl.classList.toggle('open'))
drawerClose.addEventListener('click', () => drawerEl.classList.remove('open'))

const vmWorker = new Worker(new URL('./worker/vm-worker.ts', import.meta.url), { type: 'module' })
const postToWorker = (message: MainToWorkerMessage): void => {
  vmWorker.postMessage(message)
}

const pixiAdapter = new PixiBoardAdapter(canvasHost, {
  onHoverSegment(segmentId) {
    postToWorker({ type: 'INTENT', intent: { type: 'HOVER_SEGMENT', segmentId } })
  },
  onMoveNode(nodeId, x, y) {
    postToWorker({ type: 'INTENT', intent: { type: 'MOVE_NODE', nodeId, x, y } })
  },
  onZoomChange(_zoom) {},
  onDragSegmentStart(segmentId, sourceNodeId) {
    postToWorker({ type: 'INTENT', intent: { type: 'DRAG_SEGMENT_START', segmentId, sourceNodeId } })
  },
  onDragSegmentUpdate(targetNodeId) {
    postToWorker({ type: 'INTENT', intent: { type: 'DRAG_SEGMENT_UPDATE', targetNodeId } })
  },
  onDragSegmentEnd(targetNodeId) {
    postToWorker({ type: 'INTENT', intent: { type: 'DRAG_SEGMENT_END', targetNodeId } })
  },
})

vmWorker.onmessage = (event: MessageEvent<WorkerToMainMessage>) => {
  const msg = event.data
  if (msg.type === 'SCENE_INIT') {
    pixiAdapter.applyInit(msg.scene)
    return
  }
  if (msg.type === 'SCENE_PATCHES') {
    pixiAdapter.applyPatches(msg.patches, msg.scene)
    return
  }
  if (msg.type === 'LOG') {
    console.info('[worker]', msg.message)
  }
}

postToWorker({ type: 'INIT', worldState: sampleState })

const inputEl = document.querySelector<HTMLInputElement>('#search-input')!
const chipsEl = document.querySelector<HTMLElement>('#search-chips')!
const suggestionsEl = document.querySelector<HTMLElement>('#search-suggestions')!
const resultsEl = document.querySelector<HTMLElement>('#search-results')!
const parseInputEl = document.querySelector<HTMLTextAreaElement>('#parse-input')!
const parseResultsEl = document.querySelector<HTMLElement>('#parse-results')!
const bulkInputEl = document.querySelector<HTMLTextAreaElement>('#bulk-input')!
const bulkResultsEl = document.querySelector<HTMLElement>('#bulk-results')!
const labelMinVisiblePxEl = document.querySelector<HTMLSelectElement>('#label-min-visible-px')!

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
  parseResultsEl.innerHTML = parsed.chunks
    .map((c) => {
      const override = disambiguationOverrides[c.raw]
      const effectiveStatus = override ? 'resolved' : c.status
      const locked = !!override
      const displayItemId = override ?? c.resolvedItemId
      const displayItemName = override
        ? (c.alternatives.find((a) => a.itemId === override)?.itemName ?? c.candidateName)
        : (c.resolvedItemName ?? c.candidateName)

      let altsHtml = ''
      if (locked) {
        altsHtml = `<button class="alt-unlock" data-raw="${escapeHtml(c.raw)}" type="button" title="Unlock and show alternatives">↩ unlock</button>`
      } else if (c.alternatives.length > 0) {
        altsHtml = `<div class="alt-pills">${c.alternatives
          .map(
            (a) =>
              `<button class="alt-pill ${a.itemId === displayItemId ? 'alt-pill-selected' : ''}" data-raw="${escapeHtml(c.raw)}" data-item-id="${escapeHtml(a.itemId)}" type="button">${escapeHtml(a.itemName)}</button>`,
          )
          .join('')}</div>`
      }

      return `<div class="parsed-item status-${effectiveStatus} ${locked ? 'parsed-item-locked' : ''}" data-raw="${escapeHtml(c.raw)}">
        <div class="parsed-head">
          <span class="parsed-status">${effectiveStatus}</span>
          <span class="parsed-qty">qty ${c.quantity}</span>
          ${locked ? '' : `<span class="parsed-conf">${Math.round(c.confidence * 100)}%</span>`}
        </div>
        <div class="parsed-text">${escapeHtml(c.raw)}</div>
        <div class="parsed-candidate">
          <span class="parsed-display-name">${escapeHtml(displayItemName)}</span>
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
parseInputEl.addEventListener('input', () => renderParsed(parseInputEl.value))

parseResultsEl.addEventListener('click', (e) => {
  const target = e.target as HTMLElement
  const pill = target.closest('.alt-pill')
  const unlock = target.closest('.alt-unlock')
  const raw = (pill ?? unlock)?.getAttribute('data-raw')
  if (!raw) return
  if (pill) {
    const itemId = pill.getAttribute('data-item-id')
    if (itemId) {
      disambiguationOverrides[raw] = itemId
      renderParsed(parseInputEl.value)
    }
  } else if (unlock) {
    delete disambiguationOverrides[raw]
    renderParsed(parseInputEl.value)
  }
})

bulkInputEl.value = `Fighter:\nplate armor, shield, spear\n\nLoot Pile - Crypt Chest:\n2 sacks, 14 torches and 3 flasks of oil`
renderBulkImport(bulkInputEl.value)
bulkInputEl.addEventListener('input', () => renderBulkImport(bulkInputEl.value))

pixiAdapter.setLabelMinVisiblePx(Number(labelMinVisiblePxEl.value))
labelMinVisiblePxEl.addEventListener('change', () => {
  pixiAdapter.setLabelMinVisiblePx(Number(labelMinVisiblePxEl.value))
})
