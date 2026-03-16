/**
 * 2D spring animation - based on react-spring's critically damped spring.
 * Used for smooth segment position transitions.
 */

export type SpringConfig = {
  stiffness: number
  damping: number
  precision: number
}

export type Spring2DState = {
  x: number
  y: number
  vx: number
  vy: number
  targetX: number
  targetY: number
  active: boolean
}

const DEFAULT_CONFIG: SpringConfig = {
  stiffness: 170,
  damping: 26,
  precision: 0.5,
}

export const createSpring2D = (x: number, y: number): Spring2DState => ({
  x,
  y,
  vx: 0,
  vy: 0,
  targetX: x,
  targetY: y,
  active: false,
})

export const setSpringTarget = (
  state: Spring2DState,
  targetX: number,
  targetY: number,
): void => {
  state.targetX = targetX
  state.targetY = targetY
  state.active = true
}

export const updateSpring2D = (
  state: Spring2DState,
  dt: number,
  config: SpringConfig = DEFAULT_CONFIG,
): boolean => {
  if (!state.active) return false

  const { stiffness, damping, precision } = config
  const dx = state.targetX - state.x
  const dy = state.targetY - state.y

  const ax = stiffness * dx - damping * state.vx
  const ay = stiffness * dy - damping * state.vy

  state.vx += ax * dt
  state.vy += ay * dt
  state.x += state.vx * dt
  state.y += state.vy * dt

  const dist = Math.sqrt(dx * dx + dy * dy)
  const speed = Math.sqrt(state.vx * state.vx + state.vy * state.vy)

  if (dist < precision && speed < precision) {
    state.x = state.targetX
    state.y = state.targetY
    state.vx = 0
    state.vy = 0
    state.active = false
  }
  return state.active
}

export type Spring1DState = {
  value: number
  velocity: number
  target: number
  active: boolean
}

export const createSpring1D = (value: number): Spring1DState => ({
  value,
  velocity: 0,
  target: value,
  active: false,
})

export const setSpring1DTarget = (state: Spring1DState, target: number): void => {
  state.target = target
  state.active = true
}

export const updateSpring1D = (
  state: Spring1DState,
  dt: number,
  config: SpringConfig = DEFAULT_CONFIG,
): boolean => {
  if (!state.active) return false

  const { stiffness, damping, precision } = config
  const dx = state.target - state.value
  const ax = stiffness * dx - damping * state.velocity

  state.velocity += ax * dt
  state.value += state.velocity * dt

  if (Math.abs(dx) < precision && Math.abs(state.velocity) < precision) {
    state.value = state.target
    state.velocity = 0
    state.active = false
  }
  return state.active
}
