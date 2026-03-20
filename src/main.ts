import './style.css'
import { parseInventoryImportPlan } from './domain/inventory-import-plan'
import { extractQuantityAndName, parseInventoryText, splitInventoryClauses } from './domain/inventory-text-parser'
import { resolveAddItemsCatalogMatch } from './domain/add-items-catalog-match'
import { buildInventoryLlmPrompt } from './domain/inventory-llm-prompt'
import {
  parseInventoryOpsDocument,
  unwrapPastedInventoryJson,
  type InventoryItemInput,
  type MutateAddItemsOp,
} from './domain/inventory-ops-schema'
import { allSourceItems, itemSourceCatalog, type EncumbranceExpr, type SourceItem } from './domain/item-source-catalog'
import type { ItemCatalogRow } from './domain/types'
import { formatSixthsAsStone, stoneToSixths } from './domain/rules'
import { createSourceItemSearchIndex } from './domain/item-source-search'
import { getWieldOptions } from './domain/weapon-metadata'
import { PixiBoardAdapter } from './pixi/PixiBoardAdapter'
import { sampleState } from './sample-data'
import type { ActorKind, CarryZone } from './domain/types'
import type { ConnectedUser, MainToWorkerMessage, RemoteCursor, SceneSegmentVM, SceneVM, WorkerToMainMessage } from './worker/protocol'
import type { ItemCategory } from './domain/item-category'
import {
  canonicalPathForRoute,
  parseAppRoute,
  worldCanvasContextFromRoute,
  type AppRoute,
} from './spacetimedb/context'
import { createWorldHubAdapter } from './world-hub/world-hub-adapter'
import { attachTooltip } from './tooltip'

const app = document.querySelector<HTMLDivElement>('#app')
if (!app) throw new Error('App root missing')

let appRoute: AppRoute = parseAppRoute(window.location.pathname)
let canonicalPath = canonicalPathForRoute(appRoute)
if (window.location.pathname !== canonicalPath) {
  history.replaceState(null, '', canonicalPath)
  appRoute = parseAppRoute(window.location.pathname)
  canonicalPath = canonicalPathForRoute(appRoute)
}
let worldCanvasContext = worldCanvasContextFromRoute(appRoute)

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

const connectionBadge = document.createElement('div')
connectionBadge.textContent = 'DB: offline'
Object.assign(connectionBadge.style, {
  position: 'fixed',
  right: '12px',
  bottom: '36px',
  zIndex: '2147483647',
  background: '#10161fcc',
  color: '#ff8866',
  border: '1px solid #ff886666',
  borderRadius: '6px',
  padding: '4px 8px',
  fontFamily: 'monospace',
  fontSize: '10px',
  letterSpacing: '0.02em',
  pointerEvents: 'none',
  transition: 'color 0.3s, border-color 0.3s',
} as Partial<CSSStyleDeclaration>)
document.body.appendChild(connectionBadge)

function updateConnectionBadge(status: 'connected' | 'disconnected' | 'error'): void {
  if (status === 'connected') {
    connectionBadge.textContent = 'DB: connected'
    connectionBadge.style.color = '#8ff7bf'
    connectionBadge.style.borderColor = '#8ff7bf66'
  } else if (status === 'error') {
    connectionBadge.textContent = 'DB: error'
    connectionBadge.style.color = '#ff4444'
    connectionBadge.style.borderColor = '#ff444466'
  } else {
    connectionBadge.textContent = 'DB: offline'
    connectionBadge.style.color = '#ff8866'
    connectionBadge.style.borderColor = '#ff886666'
  }
}

// ─── Identity Dialog ─────────────────────────────────────────────────────────

const identityDialog = document.createElement('dialog')
identityDialog.id = 'identity-dialog'
Object.assign(identityDialog.style, {
  border: '1px solid #334455',
  borderRadius: '10px',
  background: '#151e2b',
  color: '#d0dae8',
  padding: '0',
  maxWidth: '340px',
  width: '100%',
  fontFamily: 'system-ui, -apple-system, sans-serif',
  boxShadow: '0 20px 60px rgba(0,0,0,0.6)',
} as Partial<CSSStyleDeclaration>)

function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/)
  if (parts.length >= 2) return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
  return name.slice(0, 2).toUpperCase()
}

function initialsColor(name: string): string {
  let hash = 0
  for (let i = 0; i < name.length; i++) hash = ((hash << 5) - hash + name.charCodeAt(i)) | 0
  const hue = Math.abs(hash) % 360
  return `hsl(${hue}, 55%, 45%)`
}

function renderIdentityDialog(currentName: string, isFirstTime: boolean): void {
  const initials = getInitials(currentName || 'U')
  const color = initialsColor(currentName || 'User')
  identityDialog.innerHTML = `
    <form method="dialog" style="padding: 24px;">
      <div style="text-align:center;margin-bottom:20px;">
        <div id="id-avatar-preview" style="
          width:64px;height:64px;border-radius:50%;
          background:${color};
          display:inline-flex;align-items:center;justify-content:center;
          font-size:24px;font-weight:700;color:#fff;
          letter-spacing:0.04em;margin-bottom:8px;
        ">${initials}</div>
        <div style="font-size:16px;font-weight:600;">${isFirstTime ? 'Welcome! Who are you?' : 'Edit Profile'}</div>
        ${isFirstTime ? '<div style="font-size:12px;color:#6b7d90;margin-top:4px;">Pick a display name so others can see you.</div>' : ''}
      </div>
      <label style="display:block;margin-bottom:16px;">
        <span style="font-size:11px;text-transform:uppercase;letter-spacing:0.05em;color:#6b7d90;display:block;margin-bottom:6px;">Display Name</span>
        <input id="id-name-input" type="text" value="${currentName.replace(/"/g, '&quot;')}" 
          placeholder="Your name" autocomplete="off"
          style="
            width:100%;box-sizing:border-box;padding:8px 12px;
            background:#0c1118;border:1px solid #334455;border-radius:6px;
            color:#d0dae8;font-size:14px;outline:none;
          " />
      </label>
      <div style="display:flex;gap:8px;justify-content:flex-end;">
        ${isFirstTime ? '' : '<button type="button" id="id-cancel-btn" style="padding:8px 16px;border-radius:6px;border:1px solid #334455;background:transparent;color:#8899aa;cursor:pointer;font-size:13px;">Cancel</button>'}
        <button type="submit" id="id-save-btn" style="padding:8px 16px;border-radius:6px;border:none;background:#2b6cb0;color:#fff;cursor:pointer;font-size:13px;font-weight:600;">Save</button>
      </div>
    </form>
  `

  const nameInput = identityDialog.querySelector<HTMLInputElement>('#id-name-input')!
  const avatarPreview = identityDialog.querySelector<HTMLElement>('#id-avatar-preview')!
  const saveBtn = identityDialog.querySelector<HTMLButtonElement>('#id-save-btn')!

  const updatePreview = () => {
    const val = nameInput.value.trim()
    avatarPreview.textContent = getInitials(val || 'U')
    avatarPreview.style.background = initialsColor(val || 'User')
    saveBtn.disabled = val.length === 0
    saveBtn.style.opacity = val.length === 0 ? '0.4' : '1'
  }
  nameInput.addEventListener('input', updatePreview)
  updatePreview()

  const cancelBtn = identityDialog.querySelector<HTMLButtonElement>('#id-cancel-btn')
  cancelBtn?.addEventListener('click', () => identityDialog.close())

  const form = identityDialog.querySelector('form')!
  form.addEventListener('submit', (e) => {
    e.preventDefault()
    const newName = nameInput.value.trim()
    if (!newName) return
    postToWorker({ type: 'SET_DISPLAY_NAME', name: newName })
    identityDialog.close()
  })

  if (isFirstTime) {
    identityDialog.addEventListener('cancel', (e) => e.preventDefault(), { once: true })
  }
}

document.body.appendChild(identityDialog)

let identityDialogShown = false

function maybeShowIdentityDialog(users: ConnectedUser[], myHex: string): void {
  if (identityDialogShown) return
  const me = users.find(u => u.identityHex === myHex)
  if (!me) return
  const isDefaultName = /^User-[0-9a-f]{6}$/.test(me.displayName)
  if (isDefaultName) {
    identityDialogShown = true
    showIdentityDialog('', true)
  }
}

function showIdentityDialog(currentName: string, isFirstTime: boolean): void {
  renderIdentityDialog(currentName, isFirstTime)
  identityDialog.showModal()
  const input = identityDialog.querySelector<HTMLInputElement>('#id-name-input')
  input?.select()
}

// ─── Item Editor Dialog ───────────────────────────────────────────────────────

const itemEditorDialog = document.createElement('dialog')
itemEditorDialog.id = 'item-editor-dialog'
Object.assign(itemEditorDialog.style, {
  border: '1px solid #334455',
  borderRadius: '10px',
  background: '#151e2b',
  color: '#d0dae8',
  padding: '0',
  maxWidth: '460px',
  width: '100%',
  fontFamily: 'system-ui, -apple-system, sans-serif',
  boxShadow: '0 20px 60px rgba(0,0,0,0.6)',
} as Partial<CSSStyleDeclaration>)
document.body.appendChild(itemEditorDialog)

const addItemsDialog = document.createElement('dialog')
addItemsDialog.id = 'add-items-dialog'
Object.assign(addItemsDialog.style, {
  border: '1px solid #334455',
  borderRadius: '10px',
  background: '#151e2b',
  color: '#d0dae8',
  padding: '0',
  maxWidth: '760px',
  width: '100%',
  fontFamily: 'system-ui, -apple-system, sans-serif',
  boxShadow: '0 20px 60px rgba(0,0,0,0.6)',
} as Partial<CSSStyleDeclaration>)
document.body.appendChild(addItemsDialog)

function resolveSceneSegment(segmentId: string): SceneSegmentVM | null {
  if (currentScene) {
    for (const node of Object.values(currentScene.nodes)) {
      const found = node.segments.find((s) => s.id === segmentId)
      if (found) return found
    }
    const free = currentScene.freeSegments[segmentId]
    if (free) return free.segment
  }
  return null
}

function showItemEditorDialog(segment: SceneSegmentVM): void {
  if (segment.locked || !segment.entryId || !segment.prototype || !segment.zone) return
  const prototype = segment.prototype
  const basePrototypeId = segment.overridePrototypeId ?? prototype.id
  const state = segment.state ?? {}
  const quantity = Math.max(1, segment.quantity ?? 1)

  itemEditorDialog.innerHTML = `
    <form method="dialog" style="padding: 16px;">
      <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:12px;">
        <div>
          <div style="font-size:16px;font-weight:600;">Item editor</div>
          <div style="font-size:12px;color:#8ea0b6;">Entry <code>${segment.entryId}</code> · Prototype <code>${prototype.id}</code></div>
        </div>
        <button type="button" id="item-editor-close" style="padding:4px 8px;border-radius:6px;border:1px solid #334455;background:transparent;color:#a8b8cc;cursor:pointer;">Close</button>
      </div>

      <div style="display:flex;gap:8px;margin-bottom:12px;">
        <button type="button" id="item-editor-tab-prototype" data-tab="prototype" style="flex:1;padding:8px;border-radius:6px;border:1px solid #334455;background:#213148;color:#d0dae8;cursor:pointer;">Prototype</button>
        <button type="button" id="item-editor-tab-instance" data-tab="instance" style="flex:1;padding:8px;border-radius:6px;border:1px solid #334455;background:transparent;color:#a8b8cc;cursor:pointer;">Instance</button>
      </div>

      <input type="hidden" id="item-editor-target" value="prototype" />

      <section style="border:1px solid #334455;border-radius:8px;padding:10px;margin-bottom:10px;">
        <div style="font-size:11px;letter-spacing:0.04em;text-transform:uppercase;color:#8ea0b6;margin-bottom:8px;">Instance properties</div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;">
          <label style="display:block;">
            <span style="display:block;font-size:11px;color:#8ea0b6;margin-bottom:4px;">Quantity</span>
            <input id="item-editor-quantity" type="number" min="1" step="1" value="${quantity}" style="width:100%;box-sizing:border-box;padding:7px 9px;background:#0c1118;border:1px solid #334455;border-radius:6px;color:#d0dae8;" />
          </label>
          <label style="display:block;">
            <span style="display:block;font-size:11px;color:#8ea0b6;margin-bottom:4px;">Zone</span>
            <select id="item-editor-zone" style="width:100%;box-sizing:border-box;padding:7px 9px;background:#0c1118;border:1px solid #334455;border-radius:6px;color:#d0dae8;">
              <option value="worn" ${segment.zone === 'worn' ? 'selected' : ''}>worn</option>
              <option value="attached" ${segment.zone === 'attached' ? 'selected' : ''}>attached</option>
              <option value="accessible" ${segment.zone === 'accessible' ? 'selected' : ''}>accessible</option>
              <option value="stowed" ${segment.zone === 'stowed' ? 'selected' : ''}>stowed</option>
              <option value="dropped" ${segment.zone === 'dropped' ? 'selected' : ''}>dropped</option>
            </select>
          </label>
        </div>
        <div style="display:flex;gap:12px;flex-wrap:wrap;margin-top:8px;">
          <label style="font-size:12px;color:#c3d0e0;"><input id="item-editor-state-worn" type="checkbox" ${state.worn ? 'checked' : ''}/> worn</label>
          <label style="font-size:12px;color:#c3d0e0;"><input id="item-editor-state-attached" type="checkbox" ${state.attached ? 'checked' : ''}/> attached</label>
          <label style="font-size:12px;color:#c3d0e0;"><input id="item-editor-state-dropped" type="checkbox" ${state.dropped ? 'checked' : ''}/> dropped</label>
          <label style="font-size:12px;color:#c3d0e0;"><input id="item-editor-state-inaccessible" type="checkbox" ${state.inaccessible ? 'checked' : ''}/> inaccessible</label>
        </div>
      </section>

      <section id="item-editor-instance-override-box" style="border:1px solid #334455;border-radius:8px;padding:10px;margin-bottom:10px;display:none;">
        <label style="display:flex;align-items:center;gap:8px;font-size:12px;color:#c3d0e0;">
          <input id="item-editor-instance-override-enabled" type="checkbox" ${segment.overridePrototypeId ? 'checked' : ''} />
          Override prototype for this instance
        </label>
        <div id="item-editor-override-note" style="margin-top:6px;font-size:11px;color:${segment.overridePrototypeId ? '#ffbf7a' : '#8ea0b6'};">
          ${segment.overridePrototypeId
            ? `Overriding base prototype <code>${basePrototypeId}</code>`
            : `Currently inheriting prototype <code>${basePrototypeId}</code>`}
        </div>
      </section>

      <section id="item-editor-prototype-fields" style="border:1px solid #334455;border-radius:8px;padding:10px;margin-bottom:10px;">
        <div style="font-size:11px;letter-spacing:0.04em;text-transform:uppercase;color:#8ea0b6;margin-bottom:8px;">Prototype properties</div>
        <label style="display:block;margin-bottom:8px;">
          <span style="display:block;font-size:11px;color:#8ea0b6;margin-bottom:4px;">Canonical name</span>
          <input id="item-editor-canonical-name" type="text" value="${prototype.canonicalName.replace(/"/g, '&quot;')}" style="width:100%;box-sizing:border-box;padding:7px 9px;background:#0c1118;border:1px solid #334455;border-radius:6px;color:#d0dae8;" />
        </label>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;">
          <label style="display:block;">
            <span style="display:block;font-size:11px;color:#8ea0b6;margin-bottom:4px;">Kind</span>
            <select id="item-editor-kind" style="width:100%;box-sizing:border-box;padding:7px 9px;background:#0c1118;border:1px solid #334455;border-radius:6px;color:#d0dae8;">
              <option value="standard" ${prototype.kind === 'standard' ? 'selected' : ''}>standard</option>
              <option value="bulky" ${prototype.kind === 'bulky' ? 'selected' : ''}>bulky</option>
              <option value="armor" ${prototype.kind === 'armor' ? 'selected' : ''}>armor</option>
              <option value="coins" ${prototype.kind === 'coins' ? 'selected' : ''}>coins</option>
            </select>
          </label>
          <label style="display:block;">
            <span style="display:block;font-size:11px;color:#8ea0b6;margin-bottom:4px;">Sixths per unit</span>
            <input id="item-editor-sixths-per-unit" type="number" min="1" step="1" value="${prototype.sixthsPerUnit ?? ''}" style="width:100%;box-sizing:border-box;padding:7px 9px;background:#0c1118;border:1px solid #334455;border-radius:6px;color:#d0dae8;" />
          </label>
          <label style="display:block;">
            <span style="display:block;font-size:11px;color:#8ea0b6;margin-bottom:4px;">Armor class</span>
            <input id="item-editor-armor-class" type="number" min="1" step="1" value="${prototype.armorClass ?? ''}" style="width:100%;box-sizing:border-box;padding:7px 9px;background:#0c1118;border:1px solid #334455;border-radius:6px;color:#d0dae8;" />
          </label>
          <label style="display:block;">
            <span style="display:block;font-size:11px;color:#8ea0b6;margin-bottom:4px;">Price (gp)</span>
            <input id="item-editor-price-gp" type="number" min="0" step="0.01" value="${prototype.priceInGp ?? ''}" style="width:100%;box-sizing:border-box;padding:7px 9px;background:#0c1118;border:1px solid #334455;border-radius:6px;color:#d0dae8;" />
          </label>
        </div>
        <label style="display:flex;align-items:center;gap:8px;font-size:12px;color:#c3d0e0;margin-top:8px;">
          <input id="item-editor-fungible" type="checkbox" ${prototype.isFungibleVisual ? 'checked' : ''}/>
          Fungible visual merge
        </label>
      </section>

      <div style="display:flex;justify-content:flex-end;gap:8px;">
        <button type="button" id="item-editor-cancel" style="padding:8px 12px;border-radius:6px;border:1px solid #334455;background:transparent;color:#a8b8cc;cursor:pointer;">Cancel</button>
        <button type="submit" id="item-editor-save" style="padding:8px 12px;border-radius:6px;border:none;background:#2b6cb0;color:#fff;cursor:pointer;font-weight:600;">Save</button>
      </div>
    </form>
  `

  const targetInput = itemEditorDialog.querySelector<HTMLInputElement>('#item-editor-target')!
  const tabPrototype = itemEditorDialog.querySelector<HTMLButtonElement>('#item-editor-tab-prototype')!
  const tabInstance = itemEditorDialog.querySelector<HTMLButtonElement>('#item-editor-tab-instance')!
  const instanceOverrideBox = itemEditorDialog.querySelector<HTMLElement>('#item-editor-instance-override-box')!
  const instanceOverrideEnabled = itemEditorDialog.querySelector<HTMLInputElement>('#item-editor-instance-override-enabled')!
  const prototypeFields = itemEditorDialog.querySelector<HTMLElement>('#item-editor-prototype-fields')!
  const closeBtn = itemEditorDialog.querySelector<HTMLButtonElement>('#item-editor-close')!
  const cancelBtn = itemEditorDialog.querySelector<HTMLButtonElement>('#item-editor-cancel')!
  const form = itemEditorDialog.querySelector<HTMLFormElement>('form')!

  const applyTab = (target: 'prototype' | 'instance') => {
    targetInput.value = target
    const isPrototype = target === 'prototype'
    tabPrototype.style.background = isPrototype ? '#213148' : 'transparent'
    tabPrototype.style.color = isPrototype ? '#d0dae8' : '#a8b8cc'
    tabInstance.style.background = !isPrototype ? '#213148' : 'transparent'
    tabInstance.style.color = !isPrototype ? '#d0dae8' : '#a8b8cc'
    instanceOverrideBox.style.display = isPrototype ? 'none' : 'block'
    if (!isPrototype && !instanceOverrideEnabled.checked) {
      prototypeFields.style.opacity = '0.55'
      prototypeFields.style.pointerEvents = 'none'
    } else {
      prototypeFields.style.opacity = '1'
      prototypeFields.style.pointerEvents = 'auto'
    }
  }

  tabPrototype.addEventListener('click', () => applyTab('prototype'))
  tabInstance.addEventListener('click', () => applyTab('instance'))
  instanceOverrideEnabled.addEventListener('change', () => applyTab(targetInput.value as 'prototype' | 'instance'))

  closeBtn.addEventListener('click', () => itemEditorDialog.close())
  cancelBtn.addEventListener('click', () => itemEditorDialog.close())

  form.addEventListener('submit', (event) => {
    event.preventDefault()
    const parsedQuantity = Number(itemEditorDialog.querySelector<HTMLInputElement>('#item-editor-quantity')?.value ?? 1)
    const quantityValue = Number.isFinite(parsedQuantity) ? Math.max(1, Math.floor(parsedQuantity)) : 1
    const zoneValue = (itemEditorDialog.querySelector<HTMLSelectElement>('#item-editor-zone')?.value ?? 'stowed') as 'worn' | 'attached' | 'accessible' | 'stowed' | 'dropped'
    const kindValue = (itemEditorDialog.querySelector<HTMLSelectElement>('#item-editor-kind')?.value ?? 'standard') as 'armor' | 'bulky' | 'standard' | 'coins'
    const parseOptionalPositiveNumber = (raw: string): number | undefined => {
      const n = Number(raw)
      return Number.isFinite(n) && n > 0 ? n : undefined
    }

    postToWorker({
      type: 'INTENT',
      intent: {
        type: 'SAVE_ITEM_EDITOR',
        segmentId: segment.id,
        target: (targetInput.value === 'instance' ? 'instance' : 'prototype'),
        quantity: quantityValue,
        zone: zoneValue,
        state: {
          worn: !!itemEditorDialog.querySelector<HTMLInputElement>('#item-editor-state-worn')?.checked,
          attached: !!itemEditorDialog.querySelector<HTMLInputElement>('#item-editor-state-attached')?.checked,
          dropped: !!itemEditorDialog.querySelector<HTMLInputElement>('#item-editor-state-dropped')?.checked,
          inaccessible: !!itemEditorDialog.querySelector<HTMLInputElement>('#item-editor-state-inaccessible')?.checked,
        },
        basePrototypeId,
        instanceOverrideEnabled: !!itemEditorDialog.querySelector<HTMLInputElement>('#item-editor-instance-override-enabled')?.checked,
        prototypePatch: {
          canonicalName: itemEditorDialog.querySelector<HTMLInputElement>('#item-editor-canonical-name')?.value?.trim() ?? prototype.canonicalName,
          kind: kindValue,
          sixthsPerUnit: parseOptionalPositiveNumber(itemEditorDialog.querySelector<HTMLInputElement>('#item-editor-sixths-per-unit')?.value ?? ''),
          armorClass: parseOptionalPositiveNumber(itemEditorDialog.querySelector<HTMLInputElement>('#item-editor-armor-class')?.value ?? ''),
          priceInGp: parseOptionalPositiveNumber(itemEditorDialog.querySelector<HTMLInputElement>('#item-editor-price-gp')?.value ?? ''),
          isFungibleVisual: !!itemEditorDialog.querySelector<HTMLInputElement>('#item-editor-fungible')?.checked,
        },
      },
    })
    itemEditorDialog.close()
  })

  applyTab('prototype')
  itemEditorDialog.showModal()
}

// ─── Presence Strip + Account Menu ────────────────────────────────────────────

const presenceStrip = document.createElement('div')
Object.assign(presenceStrip.style, {
  position: 'fixed',
  right: '12px',
  top: '10px',
  zIndex: '120',
  display: 'none',
  alignItems: 'center',
  gap: '6px',
  pointerEvents: 'auto',
} as Partial<CSSStyleDeclaration>)
document.body.appendChild(presenceStrip)

const accountDropdown = document.createElement('div')
Object.assign(accountDropdown.style, {
  position: 'fixed',
  right: '12px',
  top: '52px',
  zIndex: '130',
  minWidth: '220px',
  background: '#10161ff0',
  border: '1px solid #ffffff22',
  borderRadius: '10px',
  boxShadow: '0 14px 34px rgba(0, 0, 0, 0.45)',
  overflow: 'hidden',
  display: 'none',
  color: '#d0dae8',
  fontFamily: 'system-ui, -apple-system, sans-serif',
} as Partial<CSSStyleDeclaration>)
document.body.appendChild(accountDropdown)

let accountMenuOpen = false

function closeAccountMenu(): void {
  accountMenuOpen = false
  accountDropdown.style.display = 'none'
}

function openAccountMenu(user: ConnectedUser): void {
  accountMenuOpen = true
  accountDropdown.style.display = 'block'
  accountDropdown.innerHTML = ''

  const header = document.createElement('div')
  Object.assign(header.style, {
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
    padding: '12px',
    borderBottom: '1px solid #ffffff1a',
  } as Partial<CSSStyleDeclaration>)

  const avatar = document.createElement('span')
  Object.assign(avatar.style, {
    width: '34px',
    height: '34px',
    borderRadius: '50%',
    background: initialsColor(user.displayName),
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    color: '#fff',
    fontSize: '13px',
    fontWeight: '700',
    flexShrink: '0',
    letterSpacing: '0.02em',
  } as Partial<CSSStyleDeclaration>)
  avatar.textContent = getInitials(user.displayName)
  header.appendChild(avatar)

  const headerText = document.createElement('div')
  headerText.style.minWidth = '0'
  const nameEl = document.createElement('div')
  nameEl.textContent = user.displayName
  Object.assign(nameEl.style, {
    fontSize: '13px',
    fontWeight: '600',
    color: '#e4edf8',
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
  } as Partial<CSSStyleDeclaration>)
  headerText.appendChild(nameEl)
  const statusEl = document.createElement('div')
  statusEl.textContent = 'Logged in'
  Object.assign(statusEl.style, {
    marginTop: '2px',
    fontSize: '11px',
    color: '#8ff7bf',
    letterSpacing: '0.01em',
  } as Partial<CSSStyleDeclaration>)
  headerText.appendChild(statusEl)
  header.appendChild(headerText)
  accountDropdown.appendChild(header)

  const menuButton = document.createElement('button')
  menuButton.type = 'button'
  menuButton.textContent = 'Edit username'
  Object.assign(menuButton.style, {
    width: '100%',
    textAlign: 'left',
    border: 'none',
    borderRadius: '0',
    background: 'transparent',
    color: '#d0dae8',
    padding: '10px 12px',
    fontSize: '13px',
    cursor: 'pointer',
  } as Partial<CSSStyleDeclaration>)
  menuButton.addEventListener('mouseenter', () => {
    menuButton.style.background = '#1a2535'
  })
  menuButton.addEventListener('mouseleave', () => {
    menuButton.style.background = 'transparent'
  })
  menuButton.addEventListener('click', () => {
    closeAccountMenu()
    showIdentityDialog(user.displayName, false)
  })
  accountDropdown.appendChild(menuButton)
}

document.addEventListener('pointerdown', (event) => {
  const target = event.target
  if (!(target instanceof Node)) return
  if (accountDropdown.contains(target) || presenceStrip.contains(target)) return
  closeAccountMenu()
})

const CURSOR_COLORS = ['#ff6b6b', '#4ecdc4', '#ffe66d', '#95e1d3', '#f38181', '#aa96da', '#fcbad3', '#a8d8ea']
function cursorColorForUser(hex: string): string {
  let hash = 0
  for (let i = 0; i < hex.length; i++) hash = ((hash << 5) - hash + hex.charCodeAt(i)) | 0
  return CURSOR_COLORS[Math.abs(hash) % CURSOR_COLORS.length]
}

let currentUsers: ConnectedUser[] = []
let currentCursors: RemoteCursor[] = []
let myIdentityHex = ''
let lastPresenceSignature = ''

function updateUsersPanel(users: ConnectedUser[]): void {
  const online = users.filter(u => u.online)
  const me = online.find((u) => u.identityHex === myIdentityHex)
  const others = online.filter((u) => u.identityHex !== myIdentityHex)

  const signature = JSON.stringify({
    myIdentityHex,
    online: online
      .map((u) => ({ id: u.identityHex, name: u.displayName, role: u.role }))
      .sort((a, b) => a.id.localeCompare(b.id)),
  })

  if (!me) {
    presenceStrip.style.display = 'none'
    lastPresenceSignature = ''
    closeAccountMenu()
    return
  }

  if (signature === lastPresenceSignature) return
  lastPresenceSignature = signature

  presenceStrip.style.display = 'flex'
  presenceStrip.innerHTML = ''

  for (const user of others) {
    const avatar = document.createElement('span')
    Object.assign(avatar.style, {
      width: '20px',
      height: '20px',
      borderRadius: '50%',
      background: initialsColor(user.displayName),
      display: 'inline-flex',
      alignItems: 'center',
      justifyContent: 'center',
      fontSize: '9px',
      fontWeight: '700',
      color: '#fff',
      flexShrink: '0',
      letterSpacing: '0.02em',
      border: '1px solid #ffffff30',
      userSelect: 'none',
    } as Partial<CSSStyleDeclaration>)
    avatar.textContent = getInitials(user.displayName)
    attachTooltip(avatar, `${user.displayName} (${user.role.toUpperCase()})`)
    presenceStrip.appendChild(avatar)
  }

  const myAvatarButton = document.createElement('button')
  myAvatarButton.type = 'button'
  Object.assign(myAvatarButton.style, {
    width: '34px',
    height: '34px',
    borderRadius: '50%',
    background: initialsColor(me.displayName),
    border: '2px solid #ffffff40',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: '12px',
    fontWeight: '700',
    color: '#fff',
    flexShrink: '0',
    letterSpacing: '0.02em',
    cursor: 'pointer',
    boxShadow: '0 2px 8px rgba(0,0,0,0.35)',
    padding: '0',
  } as Partial<CSSStyleDeclaration>)
  myAvatarButton.textContent = getInitials(me.displayName)
  attachTooltip(myAvatarButton, 'Account menu')
  myAvatarButton.setAttribute('aria-label', 'Open account menu')
  myAvatarButton.addEventListener('click', (event) => {
    event.stopPropagation()
    if (accountMenuOpen) {
      closeAccountMenu()
      return
    }
    openAccountMenu(me)
  })
  presenceStrip.appendChild(myAvatarButton)

  if (accountMenuOpen) {
    openAccountMenu(me)
  }
}

// ─── Remote Cursor Overlay ────────────────────────────────────────────────────

const cursorOverlay = document.createElement('div')
Object.assign(cursorOverlay.style, {
  position: 'absolute',
  top: '0',
  left: '0',
  width: '100%',
  height: '100%',
  pointerEvents: 'none',
  zIndex: '999999',
  overflow: 'hidden',
} as Partial<CSSStyleDeclaration>)

const remoteCursorElements = new Map<string, HTMLElement>()

function renderRemoteCursors(cursors: RemoteCursor[], users: ConnectedUser[]): void {
  const canvasHost = document.querySelector<HTMLElement>('#canvas-host')
  if (!canvasHost) return

  if (!cursorOverlay.parentElement) {
    canvasHost.style.position = 'relative'
    canvasHost.appendChild(cursorOverlay)
  }

  const userMap = new Map(users.map(u => [u.identityHex, u]))
  const activeCursorIds = new Set(cursors.map(c => c.identityHex))

  for (const [id, el] of remoteCursorElements) {
    if (!activeCursorIds.has(id)) {
      el.remove()
      remoteCursorElements.delete(id)
    }
  }

  for (const cursor of cursors) {
    const user = userMap.get(cursor.identityHex)
    if (!user || !user.online) continue

    const screen = pixiAdapter.getScreenPosition(cursor.x, cursor.y)

    let el = remoteCursorElements.get(cursor.identityHex)
    if (!el) {
      el = document.createElement('div')
      Object.assign(el.style, {
        position: 'absolute',
        pointerEvents: 'none',
        transition: 'left 0.1s linear, top 0.1s linear',
        zIndex: '999999',
      } as Partial<CSSStyleDeclaration>)

      const color = cursorColorForUser(cursor.identityHex)

      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
      svg.setAttribute('width', '16')
      svg.setAttribute('height', '20')
      svg.setAttribute('viewBox', '0 0 16 20')
      svg.innerHTML = `<path d="M0 0L16 12L8 12L4 20L0 0Z" fill="${color}" stroke="#000" stroke-width="1"/>`
      el.appendChild(svg)

      const label = document.createElement('span')
      label.textContent = user.displayName
      Object.assign(label.style, {
        position: 'absolute',
        left: '18px',
        top: '12px',
        fontSize: '10px',
        fontFamily: 'monospace',
        background: `${color}cc`,
        color: '#000',
        padding: '1px 4px',
        borderRadius: '3px',
        whiteSpace: 'nowrap',
        fontWeight: 'bold',
      } as Partial<CSSStyleDeclaration>)
      el.appendChild(label)

      cursorOverlay.appendChild(el)
      remoteCursorElements.set(cursor.identityHex, el)
    }

    el.style.left = `${screen.x}px`
    el.style.top = `${screen.y}px`
  }
}

// ─── Cursor Broadcasting ──────────────────────────────────────────────────────

let cursorThrottleTimer: ReturnType<typeof setTimeout> | null = null
const CURSOR_BROADCAST_MS = 100

function broadcastCursorPosition(clientX: number, clientY: number): void {
  const world = pixiAdapter.getWorldPosition(clientX, clientY)
  if (cursorThrottleTimer) return
  cursorThrottleTimer = setTimeout(() => {
    cursorThrottleTimer = null
  }, CURSOR_BROADCAST_MS)
  postToWorker({ type: 'UPDATE_CURSOR', x: world.x, y: world.y })
}

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
  <div id="canvas-shell">
  <div id="category-bar" class="category-bar">
    <button type="button" class="category-btn" data-category="armor-and-barding">Armor</button>
    <button type="button" class="category-btn" data-category="weapons">Weapons</button>
    <button type="button" class="category-btn" data-category="adventuring-equipment">Adventuring</button>
    <button type="button" class="category-btn category-btn-all" data-category="">All</button>
  </div>
  <!-- Palette UI is intentionally disabled for now.
       It is not fully implemented yet and can cause broken interactions. -->
  <!--
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
  -->
  <div id="canvas-host">
    <div id="loading-overlay" style="position:absolute;inset:0;z-index:100;display:flex;align-items:center;justify-content:center;background:#10161f">
      <div style="text-align:center;color:#8899aa;font-family:monospace">
        <div style="font-size:28px;margin-bottom:12px;animation:spin 1s linear infinite;display:inline-block">&#9881;</div>
        <div style="font-size:13px;letter-spacing:0.05em">Connecting&hellip;</div>
      </div>
    </div>
  </div>
  </div>
  <div id="world-hub-root" hidden></div>

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
        <label for="parse-input" class="tool-label">Paste Inventory (Deprecated)</label>
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
        <button id="reset-data-btn" class="tool-button tool-button-danger" type="button" style="margin-top: 12px">Reset to Sample Data</button>
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
const leftDrawerEl = document.querySelector<HTMLElement>('#left-drawer')
const leftDrawerToggle = document.querySelector<HTMLElement>('#left-drawer-toggle')
const leftDrawerClose = document.querySelector<HTMLElement>('#left-drawer-close')
const toolTextBtnEl = document.querySelector<HTMLButtonElement>('#tool-text')
const drawerEl = document.querySelector<HTMLElement>('#drawer')!
const drawerToggle = document.querySelector<HTMLElement>('#drawer-toggle')!
const drawerClose = document.querySelector<HTMLElement>('#drawer-close')!
const parseInputEl = document.querySelector<HTMLTextAreaElement>('#parse-input')!
const parseResultsEl = document.querySelector<HTMLElement>('#parse-results')!

drawerToggle.addEventListener('click', () => drawerEl.classList.toggle('open'))
drawerClose.addEventListener('click', () => drawerEl.classList.remove('open'))
leftDrawerToggle?.addEventListener('click', () => leftDrawerEl?.classList.toggle('open'))
leftDrawerClose?.addEventListener('click', () => leftDrawerEl?.classList.remove('open'))

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

let cachedItemCatalogRows: ItemCatalogRow[] | null = null
let addItemsCatalogById = new Map<string, ItemCatalogRow>()
let catalogRequestSeq = 0
const pendingCatalogResolvers = new Map<string, (rows: readonly ItemCatalogRow[]) => void>()

const postToWorker = (message: MainToWorkerMessage): void => {
  vmWorker.postMessage(message)
}

/** Set after `pixiAdapter` init; pauses the board on hub route. */
let applyRouteBoardRender: (() => void) | null = null

let worldHubAdapter: ReturnType<typeof createWorldHubAdapter> | null = null
let hubListRequestSeq = 0

const refreshWorldHubData = (): void => {
  if (appRoute.mode !== 'hub') return
  postToWorker({ type: 'GET_WORLD_HUB', requestId: `wh-${Date.now()}-${(hubListRequestSeq += 1)}` })
}

/** DOM visibility + hub list fetch; does not post to the worker (route is set by INIT / SET_APP_ROUTE). */
const syncHubCanvasShell = (): void => {
  const route = appRoute
  const shell = document.getElementById('canvas-shell')
  const hubRoot = document.getElementById('world-hub-root')
  if (route.mode === 'hub') {
    shell?.setAttribute('hidden', '')
    hubRoot?.removeAttribute('hidden')
    if (!worldHubAdapter && hubRoot) {
      worldHubAdapter = createWorldHubAdapter({
        onNavigateCanvas: (w, c) => applyAppRoute({ mode: 'canvas', worldSlug: w, canvasSlug: c }, true),
        onSaveDisplayName: (displayName) => postToWorker({ type: 'SET_WORLD_DISPLAY_NAME', displayName }),
        onCatalogUpsert: (definition) => postToWorker({ type: 'INTENT', intent: { type: 'CATALOG_UPSERT_DEFINITION', definition } }),
        onCatalogRemove: (id) => postToWorker({ type: 'INTENT', intent: { type: 'CATALOG_REMOVE_DEFINITION', id } }),
        onCreateCanvas: (slug) => {
          if (appRoute.mode !== 'hub') return
          applyAppRoute({ mode: 'canvas', worldSlug: appRoute.worldSlug, canvasSlug: slug }, true)
        },
      })
      hubRoot.appendChild(worldHubAdapter.root)
    }
    refreshWorldHubData()
  } else {
    hubRoot?.setAttribute('hidden', '')
    shell?.removeAttribute('hidden')
  }
  applyRouteBoardRender?.()
}

const applyAppRoute = (route: AppRoute, pushHistory: boolean): void => {
  const path = canonicalPathForRoute(route)
  if (pushHistory) history.pushState(null, '', path)
  appRoute = route
  worldCanvasContext = worldCanvasContextFromRoute(route)
  postToWorker({ type: 'SET_APP_ROUTE', appRoute: route })
  syncHubCanvasShell()
}

window.addEventListener('popstate', () => {
  const next = parseAppRoute(window.location.pathname)
  applyAppRoute(next, false)
})

const fetchItemCatalogFromWorker = (): Promise<readonly ItemCatalogRow[]> => {
  return new Promise((resolve, reject) => {
    const requestId = `ic-${Date.now()}-${(catalogRequestSeq += 1)}`
    const timer = window.setTimeout(() => {
      pendingCatalogResolvers.delete(requestId)
      reject(new Error('Item catalog request timed out'))
    }, 12_000)
    pendingCatalogResolvers.set(requestId, (rows) => {
      clearTimeout(timer)
      resolve(rows)
    })
    postToWorker({ type: 'GET_ITEM_CATALOG', requestId })
  })
}

let currentScene: SceneVM | null = null
const renderCanvasToolUI = (): void => {
  toolTextBtnEl?.classList.toggle('active', activeCanvasTool === 'text')
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
  if (!segment.locked) {
    html += `<button class="context-menu-item" data-action="item-editor" type="button">Item editor</button>`
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
      } else if (action === 'item-editor') {
        const targetSegment = resolveSceneSegment(segmentId)
        if (targetSegment) showItemEditorDialog(targetSegment)
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
  const nodeTitle = currentScene?.nodes[nodeId]?.title ?? nodeId

  contextMenuEl.innerHTML = [
    `<button class="context-menu-item" data-action="add-items" type="button">Add Items</button>`,
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
      if (b.dataset.action === 'add-items') {
        showAddItemsDialog(nodeId, nodeTitle)
      } else if (b.dataset.action === 'duplicate-node') {
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
  wornClothing?: boolean
  zoneHint?: CarryZone
}

type ParsedAddItemsRow = ParsedSpawnItem & {
  opIndex: number
  overrideKey: string
  prototypeName?: string
  valueGp?: number
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

const deriveItemKindFromCatalogRow = (row: ItemCatalogRow): { kind: string; sixthsPerUnit: number; armorClass?: number } => {
  const perUnit = row.sixthsPerUnit ?? 6
  if (row.kind === 'armor') {
    return {
      kind: 'armor',
      sixthsPerUnit: perUnit,
      armorClass: row.armorClass ?? Math.max(1, Math.round(perUnit / SIXTHS_PER_STONE)),
    }
  }
  if (row.kind === 'bulky') return { kind: 'bulky', sixthsPerUnit: perUnit }
  if (row.kind === 'coins') return { kind: 'coins', sixthsPerUnit: perUnit }
  return { kind: 'standard', sixthsPerUnit: perUnit }
}

const consumedParsedIds = new Set<string>()
let parsedSpawnItems: ParsedSpawnItem[] = []
let activeParsedDrag: {
  parsedItem: ParsedSpawnItem
  ghost: HTMLElement
  enteredCanvas: boolean
} | null = null
let addItemsTargetNodeId: string | null = null
let addItemsRows: ParsedAddItemsRow[] = []
let addItemsError: string | null = null
let addItemsJson = ''
let addItemsDescription = ''
const addItemsDisambiguationOverrides: Record<string, string> = {}

const normalizeRowKey = (opIndex: number, itemIndex: number, chunkIndex: number): string =>
  `${opIndex}:${itemIndex}:${chunkIndex}`

const resolveParsedItem = (
  raw: string,
  candidateName: string,
  quantity: number,
  confidence: number,
  status: 'resolved' | 'ambiguous' | 'unknown',
  resolvedItemId: string | undefined,
  resolvedItemName: string | undefined,
  alternatives: readonly { itemId: string; itemName: string }[],
  overrideKey: string,
  catalogById: ReadonlyMap<string, ItemCatalogRow>,
  stoneOverride?: number,
  wornClothing?: boolean,
  zoneHint?: CarryZone,
): ParsedSpawnItem => {
  const override = addItemsDisambiguationOverrides[overrideKey]
  const forceCustom = override === CUSTOM_ITEM_ID
  const catalogId = forceCustom
    ? undefined
    : (override && override !== CUSTOM_ITEM_ID
        ? override
        : (resolvedItemId ?? alternatives[0]?.itemId))

  let customSlug = slugify(candidateName) || slugify(raw) || 'custom-item'
  const resolvedStone = stoneOverride ?? (wornClothing ? 0 : undefined)
  const useCustom = forceCustom || !catalogId
  if (useCustom && resolvedStone != null) {
    customSlug = `${customSlug}-${Math.round(stoneToSixths(resolvedStone))}`
  }
  const customDefId = `custom:${customSlug}`

  let itemDefId: string | null
  let itemName: string
  let perUnitSixths: number
  let sixthsPerUnit: number | undefined

  if (!catalogId) {
    itemDefId = customDefId
    itemName = candidateName || raw || 'Custom item'
    if (resolvedStone != null) {
      perUnitSixths = Math.max(0, Math.round(stoneToSixths(resolvedStone)))
    } else if (alternatives.length > 0) {
      const best = catalogById.get(alternatives[0].itemId)
      perUnitSixths = best?.sixthsPerUnit !== undefined ? Math.max(0, best.sixthsPerUnit) : 1
    } else {
      perUnitSixths = 1
    }
    sixthsPerUnit = perUnitSixths
  } else {
    itemDefId = catalogId
    itemName =
      alternatives.find((a) => a.itemId === catalogId)?.itemName ??
      catalogById.get(catalogId)?.canonicalName ??
      resolvedItemName ??
      candidateName
    const catRow = catalogById.get(catalogId)
    perUnitSixths =
      catRow?.sixthsPerUnit !== undefined
        ? Math.max(0, catRow.sixthsPerUnit)
        : Math.max(0, Math.round(stoneToSixths(resolvedStone ?? 1 / 6)))
  }

  return {
    id: overrideKey,
    raw,
    status: override ? 'resolved' : status,
    confidence,
    quantity: Math.max(1, quantity),
    itemDefId,
    itemName,
    sizeSixths: Math.max(0, perUnitSixths * Math.max(1, quantity)),
    ...(sixthsPerUnit != null && { sixthsPerUnit }),
    alternatives,
    ...(wornClothing ? { wornClothing: true } : {}),
    ...(zoneHint ? { zoneHint } : {}),
  }
}

const parseAddItemsRowsFromJson = (
  jsonText: string,
  catalogRows: readonly ItemCatalogRow[],
): { rows: ParsedAddItemsRow[]; error: string | null; ops: readonly MutateAddItemsOp[] } => {
  const normalizedJson = unwrapPastedInventoryJson(jsonText)
  if (normalizedJson.length === 0) return { rows: [], error: null, ops: [] }
  let parsedRaw: unknown
  try {
    parsedRaw = JSON.parse(normalizedJson)
  } catch {
    return { rows: [], error: 'Invalid JSON', ops: [] }
  }

  const parsed = parseInventoryOpsDocument(parsedRaw)
  if (!parsed.ok) return { rows: [], error: parsed.error, ops: [] }
  const addOps = parsed.value.ops.filter((op): op is MutateAddItemsOp => op.op === 'mutate.add-items')
  if (addOps.length === 0) return { rows: [], error: 'No mutate.add-items operation found', ops: [] }

  const catalogById = new Map(catalogRows.map((r) => [r.id, r]))
  addItemsCatalogById = catalogById

  const rows: ParsedAddItemsRow[] = []
  addOps.forEach((op, opIndex) => {
    op.items.forEach((item: InventoryItemInput, itemIndex: number) => {
      const clauses = splitInventoryClauses(item.text)
      const useProto =
        item.prototypeName?.trim() && clauses.length === 1 ? item.prototypeName.trim() : undefined
      clauses.forEach((clause, chunkIndex) => {
        const extracted = extractQuantityAndName(clause)
        const match = resolveAddItemsCatalogMatch(extracted.candidateName, useProto, catalogRows)
        const alts = match.alternatives.map((a) => ({ itemId: a.itemId, itemName: a.itemName }))
        const rowKey = normalizeRowKey(opIndex, itemIndex, chunkIndex)
        const resolved = resolveParsedItem(
          clause,
          extracted.candidateName,
          (item.quantity ?? 1) * extracted.quantity,
          match.confidence,
          match.status,
          match.resolvedItemId,
          match.resolvedItemName,
          alts,
          rowKey,
          catalogById,
          item.encumbranceStone ?? extracted.stoneOverride,
          item.wornClothing,
          item.zoneHint,
        )
        rows.push({
          ...resolved,
          opIndex,
          overrideKey: rowKey,
          ...(item.prototypeName?.trim() ? { prototypeName: item.prototypeName.trim() } : {}),
          ...(item.valueGp != null && Number.isFinite(item.valueGp) ? { valueGp: item.valueGp } : {}),
        })
      })
    })
  })
  return { rows, error: null, ops: addOps }
}

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
  onMoveNodesToGroupIndex(moves) {
    postToWorker({ type: 'INTENT', intent: { type: 'MOVE_NODES_TO_GROUP_INDEX', moves } })
  },
  onMoveNodeInGroup(nodeId, groupId, x, y) {
    postToWorker({ type: 'INTENT', intent: { type: 'MOVE_NODE_IN_GROUP', nodeId, groupId, x, y } })
  },
  onMoveNodesInGroup(moves) {
    postToWorker({ type: 'INTENT', intent: { type: 'MOVE_NODES_IN_GROUP', moves } })
  },
  onDropNodeIntoNode(nodeId, targetNodeId) {
    postToWorker({ type: 'INTENT', intent: { type: 'DROP_NODE_INTO_NODE', nodeId, targetNodeId } })
  },
  onDropNodesIntoNode(nodeIds, targetNodeId) {
    postToWorker({ type: 'INTENT', intent: { type: 'DROP_NODES_INTO_NODE', nodeIds, targetNodeId } })
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
  onMoveNodesToRoot(moves) {
    postToWorker({ type: 'INTENT', intent: { type: 'MOVE_NODES_TO_ROOT', moves } })
  },
  onZoomChange(_zoom) {
    renderRemoteCursors(currentCursors, currentUsers)
  },
  onCameraChange(panX, panY, zoom) {
    postToWorker({ type: 'UPDATE_CAMERA', panX, panY, zoom })
  },
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
      : { kind: 'standard' as const, sixthsPerUnit: item.sixthsPerUnit ?? 1 }
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
  onDragStart() {
    postToWorker({ type: 'INTENT', intent: { type: 'DRAG_START' } })
  },
  onDragEnd() {
    postToWorker({ type: 'INTENT', intent: { type: 'DRAG_END' } })
  },
})

applyRouteBoardRender = (): void => {
  pixiAdapter.setBoardRenderActive(appRoute.mode === 'canvas')
}

let pendingCameraRestore: { panX: number; panY: number; zoom: number } | null = null

vmWorker.onmessage = (event: MessageEvent<WorkerToMainMessage>) => {
  const msg = event.data
  if (msg.type === 'ITEM_CATALOG') {
    cachedItemCatalogRows = [...msg.definitions]
    const resolve = pendingCatalogResolvers.get(msg.requestId)
    if (resolve) {
      pendingCatalogResolvers.delete(msg.requestId)
      resolve(msg.definitions)
    }
    return
  }
  if (msg.type === 'WORLD_HUB') {
    if (appRoute.mode === 'hub') worldHubAdapter?.render(msg.snapshot)
    return
  }
  if (msg.type === 'SCENE_INIT') {
    document.getElementById('loading-overlay')?.remove()
    closeInlineTitleEditor()
    currentScene = msg.scene
    selectedLabelId = msg.scene.selectedLabelId ?? null
    pixiAdapter.applyInit(msg.scene)
    if (pendingCameraRestore) {
      pixiAdapter.setCamera(pendingCameraRestore.panX, pendingCameraRestore.panY, pendingCameraRestore.zoom)
      pendingCameraRestore = null
    } else {
      pixiAdapter.fitAll()
    }
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
    return
  }
  if (msg.type === 'CONNECTION_STATUS') {
    console.info('[spacetimedb]', msg.status)
    updateConnectionBadge(msg.status)
    if (msg.status === 'connected') refreshWorldHubData()
    return
  }
  if (msg.type === 'STORE_TOKEN') {
    try { localStorage.setItem('spacetimedb_vtt_token', msg.token) } catch { /* noop */ }
    return
  }
  if (msg.type === 'PRESENCE_UPDATE') {
    currentUsers = msg.users
    currentCursors = msg.cursors
    myIdentityHex = msg.myIdentityHex
    updateUsersPanel(msg.users)
    renderRemoteCursors(msg.cursors, msg.users)
    maybeShowIdentityDialog(msg.users, msg.myIdentityHex)
    return
  }
  if (msg.type === 'CAMERA_RESTORE') {
    if (currentScene) {
      pixiAdapter.setCamera(msg.panX, msg.panY, msg.zoom)
    } else {
      pendingCameraRestore = { panX: msg.panX, panY: msg.panY, zoom: msg.zoom }
    }
    return
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
let savedSpacetimeToken: string | undefined
try {
  savedSpacetimeToken = localStorage.getItem('spacetimedb_vtt_token') ?? undefined
} catch { /* noop */ }
postToWorker({
  type: 'INIT',
  worldState: sampleState,
  stonesPerRow: initialStonesPerRow,
  token: savedSpacetimeToken,
  context: worldCanvasContext,
  appRoute,
})
syncHubCanvasShell()

canvasHost.addEventListener('pointermove', (e) => {
  broadcastCursorPosition(e.clientX, e.clientY)
  if (currentCursors.length > 0) renderRemoteCursors(currentCursors, currentUsers)
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
        perUnitSixths = best ? perUnitSixthsFromSource(best) : 1
      } else {
        perUnitSixths = 1
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
      const customPill = `<button class="alt-pill ${item.itemDefId?.startsWith('custom:') ? 'alt-pill-selected' : ''}" data-raw="${escapeHtml(item.raw)}" data-item-id="${escapeHtml(CUSTOM_ITEM_ID)}" type="button">Custom</button>`
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

const catalogEncMeta = (itemId: string): string => {
  const row = addItemsCatalogById.get(itemId)
  if (row?.sixthsPerUnit != null) return formatEncumbrance({ kind: 'fixed', sixths: Math.max(0, row.sixthsPerUnit) })
  const src = sourceItemById.get(itemId)
  return src ? formatEncumbrance(src.encumbrance) : '—'
}

const addItemsCustomTileMeta = (row: ParsedAddItemsRow): string => {
  if (row.wornClothing) return '0 st (clothing)'
  if (row.sixthsPerUnit != null) return formatEncumbrance({ kind: 'fixed', sixths: Math.max(0, row.sixthsPerUnit) })
  return 'Custom'
}

const renderAddItemsRows = (): void => {
  const rowsEl = addItemsDialog.querySelector<HTMLElement>('#add-items-match-results')
  const statusEl = addItemsDialog.querySelector<HTMLElement>('#add-items-status')
  const applyBtn = addItemsDialog.querySelector<HTMLButtonElement>('#add-items-apply')
  if (!rowsEl || !statusEl || !applyBtn) return

  if (addItemsError) {
    statusEl.textContent = addItemsError
    statusEl.className = 'add-items-status add-items-status-error'
    rowsEl.innerHTML = ''
    applyBtn.disabled = true
    return
  }

  if (addItemsRows.length === 0) {
    statusEl.textContent = 'Paste JSON output to validate and resolve item matches.'
    statusEl.className = 'add-items-status'
    rowsEl.innerHTML = ''
    applyBtn.disabled = true
    return
  }

  const reviewGuess = addItemsRows.filter((row) => row.status !== 'resolved').length
  statusEl.textContent = `${addItemsRows.length} rows • ${reviewGuess} best-guess (pre-selected; review if needed)`
  statusEl.className = reviewGuess > 0 ? 'add-items-status add-items-status-warn' : 'add-items-status add-items-status-ok'

  rowsEl.innerHTML = addItemsRows
    .map((row) => {
      const catalogPills = row.alternatives
        .map(
          (a) =>
            `<button class="alt-pill alt-pill-tile ${a.itemId === row.itemDefId ? 'alt-pill-selected' : ''}" data-add-items-key="${escapeAttr(row.overrideKey)}" data-item-id="${escapeHtml(a.itemId)}" type="button"><span class="alt-pill-title">${escapeHtml(a.itemName)}</span><span class="alt-pill-meta">${escapeHtml(catalogEncMeta(a.itemId))}</span></button>`,
        )
        .join('')
      const customPill = `<button class="alt-pill alt-pill-tile ${row.itemDefId?.startsWith('custom:') ? 'alt-pill-selected' : ''}" data-add-items-key="${escapeAttr(row.overrideKey)}" data-item-id="${escapeHtml(CUSTOM_ITEM_ID)}" type="button"><span class="alt-pill-title">Custom</span><span class="alt-pill-meta">${escapeHtml(addItemsCustomTileMeta(row))}</span></button>`
      const wornTag = row.wornClothing ? `<span class="parsed-qty">worn clothing</span>` : ''
      const valueTag =
        row.valueGp != null ? `<span class="parsed-qty">LLM ${escapeHtml(String(row.valueGp))} gp</span>` : ''
      const hintRow = row.prototypeName
        ? `<div class="add-items-hint">Match hint: ${escapeHtml(row.prototypeName)}</div>`
        : ''
      const reallyRow =
        row.prototypeName &&
        row.itemDefId &&
        !row.itemDefId.startsWith('custom:') &&
        row.itemName.trim().toLowerCase() !== row.prototypeName.trim().toLowerCase()
          ? `<div class="add-items-really">e.g. really: ${escapeHtml(row.prototypeName)}</div>`
          : ''
      return `<div class="parsed-item status-${row.status}" data-add-items-row="${escapeAttr(row.overrideKey)}">
        <div class="parsed-head">
          <span class="parsed-status">${row.status}</span>
          <span class="parsed-qty">qty ${row.quantity}</span>
          ${wornTag}
          ${valueTag}
          <span class="parsed-conf">${Math.round(row.confidence * 100)}%</span>
        </div>
        <div class="parsed-text">${escapeHtml(row.raw)}</div>
        ${hintRow}
        <div class="parsed-candidate">
          <span class="parsed-display-name">${escapeHtml(row.itemName)}</span>
          ${reallyRow}
          <div class="alt-pills">${catalogPills}${customPill}</div>
        </div>
      </div>`
    })
    .join('')

  const canApply = addItemsRows.every((row) => !!row.itemDefId)
  applyBtn.disabled = !canApply
}

const applyAddItemsRowsToNode = (rows: readonly ParsedAddItemsRow[], mode: 'auto' | 'manual'): void => {
  if (!addItemsTargetNodeId) return
  const spawnRows = rows.filter((row) => row.itemDefId)
  const items = spawnRows.map((row) => {
    const wornCustomId = `custom:worn-${slugify(row.itemName || row.raw || row.id)}`
    if (row.wornClothing) {
      return {
        itemDefId: wornCustomId,
        itemName: row.itemName,
        quantity: row.quantity,
        sixthsPerUnit: 0,
        itemKind: 'standard',
        armorClass: undefined,
        wornClothing: true,
        zoneHint: 'worn' as const,
      }
    }
    const catRow = row.itemDefId && !row.itemDefId.startsWith('custom:') ? addItemsCatalogById.get(row.itemDefId) : null
    const sourceItem = row.itemDefId && !row.itemDefId.startsWith('custom:') ? sourceItemById.get(row.itemDefId) : null
    const derived = catRow
      ? deriveItemKindFromCatalogRow(catRow)
      : sourceItem
        ? deriveItemKind(sourceItem)
        : { kind: 'standard', sixthsPerUnit: row.sixthsPerUnit ?? 1 }
    return {
      itemDefId: row.itemDefId!,
      itemName: row.itemName,
      quantity: row.quantity,
      sixthsPerUnit: row.sixthsPerUnit ?? derived.sixthsPerUnit,
      itemKind: derived.kind,
      armorClass: derived.armorClass,
      wornClothing: row.wornClothing,
      zoneHint: row.zoneHint,
    }
  })
  postToWorker({
    type: 'INTENT',
    intent: {
      type: 'APPLY_ADD_ITEMS_OP',
      targetNodeId: addItemsTargetNodeId,
      items,
    },
  })
  addItemsDialog.close(mode === 'auto' ? 'auto' : 'manual')
}

const refreshAddItemsParsed = (): void => {
  const parsed = parseAddItemsRowsFromJson(addItemsJson, cachedItemCatalogRows ?? [])
  addItemsError = parsed.error
  addItemsRows = parsed.rows
  renderAddItemsRows()
}

const showAddItemsDialog = (nodeId: string, nodeTitle: string): void => {
  addItemsTargetNodeId = nodeId
  addItemsRows = []
  addItemsError = null
  addItemsJson = ''
  addItemsDescription = ''
  Object.keys(addItemsDisambiguationOverrides).forEach((k) => delete addItemsDisambiguationOverrides[k])

  addItemsDialog.innerHTML = `
    <form method="dialog" class="add-items-form">
      <div class="add-items-header">
        <div>
          <div class="add-items-title">Add Items</div>
          <div class="add-items-subtitle">Target: ${escapeHtml(nodeTitle)}</div>
        </div>
        <button type="button" class="tool-button" id="add-items-close">Close</button>
      </div>
      <label class="tool-label" for="add-items-description">Description for LLM</label>
      <textarea id="add-items-description" class="tool-textarea add-items-input" rows="5" placeholder="Describe items, treasure, nodes, or operations."></textarea>
      <div class="add-items-actions">
        <button type="button" class="tool-button" id="add-items-copy-prompt">Copy Prompt for LLM</button>
      </div>
      <label class="tool-label" for="add-items-json">Paste LLM output (raw JSON or a ${'```'}json code block)</label>
      <textarea id="add-items-json" class="tool-textarea add-items-json" rows="10" placeholder="${'```json&#10;{ "schema": "vtt.inventory.ops.v1", "ops": [...] }&#10;```'}"></textarea>
      <div id="add-items-status" class="add-items-status"></div>
      <div id="add-items-match-results" class="parsed-list add-items-results"></div>
      <div class="add-items-actions add-items-actions-end">
        <button type="button" class="tool-button" id="add-items-apply">Apply</button>
      </div>
    </form>
  `

  addItemsDialog.querySelector<HTMLButtonElement>('#add-items-close')?.addEventListener('click', () => addItemsDialog.close())
  addItemsDialog.querySelector<HTMLTextAreaElement>('#add-items-description')?.addEventListener('input', (e) => {
    addItemsDescription = (e.target as HTMLTextAreaElement).value
  })
  addItemsDialog.querySelector<HTMLButtonElement>('#add-items-copy-prompt')?.addEventListener('click', async () => {
    try {
      let rows = cachedItemCatalogRows ?? []
      if (rows.length === 0) {
        rows = [...await fetchItemCatalogFromWorker()]
        cachedItemCatalogRows = rows
      }
      const prompt = buildInventoryLlmPrompt({ userDescription: addItemsDescription, catalogRows: rows })
      try {
        await navigator.clipboard.writeText(prompt)
        addItemsError = null
      } catch {
        addItemsError = 'Clipboard copy failed. Copy manually from devtools if needed.'
      }
    } catch (e) {
      addItemsError = e instanceof Error ? e.message : 'Could not load catalog or build prompt.'
    }
    renderAddItemsRows()
  })
  addItemsDialog.querySelector<HTMLTextAreaElement>('#add-items-json')?.addEventListener('input', (e) => {
    addItemsJson = (e.target as HTMLTextAreaElement).value
    refreshAddItemsParsed()
  })
  addItemsDialog.querySelector<HTMLButtonElement>('#add-items-apply')?.addEventListener('click', () => {
    if (addItemsRows.length === 0) return
    const canApply = addItemsRows.every((row) => !!row.itemDefId)
    if (!canApply) return
    applyAddItemsRowsToNode(addItemsRows, 'manual')
  })
  addItemsDialog.querySelector<HTMLElement>('#add-items-match-results')?.addEventListener('click', (e) => {
    const target = e.target as HTMLElement
    const pill = target.closest<HTMLElement>('.alt-pill[data-add-items-key][data-item-id]')
    if (!pill) return
    const key = pill.dataset.addItemsKey
    const itemId = pill.dataset.itemId
    if (!key || !itemId) return
    addItemsDisambiguationOverrides[key] = itemId
    refreshAddItemsParsed()
  })

  renderAddItemsRows()
  void fetchItemCatalogFromWorker()
    .then((rows) => {
      cachedItemCatalogRows = [...rows]
      if (addItemsError?.startsWith('Could not load world item catalog')) {
        addItemsError = null
      }
      refreshAddItemsParsed()
      renderAddItemsRows()
    })
    .catch(() => {
      addItemsError = 'Could not load world item catalog. Matches use Custom until catalog loads; retry or reopen.'
      renderAddItemsRows()
    })

  addItemsDialog.showModal()
}

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
        : (item.sixthsPerUnit ?? 1)
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

document.querySelector<HTMLButtonElement>('#reset-data-btn')!.addEventListener('click', () => {
  if (!confirm('Reset all data to sample state? This cannot be undone.')) return
  const stonesPerRow = Number(stonesPerRowEl.value ?? 25)
  postToWorker({ type: 'RESET', worldState: sampleState, stonesPerRow })
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

toolTextBtnEl?.addEventListener('click', () => {
  activeCanvasTool = activeCanvasTool === 'text' ? 'select' : 'text'
  renderCanvasToolUI()
})

window.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') {
    if (accountMenuOpen) {
      closeAccountMenu()
      return
    }
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
    return
  }
  if ((event.key === 'Delete' || event.key === 'Backspace') && selectedLabelId) {
    const active = document.activeElement
    if (active?.tagName === 'INPUT' || active?.tagName === 'TEXTAREA') return
    event.preventDefault()
    postToWorker({ type: 'INTENT', intent: { type: 'DELETE_LABEL', labelId: selectedLabelId } })
    selectedLabelId = null
    syncLabelEditor()
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
