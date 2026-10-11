/**
 * The whole of path-links that does not need the engine: find file system
 * paths in an assistant reply's markdown and turn them into `file://` links,
 * one per path segment, so a click on a folder opens that folder and a click
 * on the file name opens the file.
 *
 * Pure: whether a path exists comes in through `look`, so the hook can stat
 * first (`probes`) and rewrite second (`rewrite`) with the same scanner.
 */

export type Kind = 'file' | 'dir'
export type Mode = 'segments' | 'file' | 'off'

export type Prefs = {
  /** segments: every folder and the file are links · file: the whole path is one link · off */
  mode: Mode
  /** Paths inside fenced code blocks get a clickable line under the block. */
  codeBlocks: boolean
  /** Relative paths (`hooks/register.tsx`) are resolved against the working directory. */
  relative: boolean
}

export const DEFAULT_PREFS: Prefs = { mode: 'segments', codeBlocks: true, relative: true }

export type Ctx = {
  /** $HOME, for `~/…`; absent leaves `~` paths alone. */
  home?: string
  /** The session's working directory, for relative paths. */
  cwd?: string
}

/** What a path is, by its absolute spelling; undefined when missing or not known yet. */
export type Look = (abs: string) => Kind | undefined

/** A path found in the text: how it was written, where it lands, what it is. */
export type Found = { spelled: string; abs: string; kind: Kind; suffix: string }

/**
 * Where a path may be looked up at all. A mere stat can reach the network
 * through an automounter (macOS `/net`, `/Network`, `/home` = the firmlink
 * `/System/Volumes/Data/home`; Linux autofs anywhere) or a mounted share
 * (`/Volumes`, `/mnt`, `/media`), and reply text must never make the machine
 * contact a host. A deny-list of such spellings is only best effort (aliases
 * and case get around it), so this is an allow-list: the home folder, the
 * working directory and the local system roots below, and nothing else.
 */
const LOCAL_ROOTS = ['/users', '/etc', '/tmp', '/private/tmp', '/private/etc', '/var/folders', '/private/var/folders', '/usr', '/opt', '/applications', '/library', '/bin', '/sbin']
/** Never, even under an allowed root. */
const NEVER = ['/users/shared/.autofs', '/private/var/automount']
const under = (a: string, r: string) => a === r || a.startsWith(`${r.replace(/\/$/, '')}/`)

/** Compared without case: macOS file systems are case-insensitive, so `/NET/host` is `/net/host`. */
export function mayLookUp(abs: string, ctx: Ctx): boolean {
  const a = abs.toLowerCase()
  if (NEVER.some(r => under(a, r))) return false
  const roots = [...LOCAL_ROOTS, ctx.home, ctx.cwd].filter((r): r is string => !!r).map(r => r.toLowerCase())
  return roots.some(r => under(a, r))
}

/** Words a path in running text may stretch over, `My Drive` style. */
const MAX_WORDS = 10
/** Paths listed under one code block. */
const MAX_BLOCK_PATHS = 3
/** Lines of a code block searched for paths. */
const MAX_BLOCK_LINES = 100

/** Characters a path is made of in running text (no space: that is the word step). */
const PATH_CH = /[^\s`"'<>|[\]{}*]/
/** Where a path may begin: an absolute, a home or a relative spelling. */
const START = /(?<![\w.\/~$@+-])(?:~\/|\/(?=[^\s/])|\.{1,2}\/|[\w@][\w@.+-]*\/(?=[^\s/]))/g
/** `:42` or `:42:7` after a file, kept as text after the link. */
const LINE_SUFFIX = /:\d+(?::\d+)?$/
/** Punctuation that ends a sentence rather than a path. */
const TRAIL = /[.,;:!?]+$/

/** The absolute path a spelling lands on, `.` and `..` folded; undefined when it cannot be placed. */
export function resolvePath(spelled: string, ctx: Ctx, relative = true): string | undefined {
  let base: string
  let rest: string
  if (spelled === '~' || spelled.startsWith('~/')) {
    if (!ctx.home) return undefined
    base = ctx.home
    rest = spelled.slice(1)
  } else if (spelled.startsWith('/')) {
    base = ''
    rest = spelled
  } else {
    if (!relative || !ctx.cwd) return undefined
    base = ctx.cwd
    rest = `/${spelled}`
  }
  const parts: string[] = []
  for (const p of `${base}${rest}`.split('/')) {
    if (p === '' || p === '.') continue
    if (p === '..') parts.pop()
    else parts.push(p)
  }
  return `/${parts.join('/')}`
}

/** A `file://` URL for an absolute path; folders end in `/`. */
export function fileUrl(abs: string, kind: Kind): string {
  const path = kind === 'dir' && !abs.endsWith('/') ? `${abs}/` : abs
  return `file://${encodeURI(path).replace(/[#?()]/g, c => `%${c.charCodeAt(0).toString(16).toUpperCase()}`)}`
}

/** Text safe inside a markdown link label. */
export function escapeLabel(s: string): string {
  return s.replace(/[\\`*_[\]<>~]/g, c => `\\${c}`)
}

const link = (label: string, abs: string, kind: Kind) => `[${escapeLabel(label)}](${fileUrl(abs, kind)})`

/**
 * The markdown for one found path: each folder and the file a link of its own
 * (`segments`), or the whole spelling one link (`file`). Separators and an
 * empty first segment (the root's `/`) stay plain text.
 */
export function linkPath(f: Found, ctx: Ctx, mode: Mode): string {
  if (mode === 'file') return link(f.spelled, f.abs, f.kind) + f.suffix
  const segs = f.spelled.split('/')
  let last = segs.length - 1
  while (last > 0 && segs[last] === '') last--
  const out: string[] = []
  for (let i = 0; i < segs.length; i++) {
    const seg = segs[i]!
    if (seg === '' || i > last) {
      out.push('')
      continue
    }
    const prefix = segs.slice(0, i + 1).join('/') || '/'
    const abs = i === last ? f.abs : resolvePath(prefix, ctx)
    out.push(abs ? link(seg, abs, i === last ? f.kind : 'dir') : escapeLabel(seg))
  }
  return out.join('/') + f.suffix
}

/** A candidate spelling cleaned of trailing punctuation and a line suffix, then looked up. */
function tryCandidate(raw: string, ctx: Ctx, prefs: Prefs, look: Look): (Found & { used: number }) | undefined {
  let s = raw
  // A closing bracket belongs to the path only when the path opened one.
  for (;;) {
    const before = s
    s = s.replace(TRAIL, '')
    if (s.endsWith(')') && (s.match(/\(/g)?.length ?? 0) < (s.match(/\)/g)?.length ?? 0)) s = s.slice(0, -1)
    if (s === before) break
  }
  let suffix = ''
  const m = s.match(LINE_SUFFIX)
  if (m) {
    suffix = m[0]
    s = s.slice(0, -suffix.length)
  }
  if (s.length < 2 || s.endsWith('/') && s.length < 3) return undefined
  // `..` is folded by text here but by the kernel through symlinks (`/tmp`, `/var`, `/etc` are
  // links on macOS): the two can disagree about where a path lands, and the network check
  // below must judge the place the stat will reach. Such spellings are never looked up.
  if (s.split('/').includes('..')) return undefined
  const abs = resolvePath(s, ctx, prefs.relative)
  if (!abs || abs === '/' || !mayLookUp(abs, ctx)) return undefined
  const kind = look(abs)
  if (!kind) return undefined
  return { spelled: s, abs, kind, suffix, used: s.length + suffix.length }
}

/**
 * Paths in a stretch of running text (no code, no links). Calls `found` for
 * each and returns the text with each path replaced by what `found` returns.
 */
function scanPlain(s: string, ctx: Ctx, prefs: Prefs, look: Look, found: (f: Found) => string): string {
  let out = ''
  let pos = 0
  START.lastIndex = 0
  for (let m = START.exec(s); m; m = START.exec(s)) {
    const at = m.index
    if (at < pos) continue
    const quote = s[at - 1] === '"' || s[at - 1] === "'" ? s[at - 1]! : undefined
    const candidates: string[] = []
    if (quote) {
      const close = s.indexOf(quote, at)
      if (close > at) candidates.push(s.slice(at, close))
    }
    // One word, then further words joined by single spaces: longest first.
    let end = at
    while (end < s.length && PATH_CH.test(s[end]!)) end++
    const words = [s.slice(at, end)]
    let cur = end
    while (words.length < MAX_WORDS && s[cur] === ' ' && cur + 1 < s.length && PATH_CH.test(s[cur + 1]!)) {
      let e2 = cur + 1
      while (e2 < s.length && PATH_CH.test(s[e2]!)) e2++
      words.push(s.slice(at, e2))
      cur = e2
    }
    candidates.push(...words.reverse())

    let hit: (Found & { used: number }) | undefined
    for (const c of candidates) {
      hit = tryCandidate(c, ctx, prefs, look)
      if (hit) break
    }
    if (!hit) {
      START.lastIndex = at + 1
      continue
    }
    out += s.slice(pos, at) + found(hit)
    pos = at + hit.used
    START.lastIndex = pos
  }
  return out + s.slice(pos)
}

/** Tokens of one line that are not running text: code spans, links, autolinks, URLs. */
const TOKENS = /(`+)([^`]|[^`][\s\S]*?[^`])\1(?!`)|!?\[[^\]]*\]\([^)]*\)|<[a-z][\w+.-]*:[^>\s]*>|\b[a-z][\w+.-]*:\/\/[^\s<>`]*/gi

/** One line outside a code block, paths linked; paths inside inline code that stays code go to `extra`. */
function rewriteLine(line: string, ctx: Ctx, prefs: Prefs, look: Look, extra: Found[]): string {
  const plain = (s: string) => scanPlain(s, ctx, prefs, look, f => linkPath(f, ctx, prefs.mode))
  let out = ''
  let pos = 0
  TOKENS.lastIndex = 0
  for (let m = TOKENS.exec(line); m; m = TOKENS.exec(line)) {
    out += plain(line.slice(pos, m.index))
    pos = m.index + m[0].length
    if (m[1] === undefined) {
      out += m[0] // a link or URL: never touched
      continue
    }
    const code = m[2]!.trim()
    const whole = tryCandidate(code, ctx, prefs, look)
    if (whole && whole.used === code.length) {
      out += linkPath(whole, ctx, prefs.mode)
      continue
    }
    out += m[0]
    scanPlain(code, ctx, prefs, look, f => {
      extra.push(f)
      return ''
    })
  }
  return out + plain(line.slice(pos))
}

const unique = (fs: Found[]) => fs.filter((f, i) => fs.findIndex(g => g.abs === f.abs) === i)

/** The line under a code block or a line whose inline code named paths. */
function extraLine(fs: Found[], ctx: Ctx, prefs: Prefs): string {
  return `↳ ${unique(fs).slice(0, MAX_BLOCK_PATHS).map(f => linkPath({ ...f, suffix: '' }, ctx, prefs.mode)).join('  ·  ')}`
}

const FENCE = /^ {0,3}(`{3,}|~{3,})/

/**
 * The reply's markdown with every path that exists linked. Fenced code is
 * left as written (it stays copyable); with `codeBlocks` the paths it names
 * follow the block on a line of their own.
 */
export function rewrite(text: string, ctx: Ctx, prefs: Prefs, look: Look): string {
  if (prefs.mode === 'off' || !text.includes('/')) return text
  const lines = text.split('\n')
  const out: string[] = []
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!
    const fence = line.match(FENCE)
    if (fence) {
      const mark = fence[1]!
      let j = i + 1
      while (j < lines.length && !new RegExp(`^ {0,3}${mark[0] === '`' ? '`' : '~'}{${mark.length},}\\s*$`).test(lines[j]!)) j++
      out.push(...lines.slice(i, j + 1))
      if (prefs.codeBlocks && j < lines.length) {
        const found: Found[] = []
        for (const l of lines.slice(i + 1, Math.min(j, i + 1 + MAX_BLOCK_LINES))) {
          scanPlain(l, ctx, prefs, look, f => {
            found.push(f)
            return ''
          })
        }
        if (found.length) out.push('', extraLine(found, ctx, prefs))
      }
      i = j
      continue
    }
    const extra: Found[] = []
    const done = rewriteLine(line, ctx, prefs, look, extra)
    out.push(extra.length && !line.trimStart().startsWith('|') ? `${done}  \n${extraLine(extra, ctx, prefs)}` : done)
  }
  return out.join('\n')
}

/** Every absolute path `rewrite` would look up for this text, so the hook can stat them first. */
export function probes(text: string, ctx: Ctx, prefs: Prefs): string[] {
  const asked = new Set<string>()
  rewrite(text, ctx, prefs, abs => {
    asked.add(abs)
    return undefined
  })
  return [...asked]
}
