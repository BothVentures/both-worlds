import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { viteSingleFile } from 'vite-plugin-singlefile'

// Port is fixed and strict: never steal another process' port.
// PUBLIC_BASE is set only by the Pages workflow (project sites are served from
// /<repo>/). Local dev, preview and the e2e suite keep the default '/'.
export default defineConfig(({ mode }) => ({
  base: mode === 'single' ? undefined : (process.env.PUBLIC_BASE ?? '/'),
  plugins: [react(), ...(mode === 'single' ? [viteSingleFile()] : [])],
  server: { port: 4173, strictPort: true, host: '127.0.0.1' },
  preview: { port: 4173, strictPort: true, host: '127.0.0.1' },
  build: {
    target: 'es2020',
    outDir: mode === 'single' ? 'dist-single' : 'dist',
    assetsInlineLimit: mode === 'single' ? 100000000 : 4096,
    cssCodeSplit: mode !== 'single',
    reportCompressedSize: false,
  },
}))
