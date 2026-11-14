// The installed app opens offline from a cached copy of itself.
// Only this app's own files are cached, its typefaces included. API calls (Supabase,
// Square) go to other origins and are never cached here, so stock and order
// status always come from the server or the app's own saved copies.

const CACHE = 'dibspot-v1'
const SHELL = '/'
const STATIC_FILES = [
  '/manifest.webmanifest',
  '/icon.svg',
  '/apple-touch-icon.png',
  '/icon-192.png',
  '/icon-512.png',
  '/icon-maskable-512.png',
  // The design system's typefaces (src/fonts.css), so the first offline launch already reads in them.
  '/fonts/gabarito/gabarito-latin.woff2',
  '/fonts/atkinson-hyperlegible-next/atkinson-hyperlegible-next-latin.woff2',
  '/fonts/atkinson-hyperlegible-mono/atkinson-hyperlegible-mono-latin.woff2',
]

// The built bundle has content-hashed names that this file cannot know in
// advance, so they are read from the shell's own <script> and <link> tags, and
// from its <meta name="precache"> list (vite.config.ts), which also names the
// screens the app downloads on demand, so those open offline too.
function assetUrls(html) {
  const urls = new Set()
  for (const match of html.matchAll(/(?:src|href)="(\/assets\/[^"]+)"/g)) urls.add(match[1])
  const precache = html.match(/<meta name="precache" content="([^"]*)"/)
  for (const url of precache ? precache[1].split(' ') : []) if (url.startsWith('/assets/')) urls.add(url)
  return [...urls]
}

// A redirected or failed response must never become the offline shell:
// browsers refuse a redirected response for a navigation, and an error page
// would be shown on every later offline launch.
function storable(response) {
  return response.ok && !response.redirected && response.type === 'basic'
}

// Stores the shell and exactly the assets it references, and drops assets from
// older deploys, so the offline copy is always one consistent build.
async function cacheShell(response) {
  const cache = await caches.open(CACHE)
  const html = await response.clone().text()
  const wanted = assetUrls(html)
  await Promise.all(
    wanted.map(async (url) => {
      if (await cache.match(url, { ignoreVary: true })) return
      const asset = await fetch(url)
      if (storable(asset)) await cache.put(url, asset)
    }),
  )
  await cache.put(SHELL, response)
  const keys = await cache.keys()
  await Promise.all(
    keys
      .filter((request) => new URL(request.url).pathname.startsWith('/assets/'))
      .filter((request) => !wanted.includes(new URL(request.url).pathname))
      .map((request) => cache.delete(request)),
  )
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE)
      await cache.addAll(STATIC_FILES)
      const shell = await fetch(SHELL, { cache: 'reload' })
      if (storable(shell)) await cacheShell(shell)
    })(),
  )
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  // Every other cache goes: older versions of this one, and any a previous version of the worker made.
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  )
})

self.addEventListener('fetch', (event) => {
  const { request } = event
  const url = new URL(request.url)
  if (request.method !== 'GET') return

  if (url.origin !== self.location.origin) return

  // Pages: network first so a deploy shows up at once; offline falls back to
  // the cached shell, and the router then renders the requested route.
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (storable(response)) event.waitUntil(cacheShell(response.clone()))
          return response
        })
        .catch(async () => (await caches.match(SHELL)) ?? Response.error()),
    )
    return
  }

  // Hashed bundle files never change under the same name: cache first. The page
  // requests them with crossorigin, so a stored copy fetched without an Origin
  // header would miss under `Vary: Origin`; the hashed name alone identifies it.
  if (url.pathname.startsWith('/assets/')) {
    event.respondWith(
      caches.match(url.pathname, { ignoreVary: true }).then(
        (cached) =>
          cached ??
          fetch(request).then((response) => {
            if (storable(response)) {
              const copy = response.clone()
              event.waitUntil(caches.open(CACHE).then((cache) => cache.put(request, copy)))
            }
            return response
          }),
      ),
    )
    return
  }

  // Other files (product images, icons) can change under the same name: show
  // the saved copy at once and refresh it in the background.
  event.respondWith(
    caches.match(request, { ignoreVary: true }).then((cached) => {
      const refresh = fetch(request).then((response) => {
        if (storable(response)) {
          const copy = response.clone()
          event.waitUntil(caches.open(CACHE).then((cache) => cache.put(request, copy)))
        }
        return response
      })
      if (cached) {
        event.waitUntil(refresh.catch(() => undefined))
        return cached
      }
      return refresh
    }),
  )
})
