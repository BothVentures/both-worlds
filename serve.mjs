#!/usr/bin/env node
// Minimal static server for app/dist (no dependencies). Picks the first free port from 4173.
import { createServer } from 'node:http'
import { readFile, stat } from 'node:fs/promises'
import { createServer as net } from 'node:net'
import { extname, join, normalize, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { exec } from 'node:child_process'

const root = join(dirname(fileURLToPath(import.meta.url)), 'app', 'dist')
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.json': 'application/json', '.png': 'image/png' }

const free = (p) => new Promise((res) => { const s = net().once('error', () => res(false)).once('listening', () => s.close(() => res(true))).listen(p, '127.0.0.1') })
let port = 4173
while (!(await free(port))) port++

createServer(async (req, res) => {
  try {
    let p = normalize(decodeURIComponent((req.url || '/').split('?')[0]))
    if (p.endsWith('/')) p += 'index.html'
    const file = join(root, p)
    if (!file.startsWith(root)) throw new Error('forbidden')
    await stat(file)
    res.writeHead(200, { 'Content-Type': types[extname(file)] || 'application/octet-stream' })
    res.end(await readFile(file))
  } catch {
    res.writeHead(404); res.end('not found')
  }
}).listen(port, '127.0.0.1', () => {
  const url = `http://127.0.0.1:${port}/`
  console.log(`BOTH WORLDS → ${url}   (Ctrl+C para cerrar)`)
  const open = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'start' : 'xdg-open'
  exec(`${open} ${url}`)
})
