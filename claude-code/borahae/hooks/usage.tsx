import type { EngineInterface, On, SessionRateLimit, Timer } from 'claude-code'

import { HEART_PNG } from './art'

// "💜 Tokens" pane: plan usage windows (5 h / weekly), time to reset,
// context window fill and session cost. Reads $.session.usage() on each draw
// (a free call) and redraws when usage moves and once a minute for the countdown.

export const USAGE_PANE = 'borahae-usage'
const TITLE = '💜 Tokens'
const PURPLE = '#A374DB'
const LILAC = '#D6B4FC'
const PANE_BG = '#1C1030'

const LABELS: Record<string, string> = {
  five_hour: 'Sesión · 5 h',
  seven_day: 'Semanal · 7 días',
  seven_day_opus: 'Semanal Opus',
  seven_day_sonnet: 'Semanal Sonnet',
  spend_limit: 'Límite de gasto',
}

const pad = (n: number) => String(n).padStart(2, '0')
const DAYS = ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb']

const untilText = (ms: number) => {
  if (ms <= 0) return 'ya se restableció'
  const min = Math.ceil(ms / 60000)
  const d = Math.floor(min / 1440)
  const h = Math.floor((min % 1440) / 60)
  const m = min % 60
  if (d > 0) return `${d}d ${h}h`
  if (h > 0) return `${h}h ${m}m`
  return `${m}m`
}

const atText = (when: Date, now: Date) => {
  const hm = `${pad(when.getHours())}:${pad(when.getMinutes())}`
  const sameDay = when.toDateString() === now.toDateString()
  return sameDay ? hm : `${DAYS[when.getDay()]} ${when.getDate()} · ${hm}`
}

const bar = (pct: number, width: number) => {
  const w = Math.max(6, Math.min(20, width))
  const full = Math.round((Math.min(100, Math.max(0, pct)) / 100) * w)
  return { on: '█'.repeat(full), off: '░'.repeat(w - full) }
}

// Purple while there is room, warning colors as the window fills.
const fillColor = (pct: number) => (pct >= 90 ? 'red' : pct >= 75 ? 'yellow' : PURPLE)

const fmtTokens = (n: number) =>
  n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : n >= 1000 ? `${Math.round(n / 1000)}k` : String(n)

let tick: Timer | undefined

/**
 * Hands the figures to herdr: its `borahae-tokens` sidebar block (above Spaces)
 * reads ~/.claude/borahae-usage.json. Never throws: it is decoration.
 */
export async function writeUsageFile($: EngineInterface) {
  try {
    const home = (await $.env.get('USERPROFILE')) ?? (await $.env.get('HOME'))
    if (!home) return
    const u = await $.session.usage()
    const data = {
      updatedAt: await $.clock.now(),
      rateLimits: u.rateLimits.map(r => ({
        kind: r.kind,
        label: LABELS[r.kind] ?? r.kind,
        percentUsed: r.percentUsed,
        resetsAt: r.resetsAt ?? null,
      })),
      context: { tokens: u.context.tokens ?? null, window: u.context.window, percent: u.context.percent ?? null },
      costUsd: u.cost?.usd ?? null,
    }
    await $.fs.write(`${home.replace(/\\/g, '/')}/.claude/borahae-usage.json`, JSON.stringify(data, null, 2))
  } catch {
    // ignore
  }
}

// Called from register.tsx's one session.start hook (a mod may hook it once).
export async function startUsage($: EngineInterface) {
  await $.command
    .register({ name: 'borahae-tokens', description: 'Muestra tus tokens y cuánto falta para que se restablezcan 💜' })
    .catch(() => undefined)
  // The tokens now live in herdr's sidebar, not as a tab beside the crew.
  void $.ui.close({ id: USAGE_PANE }).catch(() => undefined)
  await writeUsageFile($)
  tick?.cancel()
  try {
    tick = $.clock.every(60_000, () => void writeUsageFile($))
  } catch {
    tick = undefined
  }
}

export function registerUsage(on: On) {

  on('command.run', { command: 'borahae-tokens' }, async $ => {
    await writeUsageFile($)
    const u = await $.session.usage()
    const now = Date.now()
    const lines = u.rateLimits.map(r => {
      const left = Math.max(0, 100 - r.percentUsed)
      const reset = r.resetsAt ? `, se restablece en ${untilText(Date.parse(r.resetsAt) - now)}` : ''
      return `${LABELS[r.kind] ?? r.kind}: ${r.percentUsed}% usado, quedan ${left.toFixed(0)}%${reset}`
    })
    if (lines.length === 0) lines.push('Límites del plan: aún sin lectura (aparece tras la primera respuesta).')
    return { text: `💜 Tokens\n${lines.join('\n')}` }
  })

  on('session.measure', ($, e, next) => {
    void writeUsageFile($)
    return next(e)
  })

  on('ui.render', { component: 'Pane', requestId: USAGE_PANE }, async ($, e) => {
    const els = $.ui.resolve(e)
    const { Box, Text } = els
    const Image = 'Image' in els ? els.Image : undefined
    const u = await $.session.usage()
    const nowMs = await $.clock.now()
    const now = new Date(nowMs)
    const cols = Math.max(24, (e.props.bodyColumns ?? 40) - 2)
    const barW = cols - 8

    const windowCard = (r: SessionRateLimit) => {
      const used = r.percentUsed
      const left = Math.max(0, 100 - used)
      const b = bar(used, barW)
      const reset = r.resetsAt ? new Date(Date.parse(r.resetsAt)) : undefined
      return (
        <Box flexDirection="column" borderStyle="round" borderColor="#5B3F7A" paddingX={1}>
          <Text bold color={LILAC}>{LABELS[r.kind] ?? r.kind}</Text>
          <Text>
            <Text color={fillColor(used)}>{b.on}</Text>
            <Text color="#5B3F7A">{b.off}</Text>
            <Text bold color={fillColor(used)}> {used}%</Text>
          </Text>
          <Text color={LILAC}>♡ quedan {left.toFixed(left % 1 ? 1 : 0)}%</Text>
          {reset && (
            <Text color={LILAC}>
              ⏳ en {untilText(reset.getTime() - nowMs)} <Text color="#9C86B8">({atText(reset, now)})</Text>
            </Text>
          )}
        </Box>
      )
    }

    const ctx = u.context
    const ctxPct = ctx.percent ?? (ctx.tokens !== undefined ? Math.round((ctx.tokens / ctx.window) * 100) : undefined)

    if (e.props.placement === 'widget') {
      const first = u.rateLimits[0]
      return (
        <Text color={PURPLE}>
          💜 {first ? `${first.percentUsed}% · ${first.resetsAt ? untilText(Date.parse(first.resetsAt) - nowMs) : ''}` : 'sin lectura'}
        </Text>
      )
    }

    return (
      <Box flexDirection="column" paddingX={1}>
        <Box borderStyle="round" borderColor={PURPLE} paddingX={1}>
          {Image ? (
            <Box flexDirection="row">
              <Image key="tok-heart-a" source={{ png: HEART_PNG }} columns={2} rows={1} alt="♥" />
              <Text bold color={PURPLE}> TOKENS · borahae </Text>
              <Image key="tok-heart-b" source={{ png: HEART_PNG }} columns={2} rows={1} alt="♥" />
            </Box>
          ) : (
            <Text bold color={PURPLE}>💜 TOKENS ♡ borahae</Text>
          )}
        </Box>
        {u.rateLimits.length === 0 ? (
          <Text color={LILAC}>Límites del plan: aún sin lectura. Aparecen tras la primera respuesta del modelo.</Text>
        ) : (
          u.rateLimits.map(windowCard)
        )}
        <Box flexDirection="column" borderStyle="round" borderColor="#5B3F7A" paddingX={1}>
          <Text bold color={LILAC}>Contexto de esta conversación</Text>
          {ctx.tokens !== undefined ? (
            <>
              <Text>
                <Text color={fillColor(ctxPct ?? 0)}>{bar(ctxPct ?? 0, barW).on}</Text>
                <Text color="#5B3F7A">{bar(ctxPct ?? 0, barW).off}</Text>
                <Text bold color={fillColor(ctxPct ?? 0)}> {ctxPct ?? 0}%</Text>
              </Text>
              <Text color={LILAC}>
                {fmtTokens(ctx.tokens)} de {fmtTokens(ctx.window)} tokens · quedan {fmtTokens(Math.max(0, ctx.window - ctx.tokens))}
              </Text>
            </>
          ) : (
            <Text color={LILAC}>ventana de {fmtTokens(ctx.window)} tokens</Text>
          )}
        </Box>
        {u.cost && <Text color={LILAC}> 💸 costo de la sesión: ${u.cost.usd.toFixed(2)}</Text>}
        <Text color="#9C86B8"> /borahae-tokens · se actualiza cada minuto</Text>
      </Box>
    )
  })
}
