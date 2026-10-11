/**
 * Renders the README images from the mod's own rewrite (hooks/paths.ts): the
 * sample reply runs through `rewrite` against a pretend file system, and the
 * markdown links it returns are what the pictures underline. So every image
 * shows exactly the links the mod draws.
 *
 *   npm run screenshots   # docs/*.png, docs/demo.gif, docs/social.png, .claude-plugin/icon.png
 *
 * Needs Playwright's Chromium (`npx playwright install chromium`) and ffmpeg
 * for the GIF.
 */
import { execFileSync } from 'node:child_process'
import { mkdirSync, readFileSync, rmSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { chromium } from 'playwright'

import { DEFAULT_PREFS, rewrite } from '../hooks/paths.ts'
import type { Ctx, Kind } from '../hooks/paths.ts'

const ROOT = resolve(import.meta.dirname, '..')
const DOCS = join(ROOT, 'docs')
const TMP = join(DOCS, '.render')

const DIR = '/Users/me/My Drive/docs/apartment/Bassfallen_Wohnzimmer'
const FILE = `${DIR}/Bassfallen-Rechner.html`
const CTX: Ctx = { home: '/Users/me', cwd: '/Users/me/src/shop' }
const FS: Record<string, Kind> = {
  [FILE]: 'file',
  [`${DIR}/2026-10_Plan_Bassfallen.md`]: 'file',
  '/Users/me/src/shop/src/routes/login.ts': 'file',
}
const look = (abs: string) => FS[abs]

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

/** Opens what, for the hover card: folders in the file manager, files in their app. */
const opens = (url: string) => {
  const path = decodeURI(url.replace('file://', '')).replace(/%23/g, '#')
  const name = path.replace(/\/$/, '').split('/').pop()
  return url.endsWith('/') ? `📂 opens <b>${esc(name!)}</b> in Finder` : `📄 opens <b>${esc(name!)}</b> in its app`
}

/**
 * The few markdown forms the rewrite produces, as HTML: links (each with its
 * index, so a picture can hover one), escapes, inline code, fenced blocks.
 */
function mdToHtml(md: string, hover = -1): string {
  let n = 0
  const inline = (s: string) =>
    s
      .split(/(`[^`]+`)/)
      .map(part => {
        if (part.startsWith('`')) return `<span class="code">${esc(part.slice(1, -1))}</span>`
        return part.replace(/\[((?:\\.|[^\]])*)\]\((file:[^)]*)\)|\\(.)|([^[\\]+|.)/g, (_m, label, url, escd, text) => {
          if (url) {
            const i = n++
            const name = (label as string).replace(/\\(.)/g, '$1')
            const card = i === hover ? `<span class="card">${opens(url)}</span>` : ''
            return `<span class="lnk${i === hover ? ' hov' : ''}" title="${esc(url)}">${esc(name)}${card}</span>`
          }
          return esc(escd ?? text)
        })
      })
      .join('')
  const out: string[] = []
  const lines = md.split('\n')
  for (let i = 0; i < lines.length; i++) {
    if (lines[i]!.startsWith('```')) {
      const body: string[] = []
      for (i++; i < lines.length && !lines[i]!.startsWith('```'); i++) body.push(esc(lines[i]!))
      out.push(`<div class="fence">${body.join('\n')}</div>`)
      continue
    }
    out.push(`<div class="ln">${inline(lines[i]!.replace(/ {2}$/, '')) || '&nbsp;'}</div>`)
  }
  return out.join('')
}

const linksIn = (md: string) => [...md.matchAll(/\]\((file:[^)]*)\)/g)].length

const CSS = `
*{box-sizing:border-box}
body{margin:0;background:transparent;font-family:"SF Mono",Menlo,"JetBrains Mono",monospace;font-size:15px;color:#e6edf3}
.win{background:#0d1117;border:1px solid #30363d;border-radius:12px;overflow:visible;box-shadow:0 18px 50px rgba(0,0,0,.45)}
.bar{display:flex;align-items:center;gap:8px;padding:11px 14px;border-bottom:1px solid #21262d}
.dot{width:12px;height:12px;border-radius:50%}
.title{flex:1;text-align:center;color:#8b949e;font-size:13px;margin-right:52px}
.body{padding:18px 22px 22px;line-height:1.65;white-space:pre-wrap}
.you{color:#8b949e}.you b{color:#e6edf3;font-weight:400}
.bullet{color:#e6edf3}
.reply{margin-top:14px;padding-left:22px}
.reply .ln:first-child{margin-left:-22px}
.ln{min-height:1.65em}
.lnk{position:relative;text-decoration:underline;text-decoration-color:#58a6ff88;text-underline-offset:3px;color:#e6edf3}
.lnk.hov{color:#79c0ff;text-decoration-color:#79c0ff;background:#1f6feb33;border-radius:3px}
.card{position:absolute;left:0;top:-38px;z-index:3;white-space:nowrap;background:#161b22;border:1px solid #30363d;border-radius:8px;padding:6px 10px;font-family:-apple-system,"Segoe UI",sans-serif;font-size:13px;color:#c9d1d9;box-shadow:0 8px 24px rgba(0,0,0,.5);text-decoration:none}
.card b{color:#79c0ff;font-weight:600}
.code{color:#a5d6ff;background:#161b22;border-radius:4px;padding:0 4px}
.fence{background:#161b22;border:1px solid #21262d;border-radius:8px;padding:10px 14px;margin:6px 0;color:#a5d6ff;white-space:pre}
#shot{padding:24px}
.cap{color:#8b949e;font-size:12.5px;padding:0 0 6px 2px;font-family:-apple-system,"Segoe UI",sans-serif}
.cols{display:flex;gap:18px}.cols>div{flex:1}
.prompt{border-top:1px solid #30363d;border-bottom:1px solid #30363d;margin-top:16px;padding:6px 0;color:#8b949e}
`

function frame(title: string, inner: string) {
  return `<style>${CSS}</style><div class="win"><div class="bar"><span class="dot" style="background:#ff5f57"></span><span class="dot" style="background:#febc2e"></span><span class="dot" style="background:#28c840"></span><span class="title">${esc(title)}</span></div><div class="body">${inner}</div></div>`
}

function transcript(asked: string, md: string, hover = -1, withPrompt = true) {
  const body = mdToHtml(md, hover).replace('<div class="ln">', '<div class="ln"><span class="bullet">⏺ </span>')
  return `<div class="you">❯ <b>${esc(asked)}</b></div><div class="reply">${body}</div>${withPrompt ? '<div class="prompt">❯ </div>' : ''}`
}

const REPLY = `Der Rechner liegt hier:\n\n${FILE}\n\nÖffnen per Doppelklick im Finder, er läuft offline im Browser.`
const ASKED = 'wo liegt der Bassfallen-Rechner?'

async function main() {
  rmSync(TMP, { recursive: true, force: true })
  mkdirSync(join(TMP, 'f'), { recursive: true })
  const browser = await chromium.launch()
  const page = await browser.newPage({ deviceScaleFactor: 2, viewport: { width: 1280, height: 900 } })

  async function shoot(name: string, html: string, out = join(DOCS, `${name}.png`), width = 1160) {
    await page.setViewportSize({ width, height: 900 })
    await page.setContent(`<body><div id="shot">${html}</div></body>`)
    await page.locator('#shot').screenshot({ path: out, omitBackground: true })
  }

  const linked = rewrite(REPLY, CTX, DEFAULT_PREFS, look)
  const count = linksIn(linked)
  if (count !== 7) throw new Error(`expected 7 links in the sample, got ${count}`)

  // Hero: the folder holding the file, hovered.
  await shoot('hero', frame('claude — ~/src/shop', transcript(ASKED, linked, 5)))

  // Before / after.
  const plain = `<div class="cap">without path-links: text</div>${frame('claude', transcript(ASKED, REPLY, -1, false))}`
  const after = `<div class="cap">with path-links: every folder and the file is a link</div>${frame('claude', transcript(ASKED, linked, -1, false))}`
  await shoot('before-after', `<div class="cols"><div>${plain}</div><div>${after}</div></div>`, undefined, 1500)

  // A code block stays copyable; its path follows on a line of its own.
  const block = rewrite(
    `Aus dem Terminal öffnest du ihn mit:\n\n\`\`\`\n! open "${FILE}"\n\`\`\`\n\nund die Route liegt in src/routes/login.ts:42.`,
    CTX,
    DEFAULT_PREFS,
    look,
  )
  await shoot('codeblock', frame('claude — ~/src/shop', transcript('und aus dem terminal?', block, linksIn(block) - 1)))

  // Mode file: the whole path one link.
  const whole = rewrite(REPLY, CTX, { ...DEFAULT_PREFS, mode: 'file' }, look)
  await shoot('mode-file', frame('claude — /path-links file', transcript(ASKED, whole, 0, false)))

  // Demo: the pointer walks the path, segment by segment, and holds on the file.
  const order = [-1, 0, 1, 2, 3, 4, 5, 6, 6, 6]
  let f = 0
  for (const hov of order) {
    const html = frame('claude — ~/src/shop', transcript(ASKED, linked, hov))
    for (let k = 0; k < (hov === -1 ? 3 : 2); k++) {
      await shoot('frame', html, join(TMP, 'f', `f${String(f++).padStart(3, '0')}.png`))
    }
  }
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-framerate', '2', '-i', join(TMP, 'f', 'f%03d.png'), '-vf', 'scale=1160:-1:flags=lanczos,split[a][b];[a]palettegen=reserve_transparent=1[p];[b][p]paletteuse=dither=none', '-loop', '0', join(DOCS, 'demo.gif')])

  // Listing icon.
  const icon = await browser.newPage({ viewport: { width: 1024, height: 1024 }, deviceScaleFactor: 1 })
  await icon.setContent(`<body style="margin:0">${readFileSync(join(DOCS, 'icon.svg'), 'utf8')}</body>`)
  await icon.locator('svg').screenshot({ path: join(ROOT, '.claude-plugin', 'icon.png') })

  // Social preview, 1280×640.
  const social = await browser.newPage({ viewport: { width: 1280, height: 640 }, deviceScaleFactor: 1 })
  const crumb = mdToHtml(rewrite('/Users/me/My Drive/docs/apartment/Bassfallen_Wohnzimmer/Bassfallen-Rechner.html', CTX, DEFAULT_PREFS, look), 4)
  await social.setContent(`<style>${CSS}
body{width:1280px;height:640px;overflow:hidden;margin:0;padding:64px 72px 64px;font-family:-apple-system,"SF Pro Display","Segoe UI",sans-serif;color:#e6edf3;
background:radial-gradient(1000px 500px at 85% 0%,#1f6feb40,transparent),radial-gradient(800px 500px at 0% 100%,#d9775730,transparent),#0d1117;display:flex;flex-direction:column}
.kicker{font-size:22px;letter-spacing:.18em;text-transform:uppercase;color:#8b949e;font-weight:600}
h1{font-size:96px;line-height:1;margin:14px 0 12px;font-weight:800;letter-spacing:-.02em}
h1 span{color:#79c0ff}
p{font-size:30px;color:#c9d1d9;max-width:1050px;line-height:1.3;margin:0}
.term{margin-top:auto;background:#0d1117ee;border:1px solid #30363d;border-radius:14px;padding:22px 26px 46px;font-family:"SF Mono",Menlo,monospace;font-size:20px;line-height:1.7;box-shadow:0 20px 60px rgba(0,0,0,.5)}
.card{font-size:17px;top:34px}
</style>
<div class="kicker">Claude Code mod</div>
<h1>path<span>-</span>links</h1>
<p>Click a folder in a path to open it in Finder. Click the file name to open the file.</p>
<div class="term">${crumb}</div>`)
  await social.screenshot({ path: join(DOCS, 'social.png') })

  await browser.close()
  rmSync(TMP, { recursive: true, force: true })
  console.log('docs/: hero.png before-after.png codeblock.png mode-file.png demo.gif social.png · .claude-plugin/icon.png')
}

await main()
