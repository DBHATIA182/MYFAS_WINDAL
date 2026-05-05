import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

const truthyEnv = (v) => ['1', 'true', 'yes', 'on'].includes(String(v || '').trim().toLowerCase())

/** Set WINDAL_TUNNEL_DEV=1 (see start-services batch files) when opening via Cloudflare Tunnel — disables HMR so the page stays stable behind HTTPS/proxy. */
const windalTunnelDev = truthyEnv(process.env.WINDAL_TUNNEL_DEV)

/** Console hint so the terminal cwd is obviously WINDAL, not GFASORCL. */
function windalDevBannerPlugin() {
  return {
    name: 'windal-dev-banner',
    configureServer(server) {
      server.httpServer?.once('listening', () => {
        console.log(`\x1b[32m[WINDAL APPTEST]\x1b[0m Vite cwd: \x1b[1m${process.cwd()}\x1b[0m`)
        if (windalTunnelDev) {
          console.log(
            '\n\x1b[33m[WINDAL APPTEST]\x1b[0m \x1b[1mWINDAL_TUNNEL_DEV=1\x1b[0m — WebSocket HMR disabled (recommended for dal-rgind… via Cloudflare Tunnel).\n',
          )
        }
        console.log(
          '\n\x1b[32m[WINDAL APPTEST]\x1b[0m Default port \x1b[1m5174\x1b[0m (5173 is often another clone). Override with `--port …`.\n' +
            'Open: same port on localhost — title Windal Accounting; dev header green WINDAL APPTEST.\n' +
            '`/windal-appmarker.txt` → plain text WINDAL_APPTEST.\n'
        )
      })
    },
  }
}

export default defineConfig({
  plugins: [react(), windalDevBannerPlugin()],
  resolve: {
    dedupe: ['react', 'react-dom'],
  },
  server: {
    port: 5174,
    strictPort: true,
    allowedHosts: true,
    ...(windalTunnelDev ? { hmr: false } : {}),
    // Forward /api to Node (npm run server). Use 5174 so another app can keep 5173 (e.g. GFASORCL).
    proxy: {
      '/api': {
        target: 'http://localhost:5001',
        changeOrigin: true,
      },
    },
  }
})