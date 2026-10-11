import { expect, mock, test } from 'claude-code/testing'

const DRIVE = '/Users/me/My Drive/docs/Bassfallen_Wohnzimmer'
const FILE = `${DRIVE}/Bassfallen-Rechner.html`
const FS: Record<string, 'file' | 'dir'> = {
  '/Users/me/My Drive/docs': 'dir',
  [DRIVE]: 'dir',
  [FILE]: 'file',
  '/Users/me/src/shop/hooks/register.tsx': 'file',
}

/** Stand-in for the engine beneath the plugin: draws the reply's text as markdown. */
function engine(on: any, real = (p: string) => p) {
  mock.clock(on)
  mock.store(on)
  const stats: string[] = []
  on('ui.render', ($: any, e: any) => {
    const { Markdown } = $.ui.resolve(e)
    return <Markdown text={e.props.text} />
  })
  on('session.start', (_$: any, e: any) => ({ cwd: e.cwd }))
  on('session.cwd', () => ({ value: '/Users/me/src/shop' }))
  on('env.get', (_$: any, e: any) => ({ value: e.name === 'HOME' || e.key === 'HOME' ? '/Users/me' : undefined }))
  on('command.register', () => ({ value: undefined }))
  on('fs.stat', (_$: any, e: any) => {
    stats.push(e.path)
    const kind = FS[e.path]
    if (!kind) throw new Error(`ENOENT: ${e.path}`)
    return { value: { kind, size: 0, mtimeMs: 0, isLink: false, realPath: real(e.path) } }
  })
  return { stats }
}

const start = ($: any) => $.session.start({ cwd: '/Users/me/src/shop', surface: 'terminal', isInteractive: true })
const reply = ($: any, text: string, surface: 'terminal' | 'desktop') =>
  $.ui.mount({ plugin: 'path-links', component: 'AssistantMessage', props: { text, isFirstOfReply: true }, surface, viewport: { columns: 120, rows: 40 } })
const drawn = async (ui: any) => (await ui.findAll({ type: 'Markdown' })).map((m: any) => m.text ?? m.props?.text).join('\n')

for (const surface of ['terminal', 'desktop'] as const) {
  test(`a path in a reply is drawn as one link per folder plus the file (${surface})`, async ($, on) => {
    engine(on)
    await start($)
    const md = await drawn(await reply($, `Der Rechner liegt hier:\n\n${FILE}`, surface))
    expect(md).toContain('[My Drive](file:///Users/me/My%20Drive/)')
    expect(md).toContain('[Bassfallen\\_Wohnzimmer](file:///Users/me/My%20Drive/docs/Bassfallen_Wohnzimmer/)')
    expect(md).toContain('[Bassfallen-Rechner.html](file:///Users/me/My%20Drive/docs/Bassfallen_Wohnzimmer/Bassfallen-Rechner.html)')
  })
}

test('a reply without existing paths is drawn exactly as written', async ($, on) => {
  engine(on)
  await start($)
  const text = 'Nothing at /Users/me/gone.txt, and/or here.'
  expect(await drawn(await reply($, text, 'terminal'))).toBe(text)
})

test('relative paths resolve against the working directory', async ($, on) => {
  engine(on)
  await start($)
  const md = await drawn(await reply($, 'see hooks/register.tsx:12', 'terminal'))
  expect(md).toContain('[register.tsx](file:///Users/me/src/shop/hooks/register.tsx):12')
})

test('/path-links off turns the links off, segments brings them back', async ($, on) => {
  engine(on)
  await start($)
  await ($ as any).command.run({ command: 'path-links', args: 'off' })
  expect(await drawn(await reply($, FILE, 'terminal'))).toBe(FILE)
  await ($ as any).command.run({ command: 'path-links', args: 'segments' })
  expect(await drawn(await reply($, FILE, 'terminal'))).toContain('file://')
})

test('a path whose link leads out of the allowed roots is not linked', async ($, on) => {
  engine(on, p => `/Volumes/share${p}`)
  await start($)
  const text = 'see hooks/register.tsx'
  expect(await drawn(await reply($, text, 'terminal'))).toBe(text)
})

test('a second drawing of the same reply stats nothing again', async ($, on) => {
  const { stats } = engine(on)
  await start($)
  await reply($, FILE, 'terminal')
  const first = stats.length
  expect(first).toBeGreaterThan(0)
  await reply($, FILE, 'terminal')
  expect(stats.length).toBe(first)
})
