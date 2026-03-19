/**
 * Non-native tooltip: shows immediately on hover, no built-in delay.
 * Single shared element, reused for all tooltips.
 */

const tooltipEl = document.createElement('div')
tooltipEl.setAttribute('role', 'tooltip')
Object.assign(tooltipEl.style, {
  position: 'fixed',
  zIndex: '99999',
  padding: '6px 10px',
  fontSize: '12px',
  fontFamily: 'system-ui, -apple-system, sans-serif',
  color: '#e2eaff',
  background: 'rgba(6, 11, 24, 0.96)',
  border: '1px solid rgba(63, 95, 153, 0.9)',
  borderRadius: '6px',
  boxShadow: '0 4px 12px rgba(0,0,0,0.4)',
  pointerEvents: 'none',
  whiteSpace: 'nowrap',
  maxWidth: '280px',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  opacity: '0',
  transition: 'opacity 0.08s ease-out',
  visibility: 'hidden',
} as Partial<CSSStyleDeclaration>)
document.body.appendChild(tooltipEl)

const OFFSET = 8
const PADDING = 16

function show(text: string, anchorRect: DOMRect): void {
  tooltipEl.textContent = text
  tooltipEl.style.visibility = 'visible'
  tooltipEl.style.opacity = '1'

  const rect = tooltipEl.getBoundingClientRect()
  const viewW = window.innerWidth
  const viewH = window.innerHeight

  let x = anchorRect.left + anchorRect.width / 2 - rect.width / 2
  let y = anchorRect.top - rect.height - OFFSET

  if (y < PADDING) {
    y = anchorRect.bottom + OFFSET
  }
  if (x < PADDING) x = PADDING
  if (x + rect.width > viewW - PADDING) x = viewW - rect.width - PADDING
  if (y + rect.height > viewH - PADDING) y = viewH - rect.height - PADDING

  tooltipEl.style.left = `${x}px`
  tooltipEl.style.top = `${y}px`
}

function hide(): void {
  tooltipEl.style.opacity = '0'
  tooltipEl.style.visibility = 'hidden'
}

/**
 * Attach a custom tooltip to an element. Replaces native title behavior with immediate show.
 */
export function attachTooltip(element: HTMLElement, text: string): void {
  element.removeAttribute('title')
  element.setAttribute('aria-label', text)

  const onEnter = () => show(text, element.getBoundingClientRect())
  const onLeave = () => hide()

  element.addEventListener('mouseenter', onEnter)
  element.addEventListener('mouseleave', onLeave)
}
