#!/usr/bin/env node
/**
 * End-to-end verification in a real (headless) Chromium via Playwright.
 *   node scripts/e2e.mjs [url] [outDir]
 * Checks: console errors, world→territory→project→element navigation by click,
 * back (Esc) and reset (Home), guided tour via keyboard and buttons, pause,
 * reduced motion, fullscreen request (best effort), label overlap (levels 1-2),
 * controls inside the viewport at 1920×1080 and 1440×900, and screenshots.
 * Writes a JSON + markdown report into outDir. Exit 1 if any check fails.
 */
import { chromium } from 'playwright'
import { mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

const url = process.argv[2] ?? 'http://127.0.0.1:4173/'
const outDir = resolve(process.argv[3] ?? '../verification/e2e')
mkdirSync(outDir, { recursive: true })
const results = []
const check = (name, ok, detail = '') => { results.push({ name, ok: !!ok, detail }); console.log(`${ok ? '✓' : '✗'} ${name}${detail ? ' — ' + detail : ''}`) }

// wait for the camera tween to finish (deterministic under CPU load), then for label transitions
const settle = async (page) => {
  await page.waitForFunction(() => window.__world && !window.__world.director.busy, null, { timeout: 20000 }).catch(() => {})
  await page.waitForTimeout(250)
  // label fade-ins are CSS transitions; under a software renderer they take seconds, on a GPU they are instant
  await page.waitForFunction(() => [...document.querySelectorAll('.lbl.lbl-on:not(.hid)')].every((e) => getComputedStyle(e).opacity === '1'), null, { timeout: 20000 }).catch(() => {})
  await page.waitForTimeout(400)
}
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] })

async function run(viewport) {
  const tag = `${viewport.width}x${viewport.height}`
  const page = await browser.newPage({ viewport, deviceScaleFactor: 1 })
  const errors = []
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()) })
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message))
  await page.goto(url, { waitUntil: 'load' })
  await settle(page)
  const shot = (n) => page.screenshot({ path: resolve(outDir, `${n}-${tag}.png`) })

  const crumb = async () => (await page.locator('.crumbs').innerText()).replace(/\s+/g, ' ').trim()
  const visibleLabels = async (sel) => page.$$eval(sel, (els) => els.filter((e) => e.classList.contains('lbl-on') && !e.classList.contains('hid') && getComputedStyle(e).visibility !== 'hidden').map((e) => { const r = e.getBoundingClientRect(); return { id: e.dataset.id, x: r.x, y: r.y, w: r.width, h: r.height } }))
  const overlaps = (rects) => { let n = 0; for (let i = 0; i < rects.length; i++) for (let j = i + 1; j < rects.length; j++) { const a = rects[i], b = rects[j]; if (a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y) n++ } return n }
  const inViewport = async (sel) => page.$$eval(sel, (els, vp) => els.map((e) => { const r = e.getBoundingClientRect(); return { t: e.textContent?.trim().slice(0, 24), ok: r.left >= 0 && r.top >= 0 && r.right <= vp.w && r.bottom <= vp.h } }), { w: viewport.width, h: viewport.height })

  // 1. world renders + WebGL context present
  const webgl = await page.evaluate(() => { const c = document.querySelector('canvas'); return !!(c && (c.getContext('webgl2') || c.getContext('webgl'))) })
  check(`[${tag}] WebGL context available`, webgl)
  await shot('01-world')
  const l1 = await visibleLabels('.lbl-l1')
  check(`[${tag}] world shows 3 territory labels`, l1.length === 3, `${l1.length} visible: ${l1.map((l) => l.id).join(', ')}`)
  check(`[${tag}] territory labels do not overlap`, overlaps(l1) === 0, `${overlaps(l1)} overlaps`)

  // 1b. narration player on the tour card
  await page.click('.player .play'); await page.waitForTimeout(2500)
  const pw = await page.$eval('.player .bar i', (e) => parseFloat(e.style.width) || 0)
  check(`[${tag}] narration plays from the card (progress advances)`, (await page.$eval('.player .play', (e) => e.getAttribute('aria-pressed'))) === 'true' && pw > 0, `${pw.toFixed(1)}% after 2.5 s`)
  await page.keyboard.press('ArrowRight'); await page.waitForTimeout(800)
  check(`[${tag}] changing step stops the narration`, (await page.$eval('.player .play', (e) => e.getAttribute('aria-pressed'))) === 'false')
  await page.keyboard.press('ArrowLeft'); await settle(page)

  // 2. controls inside viewport
  const ctl = await inViewport('.tools button, .tour .nav, .legend, .crumbs button')
  check(`[${tag}] all controls inside viewport`, ctl.every((c) => c.ok), ctl.filter((c) => !c.ok).map((c) => c.t).join(', '))

  // 3. guided tour by keyboard (N steps) + buttons
  const N = parseInt((await page.locator('.tour .meta span').first().innerText()).split('/')[1])
  for (let i = 1; i < N; i++) { await page.keyboard.press('ArrowRight'); await settle(page); if (i >= 3) await shot(`tour-step${i + 1}`) }
  check(`[${tag}] tour reaches step ${N} via keyboard`, (await page.locator('.tour .meta span').first().innerText()).startsWith(`${N} /`))
  check(`[${tag}] last step is marked as future`, await page.locator('.tour.future').count() === 1)
  await page.click('.tour .nav >> nth=0'); await page.waitForTimeout(600)
  check(`[${tag}] tour previous button works`, (await page.locator('.tour .meta span').first().innerText()).startsWith(`${N - 1} /`))
  await page.click('.tour .nav >> nth=1'); await page.waitForTimeout(600)
  check(`[${tag}] tour next button works`, (await page.locator('.tour .meta span').first().innerText()).startsWith(`${N} /`))
  for (let i = 0; i < N - 1; i++) { await page.keyboard.press('ArrowLeft'); await page.waitForTimeout(150) }
  await settle(page)
  check(`[${tag}] tour returns to step 1`, (await page.locator('.tour .meta span').first().innerText()).startsWith('1 /'))

  // 4. explore: click territory → project → element, then Esc and Home
  await page.keyboard.press('t'); await page.waitForTimeout(400)
  await page.click('.lbl-l1[data-id="t-both-ventures"]', { force: true }); await settle(page)
  check(`[${tag}] click territory → breadcrumb Both Ventures`, (await crumb()).includes('Both Ventures'))
  const l2 = await visibleLabels('.lbl-l2')
  check(`[${tag}] territory shows project labels (≥8 visible of 10)`, l2.length >= 8, `${l2.length} visible`)
  check(`[${tag}] project labels do not overlap`, overlaps(l2) === 0, `${overlaps(l2)} overlaps`)
  await shot('02-territory')
  await page.click('.lbl-l2[data-id="p-both-os"]', { force: true }); await settle(page)
  check(`[${tag}] click project → breadcrumb B_V® | OS`, (await crumb()).includes('B_V'))
  const l3 = await visibleLabels('.lbl-l3')
  check(`[${tag}] project shows element labels (≥8)`, l3.length >= 8, `${l3.length} visible`)
  check(`[${tag}] element labels do not overlap`, overlaps(l3) === 0, `${overlaps(l3)} overlaps`)
  const zones = await page.$$eval('.zlbl.lbl-on', (els) => els.filter((e) => e.style.opacity !== '0').map((e) => e.textContent))
  check(`[${tag}] project shows type-zone captions (≥3)`, zones.length >= 3, zones.join(' · '))
  await shot('03-project')
  await page.click('.lbl-l3[data-id="bo-wf-auto-miner"]', { force: true }); await settle(page)
  const panelTitle = await page.locator('.panel h2').innerText().catch(() => '')
  check(`[${tag}] click element → evidence panel opens`, panelTitle.includes('Auto-miner'), panelTitle)
  const srcCount = await page.locator('.panel .src').count()
  check(`[${tag}] evidence panel lists sources`, srcCount >= 3, `${srcCount} sources`)
  check(`[${tag}] evidence panel lists relations`, (await page.locator('.panel .rel').count()) >= 3)
  const panelIn = await inViewport('.panel')
  check(`[${tag}] evidence panel inside viewport`, panelIn.every((c) => c.ok))
  await shot('04-element')
  await page.keyboard.press('Escape'); await settle(page)
  check(`[${tag}] Esc goes back to project`, !(await crumb()).includes('Auto-miner') && (await crumb()).includes('B_V'))
  await page.keyboard.press('Escape'); await settle(page)
  check(`[${tag}] Esc again goes back to territory`, !(await crumb()).includes('B_V') && (await crumb()).includes('Both Ventures'))
  await page.keyboard.press('Home'); await settle(page)
  check(`[${tag}] Home resets to world`, (await crumb()) === 'Mundo')
  // panel navigation: territory → project via "Contiene" list
  await page.click('.lbl-l1[data-id="t-synergy-toolkit"]', { force: true }); await settle(page)
  await page.click('.panel .list button >> nth=0'); await settle(page)
  check(`[${tag}] panel list navigates into a project`, (await crumb()).includes('Synergy Toolkit ›'))
  await page.keyboard.press('Home'); await page.waitForTimeout(1500)

  // 5. pause, reduced motion, fullscreen (best effort in headless)
  await page.click('.tools button >> nth=1'); await page.waitForTimeout(200)
  check(`[${tag}] pause toggles`, (await page.locator('.tools button >> nth=1').getAttribute('aria-pressed')) === 'true')
  await page.click('.tools button >> nth=2'); await page.waitForTimeout(200)
  check(`[${tag}] reduced motion toggles`, (await page.locator('.tools button >> nth=2').getAttribute('aria-pressed')) === 'true' && (await page.evaluate(() => document.body.classList.contains('motion-off'))))
  const fsResult = await page.evaluate(async () => { try { await document.documentElement.requestFullscreen(); return document.fullscreenElement ? 'entered' : 'no-element' } catch (e) { return 'rejected: ' + e.message } })
  check(`[${tag}] fullscreen request (headless: may be rejected, not a failure)`, true, fsResult)
  await page.keyboard.press('?'); await page.waitForTimeout(200)
  await page.click('.tools button[title="L"]'); await page.waitForTimeout(300)
  check(`[${tag}] legend hides with the toolbar button`, (await page.locator('.legend').count()) === 0)
  await page.keyboard.press('l'); await page.waitForTimeout(300)
  check(`[${tag}] legend returns with the L key`, (await page.locator('.legend').count()) === 1)
  check(`[${tag}] help dialog opens`, (await page.locator('.help').count()) === 1)
  await page.keyboard.press('Escape')

  check(`[${tag}] no console errors`, errors.length === 0, errors.slice(0, 3).join(' | '))
  await page.close()
}

await run({ width: 1920, height: 1080 })
await run({ width: 1440, height: 900 })
await browser.close()

const failed = results.filter((r) => !r.ok)
const md = ['# E2E report', `URL: ${url}`, `Date: ${new Date().toISOString()}`, '', `**${results.length - failed.length} / ${results.length} checks passed**`, '', ...results.map((r) => `- ${r.ok ? '✓' : '✗'} ${r.name}${r.detail ? ' — ' + r.detail : ''}`)].join('\n')
writeFileSync(resolve(outDir, 'report.md'), md)
writeFileSync(resolve(outDir, 'report.json'), JSON.stringify(results, null, 2))
console.log(`\n${results.length - failed.length}/${results.length} passed → ${outDir}/report.md`)
process.exit(failed.length ? 1 : 0)
