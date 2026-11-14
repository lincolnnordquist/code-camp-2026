import react from '@vitejs/plugin-react'
import type { Plugin } from 'vite'
import { defineConfig } from 'vitest/config'

/**
 * Names every built file under assets/ in a <meta name="precache"> tag. The screens loaded on demand
 * (React.lazy in App.tsx) are not linked from the page, so public/sw.js reads this list to store
 * them too, and every screen still opens offline.
 */
function precacheList(): Plugin {
  return {
    name: 'precache-list',
    apply: 'build',
    transformIndexHtml: {
      order: 'post',
      handler(_html, { bundle }) {
        if (!bundle) return
        const files = Object.keys(bundle).filter((file) => file.startsWith('assets/') && !file.endsWith('.map'))
        return [{ tag: 'meta', attrs: { name: 'precache', content: files.map((file) => `/${file}`).join(' ') }, injectTo: 'head' }]
      },
    },
  }
}

/**
 * The on-demand screens (React.lazy in App.tsx) by path, mirroring App.tsx's routes. Keep the two
 * in step: a screen missing here still works, it just downloads after the app code, not with it.
 */
const ROUTE_SCREENS: Array<[path: RegExp, screen: string]> = [
  [/^\/e\/[^/]+\/map\/?$/, 'src/features/discover/MapPage.tsx'],
  [/^\/e\/[^/]+\/booths\/?$/, 'src/features/discover/BoothsPage.tsx'],
  [/^\/e\/[^/]+\/booth\/[^/]+\/?$/, 'src/features/discover/Storefront.tsx'],
  [/^\/e\/[^/]+\/cart\/?$/, 'src/features/order/CartPage.tsx'],
  [/^\/e\/[^/]+\/cart\/checkout\/?$/, 'src/features/order/CheckoutPage.tsx'],
  [/^\/orders\/?$/, 'src/features/order/MyOrders.tsx'],
  [/^\/(orders|o)\/[^/]+\/?$/, 'src/features/order/OrderPage.tsx'],
]

/**
 * A page opened straight on an on-demand screen (an order link from a text message, a reload on
 * the orders tab) would fetch the screen's code only after the app code ran: one more round trip
 * on a slow connection. This inline script asks for that screen's files alongside the app code.
 */
function routeModulePreload(): Plugin {
  return {
    name: 'route-modulepreload',
    apply: 'build',
    transformIndexHtml: {
      order: 'post',
      handler(_html, { bundle }) {
        if (!bundle) return
        const chunks = Object.values(bundle).filter((output) => output.type === 'chunk')
        const entry = chunks.find((chunk) => chunk.isEntry)
        const initial = new Set([entry?.fileName, ...(entry?.imports ?? [])])
        const filesOf = (fileName: string, seen = new Set<string>()): string[] => {
          if (initial.has(fileName) || seen.has(fileName)) return []
          seen.add(fileName)
          const chunk = chunks.find((c) => c.fileName === fileName)
          return [`/${fileName}`, ...(chunk?.imports ?? []).flatMap((file) => filesOf(file, seen))]
        }
        const routes = ROUTE_SCREENS.flatMap(([path, screen]) => {
          const chunk = chunks.find((c) => c.facadeModuleId?.endsWith(`/${screen}`))
          return chunk ? [`[${path},${JSON.stringify(filesOf(chunk.fileName))}]`] : []
        })
        const script = `for(const[p,f]of[${routes.join(',')}])if(p.test(location.pathname)){for(const h of f){const l=document.createElement('link');l.rel='modulepreload';l.href=h;document.head.append(l)}break}`
        return [{ tag: 'script', children: script, injectTo: 'head' }]
      },
    },
  }
}

/**
 * React and the router change only when a dependency is bumped, so they ship as
 * their own chunk that stays cached (by the browser and the service worker) across app deploys.
 * Listed by name: a broad node_modules test would also pull qrcode out of the pickup screens' chunk.
 */
const VENDOR_MODULES = /[\\/]node_modules[\\/](react|react-dom|scheduler|react-router|react-router-dom|cookie|set-cookie-parser)[\\/]/

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), precacheList(), routeModulePreload()],
  test: {
    // Screen tests sit next to their components; each sets its own jsdom environment.
    include: ['tests/**/*.test.ts', 'src/**/*.test.{ts,tsx}'],
    environment: 'node',
  },
  build: {
    rolldownOptions: {
      output: {
        codeSplitting: {
          groups: [
            { name: 'vendor', test: VENDOR_MODULES, priority: 2 },
            // Everything the first screen needs in one file, rather than a few small shared pieces
            // that each cost a request on a slow phone connection before anything paints.
            { name: 'app', tags: ['$initial'], priority: 1 },
          ],
        },
      },
    },
  },
})
