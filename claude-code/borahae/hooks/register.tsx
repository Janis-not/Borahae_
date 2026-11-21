import { atom, read, update } from 'claude-code'
import type { AgentStatus, EngineInterface, Register } from 'claude-code'

import type { CrewStatus, RoleId } from '../types'
import { registerUsage, startUsage } from './usage'
import { CHIBI_FRAMES, HEART_PNG, ROLES } from './art'
import type { Role } from './art'
import { DEFAULT_PM, DEFAULT_ROLES, MEMBERS, ROLE_SPECS, cap, descriptionFor, labelFor, promptFor, teamRules } from './crew'
import { endTarea, readTareas, renderTareas, settleTareas, startTarea } from './tareas'
import type { Member } from './crew'
import { SCENE_COLS_PER_ROW, STAGE_COLS_PER_ROW, scenePng, stageBannerPng, stagePng } from './scene'
import type { Sleeper } from './scene'

// 32x32 pixel avatars drawn as real pixels (kitty / Ghostty graphics) in a small box of cells.
const AVATAR_COLUMNS = 6
const AVATAR_ROWS = 3

/** The characters: original pixel chibis (generar_chibis.py), one per crew member. */
const nameOf = (m: { name: string }) => m.name

// ── Animation: one shared tick; redraws only while something moves ───────
const TICK_MS = 600
let tick: { cancel: () => void } | undefined
let anyWorking = false
/** When each member started its current run of work (first seen working). */
const busySince = new Map<string, number>()

const SPIN = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏']
const ZZZ = ['z  ', 'zZ ', 'zZz', ' Zz', '  z', '   ']

// ── On stage: sway, hop and step names (all original) ─────────────────
/** Columns the sprite sways across; its spot is this much wider than the sprite. */
const DANCE_SWAY = 3
const DANCE_PAD = [0, 1, 2, 3, 2, 1]
const DANCE_STEPS = [
  '💜 balanceo', '✨ giro', '🎵 salto', '💫 brazos arriba',
  '💜 paso lateral', '✨ deslizar', '🎵 aplauso', '💫 pose final',
]
/** Without pixels: a little dancer made of text around the emoji. */
const DANCE_TXT = ['ヽ($)ノ', '┌($)┘', '└($)┐', 'ノ($)ヽ', '＼($)／', '~($)~']
const SPOT = ['✦', '✧', '★', '✧']
/** While they dance they sing: notes float beside each singer (no lyrics, only notes). */
const NOTES = [' ♪   ♫ ', '  ♫ ♪  ', '♬   ♪  ', '  ♪  ♬ ', ' ♫  ♪  ', '♪  ♬   ']
/** Most task lines shown under one singer, so the dressing room keeps its room. */
const MAX_TASK_LINES = 2
// ── Dressing room: a pixel-art room (scene.ts); whoever is free sleeps there, arcade style.

const sweep = (frame: number, w: number) => {
  const pos = frame % (w + 3)
  return Array.from({ length: w }, (_, i) => (i >= pos - 3 && i < pos ? '▰' : '▱')).join('')
}

const elapsed = (ms: number) => {
  const s = Math.max(0, Math.floor(ms / 1000))
  const m = Math.floor(s / 60)
  return m > 0 ? `${m}m ${String(s % 60).padStart(2, '0')}s` : `${s}s`
}

const PANE = 'borahae-crew'
const TITLE = '💜 Escenario Borahae'
const PURPLE = '#A374DB' // borahae: reads on light and dark grounds
const LILAC = '#D6B4FC' // only on the pane's own dark ground
const ERROR = '#FF7A9A'
const PANE_BG = '#1C1030'

const CREW: readonly Member[] = MEMBERS

const IDLE_WORDS = ['Borahae', 'Purple you']

type Crew = Record<string, CrewStatus>

type Roles = Record<string, RoleId>

// Change a tag when its value's shape changes: it drops what an older version stored.
const crew = atom({ plugin: 'borahae', key: 'crew' } as const, {} as Crew, { shape: 'crew-1' })
const roles = atom({ plugin: 'borahae', key: 'roles' } as const, { ...DEFAULT_ROLES } as Roles, { shape: 'roles-1' })

/** The roles as last read: drawings and the spinner name each member's role from it. */
let currentRoles: Roles = { ...DEFAULT_ROLES }
const roleOf = (id: string): Role => (currentRoles[id] ?? DEFAULT_ROLES[id] ?? 'dev') as Role
/** Who is the PM (the store's 'pm'; Joonie by default). */
let currentPm = DEFAULT_PM
const labelOf = (m: Member) => labelFor(m.id, roleOf(m.id), currentPm)
const isRole = (s: string): s is RoleId => (ROLES as readonly string[]).includes(s)

/** Registers (or re-registers: a name is replaced) every member as its current role. */
let agentsReady = false
const registerAgents = async ($: EngineInterface) => {
  currentRoles = await read($, roles).catch(() => currentRoles)
  try {
    for (const m of MEMBERS) {
      const role = roleOf(m.id)
      const spec = ROLE_SPECS[role]
      await $.agent.register({
        name: m.id,
        description: descriptionFor(m, role, currentPm),
        prompt: promptFor(m, role, currentRoles, currentPm),
        ...(spec.tools ? { tools: spec.tools } : {}),
      })
    }
    agentsReady = true
  } catch {
    // Not bound yet: tried again at the next turn.
    agentsReady = false
  }
}

/** Key of an instance whose spawn has not resolved yet (no agentId so far). */
const PENDING = 'spawn:'
let seq = 0

const memberOf = (subagentType: string): Member | undefined => {
  const [plugin, name] = subagentType.split(':')
  if (plugin !== 'borahae') return undefined
  return CREW.find(m => m.id === name)
}

/** Cuts by code points (never halves an emoji) after folding whitespace. */
const short =(s: string, n: number) => {
  const chars = Array.from(s.replace(/\s+/g, ' ').trim())
  return chars.length > n ? chars.slice(0, Math.max(1, n - 1)).join('') + '…' : chars.join('')
}

const taskText = (s: CrewStatus) => (s.task.trim() === '' ? 'trabajando…' : s.task)

const hash = (s: string) => {
  let x = 0
  for (const c of s) x = (x * 31 + c.charCodeAt(0)) >>> 0
  return x
}

type Group = { m: Member; working: CrewStatus[]; done: CrewStatus[]; error: CrewStatus[] }

/** The instances of the atom, grouped by crew member. */
const groups = (all: Crew): Group[] =>
  CREW.map(m => {
    const mine = Object.values(all).filter(s => s.member === m.id)
    return {
      m,
      working: mine.filter(s => s.state === 'working'),
      done: mine.filter(s => s.state === 'done'),
      error: mine.filter(s => s.state === 'error'),
    }
  })

const times = (n: number) => (n > 1 ? ` ×${n}` : '')

const statusLine = (all: Crew) => {
  const busy = groups(all).filter(g => g.working.length > 0)
  return busy.length === 0
    ? '💜 Borahae'
    : `💜 Borahae · ${busy.map(g => `${g.m.emoji} ${nameOf(g.m)}${times(g.working.length)}`).join(' ')} trabajando`
}

/** Never throws: a status line is decoration. */
const refreshStatus = async ($: EngineInterface) => {
  try {
    $.ui.status(statusLine(await read($, crew)))
  } catch {
    // ignore
  }
}

/** Writes the atom and refreshes the status line; never rejects. */
const write = ($: EngineInterface, fn: (prev: Crew) => Crew) =>
  update($, crew, prev => fn(prev ?? {}))
    .then(() => refreshStatus($))
    .catch(() => undefined)

const without = (all: Crew, key: string): Crew => {
  const { [key]: _gone, ...rest } = all
  return rest
}

const ENDED_OK: readonly AgentStatus[] = ['completed', 'idle']
const ENDED_BAD: readonly AgentStatus[] = ['failed', 'killed']

/**
 * Drops or settles the working instances the engine no longer runs (after a
 * reload, or a turn.complete this module did not hear). With `dropPending`,
 * spawns that never resolved are dropped too: no hook is waiting on them.
 */
const reconcile = async ($: EngineInterface, dropPending: boolean) => {
  const agents = await $.agent.list().catch(() => undefined)
  if (!agents) return
  const byId = new Map(agents.map(a => [a.id, a.status] as const))
  await write($, prev => {
    const out: Crew = {}
    for (const [key, s] of Object.entries(prev)) {
      if (s.state !== 'working') out[key] = s
      else if (key.startsWith(PENDING)) {
        if (!dropPending) out[key] = s
      } else {
        const status = byId.get(key)
        if (status === undefined) continue
        if (ENDED_OK.includes(status)) out[key] = { ...s, state: 'done' }
        else if (ENDED_BAD.includes(status)) out[key] = { ...s, state: 'error', reason: status }
        else out[key] = s
      }
    }
    return out
  })
}

/** Log entries left "working" by a run that no longer runs (an earlier session). */
async function settleLog($: EngineInterface) {
  const agents = await $.agent.list().catch(() => undefined)
  if (!agents) return
  const running = new Set(agents.filter(a => !ENDED_OK.includes(a.status) && !ENDED_BAD.includes(a.status)).map(a => a.id))
  await settleTareas($, running).catch(() => undefined)
}

/** One pane: the stage on top, the dressing room below. */
const openPane = ($: EngineInterface) =>
  $.ui.open({ id: PANE, title: TITLE, backgroundColor: PANE_BG }).catch(() => undefined)

/** Notes when each member stepped on stage, for the elapsed time. */
const trackBusy = (gs: Group[], nowMs: number) => {
  for (const g of gs) {
    if (g.working.length > 0) {
      if (!busySince.has(g.m.id)) busySince.set(g.m.id, nowMs)
    } else busySince.delete(g.m.id)
  }
}

export const register: Register = on => {
  registerUsage(on)

  on('session.start', async ($, e, next) => {
    try {
      for (const c of [
        { name: 'borahae', description: 'Abre el escenario y el camerino del equipo Borahae 💜' },
        { name: 'borahae-rol', description: 'Cambia el rol de un miembro del equipo, o quién es el PM', argumentHint: '<miembro> <rol|pm>' },
        { name: 'borahae-tareas', description: 'Lista las tareas que cada miembro terminó o está haciendo', argumentHint: '[miembro]' },
      ]) {
        await $.command.register(c).catch(() => undefined)
      }
      // The roles chosen in earlier sessions.
      const savedRoles = await $.store.get('roles').catch(() => undefined)
      if (savedRoles && typeof savedRoles === 'object') {
        const clean: Roles = { ...DEFAULT_ROLES }
        for (const [k, v] of Object.entries(savedRoles as Record<string, unknown>)) {
          if (MEMBERS.some(m => m.id === k) && typeof v === 'string' && isRole(v)) clean[k] = v
        }
        await update($, roles, () => clean).catch(() => undefined)
      }
      const savedPm = await $.store.get('pm').catch(() => undefined)
      if (typeof savedPm === 'string' && MEMBERS.some(m => m.id === savedPm)) currentPm = savedPm
      await registerAgents($)
      void openPane($)
      await reconcile($, true)
      await settleLog($)
      await refreshStatus($)
      await startUsage($).catch(() => undefined)
      tick?.cancel()
      let n = 0
      try {
        tick = $.clock.every(TICK_MS, () => {
          n += 1
          // Working: every tick. Resting: a slow "zZz" every third tick.
          if (anyWorking || n % 3 === 0) $.ui.invalidate('ui.render')
        })
      } catch {
        tick = undefined
      }
      // Desktop app only: a soft lilac backdrop behind the chat. The terminal ignores it.
      void $.theme
        .set({
          backdrop: { gradient: { stops: ['#F6EEFF', '#E6D3FF', '#CDAAF5'], angle: 160 } },
          overrideColorScheme: 'light',
        })
        .catch(() => undefined)
    } catch {
      // never hold the session back
    }
    return next(e)
  })

  on('command.run', { command: 'borahae' }, async $ => {
    await reconcile($, false)
    await openPane($)
    currentRoles = await read($, roles).catch(() => currentRoles)
    const list = CREW.map(m => `${m.emoji} ${nameOf(m)} (borahae:${m.id}): ${labelOf(m)}`).join('\n')
    return { text: `💜 Equipo Borahae listo:\n${list}` }
  })

  on('command.run', { command: 'borahae-rol' }, async ($, e) => {
    const [who = '', what = ''] = e.args.trim().toLowerCase().split(/\s+/)
    const m = MEMBERS.find(x => x.id === who)
    currentRoles = await read($, roles).catch(() => currentRoles)
    const usage = [
      'Uso: /borahae-rol <miembro> <rol>',
      `Miembros: ${MEMBERS.map(x => x.id).join(', ')}`,
      `Roles: ${ROLES.map(r => `${r} (${ROLE_SPECS[r].label})`).join(', ')}`,
      'PM: /borahae-rol <miembro> pm lo nombra Project Manager (conserva su rol).',
      '',
      ...MEMBERS.map(x => `${x.emoji} ${x.name}: ${labelOf(x)}`),
    ].join('\n')
    if (m && what === 'pm') {
      currentPm = m.id
      await $.store.set('pm', m.id).catch(() => undefined)
      await registerAgents($)
      return { text: `💜 ${m.emoji} ${m.name} ahora es el PM del equipo (y sigue como ${ROLE_SPECS[roleOf(m.id)].label}).` }
    }
    if (!m || !isRole(what)) return { text: `💜 ${usage}` }
    const nextRoles: Roles = { ...currentRoles, [m.id]: what }
    await update($, roles, () => nextRoles).catch(() => undefined)
    await $.store.set('roles', nextRoles).catch(() => undefined)
    await registerAgents($)
    return { text: `💜 ${m.emoji} ${m.name} ahora es ${labelOf(m)}.` }
  })

  on('command.run', { command: 'borahae-tareas' }, async ($, e) => {
    const who = e.args.trim().toLowerCase()
    const m = MEMBERS.find(x => x.id === who)
    if (who !== '' && !m) return { text: `💜 Uso: /borahae-tareas [miembro]
Miembros: ${MEMBERS.map(x => x.id).join(', ')}` }
    const log = await readTareas($)
    return { text: `📋 Tareas del equipo Borahae${m ? ` · ${m.emoji} ${nameOf(m)}` : ''}

${renderTareas(log, m?.id)}` }
  })

  // ── Team rules in the system prompt: delegation and memory ──────────
  on('prompt.compose', async ($, e, next) => {
    const out = await next(e)
    if (e.traits.includes('bare')) return out
    return { sections: [...out.sections, { id: 'borahae:team', text: teamRules(currentRoles, currentPm), scope: 'session' as const }] }
  })

  // ── Instances: spawn starts one, its turn.complete ends it ───────────
  on('agent.spawn', async ($, e, next) => {
    const m = memberOf(e.subagentType)
    if (!m) return next(e)
    const pending = `${PENDING}${e.tool_use_id}:${seq++}`
    const base: CrewStatus = { member: m.id, state: 'working', task: e.description }
    await write($, prev => ({ ...prev, [pending]: base }))
    let result
    try {
      result = await next(e)
    } catch (err) {
      await write($, prev => ({ ...without(prev, pending), [pending]: { ...base, state: 'error' } }))
      throw err
    }
    if (result.deny !== undefined) {
      const reason = result.deny
      const key = pending
      await startTarea($, key, m.id, e.description).catch(() => undefined)
      await endTarea($, key, false, '', `denegado: ${reason}`).catch(() => undefined)
      await write($, prev => ({ ...without(prev, pending), [pending]: { ...base, state: 'error', reason } }))
    } else if (result.agentId === undefined) {
      // Nothing local to follow (a remote workflow agent): stop showing it.
      await write($, prev => without(prev, pending))
    } else {
      const id = result.agentId
      await startTarea($, id, m.id, e.description, Boolean(e.resume)).catch(() => undefined)
      // A new agent's turn.complete may already have landed: keep what it
      // wrote. A resumed one works again whatever it ended as before.
      await write($, prev => {
        const rest = without(prev, pending)
        return rest[id] && !e.resume ? rest : { ...rest, [id]: base }
      })
    }
    return result
  })

  on('turn.complete', async ($, e, next) => {
    const id = e.agentId
    if (id !== undefined) {
      const all = await read($, crew).catch(() => ({}) as Crew)
      if (all[id]) {
        const ok = e.reason === 'answer'
        await endTarea($, id, ok, e.answer, ok ? undefined : e.reason, { member: all[id].member, task: all[id].task }).catch(() => undefined)
        await write($, prev => {
          const cur = prev[id]
          if (!cur) return prev
          return { ...prev, [id]: ok ? { ...cur, state: 'done' } : { ...cur, state: 'error', reason: e.reason } }
        })
      }
    }
    return next(e)
  })

  // A new prompt on the main thread clears what already ended.
  on('turn.start', async ($, e, next) => {
    if (e.agentId === undefined) {
      if (!agentsReady) await registerAgents($)
      const all = await read($, crew).catch(() => ({}) as Crew)
      if (Object.values(all).some(s => s.state !== 'working')) {
        await write($, prev =>
          Object.fromEntries(Object.entries(prev).filter(([, s]) => s.state === 'working')),
        )
      }
    }
    return next(e)
  })

  // ── /borahae output: the crew as pixel chibis ─────────────────────────
  on('ui.render', { component: 'CommandOutput', props: { command: 'borahae' } }, async ($, e, next) => {
    const els = $.ui.resolve(e)
    const Image = 'Image' in els ? els.Image : undefined
    if (!Image || e.props.isErrored) return next(e)
    const { Box, Text } = els
    const cols = e.viewport?.columns ?? 80
    const cell = Math.max(AVATAR_COLUMNS + 3, 9)
    const perRow = Math.max(1, Math.min(CREW.length, Math.floor((cols - 2) / cell)))
    const rows: Member[][] = []
    for (let i = 0; i < CREW.length; i += perRow) rows.push(CREW.slice(i, i + perRow))
    return (
      <Box flexDirection="column">
        <Box flexDirection="row">
          <Image key="cmd-heart-a" source={{ png: HEART_PNG }} columns={2} rows={1} alt="♥" />
          <Text bold color={PURPLE}> Equipo Borahae listo </Text>
          <Image key="cmd-heart-b" source={{ png: HEART_PNG }} columns={2} rows={1} alt="♥" />
        </Box>
        {rows.map((row, r) => (
          <Box key={`r${r}`} flexDirection="row" marginTop={1}>
            {row.map(m => (
              <Box key={`c-${m.id}`} flexDirection="column" width={cell}>
                <Image key={`cmd-${m.id}`} source={{ png: CHIBI_FRAMES[m.id]?.[0] ?? '' }} columns={AVATAR_COLUMNS} rows={AVATAR_ROWS} alt={`${m.emoji} ${nameOf(m)}`} />
                <Text bold color={LILAC}>{nameOf(m)}</Text>
              </Box>
            ))}
          </Box>
        ))}
        {CREW.map(m => (
          <Text color={LILAC}>
            <Text bold color={PURPLE}>{nameOf(m)}</Text> · {labelOf(m)} <Text color="#9C86B8">(borahae:{m.id})</Text>
          </Text>
        ))}
      </Box>
    )
  })

  // ── The panel: the stage on top (singing and dancing), the dressing room below ─
  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const els = $.ui.resolve(e)
    const { Box, Text } = els
    // Image (real pixels) exists on the terminal surface only.
    const Image = 'Image' in els ? els.Image : undefined
    const all = await read($, crew)
    currentRoles = await read($, roles).catch(() => currentRoles)
    const width = Math.max(16, e.props.bodyColumns - 2)
    const gs = groups(all)
    const onStage = gs.filter(g => g.working.length > 0)
    const resting = gs.filter(g => g.working.length === 0)
    const busy = onStage.reduce((n, g) => n + g.working.length, 0)

    if (e.props.placement === 'widget') {
      const glance = busy > 0
        ? `🎤 ${onStage.map(g => g.m.emoji).join('')} cantando · 🛋️ ${resting.map(g => g.m.emoji).join('')}`
        : `🎭 Escenario libre · 🛋️ ${resting.map(g => g.m.emoji).join('')} 💤`
      return <Text bold color={PURPLE}>{short(glance, width)}</Text>
    }

    const withAvatars = Image !== undefined && width >= 26
    const nowMs = await $.clock.now().catch(() => Date.now())
    const frame = Math.floor(nowMs / TICK_MS)

    anyWorking = busy > 0
    trackBusy(gs, nowMs)

    // ── Dressing room (bottom): sized first, so it always has its rows ──
    /** The tasks the sleepers just finished, at full width under the room. */
    const notes = resting.flatMap(g => {
      const err = g.error[g.error.length - 1]
      const done = g.done[g.done.length - 1]
      const name = nameOf(g.m)
      if (err) return [<Text key={`note-${g.m.id}`} color={ERROR}>✖ {short(`${name}: ${taskText(err)}`, width - 3)}</Text>]
      if (done) return [<Text key={`note-${g.m.id}`} color="#9FE0B0">✔ {short(`${name}: ${taskText(done)}`, width - 3)}</Text>]
      return []
    })
    const notesRows = notes.length > 0 ? notes.length + 1 : 0
    const roomHead = 2 // divider + title

    // ── Stage (top): header 4 (sky strip 3 + line, or box 4), footer 1, hint 1 ──
    const rows = e.props.scroll.bodyRows
    const stageFixed = 4 + 1 + 1
    const singerTall = (g: Group) => {
      const info = 3 + Math.min(g.working.length, MAX_TASK_LINES) + (g.working.length > MAX_TASK_LINES ? 1 : 0)
      return 1 + (withAvatars ? Math.max(AVATAR_ROWS + 1, info) : info + 1)
    }
    const stageNeed = onStage.length === 0 ? 3 : onStage.reduce((n, g) => n + singerTall(g), 0)
    // The room picture is as wide as the pane, and shrinks (keeping its shape)
    // when the pane is short, so the dressing room always stays in view.
    const naturalRows = Math.max(3, Math.floor(width / SCENE_COLS_PER_ROW))
    const spare = rows - stageFixed - Math.min(stageNeed, 7) - roomHead - notesRows
    const sceneRows = Math.max(3, Math.min(naturalRows, spare))
    const sceneCols = sceneRows * SCENE_COLS_PER_ROW
    const roomBody = withAvatars && e.surface === 'terminal' ? sceneRows : Math.max(1, Math.ceil(resting.length / Math.max(1, Math.floor(width / 11))))
    const roomRows = roomHead + roomBody + notesRows
    let budget = rows - stageFixed - roomRows
    const shown: Group[] = []
    for (const g of onStage) {
      const h = singerTall(g)
      // Always one singer; past that, only who fits (one row kept for "+N más").
      if (shown.length > 0 && h + 1 > budget) break
      shown.push(g)
      budget -= h
    }
    const hidden = onStage.length - shown.length

    // ── With pixels: two pictures, the stage and the room, sized together ──
    // Text around them: stage title 1, a line per singer, footer 1, room head 2,
    // notes, hint 1. The pictures share what is left and shrink (keeping their
    // shape) down to 3 rows each, so both halves always stay in view.
    const pictures = withAvatars && Image !== undefined && e.surface === 'terminal'
    const linesOf = (g: Group) => Math.min(g.working.length, MAX_TASK_LINES)
    const singerLines = onStage.reduce((n, g) => n + linesOf(g), 0)
    const textRows = 1 + singerLines + 1 + roomHead + notesRows + 1
    const stageNatural = Math.max(3, Math.floor(width / STAGE_COLS_PER_ROW))
    let stageRows = stageNatural
    let picRows = Math.max(3, Math.floor(width / SCENE_COLS_PER_ROW))
    while (stageRows + picRows + textRows > rows && (stageRows > 3 || picRows > 3)) {
      if (stageRows >= picRows && stageRows > 3) stageRows -= 1
      else picRows -= 1
    }
    const stageCols = Math.min(width, stageRows * STAGE_COLS_PER_ROW)
    const roomCols = Math.min(width, picRows * SCENE_COLS_PER_ROW)

    /** Under the stage picture, for each singer: name and time, then each task (up to 2). */
    const singerLine = (g: Group) => {
      const since = busySince.get(g.m.id) ?? nowMs
      const head = `${g.m.emoji} ${nameOf(g.m)}${times(g.working.length)} ${elapsed(nowMs - since)}`
      const headW = Array.from(head).length
      const tasks = g.working.slice(0, linesOf(g)).map(taskText)
      const more = g.working.length - tasks.length
      return (
        <Box key={`sing-${g.m.id}`} flexDirection="column">
          {tasks.map((t, k) =>
            k === 0 ? (
              <Text key={`sing-${g.m.id}-${k}`}>
                <Text bold color={PURPLE}>{head}</Text>
                <Text color={LILAC}> › {short(t, Math.max(4, width - headW - 3))}</Text>
              </Text>
            ) : (
              <Text key={`sing-${g.m.id}-${k}`} color={LILAC}>
                {' '.repeat(Math.min(headW, 4))}› {short(`${t}${more > 0 && k === tasks.length - 1 ? ` (+${more})` : ''}`, width - 6)}
              </Text>
            ),
          )}
        </Box>
      )
    }

    const singer = (g: Group) => {
      const tag = `${nameOf(g.m)}${times(g.working.length)}`
      // Each singer is a little out of step with the others, like a real line-up.
      const beat = frame + hash(g.m.id) % DANCE_STEPS.length
      const since = busySince.get(g.m.id) ?? nowMs
      const step = DANCE_STEPS[beat % DANCE_STEPS.length] ?? ''
      const tasks = g.working.slice(0, MAX_TASK_LINES)
      const more = g.working.length - tasks.length
      const info = (w: number) => [
        <Text>
          <Text bold color={PURPLE}>{short(tag, Math.max(4, Math.floor(w / 2)))}</Text>
          <Text color="#B9A3D6"> · {short(labelOf(g.m), Math.max(4, w - Array.from(tag).length - 3))}</Text>
        </Text>,
        <Text>
          <Text bold color="#FFFFFF" backgroundColor="#2A1840"> 🎤 CANTANDO </Text>
          <Text color={LILAC}> {elapsed(nowMs - since)}</Text>
        </Text>,
        <Text color={LILAC}>{short(`${step} ${NOTES[beat % NOTES.length]?.trim() ?? ''}`, w)}</Text>,
        ...tasks.map(s => <Text color={LILAC}>› {short(taskText(s), w - 2)}</Text>),
        ...(more > 0 ? [<Text color="#9C86B8">  +{more} más</Text>] : []),
      ]
      const frames = withAvatars ? CHIBI_FRAMES[g.m.id] : undefined
      if (frames && Image) {
        const textW = width - AVATAR_COLUMNS - DANCE_SWAY - 2
        // The sprite sways across a fixed-width spot and hops on the beat; notes float above.
        const png = beat % 2 === 1 ? frames[1] : frames[0]
        const pad = DANCE_PAD[beat % DANCE_PAD.length] ?? 0
        return (
          <Box key={g.m.id} flexDirection="column" marginTop={1}>
            <Box flexDirection="row">
              <Box flexDirection="column" width={AVATAR_COLUMNS + DANCE_SWAY}>
                <Box flexDirection="row" paddingLeft={pad}>
                  <Image key={`av-${g.m.id}`} source={{ png }} columns={AVATAR_COLUMNS} rows={AVATAR_ROWS} alt={g.m.emoji} />
                </Box>
                <Text color="#C9A8F0">{NOTES[beat % NOTES.length]}</Text>
              </Box>
              <Box flexDirection="column" marginLeft={1}>{info(textW)}</Box>
            </Box>
          </Box>
        )
      }
      const pose = (DANCE_TXT[beat % DANCE_TXT.length] ?? '($)').replace('$', g.m.emoji)
      return (
        <Box key={g.m.id} flexDirection="column" marginTop={1}>
          <Text color={PURPLE}>{' '.repeat(DANCE_PAD[beat % DANCE_PAD.length] ?? 0)}{pose} <Text color="#C9A8F0">{NOTES[beat % NOTES.length]}</Text></Text>
          {info(width - 2)}
        </Box>
      )
    }

    // Arcade characters: only the chibi and its name plate (colour = how its task went).
    const sleeperState = (g: Group): Sleeper['state'] =>
      g.error.length > 0 ? 'error' : g.done.length > 0 ? 'done' : 'rest'
    const room = withAvatars && Image !== undefined && e.surface === 'terminal'
      ? (
          <Image
            key="camerino-scene"
            source={{ png: scenePng(resting.map(g => ({ id: g.m.id, name: nameOf(g.m), state: sleeperState(g) })), Math.floor(frame / 3)) }}
            columns={sceneCols}
            rows={sceneRows}
            alt={`🛋️ ${resting.map(g => nameOf(g.m)).join(' · ')}`}
          />
        )
      : (
          <Box flexDirection="row" flexWrap="wrap">
            {resting.map(g => {
              const st = sleeperState(g)
              const color = st === 'error' ? ERROR : st === 'done' ? '#9FE0B0' : LILAC
              return (
                <Text key={`bed-name-${g.m.id}`} bold color={color}>
                  {g.m.emoji}{nameOf(g.m)}{'  '}
                </Text>
              )
            })}
          </Box>
        )

    if (pictures && Image !== undefined) {
      const sleepers = resting.map(g => ({ id: g.m.id, name: nameOf(g.m), state: sleeperState(g) }))
      return (
        <Box flexDirection="column" paddingX={1}>
          {/* ── Top half: the stage, a pixel concert stage ── */}
          <Text bold color={PURPLE}>
            🎭 ESCENARIO <Text color={LILAC}>{busy > 0 ? `· 🎤 en vivo ${SPOT[frame % SPOT.length]}` : '· vacío'}</Text>
          </Text>
          <Image
            key="stage-scene"
            source={{ png: stagePng(onStage.map(g => ({ id: g.m.id, name: nameOf(g.m) })), frame) }}
            columns={stageCols}
            rows={stageRows}
            alt={busy > 0 ? `🎤 ${onStage.map(g => nameOf(g.m)).join(' · ')}` : '🎭 escenario vacío'}
          />
          {onStage.map(singerLine)}
          <Text color={PURPLE}>{busy > 0 ? ` 🎶 ${busy} en escena 🎤` : ' 💜 todos descansan en el camerino'}</Text>

          {/* ── Bottom half: the dressing room ── */}
          <Text color="#5B3F7A">{'┄'.repeat(width)}</Text>
          <Text bold color={PURPLE}>🛋️ CAMERINO 🌙{resting.length === 0 ? <Text color="#9C86B8"> · vacío: ¡todos en escena! 🎤</Text> : null}</Text>
          <Image
            key="camerino-scene"
            source={{ png: scenePng(sleepers, Math.floor(frame / 3)) }}
            columns={roomCols}
            rows={picRows}
            alt={`🛋️ ${resting.map(g => nameOf(g.m)).join(' · ')}`}
          />
          {notes.length > 0 ? <Box flexDirection="column" marginTop={1}>{notes}</Box> : null}
          <Text color={LILAC}>{short(' /borahae · /borahae-rol · "usa a joonie para…"', width)}</Text>
        </Box>
      )
    }

    return (
      <Box flexDirection="column" paddingX={1}>
        {/* ── Top half: the stage, under the same night sky as the dressing room ── */}
        {Image && e.surface === 'terminal' && width >= 20 ? (
          <Box flexDirection="column">
            <Image
              key="stage-sky"
              source={{ png: stageBannerPng(width, 3, Math.floor(frame / 2), busy > 0) }}
              columns={width}
              rows={3}
              alt="🎭 ESCENARIO BORAHAE"
            />
            <Text color={LILAC}>{busy > 0 ? `🎤 en vivo: Borahae ${SPOT[frame % SPOT.length]}` : '🎭 telón abajo · borahae'}</Text>
          </Box>
        ) : (
          <Box borderStyle="round" borderColor={PURPLE} flexDirection="column" paddingX={1}>
            {Image ? (
              <Box flexDirection="row">
                <Image key="pane-heart-a" source={{ png: HEART_PNG }} columns={2} rows={1} alt="♥" />
                <Text bold color={PURPLE}> ESCENARIO BORAHAE </Text>
                <Image key="pane-heart-b" source={{ png: HEART_PNG }} columns={2} rows={1} alt="♥" />
              </Box>
            ) : (
              <Text bold color={PURPLE}>🎭 ESCENARIO BORAHAE 🎭</Text>
            )}
            <Text color={LILAC}>{busy > 0 ? `🎤 en vivo: Borahae ${SPOT[frame % SPOT.length]}` : '🎭 telón abajo · borahae'}</Text>
          </Box>
        )}
        {onStage.length === 0 ? (
          <Box flexDirection="column" marginTop={1}>
            <Text color="#9C86B8">  El escenario está vacío…</Text>
            <Text color="#9C86B8">  todos descansan abajo, en el camerino.</Text>
          </Box>
        ) : null}
        {shown.map(singer)}
        {hidden > 0 ? <Text color="#9C86B8">  +{hidden} más cantando en el coro 🎶</Text> : null}
        <Text color={PURPLE}>{busy > 0 ? ` 🎶 ${busy} en escena 🎤` : ' 💜💜💜💜💜💜💜'}</Text>

        {/* ── Bottom half: the dressing room ── */}
        <Text color="#5B3F7A">{'┄'.repeat(width)}</Text>
        <Text bold color={PURPLE}>🛋️ CAMERINO 🌙{resting.length === 0 ? <Text color="#9C86B8"> · vacío: ¡todos en escena! 🎤</Text> : null}</Text>
        {room}
        {notes.length > 0 ? <Box flexDirection="column" marginTop={1}>{notes}</Box> : null}
        <Text color={LILAC}>{short(' /borahae · /borahae-rol · "usa a joonie para…"', width)}</Text>
      </Box>
    )
  })

  // ── Band above the prompt: only while someone works ──────────────────
  // The band has no ground of its own: purple for what matters, theme keys
  // for the rest, so it reads on light and dark themes.
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey) return next(e)
    const all = await read($, crew)
    const gs = groups(all)
    const busy = gs.filter(g => g.working.length > 0)
    if (busy.length === 0) return next(e)
    const { Box, Text } = $.ui.resolve(e)
    const width = Math.max(10, e.props.bodyColumns)
    const tasks = busy.flatMap(g => g.working.map(s => ({ m: g.m, s })))
    return (
      <Box flexDirection="column">
        <Text>
          <Text color={PURPLE} bold>💜 Borahae </Text>
          {gs.map(g =>
            g.working.length > 0 ? (
              <Text color={PURPLE} bold>{g.m.emoji}{nameOf(g.m)}{times(g.working.length)} </Text>
            ) : (
              <Text color="subtle">{g.m.emoji} </Text>
            ),
          )}
          <Text color={PURPLE}>♡</Text>
        </Text>
        {tasks.map(({ m, s }) => (
          <Text color="text">  {m.emoji} {short(taskText(s), width - 6)}</Text>
        ))}
      </Box>
    )
  })

  // ── Spinner: the verbs of whoever works, else borahae ────────────────
  on('ui.render', { component: 'Spinner' }, async ($, e, next) => {
    if (e.surface !== 'terminal') return next(e)
    const all = await read($, crew).catch(() => ({}) as Crew)
    const verbs = groups(all)
      .filter(g => g.working.length > 0)
      .map(g => `${cap(g.m.name)} ${ROLE_SPECS[roleOf(g.m.id)].verb}`)
    const words = verbs.length > 0 ? verbs : IDLE_WORDS
    const word = words[hash(e.props.word) % words.length] ?? 'Borahae'
    return next({ ...e, props: { ...e.props, word, suffix: '… 💜' } })
  })

  // ── End-of-turn line: only the word changes ──────────────────────────
  on('ui.render', { component: 'TurnDuration' }, ($, e, next) =>
    next({ ...e, props: { ...e.props, word: '💜 Hecho con amor' } }),
  )

  // ── Your messages get a purple heart (terminal) ──────────────────────
  on('ui.render', { component: 'UserMessage' }, async ($, e, next) => {
    if (e.surface !== 'terminal' || e.props.origin.kind !== 'composer') return next(e)
    const { Box, Text } = $.ui.resolve(e)
    const row = await next(e)
    return (
      <Box flexDirection="row">
        <Text color={PURPLE}>💜 </Text>
        <Box flexGrow={1}>{row}</Box>
      </Box>
    )
  })

  // ── Prompt footer ─────────────────────────────────────────────────────
  on('ui.render', { component: 'PromptHint' }, ($, e, next) => {
    if (e.props.isDraft) return next(e)
    return next({ ...e, props: { ...e.props, tail: (e.props.tail ?? '') + ' · 💜 borahae' } })
  })
}
