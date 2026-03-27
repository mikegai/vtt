export interface Env {
  IMAGES: R2Bucket
  API_KEY: string
}

const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, OPTIONS',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type',
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
  })
}

function unauthorized(): Response {
  return json({ error: 'Unauthorized' }, 401)
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS_HEADERS })
    }

    const url = new URL(request.url)

    // POST /upload-url — return a presigned-style upload target
    if (request.method === 'POST' && url.pathname === '/upload-url') {
      const auth = request.headers.get('Authorization')
      if (!auth || auth !== `Bearer ${env.API_KEY}`) {
        return unauthorized()
      }

      const body = await request.json<{ contentType?: string; filename?: string; hash?: string }>()
      const contentType = body.contentType || 'application/octet-stream'
      const ext = extensionFromContentType(contentType)
      // Use content hash as key for dedup, fall back to UUID
      const objectKey = body.hash ? `${body.hash}${ext}` : `${crypto.randomUUID()}${ext}`

      // Check if object already exists (dedup)
      const existing = body.hash ? await env.IMAGES.head(objectKey) : null
      if (existing) {
        const publicUrl = `${url.origin}/image/${objectKey}`
        return json({ uploadUrl: '', publicUrl, objectKey, contentType, skipped: true })
      }

      const uploadUrl = `${url.origin}/upload/${objectKey}`
      const publicUrl = `${url.origin}/image/${objectKey}`

      return json({ uploadUrl, publicUrl, objectKey, contentType })
    }

    // PUT /upload/:key — receive the file and store in R2
    if (request.method === 'PUT' && url.pathname.startsWith('/upload/')) {
      const auth = request.headers.get('Authorization')
      if (!auth || auth !== `Bearer ${env.API_KEY}`) {
        return unauthorized()
      }

      const objectKey = url.pathname.slice('/upload/'.length)
      if (!objectKey) return json({ error: 'Missing object key' }, 400)

      const contentType = request.headers.get('Content-Type') || 'application/octet-stream'
      await env.IMAGES.put(objectKey, request.body, {
        httpMetadata: { contentType },
      })

      const publicUrl = `${url.origin}/image/${objectKey}`
      return json({ publicUrl, objectKey })
    }

    // GET or HEAD /image/:key — serve image from R2
    if ((request.method === 'GET' || request.method === 'HEAD') && url.pathname.startsWith('/image/')) {
      const objectKey = url.pathname.slice('/image/'.length)
      if (!objectKey) return json({ error: 'Missing object key' }, 400)

      const object = await env.IMAGES.get(objectKey)
      if (!object) {
        return new Response('Not found', { status: 404, headers: CORS_HEADERS })
      }

      const headers = new Headers(CORS_HEADERS)
      object.writeHttpMetadata(headers)
      headers.set('Cache-Control', 'public, max-age=31536000, immutable')
      headers.set('ETag', object.httpEtag)

      if (request.method === 'HEAD') {
        headers.set('Content-Length', String(object.size))
        return new Response(null, { headers })
      }
      return new Response(object.body, { headers })
    }

    return json({ error: 'Not found' }, 404)
  },
}

function extensionFromContentType(contentType: string): string {
  const map: Record<string, string> = {
    'image/png': '.png',
    'image/jpeg': '.jpg',
    'image/gif': '.gif',
    'image/webp': '.webp',
    'image/svg+xml': '.svg',
    'image/avif': '.avif',
  }
  return map[contentType] || ''
}
