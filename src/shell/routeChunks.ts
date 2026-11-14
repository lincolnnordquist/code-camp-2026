import { matchPath } from 'react-router-dom'

/** A screen whose code downloads on demand (App's lazyRoute). */
export interface RouteChunk {
  loaded: () => boolean
  /** Downloads the code; rejects when it did not arrive. Safe to call again after a failure. */
  preload: () => Promise<unknown>
}

const chunks: Array<{ patterns: readonly string[]; chunk: RouteChunk }> = []

/** Called once per on-demand screen with the route patterns it renders for. */
export function registerRouteChunk(patterns: readonly string[], chunk: RouteChunk) {
  chunks.push({ patterns, chunk })
}

/** The on-demand screen a path opens, or null for a screen in the first download. */
export function chunkFor(pathname: string): RouteChunk | null {
  return chunks.find(({ patterns }) => patterns.some((pattern) => matchPath(pattern, pathname)))?.chunk ?? null
}

/**
 * The built file of a screen's code, by its chunk name (MapPage for assets/MapPage-<hash>.js), from
 * the build's file list in <meta name="precache">. Null in development, which has no such list.
 */
export function builtChunkUrl(chunkName: string): string | null {
  const files = document.querySelector('meta[name="precache"]')?.getAttribute('content')?.split(/\s+/) ?? []
  const pattern = new RegExp(`^/assets/${chunkName}-[\\w-]+\\.js$`)
  return files.find((file) => pattern.test(file)) ?? null
}

/**
 * Downloads a screen's code again after a failure. The usual import goes first (it also brings the
 * screen's stylesheet), but WebKit keeps a failed module for the document's life and for a while
 * across reloads, failing a repeat at once without a request; then the same file under a new query
 * is a new module to it, so it is really fetched.
 */
export function retryChunk<M>(load: () => Promise<M>, chunkName: string, attempt: number): Promise<M> {
  return load().catch((error: unknown) => {
    const url = builtChunkUrl(chunkName)
    if (!url) throw error
    return import(/* @vite-ignore */ `${url}?retry=${attempt}`) as Promise<M>
  })
}

/** How long a tap waits on a screen's code with the old screen still up, before it shows the placeholders. */
export const CHUNK_WAIT_MS = 300

export type ChunkOutcome = 'loaded' | 'failed' | 'slow'

/** The code's arrival, its failure, or CHUNK_WAIT_MS passing, whichever is first. */
export function waitForChunk(chunk: RouteChunk): Promise<ChunkOutcome> {
  return Promise.race([
    // Once more on a failure: a download that failed earlier (a preload in the background) is
    // asked again for this tap, rather than the tap opening the error.
    chunk
      .preload()
      .catch(() => chunk.preload())
      .then(
        () => 'loaded' as const,
        () => 'failed' as const,
      ),
    new Promise<ChunkOutcome>((resolve) => window.setTimeout(() => resolve('slow'), CHUNK_WAIT_MS)),
  ])
}
