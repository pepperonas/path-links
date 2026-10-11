import type { EngineInterface, PluginOptions, Register } from 'claude-code'

import { DEFAULT_PREFS, mayLookUp, probes, rewrite } from './paths'
import type { Ctx, Kind, Mode, Prefs } from './paths'

const MODES: readonly Mode[] = ['segments', 'file', 'off']
/** How long a lookup is trusted: a path that exists rarely vanishes, a missing one may appear soon. */
const HIT_MS = 60_000
const MISS_MS = 5_000
/** Lookups one drawing may start; the rest wait for the next drawing. */
const MAX_PROBES = 64
/** Lookups remembered at most. */
const MAX_CACHE = 2000

/** userConfig defaults, overridden by what /path-links stored. */
export function prefsOf(options: PluginOptions, stored: unknown): Prefs {
  const s = (stored && typeof stored === 'object' ? stored : {}) as Partial<Prefs>
  const isMode = (v: unknown): v is Mode => MODES.includes(v as Mode)
  const isBool = (v: unknown): v is boolean => typeof v === 'boolean'
  const opt = <T,>(v: unknown, ok: (v: unknown) => v is T, d: T): T => (ok(v) ? v : d)
  const base: Prefs = {
    mode: opt(options.mode, isMode, DEFAULT_PREFS.mode),
    codeBlocks: opt(options.codeBlocks, isBool, DEFAULT_PREFS.codeBlocks),
    relative: opt(options.relative, isBool, DEFAULT_PREFS.relative),
  }
  return {
    mode: opt(s.mode, isMode, base.mode),
    codeBlocks: opt(s.codeBlocks, isBool, base.codeBlocks),
    relative: opt(s.relative, isBool, base.relative),
  }
}

let prefs: Prefs = DEFAULT_PREFS
let home: string | undefined
const cache = new Map<string, { kind: Kind | null; at: number }>()

/** A lookup that has not answered by then counts as missing, so a stalled mount never holds up a drawing. */
const STAT_TIMEOUT_MS = 300

async function kindOf($: EngineInterface, abs: string, ctx: Ctx): Promise<Kind | null> {
  let timer: { cancel(): void } | undefined
  const late = new Promise<undefined>(done => {
    timer = $.clock.after(STAT_TIMEOUT_MS, () => done(undefined))
  })
  const st = await Promise.race([$.fs.stat(abs, { resolve: true }).catch(() => undefined), late])
  timer?.cancel()
  // A link that leads out of the allowed roots is not linked either.
  if (!st?.realPath || !mayLookUp(st.realPath, ctx)) return null
  return st.kind === 'file' || st.kind === 'dir' ? st.kind : null
}

/** Stat what the text names and is not fresh in the cache. */
async function lookUp($: EngineInterface, paths: string[], now: number, ctx: Ctx): Promise<void> {
  const stale = paths.filter(p => {
    const c = cache.get(p)
    return !c || now - c.at > (c.kind ? HIT_MS : MISS_MS)
  })
  await Promise.all(
    stale.slice(0, MAX_PROBES).map(async p => {
      cache.set(p, { kind: await kindOf($, p, ctx), at: now })
    }),
  )
  if (cache.size > MAX_CACHE) {
    for (const k of [...cache.keys()].slice(0, cache.size - MAX_CACHE)) cache.delete(k)
  }
}

async function ctxOf($: EngineInterface): Promise<Ctx> {
  if (home === undefined) home = (await $.env.get('HOME').catch(() => undefined)) ?? ''
  const cwd = await $.session.cwd().catch(() => undefined)
  return { home: home || undefined, cwd }
}

const HELP = [
  'Commands:',
  '  /path-links                      this report',
  '  /path-links segments|file|off    every folder a link · the whole path one link · off',
  '  /path-links blocks on|off        a clickable line under code blocks that name paths',
  '  /path-links relative on|off      link relative paths (resolved against the working directory)',
]

export const register: Register = (on, options) => {
  on('session.start', async ($, e, next) => {
    prefs = prefsOf(options, await $.store.get('prefs').catch(() => undefined))
    await $.command.register({
      name: 'path-links',
      description: 'path-links: clickable file and folder paths in replies (/path-links help)',
      argumentHint: '[segments|file|off|blocks on|off|relative on|off]',
      immediate: true,
    })
    return next(e)
  })

  on('command.run', { command: 'path-links' }, async ($, e) => {
    const [cmd = '', arg = ''] = e.args.trim().toLowerCase().split(/\s+/)
    const save = async (p: Prefs, said: string) => {
      prefs = p
      await $.store.set('prefs', p).catch(() => undefined)
      $.ui.invalidate('ui.render')
      return { text: `path-links: ${said}` }
    }
    const flag = (v: boolean) => (arg === 'on' ? true : arg === 'off' ? false : !v)
    if (MODES.includes(cmd as Mode)) return save({ ...prefs, mode: cmd as Mode }, `mode ${cmd}`)
    if (cmd === 'blocks') {
      const v = flag(prefs.codeBlocks)
      return save({ ...prefs, codeBlocks: v }, `code block line ${v ? 'on' : 'off'}`)
    }
    if (cmd === 'relative') {
      const v = flag(prefs.relative)
      return save({ ...prefs, relative: v }, `relative paths ${v ? 'on' : 'off'}`)
    }
    const status = `path-links: mode ${prefs.mode} · code blocks ${prefs.codeBlocks ? 'on' : 'off'} · relative ${prefs.relative ? 'on' : 'off'}`
    return { text: [status, '', ...HELP].join('\n') }
  })

  // The stored reply stays as written; only its drawing carries the links.
  on('ui.render', { component: 'AssistantMessage' }, async ($, e, next) => {
    if (prefs.mode === 'off') return next(e)
    const text = e.props.text
    const ctx = await ctxOf($)
    const wanted = probes(text, ctx, prefs)
    if (wanted.length === 0) return next(e)
    await lookUp($, wanted, await $.clock.now(), ctx)
    const out = rewrite(text, ctx, prefs, abs => cache.get(abs)?.kind ?? undefined)
    return out === text ? next(e) : next({ ...e, props: { ...e.props, text: out } })
  }).catch(($, e, next) => next(e)) // never in the way of a reply
}
