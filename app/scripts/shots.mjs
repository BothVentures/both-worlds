#!/usr/bin/env node
/** Fixed contact sheet for visual iteration: node scripts/shots.mjs <outDir> [url] [w] [h] */
import { chromium } from 'playwright'
import { mkdirSync } from 'node:fs'
import { resolve } from 'node:path'
const [outDir = '../verification/tmp', url = 'http://127.0.0.1:4173/', w = '1920', h = '1080'] = process.argv.slice(2)
mkdirSync(resolve(outDir), { recursive: true })
// wait for the camera tween to finish (deterministic under CPU load), then for label transitions
const settle = async (page) => {
  await page.waitForFunction(() => window.__world && !window.__world.director.busy, null, { timeout: 20000 }).catch(() => {})
  await page.waitForTimeout(250)
  // label fade-ins are CSS transitions; under a software renderer they take seconds, on a GPU they are instant
  await page.waitForFunction(() => [...document.querySelectorAll('.lbl.lbl-on:not(.hid)')].every((e) => getComputedStyle(e).opacity === '1'), null, { timeout: 20000 }).catch(() => {})
  await page.waitForTimeout(400)
}
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] })
const page = await browser.newPage({ viewport: { width: +w, height: +h }, deviceScaleFactor: 1 })
const errors = []
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()) })
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message))
const shot = (n) => page.screenshot({ path: resolve(outDir, `${n}-${w}x${h}.png`) })
const click = (sel) => page.click(sel, { timeout: 8000, force: true })
await page.goto(url, { waitUntil: 'load' })
await page.waitForTimeout(3600); await shot('01-world-tour')
await page.keyboard.press('t'); await page.waitForTimeout(600)
await click('.lbl-l1[data-id="t-both-ventures"]'); await settle(page); await shot('02-territory-bv')
await click('.lbl-l2[data-id="p-both-os"]'); await settle(page); await shot('03-project-both-os')
await click('.lbl-l3[data-id="bo-wf-auto-miner"]'); await settle(page); await shot('04-element-auto-miner')
await page.keyboard.press('Home'); await page.waitForTimeout(1200)
await click('.lbl-l1[data-id="t-lc-chaman"]'); await settle(page); await shot('05-territory-chaman')
await page.keyboard.press('t'); await page.waitForTimeout(300)
for (let i = 0; i < 5; i++) { await page.keyboard.press('ArrowRight'); await page.waitForTimeout(200) }
await settle(page); await shot('06-tour-s6-gtm')
await page.keyboard.press('ArrowRight'); await settle(page); await shot('07-tour-s7-transversal')
await page.keyboard.press('ArrowRight'); await settle(page); await shot('08-tour-s8-future')
console.log(`errors: ${errors.length}`); for (const e of errors) console.log('  ' + e)
await browser.close()
process.exit(errors.length ? 2 : 0)
