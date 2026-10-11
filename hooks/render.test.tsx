import { expect, mock, test } from 'claude-code/testing'

const DRIVE = '/Users/me/My Drive/docs/Bassfallen_Wohnzimmer'
const FILE = `${DRIVE}/Bassfallen-Rechner.html`
const FS: Record<string, 'file' | 'dir'> = {
  '/Users/me/My Drive/docs': 'dir',
  [DRIVE]: 'dir',
  [FILE]: 'file',
  '/Users/me/src/shop/hooks/register.tsx': 'file',
}

/** Children of a folder in the pretend file system, as `$.fs.list` names them. */
function children(dir: string, links: Set<string>) {
  const names = new Map<string, 'file' | 'dir'>()
  for (const [p, kind] of Object.entries(FS)) {
    const parts = p.split('/')
    for (let i = 1; i < parts.length; i++) {
      const parent = parts.slice(0, i).join('/') || '/'
      if (parent === dir) names.set(parts[i]!, i === parts.length - 1 ? kind : 'dir')
    }
  }
  return [...names].map(([name, kind]) => {
    const full = `${dir === '/' ? '' : dir}/${name}`
    const isLink = links.has(full)
    return { name, kind: isLink ? 'other' : kind, size: 0, mtimeMs: 0, isLink }
  })
}

/** Stand-in for the engine beneath the plugin: draws the reply's text as markdown. */
function engine(on: any, links = new Set<string>()) {
  mock.clock(on)
  mock.store(on)
  const stats: string[] = []
  const lists: string[] = []
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
    return { value: { kind: 'dir', size: 0, mtimeMs: 0, isLink: false, realPath: e.path } }
  })
  on('fs.list', (_$: any, e: any) => {
    lists.push(e.path)
    return { value: children(e.path, links) }
  })
  return { stats, lists }
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

test('a path that runs through a symlink is not linked: no link is ever followed', async ($, on) => {
  engine(on, new Set(['/Users/me/src/shop/hooks']))
  await start($)
  const text = 'see hooks/register.tsx'
  expect(await drawn(await reply($, text, 'terminal'))).toBe(text)
})

test('a second drawing lists nothing again, and only roots are ever stat-ed', async ($, on) => {
  const { stats, lists } = engine(on)
  await start($)
  await reply($, FILE, 'terminal')
  const first = lists.length
  expect(first).toBeGreaterThan(0)
  await reply($, FILE, 'terminal')
  expect(lists.length).toBe(first)
  // only trusted roots are ever stat-ed, never a path from the reply
  for (const p of stats) expect(['/Users', '/Users/me', '/Users/me/src/shop'].includes(p)).toBe(true)
})
