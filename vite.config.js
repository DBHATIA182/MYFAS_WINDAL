import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

const truthyEnv = (v) => ['1', 'true', 'yes', 'on'].includes(String(v || '').trim().toLowerCase())

/** Set WINDAL_TUNNEL_DEV=1 when using Cloudflare Tunnel or phone on dal-demo — disables HMR (fixes blank/intermittent mobile). */
const windalTunnelDev = truthyEnv(process.env.WINDAL_TUNNEL_DEV)
const API_PROXY_TARGET = 'http://127.0.0.1:5001'

/** Drop @vite/client when tunneling — must run after Vite injects the tag (enforce: post). */
function windalTunnelIndexPlugin() {
  return {
    name: 'windal-tunnel-index',
    enforce: 'post',
    transformIndexHtml(html) {
      if (!windalTunnelDev) return html
      return html.replace(/<script[^>]*src="\/@vite\/client"[^>]*><\/script>\s*/gi, '')
    },
  }
}

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
        const port = server.config.server.port
        console.log(
          `\n\x1b[32m[WINDAL APPTEST]\x1b[0m Vite DEV port \x1b[1m${port}\x1b[0m (dal-demo / phone uses \x1b[1m5174\x1b[0m preview only — Windal_Start_Services.bat).\n` +
            'API proxy: /api → ' +
            API_PROXY_TARGET +
            ' — start API: npm run server\n'
        )
      })
    },
  }
}

/** 5174 = tunnel / phone (vite preview only). 5175 = local npm run dev — never use 5174 for dev. */
const TUNNEL_WEB_PORT = 5174
const LOCAL_DEV_PORT = 5175

export default defineConfig(({ command }) => {
  const isPreview = command === 'preview'
  return {
    plugins: [react(), ...(isPreview ? [] : [windalTunnelIndexPlugin()]), windalDevBannerPlugin()],
    resolve: {
      dedupe: ['react', 'react-dom'],
    },
    server: {
      port: LOCAL_DEV_PORT,
      strictPort: true,
      allowedHosts: true,
      ...(windalTunnelDev ? { hmr: false } : {}),
      proxy: {
        '/api': {
          target: API_PROXY_TARGET,
          changeOrigin: true,
        },
      },
    },
    preview: {
      host: '0.0.0.0',
      port: TUNNEL_WEB_PORT,
      strictPort: true,
      allowedHosts: true,
      proxy: {
        '/api': {
          target: API_PROXY_TARGET,
          changeOrigin: true,
        },
      },
    },
  }
})