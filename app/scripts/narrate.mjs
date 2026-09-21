#!/usr/bin/env node
/**
 * Generates one narration clip per tour step from tour.json `narration`.
 * Engines:
 *   edge (default) — Microsoft neural voices via `uvx edge-tts` (free, no account;
 *                    needs internet only at generation time — clips are embedded afterwards).
 *   say            — macOS built-in voices (offline).
 * Output: src/audio/{step.audio} as mp3 mono 24 kHz 64 kbps + durations.json.
 *   node scripts/narrate.mjs [engine] [voice] [rate]
 *   node scripts/narrate.mjs                      → edge es-MX-DaliaNeural (team choice 2026-09-08)
 *   node scripts/narrate.mjs say Paulina 168      → previous offline fallback
 * To use any other voice, drop replacement mp3s with the same names into src/audio/
 * and re-run with engine `none` to refresh durations.json only.
 */
import { readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
const here = dirname(fileURLToPath(import.meta.url))
const engine = process.argv[2] ?? 'edge'
const voice = process.argv[3] ?? (engine === 'say' ? 'Paulina' : 'es-MX-DaliaNeural')
const rate = process.argv[4] ?? (engine === 'say' ? '168' : '+0%')
const tour = JSON.parse(readFileSync(resolve(here, '../src/data/tour.json'), 'utf8'))
const out = resolve(here, '../src/audio'); mkdirSync(out, { recursive: true })
const durations = {}
const encode = (src, mp3) => execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', src, '-ac', '1', '-ar', '24000', '-b:a', '64k', mp3])
for (const s of tour) {
  if (!s.narration) continue
  const mp3 = resolve(out, s.audio)
  if (engine === 'say') {
    const aiff = resolve(out, s.id + '.aiff')
    execFileSync('say', ['-v', voice, '-r', rate, '-o', aiff, s.narration])
    encode(aiff, mp3); rmSync(aiff)
  } else if (engine === 'edge') {
    const txt = resolve(out, s.id + '.txt'), raw = resolve(out, s.id + '.raw.mp3')
    writeFileSync(txt, s.narration)
    execFileSync('uvx', ['edge-tts', '--voice', voice, '--rate', rate, '--file', txt, '--write-media', raw], { stdio: ['ignore', 'ignore', 'inherit'] })
    encode(raw, mp3); rmSync(txt); rmSync(raw)
  } else if (engine !== 'none') throw new Error(`unknown engine ${engine}`)
  const d = parseFloat(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', mp3]).toString())
  durations[s.id] = Math.round(d)
  console.log(`${s.audio}  ${Math.round(d)} s  [${engine}${engine === 'none' ? '' : ' · ' + voice}]`)
}
writeFileSync(resolve(out, 'durations.json'), JSON.stringify(durations, null, 2))
