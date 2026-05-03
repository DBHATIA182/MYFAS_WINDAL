import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

/** Console hint so the terminal cwd is obviously WINDAL, not GFASORCL. */
function windalDevBannerPlugin() {
  return {
    name: 'windal-dev-banner',
    configureServer(server) {
      server.httpServer?.once('listening', () => {
        console.log(`\x1b[32m[WINDAL APPTEST]\x1b[0m Vite cwd: \x1b[1m${process.cwd()}\x1b[0m`)
        console.log(
          '\n\x1b[32m[WINDAL APPTEST]\x1b[0m Vite is running on \x1b[1mport 5174\x1b[0m (5173 is often another clone, e.g. GRAINFAS).\n' +
            'Open: \x1b[1mhttp://localhost:5174\x1b[0m — title should be Windal Accounting; dev header shows green WINDAL APPTEST.\n' +
            'Marker file: \x1b[1mhttp://localhost:5174/windal-appmarker.txt\x1b[0m → plain text WINDAL_APPTEST (not the sign-in page).\n'
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
    // Forward /api to Node (npm run server). Use 5174 so another app can keep 5173 (e.g. GFASORCL).
    proxy: {
      '/api': {
        target: 'http://localhost:5001',
        changeOrigin: true,
      },
    },
  }
})