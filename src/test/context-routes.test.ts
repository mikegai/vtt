import { describe, expect, it } from 'vitest'
import {
  canonicalPathForRoute,
  deterministicUuidFromString,
  parseAppRoute,
  worldCanvasContextFromRoute,
} from '../spacetimedb/context'

describe('parseAppRoute', () => {
  it('treats one segment as hub', () => {
    expect(parseAppRoute('/my-world')).toEqual({ mode: 'hub', worldSlug: 'my-world' })
  })

  it('normalizes world slug (lowercase, trim, collapse separators)', () => {
    expect(parseAppRoute('/  FOO  Bar  /')).toEqual({ mode: 'hub', worldSlug: 'foo-bar' })
  })

  it('treats two segments as canvas', () => {
    expect(parseAppRoute('/my-world/arena')).toEqual({
      mode: 'canvas',
      worldSlug: 'my-world',
      canvasSlug: 'arena',
    })
  })

  it('defaults empty path to default world hub', () => {
    expect(parseAppRoute('/')).toEqual({ mode: 'hub', worldSlug: 'default-world' })
  })

  it('ignores extra path segments for routing mode', () => {
    expect(parseAppRoute('/w/c/extra')).toEqual({ mode: 'canvas', worldSlug: 'w', canvasSlug: 'c' })
  })
})

describe('canonicalPathForRoute', () => {
  it('omits canvas slug for hub', () => {
    expect(canonicalPathForRoute({ mode: 'hub', worldSlug: 'foo' })).toBe('/foo')
  })

  it('includes canvas for canvas route', () => {
    expect(canonicalPathForRoute({ mode: 'canvas', worldSlug: 'foo', canvasSlug: 'bar' })).toBe('/foo/bar')
  })
})

describe('worldCanvasContextFromRoute', () => {
  it('uses main canvas slug for hub and preserves ids', () => {
    const worldId = deterministicUuidFromString('world:x')
    const canvasId = deterministicUuidFromString('canvas:x:main')
    expect(worldCanvasContextFromRoute({ mode: 'hub', worldSlug: 'x' }, worldId, canvasId)).toEqual({
      worldId,
      canvasId,
      worldSlug: 'x',
      canvasSlug: 'main',
    })
  })
})
