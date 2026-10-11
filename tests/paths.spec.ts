import { test } from 'node:test'
import assert from 'node:assert/strict'

import { DEFAULT_PREFS, escapeLabel, fileUrl, linkPath, probes, resolvePath, rewrite } from '../hooks/paths.ts'
import type { Ctx, Kind, Prefs } from '../hooks/paths.ts'

const CTX: Ctx = { home: '/Users/me', cwd: '/Users/me/src/shop' }
const DRIVE = '/Users/me/My Drive/docs/Bassfallen_Wohnzimmer'
const FS: Record<string, Kind> = {
  '/Users': 'dir',
  '/Users/me': 'dir',
  '/Users/me/My Drive': 'dir',
  '/Users/me/My Drive/docs': 'dir',
  [DRIVE]: 'dir',
  [`${DRIVE}/Bassfallen-Rechner.html`]: 'file',
  [`${DRIVE}/2026-10_Plan_Bassfallen.md`]: 'file',
  '/Users/me/src/shop': 'dir',
  '/Users/me/src/shop/hooks': 'dir',
  '/Users/me/src/shop/hooks/register.tsx': 'file',
  '/Users/me/notes.md': 'file',
  '/etc': 'dir',
  '/etc/hosts': 'file',
  '/tmp/a#b?(c).txt': 'file',
  '/Users/me/Über.md': 'file',
}
const look = (abs: string) => FS[abs]
const run = (text: string, prefs: Partial<Prefs> = {}) => rewrite(text, CTX, { ...DEFAULT_PREFS, ...prefs }, look)
const hrefs = (md: string) => [...md.matchAll(/\]\((file:[^)]*)\)/g)].map(m => decodeURI(m[1]!))

test('resolvePath folds absolute, home and relative spellings', () => {
  assert.equal(resolvePath('/a/./b/../c', CTX), '/a/c')
  assert.equal(resolvePath('~/x', CTX), '/Users/me/x')
  assert.equal(resolvePath('hooks/r.tsx', CTX), '/Users/me/src/shop/hooks/r.tsx')
  assert.equal(resolvePath('../up', CTX), '/Users/me/src/up')
  assert.equal(resolvePath('hooks/r.tsx', CTX, false), undefined)
  assert.equal(resolvePath('~/x', {}), undefined)
})

test('fileUrl encodes spaces, umlauts and the characters a URL would misread; folders end in /', () => {
  assert.equal(fileUrl('/Users/me/My Drive', 'dir'), 'file:///Users/me/My%20Drive/')
  assert.equal(fileUrl('/tmp/a#b?(c).txt', 'file'), 'file:///tmp/a%23b%3F%28c%29.txt')
  assert.equal(fileUrl('/Users/me/Über.md', 'file'), 'file:///Users/me/%C3%9Cber.md')
})

test('escapeLabel keeps markdown from reading underscores and brackets as markup', () => {
  assert.equal(escapeLabel('Bassfallen_Wohnzimmer'), 'Bassfallen\\_Wohnzimmer')
  assert.equal(escapeLabel('[a]*b*'), '\\[a\\]\\*b\\*')
})

test('a path with spaces in running text: every folder and the file a link of its own', () => {
  const out = run(`Der Rechner liegt hier:\n\n${DRIVE}/Bassfallen-Rechner.html\n\nÖffnen per Doppelklick.`)
  assert.deepEqual(hrefs(out), [
    'file:///Users/',
    'file:///Users/me/',
    'file:///Users/me/My Drive/',
    'file:///Users/me/My Drive/docs/',
    `file://${DRIVE}/`,
    `file://${DRIVE}/Bassfallen-Rechner.html`,
  ])
  assert.ok(out.includes('[My Drive](file:///Users/me/My%20Drive/)'))
  assert.ok(out.includes('[Bassfallen-Rechner.html]('))
  assert.ok(out.startsWith('Der Rechner liegt hier:\n\n/[Users]('), 'the root slash stays plain text')
  assert.ok(out.endsWith('\n\nÖffnen per Doppelklick.'))
})

test('the words after a path are not swallowed into it', () => {
  const out = run(`Open ${DRIVE}/Bassfallen-Rechner.html in the browser.`)
  assert.ok(out.endsWith('Bassfallen-Rechner.html) in the browser.'))
})

test('trailing punctuation and a closing bracket the path did not open stay outside', () => {
  assert.ok(run('see /etc/hosts.').endsWith('[hosts](file:///etc/hosts).'))
  assert.ok(run('(see /etc/hosts)').endsWith('[hosts](file:///etc/hosts))'))
})

test('a :line suffix stays as text after the file link', () => {
  const out = run('look at hooks/register.tsx:42:7 now')
  assert.ok(out.includes('[register.tsx](file:///Users/me/src/shop/hooks/register.tsx):42:7 now'))
})

test('~ and relative spellings are kept as written but link to where they land', () => {
  assert.equal(run('~/notes.md'), '[\\~](file:///Users/me/)/[notes.md](file:///Users/me/notes.md)')
  assert.equal(
    run('hooks/register.tsx'),
    '[hooks](file:///Users/me/src/shop/hooks/)/[register.tsx](file:///Users/me/src/shop/hooks/register.tsx)',
  )
  assert.equal(run('hooks/register.tsx', { relative: false }), 'hooks/register.tsx')
})

test('a path that does not exist is left exactly as written', () => {
  const t = 'nothing at /Users/me/gone.txt or and/or here'
  assert.equal(run(t), t)
})

test('links, autolinks and URLs are never touched', () => {
  const t = 'see [the file](/etc/hosts), <file:///etc/hosts> and https://x.io/etc/hosts'
  assert.equal(run(t), t)
})

test('inline code holding just a path becomes the links, without the backticks', () => {
  assert.equal(run('edit `/etc/hosts`'), 'edit /[etc](file:///etc/)/[hosts](file:///etc/hosts)')
})

test('inline code holding a command stays code; its paths follow on a line of their own', () => {
  const out = run(`run \`open "${DRIVE}/Bassfallen-Rechner.html"\` to open it`)
  const [first, second] = out.split('\n')
  assert.equal(first, `run \`open "${DRIVE}/Bassfallen-Rechner.html"\` to open it  `)
  assert.ok(second!.startsWith('↳ /[Users]('))
  assert.ok(second!.endsWith('[Bassfallen-Rechner.html](file:///Users/me/My%20Drive/docs/Bassfallen_Wohnzimmer/Bassfallen-Rechner.html)'))
})

test('a fenced block stays copyable as written; the paths it names follow it', () => {
  const block = ['```', `! open "${DRIVE}/Bassfallen-Rechner.html"`, '```']
  const out = run(block.join('\n')).split('\n')
  assert.deepEqual(out.slice(0, 3), block)
  assert.equal(out[3], '')
  assert.ok(out[4]!.startsWith('↳ '))
  assert.equal(hrefs(out[4]!).at(-1), `file://${DRIVE}/Bassfallen-Rechner.html`)
  assert.deepEqual(run(block.join('\n'), { codeBlocks: false }).split('\n'), block)
})

test('an unclosed fence (a reply still streaming) gets no line yet', () => {
  const t = ['```sh', 'cat /etc/hosts'].join('\n')
  assert.equal(run(t), t)
})

test('the line under a block lists each path once, three at most', () => {
  const block = ['```', 'cat /etc/hosts /etc/hosts ~/notes.md hooks/register.tsx /Users/me/Über.md', '```'].join('\n')
  const line = run(block).split('\n').at(-1)!
  assert.equal(line.split('  ·  ').length, 3)
})

test('a quoted path is taken whole, spaces and all', () => {
  const out = run(`"${DRIVE}/Bassfallen-Rechner.html"`)
  assert.equal(hrefs(out).length, 6)
  assert.ok(out.startsWith('"/[Users]') && out.endsWith(')"'))
})

test('mode file: the whole spelling is one link', () => {
  assert.equal(run('see /etc/hosts', { mode: 'file' }), 'see [/etc/hosts](file:///etc/hosts)')
})

test('mode off and text without a slash come back untouched', () => {
  assert.equal(run('see /etc/hosts', { mode: 'off' }), 'see /etc/hosts')
  assert.equal(run('no paths here'), 'no paths here')
})

test('a folder path ending in / links the folder', () => {
  assert.equal(run('/etc/'), '/[etc](file:///etc/)/')
})

test('probes names every path rewrite would look up, and rewrite asks for nothing else', () => {
  const texts = [
    `Open ${DRIVE}/Bassfallen-Rechner.html, then /etc/hosts.`,
    'a/b.html,/etc/hosts and `cat ~/notes.md`',
    ['```', 'open "/etc/hosts"', '```'].join('\n'),
  ]
  for (const t of texts) {
    const asked = new Set(probes(t, CTX, DEFAULT_PREFS))
    rewrite(t, CTX, DEFAULT_PREFS, abs => {
      assert.ok(asked.has(abs), `rewrite looked up ${abs}, which probes did not name`)
      return look(abs)
    })
  }
})

test('linkPath with a missing home leaves the ~ segment as text', () => {
  const out = linkPath({ spelled: '~/x', abs: '/h/x', kind: 'file', suffix: '' }, {}, 'segments')
  assert.equal(out, '\\~/[x](file:///h/x)')
})

test('when a shorter spelling exists too, the longest existing one wins', () => {
  const both = (abs: string) => (abs === '/Users/me/My' ? 'dir' : abs === '/Users/me/My Drive/notes.md' ? 'file' : look(abs))
  const out = rewrite('see /Users/me/My Drive/notes.md now', CTX, DEFAULT_PREFS, both)
  assert.ok(out.includes('[notes.md](file:///Users/me/My%20Drive/notes.md) now'), out)
})

test('automounter roots are never looked up, so a reply cannot make the machine contact a host', () => {
  const asked = probes('see /net/fileserver/share/x.txt and /Network/Servers/h/y and /home/u/z and /afs/cell/a', CTX, DEFAULT_PREFS)
  assert.deepEqual(asked.filter(p => /^\/(net|Network|home|afs)(\/|$)/.test(p)), [])
  assert.ok(probes('see /etc/hosts', CTX, DEFAULT_PREFS).includes('/etc/hosts'))
})
