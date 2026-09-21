#!/usr/bin/env node
/**
 * Quick visual check: opens the app in headless Chromium, runs an optional
 * sequence of actions, saves screenshots and prints console errors.
 *   node scripts/shot.mjs <url> <outDir> [w] [h] [actions]
 * actions: comma list of  wait:<ms> | key:<Key> | click:<selector> | shot:<name> | eval:<js>
 */
import { chromium } from 'playwright'
import { mkdirSync } from 'node:fs'
import { resolve } from 'node:path'

const [url = 'http://127.0.0.1:4173/', outDir = '../verification/tmp', w = '1920', h = '1080', actions = 'wait:2500,shot:world'] = process.argv.slice(2)
mkdirSync(resolve(outDir), { recursive: true })
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] })
const page = await browser.newPage({ viewport: { width: +w, height: +h }, deviceScaleFactor: 1 })
const errors = [], logs = []
page.on('console', (m) => { const t = `${m.type()}: ${m.text()}`; logs.push(t); if (m.type() === 'error') errors.push(t) })
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`))
await page.goto(url, { waitUntil: 'load' })
for (const a of actions.split(',')) {
  const [op, ...rest] = a.split(':')
  const arg = rest.join(':')
  if (op === 'wait') await page.waitForTimeout(+arg)
  else if (op === 'key') await page.keyboard.press(arg)
  else if (op === 'click') await page.click(arg, { timeout: 8000, force: true })
  else if (op === 'shot') await page.screenshot({ path: resolve(outDir, `${arg}-${w}x${h}.png`) })
  else if (op === 'eval') console.log('eval →', JSON.stringify(await page.evaluate(arg)))
}
console.log(`console messages: ${logs.length}, errors: ${errors.length}`)
for (const e of errors) console.log('  ' + e)
await browser.close()
process.exit(errors.length ? 2 : 0)
