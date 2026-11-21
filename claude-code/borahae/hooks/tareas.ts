import type { EngineInterface } from 'claude-code'

import { MEMBERS, MEMORY_DIR, cap } from './crew'

// The team's task log: every job a member starts, with how it ended and the
// "📋 TAREAS:" list its report closes with. Kept in the plugin's store (so it
// outlives the session) and mirrored to tareas.md in the team notebook, where
// the PM and the user can read it.

export type TareaState = 'working' | 'done' | 'error'

export type Tarea = {
  /** The agentId of the run (one entry per run of a member). */
  key: string
  member: string
  /** The Agent call's description. */
  task: string
  state: TareaState
  /** Milliseconds, `$.clock.now()`. */
  start: number
  end?: number
  /** From the report's "📋 TAREAS:" block. */
  hechas?: string[]
  pendientes?: string[]
  reason?: string
}

const STORE_KEY = 'tareas'
/** Older entries fall off the end: the log stays readable. */
const MAX_ENTRIES = 300
export const TAREAS_FILE = 'tareas.md'

/** Reads the "📋 TAREAS:" block of a report: `- ✔ …` done, `- ⏳ …` pending. */
export const parseTareas = (answer: string): { hechas: string[]; pendientes: string[] } => {
  const hechas: string[] = []
  const pendientes: string[] = []
  const at = answer.lastIndexOf('📋 TAREAS')
  if (at < 0) return { hechas, pendientes }
  for (const raw of answer.slice(at).split('\n').slice(1)) {
    const line = raw.trim()
    if (line === '') continue
    const m = /^[-*•]\s*(✔️?|✅|☑️?|⏳|🕐|⬜)\s*(.+)$/u.exec(line)
    if (!m) {
      if (/^[-*•]/.test(line)) continue
      break // the block ended
    }
    const mark = m[1] ?? ''
    const text = (m[2] ?? '').trim()
    if (text === '') continue
    if (/^(⏳|🕐|⬜)$/u.test(mark)) pendientes.push(text)
    else hechas.push(text)
  }
  return { hechas, pendientes }
}

const pad = (n: number) => String(n).padStart(2, '0')
const when = (ms: number) => {
  const d = new Date(ms)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}
const took = (t: Tarea) => {
  if (t.end === undefined) return ''
  const s = Math.max(0, Math.round((t.end - t.start) / 1000))
  return s >= 60 ? ` · ${Math.floor(s / 60)}m ${pad(s % 60)}s` : ` · ${s}s`
}
const ICON: Record<TareaState, string> = { working: '⏳', done: '✔', error: '✖' }

async function read($: EngineInterface): Promise<Tarea[]> {
  const v = await $.store.get(STORE_KEY).catch(() => undefined)
  return Array.isArray(v) ? (v as Tarea[]) : []
}

/** The log as text, grouped by member, newest first. `only` keeps one member. */
export const renderTareas = (log: readonly Tarea[], only?: string, markdown = false): string => {
  const out: string[] = []
  for (const m of MEMBERS) {
    if (only && m.id !== only) continue
    const mine = log.filter(t => t.member === m.id).sort((a, b) => b.start - a.start)
    if (mine.length === 0) continue
    const working = mine.filter(t => t.state === 'working').length
    const done = mine.filter(t => t.state === 'done').length
    out.push(
      `${markdown ? '## ' : ''}${m.emoji} ${cap(m.name)} — ${working} en curso · ${done} terminadas${mine.length - working - done > 0 ? ` · ${mine.length - working - done} con error` : ''}`,
    )
    for (const t of mine) {
      out.push(`- ${ICON[t.state]} ${t.task.trim() || 'trabajando…'} (${when(t.start)}${took(t)})${t.reason ? ` — ${t.reason}` : ''}`)
      for (const h of t.hechas ?? []) out.push(`    - ✔ ${h}`)
      for (const p of t.pendientes ?? []) out.push(`    - ⏳ ${p}`)
    }
    out.push('')
  }
  return out.length === 0 ? (only ? 'Sin tareas registradas para ese miembro todavía.' : 'Sin tareas registradas todavía.') : out.join('\n').trimEnd()
}

async function writeFile($: EngineInterface, log: readonly Tarea[]) {
  try {
    const home = (await $.env.get('USERPROFILE')) ?? (await $.env.get('HOME'))
    if (!home) return
    const dir = MEMORY_DIR.replace(/^~/, home.replace(/\\/g, '/'))
    const body = [
      '# Tareas del equipo Borahae',
      '',
      '> Lo escribe el plugin solo: cada encargo de un miembro (⏳ en curso, ✔ terminado, ✖ con error) y la lista "📋 TAREAS:" de su informe. No lo edites a mano: se reescribe.',
      '',
      renderTareas(log, undefined, true),
      '',
    ].join('\n')
    await $.fs.write(`${dir}${TAREAS_FILE}`, body)
  } catch {
    // the file is a mirror: the store keeps the log
  }
}

// One write at a time: spawns and completions can land together.
let chain: Promise<unknown> = Promise.resolve()

/** Changes the log and mirrors it to tareas.md; never rejects. */
export function changeTareas($: EngineInterface, fn: (log: Tarea[]) => Tarea[]) {
  const run = chain.then(async () => {
    const next = fn(await read($)).slice(-MAX_ENTRIES)
    await $.store.set(STORE_KEY, next)
    await writeFile($, next)
  })
  chain = run.catch(() => undefined)
  return chain
}

export function readTareas($: EngineInterface) {
  return read($)
}

const lastOf = (log: readonly Tarea[], key: string) => {
  for (let i = log.length - 1; i >= 0; i--) if (log[i]?.key === key) return i
  return -1
}

/** A run started; a resumed agent gets a new entry under the same key. */
export async function startTarea($: EngineInterface, key: string, member: string, task: string, resume = false) {
  const now = await $.clock.now()
  return changeTareas($, log => {
    const i = lastOf(log, key)
    const cur = i >= 0 ? log[i] : undefined
    if (cur?.state === 'working') return log
    // A new agent's turn.complete may already have landed: keep what it wrote.
    if (cur && !resume) return log
    return [...log, { key, member, task, state: 'working', start: now }]
  })
}

/** Runs still "working" that the engine no longer runs ended without being heard. */
export function settleTareas($: EngineInterface, running: ReadonlySet<string>) {
  return changeTareas($, log =>
    log.some(t => t.state === 'working' && !running.has(t.key))
      ? log.map(t => (t.state === 'working' && !running.has(t.key) ? { ...t, state: 'error', reason: 'sin cierre (sesión terminada)' } : t))
      : log,
  )
}

/** A run ended: how, and the report's task list. */
export async function endTarea(
  $: EngineInterface,
  key: string,
  ok: boolean,
  answer: string,
  reason?: string,
  fallback?: { member: string; task: string },
) {
  const now = await $.clock.now()
  const { hechas, pendientes } = parseTareas(answer)
  return changeTareas($, log => {
    const i = lastOf(log, key)
    const ended = (t: Tarea): Tarea => ({
      ...t,
      state: ok ? 'done' : 'error',
      end: now,
      ...(hechas.length > 0 ? { hechas } : {}),
      ...(pendientes.length > 0 ? { pendientes } : {}),
      ...(!ok && reason ? { reason } : {}),
    })
    if (i >= 0) return log.map((t, k) => (k === i ? ended(t) : t))
    if (!fallback) return log
    return [...log, ended({ key, member: fallback.member, task: fallback.task, state: 'working', start: now })]
  })
}
