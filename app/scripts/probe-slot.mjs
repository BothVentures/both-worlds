#!/usr/bin/env node
// Sonda de layout (2026-10-25): para una posición del territorio Bienal Orch, cuenta etiquetas
// visibles en el mundo y dentro de Both Ventures, a 1920×1080 y 1440×900 — los mismos criterios
// que e2e.mjs. Uso: node scripts/probe-slot.mjs [url]
import { chromium } from 'playwright'
const url = process.argv[2] ?? 'http://127.0.0.1:4173/'
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] })
const settle = async (page) => {
  await page.waitForFunction(() => window.__world && !window.__world.director.busy, null, { timeout: 20000 }).catch(() => {})
  await page.waitForTimeout(250)
  await page.waitForFunction(() => [...document.querySelectorAll('.lbl.lbl-on:not(.hid)')].every((e) => getComputedStyle(e).opacity === '1'), null, { timeout: 20000 }).catch(() => {})
}
const vis = (page, sel) => page.$$eval(sel, (els) => els.filter((e) => e.classList.contains('lbl-on') && !e.classList.contains('hid') && getComputedStyle(e).visibility !== 'hidden').map((e) => e.dataset.id))
const out = []
for (const [w, h] of [[1920, 1080], [1440, 900]]) {
  const page = await browser.newPage({ viewport: { width: w, height: h } })
  await page.goto(url + '#/x/world', { waitUntil: 'load' }); await page.waitForTimeout(1500); await settle(page)
  const l1 = await vis(page, '.lbl-l1')
  await page.click('.lbl-l1[data-id="t-both-ventures"]', { force: true }); await settle(page)
  const l2 = await vis(page, '.lbl-l2')
  out.push(`${w}x${h}: mundo ${l1.length}/4 · Both Ventures ${l2.length}/10 (${l2.join(' ')})`)
  await page.close()
}
console.log(out.join('\n'))
await browser.close()
