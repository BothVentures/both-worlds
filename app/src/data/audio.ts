// Narration clips, bundled as assets (inlined as data URIs in the single-file build).
const files = import.meta.glob('../audio/*.mp3', { eager: true, query: '?url', import: 'default' }) as Record<string, string>
import durations from '../audio/durations.json'
export const audioUrl = (name: string): string | undefined => files[`../audio/${name}`]
export const audioDuration = (stepId: string): number | undefined => (durations as Record<string, number>)[stepId]
