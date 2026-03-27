/** Base URL for the image upload Cloudflare Worker. Set via VITE_IMAGE_WORKER_URL env var. */
export const IMAGE_WORKER_URL: string =
  (import.meta as any).env?.VITE_IMAGE_WORKER_URL ?? 'https://vtt-images.mike-d-gai.workers.dev'

/** API key for authenticating with the image worker. Set via VITE_IMAGE_API_KEY env var. */
export const IMAGE_API_KEY: string =
  (import.meta as any).env?.VITE_IMAGE_API_KEY ?? ''
