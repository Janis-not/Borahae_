import { expect, mock, test } from 'claude-code/testing'

const PANE = {
  plugin: 'borahae',
  component: 'Pane',
  requestId: 'borahae-crew',
  props: {
    title: '💜 Escenario Borahae',
    isFocused: false,
    bodyColumns: 40,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 45 },
    view: {},
  },
} as const


const SURFACES = ['terminal', 'desktop'] as const

// The engine's `$` takes the whole input, as the Agent tool's call site does.
const spawn = (n: number, description: string, subagentType: string) => ({
  tool_use_id: `toolu_${n}`,
  prompt: description,
  description,
  subagentType,
  provider: { plugin: 'borahae', tier: 'user' as const },
  parentModel: 'test-model',
  background: true,
  fork: false,
})

const end = (agentId: string, reason: 'answer' | 'aborted' | 'error' = 'answer') => ({
  answer: 'listo',
  durationMs: 1000,
  isAborted: reason === 'aborted',
  turnId: `turn-${agentId}`,
  agentId,
  reason,
})

test('spawn shows working, turn.complete shows done', async ($, on) => {
  // Each hook here stands for the engine beneath the plugin.
  on('agent.spawn', () => ({ model: 'test-model', agentId: 'a1' }))
  on('turn.complete', (_, e) => ({ text: e.answer }))

  await $.agent.spawn(spawn(1, 'investigar README', 'borahae:joonie'))

  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ ...PANE, surface })
    if (surface === 'terminal') {
      // The stage is a picture; its alt names who dances on it.
      expect((await ui.find({ type: 'Image', key: 'stage-scene' }))?.props.alt).toContain('JOONIE')
    } else {
      expect(await ui.find({ type: 'Text', text: /CANTANDO/ })).toBeDefined()
    }
    expect((await ui.find({ type: 'Text', text: /investigar README/ }))?.text).toContain('› investigar README')
    // Joonie is on stage, so no bed is theirs in the dressing room below.
    expect(await ui.find({ type: 'Text', text: /CAMERINO/ })).toBeDefined()
    if (surface === 'terminal') {
      // One picture for the room; its alt names who sleeps there.
      const scene = await ui.find({ type: 'Image', key: 'camerino-scene' })
      expect(scene?.props.alt).toContain('KOOKIE')
      expect(scene?.props.alt).not.toContain('JOONIE')
    } else {
      // No pixels elsewhere: only the names.
      expect(await ui.find({ type: 'Text', text: /💜KOOKIE/ })).toBeDefined()
      expect(await ui.find({ type: 'Text', text: /💙JOONIE/ })).toBeUndefined()
    }
    await ui.unmount()
  }

  // The spawn resolved at the start: only the subagent's turn.complete ends it.
  await $.turn.complete(end('a1'))

  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ ...PANE, surface })
    expect(await ui.find({ type: 'Text', text: /CANTANDO/ })).toBeUndefined()
    if (surface === 'terminal') {
      expect((await ui.find({ type: 'Image', key: 'stage-scene' }))?.props.alt).toContain('escenario vacío')
    } else {
      expect(await ui.find({ type: 'Text', text: /escenario está vacío/ })).toBeDefined()
    }
    expect((await ui.find({ type: 'Text', text: /investigar README/ }))?.text).toContain('JOONIE: investigar README')
    await ui.unmount()
  }
})

test('a denied spawn is shown as an error, never as done', async ($, on) => {
  on('agent.spawn', () => ({ deny: 'límite alcanzado' }))

  const r = await $.agent.spawn(spawn(2, 'auditar', 'borahae:kookie'))
  expect(r.deny).toBe('límite alcanzado')

  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ ...PANE, surface })
    expect((await ui.find({ type: 'Text', text: /auditar/ }))?.text).toContain('KOOKIE: auditar')
    await ui.unmount()
  }
})

test('the team rules reach the system prompt', async ($, on) => {
  on('prompt.compose', () => ({ sections: [{ id: 'intro', text: 'x', scope: 'shared' as const }] }))
  const r = await $.prompt.compose({ model: 'm', promptModel: 'm', surfaces: ['terminal'], tools: [], outputStyle: null, traits: [] })
  const team = r.sections.find(s => s.id === 'borahae:team')
  expect(team?.text).toContain('🔀 DELEGAR')
  expect(team?.text).toContain('borahae-memoria')
})

test('two concurrent instances of one member count ×2', async ($, on) => {
  // Ids follow the task, not arrival order, so 's1' is always "tarea uno".
  on('agent.spawn', (_, e) => ({ model: 'test-model', agentId: e.description === '' ? 's2' : 's1' }))
  on('turn.complete', (_, e) => ({ text: e.answer }))
  on('ui.status', () => ({ value: undefined }))

  await Promise.all([
    $.agent.spawn(spawn(3, 'tarea uno', 'borahae:meowmeow')),
    $.agent.spawn(spawn(4, '', 'borahae:meowmeow')),
  ])

  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ ...PANE, surface })
    expect((await ui.find({ type: 'Text', text: /MEOWMEOW ×2/ }))?.text).toContain('MEOWMEOW ×2')
    expect(await ui.find({ type: 'Text', text: /tarea uno/ })).toBeDefined()
    // An empty task reads as working, not blank.
    expect((await ui.find({ type: 'Text', text: /trabajando…/ }))?.text).toContain('trabajando…')
    await ui.unmount()
  }

  // One ends with an error: the other still works, and the count drops.
  await $.turn.complete(end('s1', 'error'))

  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ ...PANE, surface })
    expect(await ui.find({ type: 'Text', text: /×2/ })).toBeUndefined()
    expect((await ui.find({ type: 'Text', text: /trabajando…/ }))?.text).toContain('› trabajando…')
    await ui.unmount()
  }
})

test('the band draws nothing while nobody works', async ($, on) => {
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>engine</Text>
  })

  const band = {
    plugin: 'borahae',
    component: 'AbovePrompt',
    requestId: 'band',
    props: {
      hasSurvey: false,
      isCollapsed: false,
      isWorking: false,
      maxRows: 10,
      bodyColumns: 60,
      scroll: { offset: 0, bodyRows: 10 },
      view: {},
    },
  } as const

  const ui = await $.ui.mount({ ...band, surface: 'terminal' })
  expect((await ui.find({ type: 'Text' }))?.text).toBe('engine')
  await ui.unmount()
})

test('/borahae draws the crew as pixel avatars on the terminal', async $ => {
  const ui = await $.ui.mount({
    plugin: 'borahae',
    surface: 'terminal',
    component: 'CommandOutput',
    props: { command: 'borahae', args: '', text: 'x', isErrored: false },
  })
  expect(await ui.find({ type: 'Image', key: 'cmd-joonie' })).toBeDefined()
  expect(await ui.find({ type: 'Image', key: 'cmd-mochi' })).toBeDefined()
  await ui.unmount()
})

test('only whoever works dances on stage, as an avatar on the terminal', async ($, on) => {
  on('agent.spawn', () => ({ model: 'test-model', agentId: 'd1' }))
  await $.agent.spawn(spawn(9, 'bailar', 'borahae:meowmeow'))
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  const stage = await ui.find({ type: 'Image', key: 'stage-scene' })
  expect(stage?.props.alt).toContain('MEOWMEOW')
  expect(stage?.props.alt).not.toContain('JOONIE')
  expect(String((stage?.props.source as { png: string }).png).startsWith('iVBORw0KGgo')).toBe(true)
  // Below the stage, in the same panel: Joonie sleeps, Meowmeow has no bed.
  const scene = await ui.find({ type: 'Image', key: 'camerino-scene' })
  expect(scene?.props.alt).toContain('JOONIE')
  expect(scene?.props.alt).not.toContain('MEOWMEOW')
  expect(await ui.find({ type: 'Text', text: /CAMERINO/ })).toBeDefined()
  await ui.unmount()
})

test('free members sleep in the dressing room, each in a bed', async $ => {
  const ui = await $.ui.mount({ ...PANE, props: { ...PANE.props, scroll: { offset: 0, bodyRows: 40 } }, surface: 'terminal' })
  const scene = await ui.find({ type: 'Image', key: 'camerino-scene' })
  expect(scene?.props.alt).toContain('JOONIE')
  expect(scene?.props.alt).toContain('MOCHI')
  // A real PNG, as wide as the pane allows.
  expect(String((scene?.props.source as { png: string }).png).startsWith('iVBORw0KGgo')).toBe(true)
  expect(scene?.props.columns).toBeLessThanOrEqual(38)
  await ui.unmount()
})

test('without pixels, the sleepers are only their names', async $ => {
  const ui = await $.ui.mount({ ...PANE, props: { ...PANE.props, bodyColumns: 20 }, surface: 'terminal' })
  expect(await ui.find({ type: 'Image', key: 'camerino-scene' })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: /💜KOOKIE/ })).toBeDefined()
  await ui.unmount()
})

test('a short panel keeps the dressing room in view, smaller', async ($, on) => {
  on('agent.spawn', (_, e) => ({ model: 'test-model', agentId: e.description }))
  await $.agent.spawn(spawn(20, 'uno', 'borahae:meowmeow'))
  await $.agent.spawn(spawn(21, 'dos', 'borahae:hobi'))
  await $.agent.spawn(spawn(22, 'tres', 'borahae:wwh'))
  const ui = await $.ui.mount({ ...PANE, props: { ...PANE.props, scroll: { offset: 0, bodyRows: 18 } }, surface: 'terminal' })
  // Both pictures shrink so that everything fits in 18 rows.
  const scene = await ui.find({ type: 'Image', key: 'camerino-scene' })
  const stage = await ui.find({ type: 'Image', key: 'stage-scene' })
  expect(Number(scene?.props.rows) + Number(stage?.props.rows)).toBeLessThanOrEqual(10)
  expect(Number(scene?.props.rows)).toBeGreaterThanOrEqual(3)
  expect(await ui.find({ type: 'Text', text: /CAMERINO/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /HOBI/ })).toBeDefined()
  await ui.unmount()
})

test('/borahae-rol swaps a role and the agents follow', async ($, on) => {
  const registered: { name: string; description: string; prompt: string }[] = []
  on('agent.register', (_, e) => {
    registered.push(e as { name: string; description: string; prompt: string })
    return { value: { agent: e.name } }
  })
  const r = await $.command.run({ command: 'borahae-rol', args: 'kookie dev', origin: { kind: 'composer' }, presentation: { isFullscreen: true, columns: 100 } })
  expect(r.text).toContain('KOOKIE ahora es Desarrollador')
  const kookie = registered.filter(a => a.name === 'kookie').pop()
  expect(kookie?.description).toContain('Desarrollador')
  expect(kookie?.prompt).toContain('🔀 DELEGAR → borahae:')
  expect(kookie?.prompt).toContain('borahae-memoria')
})

test('Joonie is the PM by default and keeps their role', async ($, on) => {
  const registered: { name: string; description: string; prompt: string }[] = []
  on('agent.register', (_, e) => {
    registered.push(e as { name: string; description: string; prompt: string })
    return { value: { agent: e.name } }
  })
  await $.command.run({ command: 'borahae-rol', args: 'kookie qa', origin: { kind: 'composer' }, presentation: { isFullscreen: true, columns: 100 } })
  const joonie = registered.filter(a => a.name === 'joonie').pop()
  expect(joonie?.description).toContain('Project Manager y Documentador e Investigador')
  expect(joonie?.prompt).toContain('❓ DECISIÓN')
  expect(joonie?.prompt).toContain('🔀 CONSULTAR')
  const kookie = registered.filter(a => a.name === 'kookie').pop()
  expect(kookie?.prompt).toContain('es el PM del equipo')
  expect(kookie?.prompt).toContain('📋 TAREAS:')
})

test('/borahae-rol <miembro> pm moves the PM', async ($, on) => {
  const registered: { name: string; description: string; prompt: string }[] = []
  on('agent.register', (_, e) => {
    registered.push(e as { name: string; description: string; prompt: string })
    return { value: { agent: e.name } }
  })
  const r = await $.command.run({ command: 'borahae-rol', args: 'wwh pm', origin: { kind: 'composer' }, presentation: { isFullscreen: true, columns: 100 } })
  expect(r.text).toContain('WWH ahora es el PM')
  expect(registered.filter(a => a.name === 'wwh').pop()?.description).toContain('Project Manager')
  expect(registered.filter(a => a.name === 'joonie').pop()?.description).not.toContain('Project Manager')
})

test('the team rules route work through the PM and relay decisions', async ($, on) => {
  on('prompt.compose', () => ({ sections: [] }))
  const r = await $.prompt.compose({ model: 'm', promptModel: 'm', surfaces: ['terminal'], tools: [], outputStyle: null, traits: [] })
  const team = r.sections.find(s => s.id === 'borahae:team')?.text ?? ''
  expect(team).toContain('PM: Joonie (borahae:joonie)')
  expect(team).toContain('❓ DECISIÓN')
  expect(team).toContain('🔀 CONSULTAR')
  expect(team).toContain('tareas.md')
})

test('/borahae-tareas lists each run and the report task list', async ($, on) => {
  mock.store(on)
  mock.clock(on, { now: Date.UTC(2026, 10, 21, 15, 0) })
  on('agent.spawn', () => ({ model: 'test-model', agentId: 'a7' }))
  on('turn.complete', (_, e) => ({ text: e.answer }))
  await $.agent.spawn(spawn(7, 'documentar el fondo', 'borahae:joonie'))
  let r = await $.command.run({ command: 'borahae-tareas', args: '', origin: { kind: 'composer' }, presentation: { isFullscreen: true, columns: 100 } })
  expect(r.text).toContain('⏳ documentar el fondo')
  await $.turn.complete({
    ...end('a7'),
    answer: 'Informe.\n\n📋 TAREAS:\n- ✔ Leí AGENTS.md\n- ⏳ Probar la opacidad (hobi)\n\n📝 MEMORIA: nada nuevo',
  })
  r = await $.command.run({ command: 'borahae-tareas', args: 'joonie', origin: { kind: 'composer' }, presentation: { isFullscreen: true, columns: 100 } })
  expect(r.text).toContain('✔ documentar el fondo')
  expect(r.text).toContain('- ✔ Leí AGENTS.md')
  expect(r.text).toContain('- ⏳ Probar la opacidad (hobi)')
  expect(r.text).toContain('1 terminadas')
})
