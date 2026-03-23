import type { WorldHubSnapshot } from '../spacetimedb/world-hub-snapshot'
import { formatLastVisited } from './world-hub-vm'
import { canonicalCanvasPath, type HubView } from '../spacetimedb/context'
import type { ItemKind } from '../domain/types'

export type WorldHubAdapterHandlers = {
  readonly onNavigateCanvas: (worldSlug: string, canvasSlug: string) => void
  readonly onHubViewChange: (view: HubView) => void
  readonly onSaveDisplayName: (name: string) => void
  readonly onCatalogUpsert: (row: {
    id: string
    canonicalName: string
    kind: ItemKind
    sixthsPerUnit?: number
    armorClass?: number
    priceInGp?: number
    isFungibleVisual?: boolean
  }) => void
  readonly onCatalogRemove: (id: string) => void
  readonly onCreateCanvas: (slug: string) => void
}

const esc = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;')

export type WorldHubAdapter = {
  readonly root: HTMLElement
  readonly render: (snapshot: WorldHubSnapshot, hubView: HubView) => void
  readonly setHubView: (hubView: HubView) => void
  readonly destroy: () => void
}

export function createWorldHubAdapter(handlers: WorldHubAdapterHandlers): WorldHubAdapter {
  const root = document.createElement('div')
  root.className = 'world-hub'

  root.innerHTML = `
    <header class="world-hub-header">
      <div class="world-hub-title-block">
        <p class="world-hub-eyebrow">World</p>
        <input type="text" class="world-hub-title-input" id="wh-title" autocomplete="off" />
        <p class="world-hub-slug" id="wh-slug"></p>
      </div>
      <div class="world-hub-actions">
        <button type="button" class="world-hub-btn primary" id="wh-open-main">Open main canvas</button>
      </div>
    </header>
    <nav class="world-hub-tabs" role="tablist" aria-label="World sections">
      <button type="button" class="world-hub-tab" role="tab" id="wh-tab-canvases" aria-controls="wh-panel-canvases" aria-selected="true">Canvases</button>
      <button type="button" class="world-hub-tab" role="tab" id="wh-tab-catalog" aria-controls="wh-panel-catalog" aria-selected="false">Item catalog</button>
    </nav>
    <div class="world-hub-panels">
      <section id="wh-panel-canvases" class="world-hub-panel" role="tabpanel" aria-labelledby="wh-tab-canvases">
        <div class="world-hub-section">
          <h2 class="world-hub-h2">Your boards</h2>
          <div class="world-hub-new-canvas">
            <input type="text" class="world-hub-input" id="wh-new-canvas" placeholder="new-canvas-slug" />
            <button type="button" class="world-hub-btn" id="wh-create-canvas">Create / open</button>
          </div>
          <div class="world-hub-canvas-grid" id="wh-canvases"></div>
        </div>
      </section>
      <section id="wh-panel-catalog" class="world-hub-panel" role="tabpanel" aria-labelledby="wh-tab-catalog" hidden>
        <div class="world-hub-section world-hub-catalog-section">
          <h2 class="world-hub-h2">Item catalog</h2>
          <p class="world-hub-hint">World-wide item definitions. Edits sync to SpacetimeDB and apply on every canvas in this world.</p>
          <div class="world-hub-table-wrap">
            <table class="world-hub-table" id="wh-catalog">
              <thead><tr>
                <th>Id</th><th>Name</th><th>Kind</th><th>Sixths</th><th>AC</th><th>gp</th><th>Fungible</th><th></th>
              </tr></thead>
              <tbody id="wh-catalog-body"></tbody>
            </table>
          </div>
        </div>
      </section>
    </div>
  `

  const titleInput = root.querySelector<HTMLInputElement>('#wh-title')!
  const slugEl = root.querySelector<HTMLElement>('#wh-slug')!
  const canvasHost = root.querySelector<HTMLElement>('#wh-canvases')!
  const catalogBody = root.querySelector<HTMLElement>('#wh-catalog-body')!
  const newCanvasInput = root.querySelector<HTMLInputElement>('#wh-new-canvas')!

  let snapshotWorld = ''

  const scheduleNameSave = (): void => {
    const v = titleInput.value.trim()
    if (v) handlers.onSaveDisplayName(v)
  }
  let nameTimer: ReturnType<typeof setTimeout> | null = null
  titleInput.addEventListener('input', () => {
    if (nameTimer) clearTimeout(nameTimer)
    nameTimer = setTimeout(() => {
      nameTimer = null
      scheduleNameSave()
    }, 450)
  })

  root.querySelector('#wh-open-main')?.addEventListener('click', () => {
    if (snapshotWorld) handlers.onNavigateCanvas(snapshotWorld, 'main')
  })

  root.querySelector('#wh-create-canvas')?.addEventListener('click', () => {
    const raw = newCanvasInput.value.trim().toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '')
    if (!raw) return
    handlers.onCreateCanvas(raw)
    newCanvasInput.value = ''
  })

  const tabCanvases = root.querySelector<HTMLButtonElement>('#wh-tab-canvases')!
  const tabCatalog = root.querySelector<HTMLButtonElement>('#wh-tab-catalog')!
  const panelCanvases = root.querySelector<HTMLElement>('#wh-panel-canvases')!
  const panelCatalog = root.querySelector<HTMLElement>('#wh-panel-catalog')!

  const setHubView = (hubView: HubView): void => {
    const onCanvases = hubView === 'canvases'
    tabCanvases.classList.toggle('active', onCanvases)
    tabCatalog.classList.toggle('active', !onCanvases)
    tabCanvases.setAttribute('aria-selected', onCanvases ? 'true' : 'false')
    tabCatalog.setAttribute('aria-selected', onCanvases ? 'false' : 'true')
    panelCanvases.hidden = !onCanvases
    panelCatalog.hidden = onCanvases
  }

  tabCanvases.addEventListener('click', () => handlers.onHubViewChange('canvases'))
  tabCatalog.addEventListener('click', () => handlers.onHubViewChange('catalog'))

  const render = (snapshot: WorldHubSnapshot, hubView: HubView): void => {
    snapshotWorld = snapshot.worldSlug
    titleInput.value = snapshot.displayName
    slugEl.textContent = `/${snapshot.worldSlug}`

    canvasHost.innerHTML = snapshot.canvases
      .map((c) => {
        const hrefPath = canonicalCanvasPath(snapshot.worldSlug, c.canvasSlug)
        const avatars = c.presence
          .map(
            (a) =>
              `<span class="world-hub-avatar" style="background:${esc(a.color)}" title="${esc(a.displayName)}">${esc(a.initials)}</span>`,
          )
          .join('')
        return `
          <article class="world-hub-card" data-canvas="${esc(c.canvasSlug)}">
            <div class="world-hub-card-avatars">${avatars}</div>
            <h3 class="world-hub-card-title">${esc(c.canvasSlug)}</h3>
            <p class="world-hub-card-meta">${esc(formatLastVisited(c.lastVisitedMs))}</p>
            <button type="button" class="world-hub-btn world-hub-card-open" data-href="${esc(hrefPath)}">Open</button>
          </article>
        `
      })
      .join('')

    canvasHost.querySelectorAll<HTMLButtonElement>('.world-hub-card-open').forEach((btn) => {
      btn.addEventListener('click', () => {
        const card = btn.closest<HTMLElement>('[data-canvas]')
        const slug = card?.dataset.canvas
        if (slug) handlers.onNavigateCanvas(snapshot.worldSlug, slug)
      })
    })

    catalogBody.innerHTML = snapshot.catalog
      .map((row) => {
        const sid = esc(row.id)
        return `<tr data-id="${sid}">
          <td><code class="world-hub-code">${sid}</code></td>
          <td><input class="world-hub-cell-input wh-cn" type="text" value="${esc(row.canonicalName)}" /></td>
          <td><select class="world-hub-cell-select wh-k">
            <option value="standard"${row.kind === 'standard' ? ' selected' : ''}>standard</option>
            <option value="armor"${row.kind === 'armor' ? ' selected' : ''}>armor</option>
            <option value="bulky"${row.kind === 'bulky' ? ' selected' : ''}>bulky</option>
            <option value="coins"${row.kind === 'coins' ? ' selected' : ''}>coins</option>
            <option value="bundled"${row.kind === 'bundled' ? ' selected' : ''}>bundled</option>
          </select></td>
          <td><input class="world-hub-cell-num wh-6" type="number" min="1" step="1" value="${row.sixthsPerUnit ?? ''}" placeholder="-" /></td>
          <td><input class="world-hub-cell-num wh-ac" type="number" min="0" step="1" value="${row.armorClass ?? ''}" placeholder="-" /></td>
          <td><input class="world-hub-cell-num wh-gp" type="number" min="0" step="0.01" value="${row.priceInGp ?? ''}" placeholder="-" /></td>
          <td class="world-hub-td-c"><input type="checkbox" class="wh-fung"${row.isFungibleVisual ? ' checked' : ''} /></td>
          <td><button type="button" class="world-hub-btn danger wh-del" ${row.isFromSample ? 'disabled title="Remove override in board editor"' : ''}>Delete</button></td>
        </tr>`
      })
      .join('')

    const postUpsert = (tr: HTMLTableRowElement): void => {
      const id = tr.dataset.id
      if (!id) return
      const cn = tr.querySelector<HTMLInputElement>('.wh-cn')?.value.trim() ?? ''
      const kind = (tr.querySelector<HTMLSelectElement>('.wh-k')?.value ?? 'standard') as ItemKind
      const sixthRaw = tr.querySelector<HTMLInputElement>('.wh-6')?.value
      const acRaw = tr.querySelector<HTMLInputElement>('.wh-ac')?.value
      const gpRaw = tr.querySelector<HTMLInputElement>('.wh-gp')?.value
      const fung = !!tr.querySelector<HTMLInputElement>('.wh-fung')?.checked
      const sixthsPerUnit = sixthRaw !== '' && Number.isFinite(Number(sixthRaw)) ? Math.max(1, Math.floor(Number(sixthRaw))) : undefined
      const armorClass = acRaw !== '' && Number.isFinite(Number(acRaw)) ? Math.max(0, Math.floor(Number(acRaw))) : undefined
      const priceInGp = gpRaw !== '' && Number.isFinite(Number(gpRaw)) ? Math.max(0, Number(gpRaw)) : undefined
      handlers.onCatalogUpsert({
        id,
        canonicalName: cn || id,
        kind,
        sixthsPerUnit,
        armorClass,
        priceInGp,
        isFungibleVisual: fung,
      })
    }

    let catalogTimer: ReturnType<typeof setTimeout> | null = null
    const debounceUpsert = (tr: HTMLTableRowElement): void => {
      if (catalogTimer) clearTimeout(catalogTimer)
      catalogTimer = setTimeout(() => {
        catalogTimer = null
        postUpsert(tr)
      }, 400)
    }

    catalogBody.querySelectorAll<HTMLTableRowElement>('tr[data-id]').forEach((tr) => {
      tr.querySelectorAll<HTMLInputElement | HTMLSelectElement>('input, select').forEach((el) => {
        el.addEventListener('change', () => postUpsert(tr))
        el.addEventListener('input', () => debounceUpsert(tr))
      })
      const delBtn = tr.querySelector<HTMLButtonElement>('.wh-del')
      delBtn?.addEventListener('click', () => {
        const id = tr.dataset.id
        if (id && !delBtn.disabled) handlers.onCatalogRemove(id)
      })
    })

    setHubView(hubView)
  }

  const destroy = (): void => {
    root.remove()
  }

  return { root, render, setHubView, destroy }
}

export { canonicalCanvasPath }
