window.__ModuleLoader__.load({
  id: 'dsh-novel-fade',
  factory(require) {
    const React = require('react')
    const h = React.createElement

    /* ════════════════════════════════════════════════════════════════════════
     * 0. Remote contract — keep in sync with lib/remote-contract.js.
     *    Duplicated because this browser factory cannot import a Host module.
     * ════════════════════════════════════════════════════════════════════════ */
    function scalar(validate) {
      return {
        parse(value) {
          validate(value)
          return value
        },
        safeParse(value) {
          try {
            validate(value)
            return { success: true, data: value }
          } catch (error) {
            return { success: false, error }
          }
        },
      }
    }
    const sessionIdSchema = scalar((value) => {
      if (typeof value !== 'string' || value.length === 0) throw new Error('sessionId must be a non-empty string')
    })
    const booleanSchema = scalar((value) => {
      if (typeof value !== 'boolean') throw new Error('on must be a boolean')
    })
    const modeResultSchema = scalar((value) => {
      if (!value || typeof value.on !== 'boolean') throw new Error('result must be { on: boolean }')
    })
    const jsonObjectSchema = scalar((value) => {
      if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error('expected a JSON object')
    })
    const panelResultSchema = scalar((value) => {
      if (!value || typeof value !== 'object') throw new Error('panel result must be an object')
    })
    const codec = (typeSymbol, schema) => ({ mode: 'strict', typeSymbol, create: () => schema })
    const param = (name, schema) => ({ name, wire: name, source: 'json', codec: codec(name, schema) })
    const TYPERT_REMOTE = {
      package: 'dsh-novel-fade',
      descriptors: [
        ['status', [param('sessionId', sessionIdSchema)], modeResultSchema, 'FadeMode'],
        ['setMode', [param('sessionId', sessionIdSchema), param('on', booleanSchema)], modeResultSchema, 'FadeMode'],
        ['panel', [param('sessionId', sessionIdSchema), param('options', jsonObjectSchema)], panelResultSchema, 'FadePanel'],
        ['curve', [param('sessionId', sessionIdSchema), param('options', jsonObjectSchema)], panelResultSchema, 'FadePanel'],
        ['chapter', [param('sessionId', sessionIdSchema), param('options', jsonObjectSchema)], panelResultSchema, 'FadePanel'],
        ['sourceIndex', [param('sessionId', sessionIdSchema), param('options', jsonObjectSchema)], panelResultSchema, 'FadePanel'],
        ['sourceSlice', [param('sessionId', sessionIdSchema), param('options', jsonObjectSchema)], panelResultSchema, 'FadePanel'],
        ['brief', [param('sessionId', sessionIdSchema), param('options', jsonObjectSchema)], panelResultSchema, 'FadePanel'],
      ].map(([method, parameters, result, typeSymbol]) => ({
        id: `dsh-novel-fade#memoMode/${method}`,
        namespace: 'memoMode',
        service: 'memoMode',
        method,
        invocation: { kind: 'direct' },
        parameters,
        result: codec(typeSymbol, result),
      })),
    }

    /* ════════════════════════════════════════════════════════════════════════
     * 1. Helpers
     * ════════════════════════════════════════════════════════════════════════ */

    const fmt = (value) => {
      const number = Number(value)
      if (!Number.isFinite(number)) return '—'
      if (Math.abs(number) >= 100000) return `${(number / 10000).toFixed(1)}w`
      if (Math.abs(number) >= 10000) return `${(number / 1000).toFixed(1)}k`
      return String(Math.round(number))
    }
    const pct = (value) => {
      const number = Number(value)
      if (!Number.isFinite(number)) return '—'
      return `${Math.round(Math.min(1, Math.max(0, number)) * 100)}%`
    }
    const unwrap = (result) => {
      if (result && result.ok === false) {
        throw new Error(result.error?.message ?? result.message ?? 'remote 调用失败')
      }
      return result && result.ok === true && 'value' in result ? result.value : result
    }
    const sessionIdOf = (value) => {
      if (typeof value === 'string') return value
      if (!value) return null
      return value.id ?? value.sessionId ?? String(value)
    }

    /* ════════════════════════════════════════════════════════════════════════
     * 1b. Palette — fade 自己的调色板，深/浅两套，仍以宿主 token 兜底。
     *     每项都是 var(--fade-x, <宿主 token>)，宿主换了主题也不会崩。
     * ════════════════════════════════════════════════════════════════════════ */
    const T = {
      text: 'var(--fade-text, var(--dsw-alias-label-primary, #1f2328))',
      muted: 'var(--fade-muted, var(--dsw-alias-label-secondary, #6b7280))',
      faint: 'var(--fade-faint, var(--dsw-alias-label-secondary, #9aa0a6))',
      layer1: 'var(--fade-surface, var(--dsw-alias-bg-layer-1, #f7f7f8))',
      layer2: 'var(--fade-surface-2, var(--dsw-alias-bg-layer-2, #efeff1))',
      border: 'var(--fade-line, var(--dsw-alias-border-l1, rgba(127,127,127,.22)))',
      border2: 'var(--fade-line-2, var(--dsw-alias-border-l2, rgba(127,127,127,.38)))',
      brand: 'var(--fade-brand, var(--dsw-alias-brand-primary, #2563eb))',
      ok: 'var(--fade-ok, var(--dsw-alias-state-success-primary, #16a34a))',
      warn: 'var(--fade-warn, var(--dsw-alias-state-warn-primary, #b45309))',
      danger: 'var(--fade-danger, var(--dsw-alias-state-error-primary, #dc2626))',
      idle: 'var(--fade-faint, var(--dsw-alias-state-idle-primary, #9ca3af))',
      c3: 'var(--fade-c3, #8b5cf6)',
      c4: 'var(--fade-c4, #0ea5e9)',
      mono: 'ui-monospace, "Cascadia Mono", "SFMono-Regular", Consolas, monospace',
    }

    const PERMISSION_TONE = { precise: T.ok, recall: T.warn, gist: T.warn, feeling: T.danger }
    const PERMISSION_TEXT = { precise: '可写细节', recall: '在库里', gist: '只写大意', feeling: '只写感觉' }

    const PALETTE_CSS = `
.fade-root[data-scheme="dark"]{
  --fade-text:#e8e9ec; --fade-muted:#9aa0a6; --fade-faint:#6f757c;
  --fade-surface:rgba(255,255,255,.035); --fade-surface-2:rgba(255,255,255,.07);
  --fade-line:rgba(255,255,255,.10); --fade-line-2:rgba(255,255,255,.18);
  --fade-brand:#7d95fb; --fade-ok:#5fae8b; --fade-warn:#d4b04a; --fade-danger:#d97b76;
  --fade-c3:#a78bfa; --fade-c4:#38bdf8;
  --fade-shadow:0 1px 0 rgba(255,255,255,.03) inset;
}
.fade-root[data-scheme="light"]{
  --fade-text:#1f2328; --fade-muted:#5b6168; --fade-faint:#8a9098;
  --fade-surface:#fbfbfc; --fade-surface-2:#f1f2f5;
  --fade-line:#e4e6ea; --fade-line-2:#d2d6dd;
  --fade-brand:#3f5ce0; --fade-ok:#23805c; --fade-warn:#9a6b12; --fade-danger:#b8443c;
  --fade-c3:#6d4bd8; --fade-c4:#0b7fb5;
  --fade-shadow:0 1px 2px rgba(16,24,40,.04);
}`

    function detectScheme() {
      // Test seam: the harness sets window.__FADE_SCHEME__ to render both palettes.
      try {
        const forced = window?.__FADE_SCHEME__
        if (forced === 'light' || forced === 'dark') return forced
      } catch { /* no window */ }
      try {
        const probe = document.createElement('div')
        probe.style.cssText = 'position:absolute;left:-9999px;top:0;width:1px;height:1px;background:var(--dsw-alias-bg-base,#0f1011)'
        document.body.appendChild(probe)
        const rgb = getComputedStyle(probe).backgroundColor
        probe.remove()
        const match = String(rgb).match(/(\d+(?:\.\d+)?)\D+(\d+(?:\.\d+)?)\D+(\d+(?:\.\d+)?)/)
        if (!match) return 'dark'
        const [r, g, b] = [Number(match[1]), Number(match[2]), Number(match[3])]
        const luminance = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255
        return luminance > 0.55 ? 'light' : 'dark'
      } catch {
        return 'dark'
      }
    }

    const CSS = `
.fade-root{display:flex;flex-direction:column;height:100%;min-height:0;color:${T.text};font-size:12.5px;line-height:1.5;background:transparent}
.fade-root *{box-sizing:border-box}
.fade-head{padding:10px 12px 0;flex:none}
.fade-select{max-width:190px;height:20px;border:1px solid ${T.border};border-radius:5px;background:transparent;color:${T.text};font:inherit;font-size:10.5px;padding:0 2px;cursor:pointer;outline:none}
.fade-select option{background:var(--dsw-alias-bg-overlay,#1c1e22);color:${T.text}}
.fade-title-row{display:flex;align-items:center;gap:8px}
.fade-title{font-size:13px;font-weight:600;letter-spacing:.02em;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.fade-sub{margin-top:2px;color:${T.muted};font-size:10.5px;display:flex;gap:6px;align-items:center;white-space:nowrap;overflow:hidden}
.fade-tabs{display:flex;gap:2px;padding:8px 10px;border-bottom:1px solid ${T.border};flex:none}
.fade-tab{flex:1;height:26px;border:0;background:transparent;color:${T.muted};font:inherit;font-size:11.5px;border-radius:6px;cursor:pointer}
.fade-tab:hover{background:${T.layer1};color:${T.text}}
.fade-tab[data-a="1"]{background:${T.layer2};color:${T.text};box-shadow:inset 0 0 0 1px ${T.border},inset 0 -2px 0 ${T.brand}}
.fade-body{flex:1;min-height:0;overflow:auto;padding:10px 12px 16px}
.fade-foot{flex:none;display:flex;justify-content:space-between;gap:8px;padding:6px 12px;border-top:1px solid ${T.border};color:${T.muted};font-size:9.5px;font-family:${T.mono}}
.fade-card{border:1px solid ${T.border};border-radius:10px;background:${T.layer1};padding:9px 10px;box-shadow:var(--fade-shadow,none)}
.fade-num{font-family:${T.mono};font-variant-numeric:tabular-nums}
.fade-k{font-size:9.5px;letter-spacing:.06em;color:${T.muted};text-transform:uppercase}
.fade-big{font-family:${T.mono};font-size:20px;font-weight:600;letter-spacing:-.02em;line-height:1.1}
.fade-big small{font-size:10px;font-weight:400;color:${T.muted};margin-left:2px}
.fade-top{display:grid;grid-template-columns:minmax(0,1fr) 104px;gap:8px;align-items:stretch}
.fade-top-side{display:flex;flex-direction:column;gap:6px;min-width:0}
.fade-mini{border:1px solid ${T.border};border-radius:8px;padding:5px 8px;background:${T.layer1};text-align:left;cursor:pointer;font:inherit;color:inherit;box-shadow:var(--fade-shadow,none);flex:1;min-height:0;display:flex;flex-direction:column;justify-content:center}
.fade-mini:hover{background:${T.layer2}}
.fade-mini-num{font-family:${T.mono};font-size:15px;font-weight:600;margin-top:0;line-height:1.2}
.fade-callout{display:flex;gap:8px;align-items:center;width:100%;text-align:left;font:inherit;color:${T.warn};margin-top:8px;padding:7px 9px 7px 8px;border:0;border-left:3px solid ${T.warn};border-radius:0 7px 7px 0;background:color-mix(in srgb,${T.warn} 7%,transparent);cursor:pointer}
.fade-callout:hover{background:color-mix(in srgb,${T.warn} 11%,transparent)}
.fade-callout-t{font-size:11.5px;line-height:1.4}
.fade-callout-s{font-size:10px;line-height:1.4;color:color-mix(in srgb,${T.warn} 78%,${T.muted})}
.fade-tl{display:flex;flex-direction:column;margin-top:2px}
.fade-tl-row{display:flex;gap:8px;padding:5px 0;border:0;background:transparent;font:inherit;color:inherit;text-align:left;cursor:pointer;width:100%}
.fade-tl-row:hover .fade-tl-body{background:${T.layer1};border-radius:6px}
.fade-tl-rail{width:10px;flex:none;display:flex;flex-direction:column;align-items:center;padding-top:5px}
.fade-tl-dot{width:7px;height:7px;border-radius:50%;flex:none}
.fade-tl-line{width:1px;flex:1;background:${T.border};margin-top:3px}
.fade-tl-body{flex:1;min-width:0;padding:0 6px 2px 2px}
.fade-tl-ch{font-family:${T.mono};font-size:9.5px;color:${T.muted};margin-right:5px}
.fade-info{display:flex;align-items:center;gap:8px;width:100%;padding:7px 2px;border:0;border-top:1px solid ${T.border};background:transparent;font:inherit;color:inherit;text-align:left;cursor:pointer}
.fade-info:hover{color:${T.text}}
.fade-stickybar{position:sticky;bottom:-2px;margin-top:10px;padding:8px 0 2px;background:var(--dsw-alias-bg-base,transparent);z-index:2}
.fade-primary{display:flex;align-items:center;justify-content:center;gap:6px;width:100%;height:32px;margin-top:0;border-radius:8px;border:1px solid ${T.brand};background:color-mix(in srgb,${T.brand} 14%,transparent);color:${T.brand};font:inherit;font-size:12px;font-weight:600;cursor:pointer}
.fade-primary:hover{background:color-mix(in srgb,${T.brand} 22%,transparent)}
.fade-primary:disabled{opacity:.55;cursor:default}
.fade-row{display:flex;align-items:center;gap:8px;padding:6px 7px;border-radius:7px;cursor:pointer;width:100%;border:0;background:transparent;text-align:left;color:inherit;font:inherit}
.fade-row:hover{background:${T.layer1}}
.fade-row[data-a="1"]{background:${T.layer1};box-shadow:inset 0 0 0 1px ${T.border2}}
.fade-av{width:22px;height:22px;flex:none;border-radius:6px;display:flex;align-items:center;justify-content:center;background:${T.layer2};color:${T.muted};font:600 10px ${T.mono};box-shadow:inset 0 0 0 1px ${T.border}}
.fade-t1{font-size:12px;line-height:1.35;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.fade-t2{font-size:10px;color:${T.muted};line-height:1.4;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-family:${T.mono}}
.fade-grow{flex:1;min-width:0}
.fade-chip{height:20px;padding:0 7px;border-radius:5px;border:1px solid ${T.border};background:transparent;color:${T.muted};font:inherit;font-size:10px;cursor:pointer;font-family:${T.mono}}
.fade-chip[data-a="1"]{color:${T.brand};border-color:color-mix(in srgb,${T.brand} 45%,transparent);background:color-mix(in srgb,${T.brand} 10%,transparent)}
.fade-tag{font:9.5px/1 ${T.mono};padding:3px 5px;border-radius:4px;border:1px solid ${T.border};color:${T.muted};white-space:nowrap}
.fade-btn{display:flex;align-items:center;justify-content:center;gap:6px;width:100%;height:28px;border-radius:7px;border:1px solid ${T.border};background:transparent;color:${T.text};font:inherit;font-size:11.5px;cursor:pointer}
.fade-btn:hover{background:${T.layer1}}
.fade-btn:disabled{opacity:.5;cursor:default}
.fade-btn[data-p="1"]{border-color:${T.brand};color:${T.brand}}
.fade-input{display:flex;align-items:center;gap:6px;height:28px;padding:0 8px;border:1px solid ${T.border};border-radius:7px;background:transparent}
.fade-input input{flex:1;min-width:0;border:0;background:transparent;color:${T.text};font:inherit;font-size:11.5px;outline:none}
.fade-sec{display:flex;align-items:baseline;justify-content:space-between;gap:8px;margin:12px 0 4px}
.fade-sec h3{margin:0;font-size:10.5px;font-weight:600;color:${T.muted};letter-spacing:.05em}
.fade-sec span{font-size:10px;color:${T.muted};font-family:${T.mono}}
.fade-bar{height:3px;border-radius:2px;background:var(--fade-line,rgba(127,127,127,.2));overflow:hidden}
.fade-bar i{display:block;height:3px;border-radius:2px;background:${T.ok}}
.fade-warn{display:flex;align-items:center;gap:6px;padding:6px 8px;border-radius:7px;border:1px solid ${T.border2};background:${T.layer1};color:${T.warn};font-size:10.5px;cursor:pointer;width:100%;text-align:left;font-family:inherit}
.fade-list{border:1px solid ${T.border};border-radius:9px;overflow:hidden;background:transparent}
.fade-kv{display:grid;grid-template-columns:46px 1fr;gap:3px 8px;font-size:11px;margin-top:5px}
.fade-kv dt{color:${T.muted};font-size:10px;margin:0}
.fade-kv dd{margin:0}
.fade-quote{margin-top:7px;padding-left:8px;border-left:2px solid ${T.border2};color:${T.muted};font-size:10.5px;line-height:1.6;word-break:break-word}
.fade-empty{padding:18px 6px;text-align:center;color:${T.muted};font-size:11.5px;line-height:1.7}
.fade-err{padding:10px;border:1px solid ${T.border2};border-radius:8px;color:${T.danger};background:${T.layer1};font-size:11px;word-break:break-word}
.fade-pre{white-space:pre-wrap;word-break:break-word;font-family:${T.mono};font-size:10.5px;line-height:1.6;background:${T.layer1};border:1px solid ${T.border};border-radius:8px;padding:8px;max-height:240px;overflow:auto;margin:6px 0 0}
.fade-legend{display:flex;flex-wrap:wrap;gap:8px;color:${T.muted};font-size:10px;margin-top:4px}
.fade-dot{display:inline-block;width:6px;height:6px;border-radius:50%;margin-right:4px;vertical-align:1px}
.fade-spin{display:inline-block;width:10px;height:10px;border:1.5px solid ${T.border2};border-top-color:${T.brand};border-radius:50%;animation:fade-spin .8s linear infinite}
@keyframes fade-spin{to{transform:rotate(360deg)}}
`
    function Styles() {
      return h('style', { 'data-novel-fade': '' }, PALETTE_CSS + CSS)
    }

    /* ════════════════════════════════════════════════════════════════════════
     * 3. Data hooks
     * ════════════════════════════════════════════════════════════════════════ */
    function useRemoteCall(fn, deps) {
      const [state, setState] = React.useState({ phase: 'loading', data: null, error: null })
      const seq = React.useRef(0)
      const run = React.useCallback(() => {
        const mine = ++seq.current
        setState((prev) => ({ ...prev, phase: prev.data ? 'ready' : 'loading', error: null }))
        Promise.resolve()
          .then(fn)
          .then((value) => {
            if (mine !== seq.current) return
            setState({ phase: 'ready', data: value, error: null })
          })
          .catch((error) => {
            if (mine !== seq.current) return
            setState({ phase: 'error', data: null, error: String(error?.message ?? error) })
          })
      // eslint-disable-next-line react-hooks/exhaustive-deps
      }, deps)
      React.useEffect(() => { run() }, [run])
      return { ...state, reload: run }
    }

    const EMPTY_OPTS = {}

    function usePanel(remote, sessionId, book) {
      const call = React.useCallback(() => {
        if (!remote || !sessionId) throw new Error('会话还没准备好')
        const options = book ? { book } : EMPTY_OPTS
        return Promise.all([remote.status(sessionId), remote.panel(sessionId, options)])
          .then(([mode, panel]) => ({ mode: unwrap(mode), panel: unwrap(panel) }))
      }, [remote, sessionId, book])
      return useRemoteCall(call, [call])
    }

    function useCurve(remote, sessionId, series, chapter, enabled, book) {
      const call = React.useCallback(() => {
        if (!enabled) return Promise.resolve(null)
        if (!remote || !sessionId) throw new Error('会话还没准备好')
        const options = { series }
        if (chapter) options.chapter = chapter
        if (book) options.book = book
        return remote.curve(sessionId, options).then(unwrap)
      }, [remote, sessionId, series, chapter, enabled, book])
      return useRemoteCall(call, [call])
    }

    function useSourceIndex(remote, sessionId, enabled, book) {
      const call = React.useCallback(() => {
        if (!enabled) return Promise.resolve(null)
        if (!remote || !sessionId) throw new Error('会话还没准备好')
        return remote.sourceIndex(sessionId, book ? { book } : EMPTY_OPTS).then(unwrap)
      }, [remote, sessionId, enabled, book])
      return useRemoteCall(call, [call])
    }

    /* ════════════════════════════════════════════════════════════════════════
     * 4. Small components
     * ════════════════════════════════════════════════════════════════════════ */
    function Chip({ active, onClick, children, title, tone }) {
      const style = tone
        ? {
          color: tone,
          borderColor: `color-mix(in srgb, ${tone} 45%, transparent)`,
          background: `color-mix(in srgb, ${tone} 12%, transparent)`,
        }
        : undefined
      return h('button', {
        type: 'button', className: 'fade-chip', 'data-a': active ? '1' : '0', onClick, title, style,
      }, children)
    }

    function Mark({ size = 14 }) {
      return h('svg', {
        width: size, height: size, viewBox: '0 0 24 24', 'aria-hidden': 'true',
        focusable: 'false', style: { flex: 'none', display: 'block' },
      },
      h('path', { d: 'M4 6h16', stroke: T.brand, strokeWidth: 2.6, strokeLinecap: 'round' }),
      h('path', { d: 'M4 12h11', stroke: T.brand, strokeWidth: 2.6, strokeLinecap: 'round', opacity: 0.62 }),
      h('path', { d: 'M4 18h6', stroke: T.brand, strokeWidth: 2.6, strokeLinecap: 'round', opacity: 0.3 }))
    }

    function MiniStat({ label, value, tone, onClick, title }) {
      return h('button', {
        type: 'button', className: 'fade-mini', onClick, title,
      },
      h('div', { className: 'fade-k' }, label),
      h('div', { className: 'fade-mini-num', style: tone ? { color: tone } : undefined }, String(value)))
    }

    function Tag({ tone, children }) {
      return h('span', {
        className: 'fade-tag',
        style: tone
          ? {
            color: tone,
            borderColor: `color-mix(in srgb, ${tone} 52%, transparent)`,
            background: `color-mix(in srgb, ${tone} 13%, transparent)`,
          }
          : undefined,
      }, children)
    }

    function Bar({ value, tone, track }) {
      const width = `${Math.round(Math.min(1, Math.max(0, Number(value) || 0)) * 100)}%`
      return h('div', {
        className: 'fade-bar',
        style: { width: '100%', ...(track ? { background: track } : {}) },
      }, h('i', { style: { width, background: tone ?? T.ok } }))
    }

    function Empty({ children }) {
      return h('div', { className: 'fade-empty' }, children)
    }

    function Loading({ label }) {
      return h('div', { className: 'fade-empty' },
        h('span', { className: 'fade-spin', style: { marginRight: 8, verticalAlign: -1 } }), label || '读取中…')
    }

    function ErrorBox({ error, onRetry }) {
      const text = String(error ?? '')
      // The most common cause while developing: the page reloaded with the new
      // client but the Host still runs the old plugin entry.
      const staleHost = /unknown|not found|not registered|未注册|没有.*注册|invalid invocation|cannot find/i.test(text)
      return h('div', null,
        h('div', { className: 'fade-err' }, text),
        staleHost
          ? h('div', { style: { marginTop: 6, fontSize: 10.5, color: T.muted, lineHeight: 1.6 } },
            'Host 可能还是旧代码：重启 DeepSeek Harness（整窗关闭再打开）后重试。')
          : null,
        onRetry ? h('div', { style: { marginTop: 8 } },
          h('button', { type: 'button', className: 'fade-btn', onClick: onRetry }, '重试')) : null)
    }

    /* ════════════════════════════════════════════════════════════════════════
     * 5. Overview
     * ════════════════════════════════════════════════════════════════════════ */
    function HealthCard({ health, onAction }) {
      const [expanded, setExpanded] = React.useState(false)
      const all = Array.isArray(health.issues) ? health.issues : []
      const issues = expanded ? all : all.slice(0, 3)
      const counts = health.counts ?? {}
      const total = (counts.block ?? 0) + (counts.warn ?? 0) + (counts.info ?? 0)
      const tone = counts.block ? T.danger : counts.warn ? T.warn : T.ok
      const label = total
        ? (counts.block || counts.warn ? `本章体检 · ${total} 项待处理` : `本章体检 · ${total} 条提醒`)
        : '本章体检 · 通过'
      return h('div', {
        className: 'fade-card',
        style: { marginTop: 10, borderLeft: `3px solid ${tone}`, paddingLeft: 10 },
      },
      h('div', { style: { display: 'flex', alignItems: 'center', gap: 7 } },
        h('span', { style: { width: 7, height: 7, borderRadius: '50%', background: tone, flex: 'none' } }),
        h('span', { style: { fontSize: 12, fontWeight: 600 } }, label),
        h('span', { className: 'fade-grow' }),
        h('span', { className: 'fade-t2' }, `第 ${health.chapter} 章`)),
      issues.length
        ? h('div', { style: { marginTop: 2 } }, issues.map((issue) => h('button', {
          key: issue.id,
          type: 'button',
          className: 'fade-row',
          style: { padding: '7px 0', textAlign: 'left', alignItems: 'flex-start' },
          onClick: () => onAction?.(issue.action),
        },
        h('span', {
          style: {
            width: 3, alignSelf: 'stretch', flex: 'none', borderRadius: 2, marginTop: 2,
            background: issue.severity === 'block' ? T.danger : issue.severity === 'warn' ? T.warn : T.muted,
          },
        }),
        h('div', { className: 'fade-grow' },
          h('div', { style: { fontSize: 11.5, lineHeight: 1.4, whiteSpace: 'normal' } }, issue.title),
          h('div', { className: 'fade-t2', style: { whiteSpace: 'normal', marginTop: 2 } }, issue.detail),
          issue.action?.label
            ? h('span', { style: { color: T.brand, fontSize: 10, fontFamily: T.mono } }, `${issue.action.label} →`)
            : null))))
        : h('div', { className: 'fade-t2', style: { marginTop: 4 } }, '这一章没有发现需要处理的问题。'),
      health.passed?.length
        ? h('div', { className: 'fade-t2', style: { marginTop: 6 } },
          `检查通过 ${health.passed.length} 项：${health.passed.map((item) => item.label).join('、')}`)
        : null,
      all.length > 3
        ? h('button', {
          type: 'button', className: 'fade-chip', style: { marginTop: 6 },
          onClick: () => setExpanded((value) => !value),
        }, expanded ? '收起' : `展开全部 ${all.length} 项`)
        : null,
      h('div', { className: 'fade-t2', style: { marginTop: 5, display: 'flex', justifyContent: 'space-between' } },
        h('span', null, '只读，不自动修改记忆'),
        h('span', null, health.summary ?? '')))
    }

    function Overview({ snapshot, mode, onToggleMode, onGo, onBrief, brief, onFaded, onHealthAction }) {
      const overview = snapshot.overview ?? {}
      const savings = overview.savings ?? {}
      const decay = overview.decay ?? {}
      const budget = overview.budget ?? {}
      const source = overview.source ?? {}
      const currency = overview.currency
      const people = snapshot.people ?? []
      const cards = snapshot.cards ?? []
      const fadedCount = (overview.cards?.distribution?.gist ?? 0) + (overview.cards?.distribution?.feeling ?? 0)

      const scopeRatio = currency?.ratio != null
        ? currency.ratio
        : (savings.rawChars ? savings.memChars / savings.rawChars : null)
      const scopeText = currency
        ? `原文 ${fmt(currency.rawChars)} 字 → 记忆 ${fmt(currency.memChars)} 字`
        : (savings.rawChars ? `累计 ${savings.chapterCount} 章 · ${fmt(savings.rawChars)} → ${fmt(savings.memChars)} 字` : '还没有可统计的章')

      return h('div', null,
        h('div', { className: 'fade-top' },
          h('div', { className: 'fade-card' },
            h('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 } },
              h('span', { className: 'fade-k' }, currency ? '本章记忆预算' : '累计记忆预算'),
              h('span', { className: 'fade-tag', style: { color: T.muted } }, `简报 ${fmt(budget.briefChars)} 字`)),
            h('div', { style: { display: 'flex', alignItems: 'flex-end', gap: 8, marginTop: 4 } },
              h('div', {
                className: 'fade-big',
                style: scopeRatio != null && scopeRatio > 1 ? { color: T.warn } : undefined,
              },
              scopeRatio == null ? '—' : String(Math.round((1 - scopeRatio) * 100)),
              scopeRatio == null ? null : h('small', null, '%')),
              h('div', { className: 'fade-grow' }),
              h('div', { className: 'fade-t2', style: { textAlign: 'right', whiteSpace: 'normal' } }, scopeText)),
            h('div', { style: { marginTop: 4 } },
              h('span', { className: 'fade-k' }, currency ? '这一章少读' : '少读比例')),
            h('div', { style: { marginTop: 7 } },
              h(Bar, { value: scopeRatio == null ? 0 : 1 - scopeRatio, tone: scopeRatio != null && scopeRatio > 1 ? T.warn : T.ok })),
            h('div', { style: { display: 'flex', justifyContent: 'space-between', marginTop: 6 } },
              h('span', { className: 'fade-k' }, `预算 ${fmt(budget.budget)} 字`),
              h('span', { className: 'fade-t2', style: { color: savings.savedTokens > 0 ? T.ok : T.muted } },
                savings.chapterCount
                  ? (savings.savedTokens >= 0 ? `省 ${fmt(savings.savedTokens)} token` : `多耗 ${fmt(-savings.savedTokens)} token`)
                  : '—'))),
          h('div', { className: 'fade-top-side' },
            h(MiniStat, {
              label: '人物', value: people.length,
              onClick: () => onGo('cards', 'people'), title: '看人物卡',
            }),
            h(MiniStat, {
              label: '事件', value: overview.cards?.active ?? 0,
              onClick: () => onGo('cards', 'events'), title: '看事件卡',
            }),
            h(MiniStat, {
              label: '已褪', value: fadedCount,
              tone: fadedCount ? T.warn : undefined,
              onClick: onFaded, title: '只看已经褪色的卡',
            }))),

        decay.soon
          ? h('button', {
            type: 'button', className: 'fade-callout', onClick: () => onGo('curve'),
          },
          h('div', { className: 'fade-grow' },
            h('div', { className: 'fade-callout-t' }, `${decay.soon} 条将在 ${decay.horizon} 章内跌出「脱口而出」`),
            h('div', { className: 'fade-callout-s' }, '之后写细节前要先翻旧账；点开看是哪几张')),
          h('span', { style: { fontSize: 11 } }, '→'))
          : null,
        decay.recalled
          ? h('div', { className: 'fade-t2', style: { marginTop: 6 } },
            `另有 ${decay.recalled} 条已经要翻旧账；L0 硬契约 ${decay.hardKept} 条永不褪色。`)
          : null,

        snapshot.health ? h(HealthCard, { health: snapshot.health, onAction: onHealthAction }) : null,

        h('div', { className: 'fade-sec' }, h('h3', null, '最近人物'), h('span', null, '按出场章')),
        people.length
          ? h('div', { className: 'fade-list' }, people.slice(0, 5).map((person) => h('button', {
            key: person.id, type: 'button', className: 'fade-row', onClick: () => onGo('cards', 'people'),
          },
          h('div', { className: 'fade-av' }, (person.name ?? '?').slice(0, 1)),
          h('div', { className: 'fade-grow' },
            h('div', { className: 'fade-t1' }, person.name,
              h('span', { style: { marginLeft: 5, color: T.muted, fontFamily: T.mono, fontSize: 9.5 } }, person.layer ?? '')),
            h('div', { className: 'fade-t2' }, `第 ${person.lastChapter} 章 · 出场 ${person.appearances} 次`,
              person.relationship ? ` · ${person.relationship}` : '')),
          h('div', { style: { display: 'flex', flexDirection: 'column', gap: 3, width: 54 } },
            h(Bar, { value: person.familiarity, tone: T.brand }),
            h(Bar, { value: person.accessibility, tone: T.ok }),
            h(Bar, { value: person.fidelity, tone: T.warn }))))) 
          : h(Empty, null, '还没有人物卡；memo_digest 时会自动建。'),

        h('div', { className: 'fade-sec' }, h('h3', null, '最近事件'), h('span', null, `最新 ${Math.min(4, cards.length)} 条`)),
        cards.length
          ? h('div', { className: 'fade-tl' }, cards.slice(0, 4).map((card, index, list) => h('button', {
            key: card.id, type: 'button', className: 'fade-tl-row', onClick: () => onGo('cards', 'events', card.id),
          },
          h('div', { className: 'fade-tl-rail' },
            h('span', { className: 'fade-tl-dot', style: { background: PERMISSION_TONE[card.permission] ?? T.muted } }),
            index < list.length - 1 ? h('span', { className: 'fade-tl-line' }) : null),
          h('div', { className: 'fade-tl-body' },
            h('div', { className: 'fade-t1' },
              h('span', { className: 'fade-tl-ch' }, `第 ${card.chapter} 章`), card.topic,
              card.emotion ? h('span', { style: { color: T.muted } }, ` · ${card.emotion}`) : null),
            h('div', { className: 'fade-t2' },
              [card.cause ? `因 ${card.cause}` : '', card.effect ? `果 ${card.effect}` : ''].filter(Boolean).join(' → ')
              || (card.entityNames.length ? card.entityNames.join('、') : card.placeName || '—'))))))
          : h(Empty, null, '还没有事件卡。'),

        h('div', { className: 'fade-sec' }, h('h3', null, '原文贮存'), h('span', null, source.chapters ? `${source.chapters} 章` : '未开启')),
        h('button', { type: 'button', className: 'fade-info', onClick: () => onGo('source') },
          h('span', { style: { color: T.muted, fontSize: 12 } }, '▤'),
          h('div', { className: 'fade-grow' },
            h('div', { style: { fontSize: 11.5 } },
              source.chapters ? `${source.chapters} 章原句已存 · ${(Number(source.bytes || 0) / 1048576).toFixed(1)} MB` : '还没有原文；digest 会自动存'),
            h('div', { className: 'fade-t2' }, '只存不用：写作只拿简报和卡，要对原句才取')),
          h('span', { style: { color: T.muted, fontSize: 11 } }, '→')),

        h('div', { style: { marginTop: 14 } },
          h('button', {
            type: 'button', className: 'fade-primary',
            disabled: brief.phase === 'loading',
            onClick: onBrief,
          }, brief.phase === 'loading' ? '生成中…' : '生成本章简报（只读）')),
        brief.phase === 'error' ? h('div', { style: { marginTop: 8 } }, h(ErrorBox, { error: brief.error, onRetry: onBrief })) : null,
        brief.data?.ok
          ? h('div', null,
            h('div', { className: 'fade-t2', style: { marginTop: 8 } },
              `简报 ${fmt(brief.data.chars)} 字 / 预算 ${fmt(brief.data.budget)}；不调用模型`),
            h('pre', { className: 'fade-pre' }, brief.data.markdown ?? ''))
          : null,
        brief.data && brief.data.ok === false
          ? h('div', { style: { marginTop: 8 } }, h('div', { className: 'fade-err' }, brief.data.error ?? '生成失败'))
          : null)
    }

    /* ════════════════════════════════════════════════════════════════════════
     * 6. Cards
     * ════════════════════════════════════════════════════════════════════════ */
    function CardDetail({ card, onClose, onLocateSource, onEntity, cached }) {
      const hasSource = Array.isArray(cached) && cached.includes(card.chapter)
      return h('div', { className: 'fade-card', style: { marginTop: 8 } },
        h('div', { style: { display: 'flex', alignItems: 'center', gap: 6 } },
          h('span', { className: 'fade-k' }, `第 ${card.chapter} 章 · ${card.layer}`),
          h('span', { className: 'fade-grow' }),
          h(Tag, { tone: PERMISSION_TONE[card.permission] }, card.permissionLabel),
          h('button', { type: 'button', className: 'fade-chip', onClick: onClose }, '×')),
        h('div', { style: { fontSize: 13, fontWeight: 600, marginTop: 5 } }, card.topic),
        h('dl', { className: 'fade-kv' },
          card.emotion ? [h('dt', { key: 'e' }, '情绪'), h('dd', { key: 'ev' }, card.emotion)] : null,
          card.cause || card.effect
            ? [h('dt', { key: 'c' }, '因→果'), h('dd', { key: 'cv' }, `${card.cause || '—'} → ${card.effect || '—'}`)]
            : null,
          card.entityNames.length || card.placeName
            ? [h('dt', { key: 'p' }, '涉及'),
              h('dd', { key: 'pv', style: { display: 'flex', gap: 4, flexWrap: 'wrap', alignItems: 'center' } },
                card.entityNames.map((name) => h('button', {
                  key: name, type: 'button', className: 'fade-chip',
                  title: '只看这个人',
                  onClick: () => onEntity?.(name),
                }, name)),
                card.placeName ? h('span', { style: { color: T.muted } }, card.placeName) : null)]
            : null,
          [h('dt', { key: 'd' }, '三维'),
            h('dd', { key: 'dv', className: 'fade-num', style: { fontSize: 10.5 } },
              `熟 ${card.familiarity} · 可及 ${card.accessibility} · 保真 ${card.fidelity}`)]),
        card.gist ? h('div', { style: { fontSize: 11.5, lineHeight: 1.65, marginTop: 6 } }, card.gist) : null,
        card.gist === '' && card.permission !== 'precise' && card.permission !== 'recall'
          ? h('div', { style: { fontSize: 10.5, color: T.muted, marginTop: 6 } }, '这张卡被褪色了：只保留主题与情绪。')
          : null,
        card.quote ? h('div', { className: 'fade-quote' }, card.quote) : null,
        h('div', { style: { marginTop: 8, display: 'flex', gap: 6 } },
          h('button', {
            type: 'button', className: 'fade-btn', onClick: () => onLocateSource(card),
          }, hasSource ? '回查这一章的原句（已存）' : '查看原文片段（按需取）')),
        h('div', { className: 'fade-t2', style: { marginTop: 6 } },
          `原文位置：第 ${card.chapter} 章 · ${hasSource ? '已存进原文贮存，未载入' : '原文未存（memo_ingest 可补）'}`))
    }

    function ChapterDetail({ remote, sessionId, book, chapter, onClose, onShowCards, onLocateSource }) {
      const [state, setState] = React.useState({ phase: 'loading', data: null, error: null })
      React.useEffect(() => {
        if (!remote || !sessionId || !chapter) return undefined
        let cancelled = false
        setState({ phase: 'loading', data: null, error: null })
        const options = { chapter }
        if (book) options.book = book
        remote.chapter(sessionId, options)
          .then(unwrap)
          .then((value) => { if (!cancelled) setState({ phase: 'ready', data: value, error: null }) })
          .catch((error) => { if (!cancelled) setState({ phase: 'error', data: null, error: String(error?.message ?? error) }) })
        return () => { cancelled = true }
      }, [remote, sessionId, book, chapter])

      const data = state.data
      const sheet = data?.sheet ?? null
      const meta = data?.meta ?? {}
      const layers = data?.layers ?? {}
      const distribution = data?.distribution ?? {}

      return h('div', { className: 'fade-card', style: { marginTop: 6 } },
        h('div', { style: { display: 'flex', alignItems: 'center', gap: 6 } },
          h('span', { className: 'fade-k' }, `第 ${chapter} 章`),
          meta.highlight ? h(Tag, { tone: T.warn }, '高光') : null,
          meta.source === 'model' && (meta.climaxLevel >= 2) ? h(Tag, { tone: T.muted }, '模型推断') : null,
          h('span', { className: 'fade-grow' }),
          h('button', { type: 'button', className: 'fade-chip', onClick: onClose }, '×')),

        state.phase === 'loading' ? h(Loading, { label: '读这一章…' }) : null,
        state.phase === 'error' ? h(ErrorBox, { error: state.error }) : null,
        data && data.exists === false ? h(Empty, null, data.message ?? '这一章还没有 digest。') : null,

        data && data.exists
          ? h('div', null,
            data.title
              ? h('div', { style: { fontSize: 13, fontWeight: 600, marginTop: 5 } }, data.title)
              : null,
            h('div', { className: 'fade-t2', style: { marginTop: 3 } },
              `${data.cardCount} 张卡 · ${fmt(data.chars)} 字 · v${data.digestVersion}` +
              ` · L0 ${layers.L0 ?? 0} / L1 ${layers.L1 ?? 0} / L2 ${layers.L2 ?? 0} / L3 ${layers.L3 ?? 0}` +
              (data.faded ? ` · 已褪 ${data.faded}` : '')),
            data.faded
              ? h('div', { className: 'fade-t2', style: { marginTop: 4, whiteSpace: 'normal', color: T.warn } },
                `这一章有 ${data.faded} 条卡只剩大意；要写细节得回查原文。`)
              : null,

            sheet
              ? h('div', null,
                (sheet.scene?.location || sheet.scene?.time || (sheet.scene?.entities ?? []).length)
                  ? h('div', { className: 'fade-kv', style: { marginTop: 6 } },
                    [h('dt', { key: 'l' }, '场景'),
                      h('dd', { key: 'lv' },
                        [sheet.scene.location, sheet.scene.time].filter(Boolean).join(' · ') || '—',
                        (sheet.scene.entities ?? []).length
                          ? h('span', { style: { color: T.muted } }, `　在场：${sheet.scene.entities.join('、')}`)
                          : null)])
                  : null,
                (sheet.beats ?? []).length
                  ? h('div', { style: { marginTop: 6 } },
                    h('div', { className: 'fade-k' }, '关键动作'),
                    h('ul', { style: { margin: '3px 0 0', paddingLeft: 16, fontSize: 11, lineHeight: 1.7 } },
                      sheet.beats.map((beat, index) => h('li', { key: index }, beat))))
                  : null,
                (sheet.keyLines ?? []).length
                  ? h('div', { style: { marginTop: 6 } },
                    h('div', { className: 'fade-k' }, '关键句'),
                    sheet.keyLines.map((line, index) => h('div', { key: index, className: 'fade-quote' }, line)))
                  : null,
                sheet.ending
                  ? h('div', { style: { marginTop: 6 } },
                    h('div', { className: 'fade-k' }, '结尾'),
                    h('div', { className: 'fade-quote' }, sheet.ending))
                  : null,
                (sheet.openThreads ?? []).length
                  ? h('div', { style: { marginTop: 6 } },
                    h('div', { className: 'fade-k' }, '未闭合线索'),
                    h('ul', { style: { margin: '3px 0 0', paddingLeft: 16, fontSize: 11, lineHeight: 1.7 } },
                      sheet.openThreads.map((thread, index) => h('li', { key: index }, thread))))
                  : null)
              : h('div', { className: 'fade-t2', style: { marginTop: 6 } }, '这一章没有 scene sheet（digest 时没给 sheet）。'),

            (data.threads ?? []).length
              ? h('div', { style: { marginTop: 6 } },
                h('div', { className: 'fade-k' }, '本章埋的线索'),
                data.threads.map((thread) => h('div', { key: thread.id, className: 'fade-t2', style: { whiteSpace: 'normal' } },
                  `${thread.type}${thread.dueChapter ? `（第 ${thread.dueChapter} 章到期）` : ''}：${thread.text}`)))
              : null,

            h('div', { style: { marginTop: 8, display: 'flex', gap: 6 } },
              h('button', { type: 'button', className: 'fade-btn', onClick: () => onShowCards(data.chapter) },
                `看这一章的 ${data.cardCount} 张卡`),
              h('button', { type: 'button', className: 'fade-btn', onClick: () => onLocateSource({ chapter: data.chapter, quote: '' }) },
                data.sourceCached ? '回查本章原文（已存）' : '回查本章原文（未存）')))
          : null)
    }

    function CardsSection({
      snapshot, kind, onKind, query, onQuery, selected, onSelect, chapter, onChapter, onLocateSource,
      cards, total, hasMore, onMore, chapterFilter, onClearChapter, loadingMore,
      entityFilter, placeFilter, onEntity, onPlace, cachedChapters, fadedOnly, onFaded, fadedCount,
      remote, sessionId, book, chapterOpen, onOpenChapter, onCloseChapter, onChapterCards,
    }) {
      const people = snapshot.people ?? []
      const places = snapshot.places ?? []
      const chapters = snapshot.chapters ?? []
      const selectedCard = cards.find((card) => card.id === selected) ?? null
      const count = kind === 'people' ? people.length
        : kind === 'places' ? places.length
          : kind === 'chapters' ? chapters.length : total

      return h('div', null,
        h('div', { className: 'fade-input' },
          h('span', { style: { color: T.muted } }, '⌕'),
          h('input', {
            value: query, placeholder: '搜主题 / 人物 / 地点',
            onChange: (event) => onQuery(event.target.value),
          }),
          query ? h('button', { type: 'button', className: 'fade-chip', onClick: () => onQuery('') }, '清') : null,
          h('span', { className: 'fade-tag' }, `共 ${count}`)),
        h('div', { style: { display: 'flex', gap: 4, marginTop: 6, flexWrap: 'wrap' } },
          h(Chip, { active: kind === 'events', onClick: () => onKind('events') }, '事件'),
          h(Chip, { active: kind === 'chapters', onClick: () => onKind('chapters') }, `章节 ${chapters.length}`),
          h(Chip, { active: kind === 'people', onClick: () => onKind('people') }, `人物 ${people.length}`),
          h(Chip, { active: kind === 'places', onClick: () => onKind('places') }, `地点 ${places.length}`),
          fadedCount
            ? h(Chip, {
              active: fadedOnly, tone: fadedOnly ? T.warn : undefined, onClick: onFaded,
              title: '只看已经褪色的卡；这些卡只留大意，需要原句要回查原文',
            }, `已褪 ${fadedCount}`)
            : null,
          chapterFilter
            ? h(Chip, { active: true, onClick: onClearChapter, title: '取消章号筛选' }, `第 ${chapterFilter} 章 ×`)
            : null,
          entityFilter
            ? h(Chip, { active: true, onClick: () => onEntity(null), title: '取消人物筛选' }, `${entityFilter} ×`)
            : null,
          placeFilter
            ? h(Chip, { active: true, onClick: () => onPlace(null), title: '取消地点筛选' }, `${placeFilter} ×`)
            : null),

        selectedCard ? h(CardDetail, {
          card: selectedCard, onClose: () => onSelect(null), onLocateSource, onEntity,
          cached: cachedChapters,
        }) : null,

        chapterOpen
          ? h(ChapterDetail, {
            remote, sessionId, book, chapter: chapterOpen,
            onClose: onCloseChapter,
            onShowCards: onChapterCards,
            onLocateSource: (target) => onLocateSource(target),
          })
          : null,

        kind === 'people'
          ? (people.length
            ? h('div', { className: 'fade-list', style: { marginTop: 6 } }, people.map((person) => h('button', {
              key: person.id, type: 'button', className: 'fade-row',
              'data-a': entityFilter === person.name ? '1' : '0',
              onClick: () => onEntity(entityFilter === person.name ? null : person.name),
            },
            h('div', { className: 'fade-av' }, (person.name ?? '?').slice(0, 1)),
            h('div', { className: 'fade-grow' },
              h('div', { className: 'fade-t1' }, person.name,
                h('span', { style: { marginLeft: 5, color: T.muted, fontFamily: T.mono, fontSize: 9.5 } }, person.layer ?? '')),
              h('div', { className: 'fade-t2' }, `第 ${person.lastChapter} 章 · ${person.appearances} 次`,
                person.relationship ? ` · ${person.relationship}` : '')),
            h('div', { style: { display: 'flex', gap: 3 } },
              h(Tag, { tone: person.recallable ? T.ok : T.warn }, person.recallable ? '可召回' : '仅大意')))))
            : h(Empty, null, '没有匹配的人物。'))

          : kind === 'places'
            ? (places.length
              ? h('div', { className: 'fade-list', style: { marginTop: 6 } }, places.map((place) => h('button', {
                key: place.id, type: 'button', className: 'fade-row',
                'data-a': placeFilter === place.name ? '1' : '0',
                onClick: () => onPlace(placeFilter === place.name ? null : place.name),
              },
              h('div', { className: 'fade-av' }, (place.name ?? '?').slice(0, 1)),
              h('div', { className: 'fade-grow' },
                h('div', { className: 'fade-t1' }, place.name),
                h('div', { className: 'fade-t2' }, `第 ${place.lastVisit} 章 · 到访 ${place.visits} 次`,
                  place.state ? ` · ${place.state}` : '')),
              h('div', { style: { display: 'flex', gap: 3 } },
                h(Tag, { tone: T.muted }, `可及 ${place.accessibility.toFixed(2)}`)))))
              : h(Empty, null, '还没有地点。'))

          : kind === 'chapters'
            ? (chapters.length
              ? h('div', { className: 'fade-list', style: { marginTop: 6 } }, chapters.map((chapterRow) => h('button', {
                key: chapterRow.chapter, type: 'button', className: 'fade-row',
                'data-a': chapterOpen === chapterRow.chapter ? '1' : '0',
                onClick: () => onOpenChapter(chapterOpen === chapterRow.chapter ? null : chapterRow.chapter),
              },
              h('div', { className: 'fade-av' }, String(chapterRow.chapter)),
              h('div', { className: 'fade-grow' },
                h('div', { className: 'fade-t1' }, chapterRow.title || `第 ${chapterRow.chapter} 章`),
                h('div', { className: 'fade-t2' }, `${chapterRow.cards} 卡 · ${fmt(chapterRow.chars)} 字${chapterRow.hasSheet ? ' · 结尾 ✓' : ''}${chapterRow.faded ? ` · ${chapterRow.faded} 条已褪` : ''}`)),
              h(Tag, { tone: chapterRow.chapter === chapter ? T.brand : undefined }, chapterRow.chapter === chapter ? '当前' : `v${chapterRow.digestVersion}`))))
              : h(Empty, null, '还没有章节记忆卡。'))

            : (cards.length
              ? h('div', { className: 'fade-list', style: { marginTop: 6 } }, cards.map((card) => h('button', {
                key: card.id, type: 'button', className: 'fade-row', 'data-a': selected === card.id ? '1' : '0',
                onClick: () => onSelect(selected === card.id ? null : card.id),
              },
              h('div', { className: 'fade-av', style: { boxShadow: `inset 0 0 0 1px ${T.border}, inset 2px 0 0 ${PERMISSION_TONE[card.permission] ?? T.border}` } }, String(card.chapter)),
              h('div', { className: 'fade-grow' },
                h('div', { className: 'fade-t1' }, card.topic),
                h('div', { className: 'fade-t2' },
                  [card.emotion, card.entityNames.join('、'), card.placeName].filter(Boolean).join(' · ') || '—')),
              h(Tag, { tone: PERMISSION_TONE[card.permission] }, card.permission))))
              : h(Empty, null, query ? '没有匹配的卡。' : '还没有事件卡。')),
        hasMore && kind === 'events'
          ? h('div', { style: { marginTop: 8 } },
            h('button', {
              type: 'button', className: 'fade-btn', disabled: loadingMore, onClick: onMore,
            }, loadingMore ? '加载中…' : `加载更多（还有 ${Math.max(1, total - cards.length)} 条）`))
          : null)
    }

    /* ════════════════════════════════════════════════════════════════════════
     * 7. Curve
     * ════════════════════════════════════════════════════════════════════════ */
    const CURVE_COLORS = [T.brand, T.ok, T.warn, T.c3, T.c4]

    function Curve({ data, width }) {
      const boxWidth = Math.max(240, width || 360)
      const height = 190
      const pad = { l: 26, r: 8, t: 12, b: 20 }
      const innerW = boxWidth - pad.l - pad.r
      const innerH = height - pad.t - pad.b
      const from = 1
      const to = Math.max(from + 1, data?.x?.to ?? 1)
      const lines = data?.lines ?? []
      const threshold = Number(data?.threshold ?? 0.35)
      const px = (chapter) => pad.l + ((chapter - from) / Math.max(1, to - from)) * innerW
      const py = (value) => pad.t + (1 - Math.min(1, Math.max(0, value))) * innerH

      return h('div', null,
        h('svg', {
          width: '100%', viewBox: `0 0 ${boxWidth} ${height}`, style: { display: 'block' },
          role: 'img', 'aria-label': '记忆衰退曲线',
        },
        h('rect', { x: pad.l, y: py(threshold), width: innerW, height: Math.max(0, height - pad.b - py(threshold)), fill: T.warn, opacity: 0.055 }),
        h('line', { x1: pad.l, x2: pad.l + innerW, y1: py(threshold), y2: py(threshold), stroke: T.warn, strokeOpacity: 0.5, strokeDasharray: '3 3' }),
        [0, 0.25, 0.5, 0.75, 1].map((tick) => h('g', { key: tick },
          h('line', { x1: pad.l, x2: pad.l + innerW, y1: py(tick), y2: py(tick), stroke: T.border, strokeWidth: 1 }),
          h('text', { x: 2, y: py(tick) + 3, fill: T.muted, fontSize: 8, fontFamily: T.mono }, String(tick)))),
        lines.map((line, index) => h('polyline', {
          key: line.id,
          fill: 'none',
          stroke: CURVE_COLORS[index % CURVE_COLORS.length],
          strokeWidth: 1.7,
          strokeLinejoin: 'round',
          points: (line.points ?? []).map(([chapter, value]) => `${px(chapter)},${py(value)}`).join(' '),
        })),
        h('line', {
          x1: px(to), x2: px(to), y1: pad.t, y2: pad.t + innerH,
          stroke: T.muted, strokeOpacity: 0.35, strokeDasharray: '2 3',
        }),
        h('text', { x: px(to) - 2, y: pad.t + 8, fill: T.muted, fontSize: 8, fontFamily: T.mono, textAnchor: 'end' }, `第 ${to} 章`),
        h('text', { x: pad.l, y: height - 5, fill: T.muted, fontSize: 8, fontFamily: T.mono }, String(from)),
        h('text', { x: pad.l + innerW, y: height - 5, fill: T.muted, fontSize: 8, fontFamily: T.mono, textAnchor: 'end' }, String(to))),
        h('div', { className: 'fade-legend' },
          lines.map((line, index) => h('span', { key: line.id },
            h('i', { className: 'fade-dot', style: { background: CURVE_COLORS[index % CURVE_COLORS.length] } }), line.label)),
          h('span', null, h('i', { className: 'fade-dot', style: { background: T.warn } }), `可及性 < ${threshold}：细节要翻旧账`)))
    }

    function CurveSection({ curve, series, onSeries, width }) {
      return h('div', null,
        h('div', { style: { display: 'flex', gap: 4, alignItems: 'center' } },
          h(Chip, { active: series === 'people', onClick: () => onSeries('people') }, '人物'),
          h(Chip, { active: series === 'cards', onClick: () => onSeries('cards') }, '事件'),
          h(Chip, { active: series === 'chapters', onClick: () => onSeries('chapters') }, '章节'),
          h('div', { className: 'fade-grow' }),
          h('span', { className: 'fade-t2' }, curve.data ? `${curve.data.x?.points ?? 0} 点` : '')),
        curve.phase === 'loading' && !curve.data ? h(Loading, { label: '采样中…' }) : null,
        curve.phase === 'error' ? h(ErrorBox, { error: curve.error, onRetry: curve.reload }) : null,
        curve.data
          ? h('div', null,
            h('div', { className: 'fade-card', style: { marginTop: 6, padding: '6px 4px 2px' } },
              h(Curve, { data: curve.data, width })),
            h('div', { className: 'fade-t2', style: { marginTop: 6 } },
              '每章取一点，可及性由本地推导，不调用模型；L0 硬契约不进采样，始终可召回。'),
            (curve.data.lines ?? []).length === 0
              ? h(Empty, null, '还没有可采样的卡。')
              : null,
            (() => {
              const values = (curve.data.lines ?? []).flatMap((line) => (line.points ?? []).map(([, value]) => value))
              if (values.length === 0) return null
              const lowest = Math.min(...values)
              return lowest > 0.6
                ? h('div', { className: 'fade-t2', style: { marginTop: 4, whiteSpace: 'normal', lineHeight: 1.6 } },
                  `当前最低 ${lowest.toFixed(2)}：这本书的卡多是 L0/L1，衰减还不明显；L2 普通事件多起来后曲线才会压下去。`)
                : null
            })())
          : null)
    }

    /* ════════════════════════════════════════════════════════════════════════
     * 8. Source
     * ════════════════════════════════════════════════════════════════════════ */
    function SourceExcerpt({ result }) {
      const text = result?.text ?? ''
      if (!text) return h('pre', { className: 'fade-pre' }, '（空）')
      const offset = Number.isInteger(result.offset) ? result.offset : null
      const end = Number.isInteger(result.endOffset) ? result.endOffset : null
      const base = Number.isInteger(result.excerptStart) ? result.excerptStart : 0
      if (offset == null || end == null) return h('pre', { className: 'fade-pre' }, text)
      const start = offset - base
      const stop = end - base
      if (start < 0 || stop <= start || stop > text.length) return h('pre', { className: 'fade-pre' }, text)
      return h('pre', { className: 'fade-pre' },
        text.slice(0, start),
        h('mark', {
          style: {
            background: 'rgba(125,149,251,.28)', color: 'inherit',
            borderRadius: 2, padding: '0 1px',
          },
        }, text.slice(start, stop)),
        text.slice(stop))
    }

    function SourceSection({ index, remote, sessionId, inline, fadedChapters, book }) {
      const [term, setTerm] = React.useState(inline?.query ?? '')
      const [result, setResult] = React.useState(null)
      const [busy, setBusy] = React.useState(false)
      const [error, setError] = React.useState(null)
      const [chapter, setChapter] = React.useState(inline?.chapter ?? null)
      // 从卡片跳进来时，inline 那条 effect 已经取过片段，不要再自动取一次。
      const skipAuto = React.useRef(false)

      const run = async (targetChapter = chapter ?? inline?.chapter, targetTerm = term) => {
        if (!remote || !sessionId) return
        if (!targetChapter) {
          setError('先选一章，再搜索。')
          return
        }
        setBusy(true)
        setError(null)
        try {
          const value = unwrap(await remote.sourceSlice(sessionId, {
            ...(book ? { book } : {}),
            chapter: targetChapter,
            ...(String(targetTerm || '').trim() ? { query: String(targetTerm).trim() } : { from: 0, len: 2000 }),
          }))
          setResult(value)
        } catch (err) {
          setError(String(err?.message ?? err))
        } finally {
          setBusy(false)
        }
      }

      React.useEffect(() => {
        if (!inline?.chapter) return
        setChapter(inline.chapter)
        if (inline.query) setTerm(inline.query)
        skipAuto.current = true
        run(inline.chapter, inline.query)
      // eslint-disable-next-line react-hooks/exhaustive-deps
      }, [])

      // 选中一章就直接给开头一段，不用再点「搜」；从卡片跳进来的那次跳过。
      React.useEffect(() => {
        if (!chapter) return
        if (skipAuto.current) {
          skipAuto.current = false
          return
        }
        run(chapter, '')
      // eslint-disable-next-line react-hooks/exhaustive-deps
      }, [chapter])

      const chapters = index?.data?.chapters ?? []
      const enabled = index?.data?.enabled !== false
      const fadedMap = new Map((fadedChapters ?? []).map((row) => [row.chapter, row.faded ?? 0]))

      return h('div', null,
        h('div', { style: { display: 'flex', gap: 6, alignItems: 'center' } },
          h('span', { className: 'fade-k' }, enabled ? '原文贮存' : '原文贮存已关闭'),
          h('div', { className: 'fade-grow' }),
          h('span', { className: 'fade-t2' }, chapters.length ? `${chapters.length} 章 · ${(Number(index.data.bytes || 0) / 1048576).toFixed(1)} MB` : '0 章')),
        h('div', { className: 'fade-t2', style: { marginTop: 4, whiteSpace: 'normal', lineHeight: 1.6 } },
          '每写完一章自动存这里，只存不用：写作只拿简报和卡；哪一章的卡被褪掉了、要核对原句，才下来取片段（≤4000 字），不随会话发送。'),

        index.phase === 'loading' ? h(Loading, null) : null,
        index.phase === 'error' ? h(ErrorBox, { error: index.error, onRetry: index.reload }) : null,

        !enabled
          ? h(Empty, null, '没有开启原文贮存。卡与简报不受影响；要查原文，先让模型 memo_ingest 一章。')
          : chapters.length === 0
            ? h(Empty, null, '索引还是空的：下次 memo_digest 会自动把这一章存进来，也可以让模型对旧章跑 memo_ingest 补齐。')
            : h('div', { className: 'fade-list', style: { marginTop: 8, maxHeight: 220, overflow: 'auto' } },
              chapters.slice().reverse().map((row) => h('button', {
                key: row.chapter, type: 'button', className: 'fade-row',
                'data-a': chapter === row.chapter ? '1' : '0',
                onClick: () => { setChapter(row.chapter); setResult(null); setError(null) },
              },
              h('div', { className: 'fade-av' }, String(row.chapter)),
              h('div', { className: 'fade-grow' },
                h('div', { className: 'fade-t1' }, row.title || `第 ${row.chapter} 章`),
                h('div', { className: 'fade-t2' }, `${fmt(row.chars)} 字 · ${row.at ? row.at.slice(0, 10) : ''}${fadedMap.get(row.chapter) ? ` · ${fadedMap.get(row.chapter)} 条已褪` : ''}`)),
              h(Tag, { tone: chapter === row.chapter ? T.brand : undefined }, chapter === row.chapter ? '选中' : '查看')))),

        h('div', { className: 'fade-input', style: { marginTop: 8 } },
          h('span', { style: { color: T.muted } }, '⌕'),
          h('input', {
            value: term, placeholder: chapter ? `在第 ${chapter} 章里找…` : '先选一章',
            onChange: (event) => setTerm(event.target.value),
            onKeyDown: (event) => { if (event.key === 'Enter') run() },
          }),
          h('button', { type: 'button', className: 'fade-chip', disabled: busy, onClick: () => run() }, busy ? '…' : '搜')),

        error ? h('div', { style: { marginTop: 8 } }, h('div', { className: 'fade-err' }, error)) : null,
        result
          ? h('div', { style: { marginTop: 8 } },
            h('div', { className: 'fade-t2' }, result.ok
              ? `第 ${result.chapter} 章 · 偏移 ${result.offset}${result.endOffset != null ? `–${result.endOffset}` : ''}${result.truncated ? ' · 已截断' : ''}${result.stale === true ? ' · 原文已变化' : result.stale === false ? ' · sha 校验通过' : ''}${result.note ? ` · ${result.note}` : ''}`
              : '没取到'),
            result.ok
              ? h(SourceExcerpt, { result })
              : h('div', { className: 'fade-err', style: { marginTop: 6 } }, result.message ?? result.code ?? '取不到'),
            result.ok && result.stale === true
              ? h('div', { className: 'fade-err', style: { marginTop: 6 } },
                '原文已变化：旧偏移可能不再准确；建议重新 digest 这一章，或重新 memo_ingest。')
              : null)
          : null)
    }

    /* ════════════════════════════════════════════════════════════════════════
     * 9. Shell
     * ════════════════════════════════════════════════════════════════════════ */
    const SECTIONS = [
      ['overview', '总览'],
      ['cards', '卡片'],
      ['curve', '曲线'],
      ['source', '原文'],
    ]

    function FadeTab(props) {
      const sessionId = sessionIdOf(props?.sessionId)
      const remote = props?.remote ?? null
      const [bookPicked, setBookPicked] = React.useState(null)
      const panel = usePanel(remote, sessionId, bookPicked)
      const [section, setSection] = React.useState('overview')
      const [kind, setKind] = React.useState('events')
      const [selected, setSelected] = React.useState(null)
      const [query, setQuery] = React.useState('')
      const [debounced, setDebounced] = React.useState('')
      const [chapterFilter, setChapterFilter] = React.useState(null)
      const [entityFilter, setEntityFilter] = React.useState(null)
      const [placeFilter, setPlaceFilter] = React.useState(null)
      const [fadedOnly, setFadedOnly] = React.useState(false)
      const [chapterOpen, setChapterOpen] = React.useState(null)
      const [filtered, setFiltered] = React.useState(null)
      const [sourceCursor, setSourceCursor] = React.useState(null)
      const [brief, setBrief] = React.useState({ phase: 'idle', data: null, error: null })
      const [curveSeries, setCurveSeries] = React.useState('people')
      const [width, setWidth] = React.useState(360)
      const [scheme] = React.useState(() => detectScheme())
      const rootRef = React.useRef(null)

      React.useEffect(() => {
        const id = setTimeout(() => setDebounced(query.trim()), 260)
        return () => clearTimeout(id)
      }, [query])

      const hasFilter = Boolean(debounced || chapterFilter || entityFilter || placeFilter || fadedOnly)
      React.useEffect(() => {
        if (!hasFilter || !remote || !sessionId) {
          setFiltered(null)
          return undefined
        }
        let cancelled = false
        const options = { limit: 60 }
        if (bookPicked) options.book = bookPicked
        if (debounced) options.query = debounced
        if (chapterFilter) options.chapter = chapterFilter
        if (entityFilter) options.entity = entityFilter
        if (placeFilter) options.place = placeFilter
        if (fadedOnly) options.permission = ['gist', 'feeling']
        remote.panel(sessionId, options)
          .then(unwrap)
          .then((value) => { if (!cancelled) setFiltered(value) })
          .catch((error) => { if (!cancelled) console.error('[novel-fade] 筛选失败', error) })
        return () => { cancelled = true }
      }, [hasFilter, debounced, chapterFilter, entityFilter, placeFilter, fadedOnly, remote, sessionId])

      React.useEffect(() => {
        if (!rootRef.current || typeof ResizeObserver !== 'function') return undefined
        const observer = new ResizeObserver((entries) => {
          const next = entries[0]?.contentRect?.width
          if (next && Math.abs(next - width) > 24) setWidth(Math.round(next))
        })
        observer.observe(rootRef.current)
        return () => observer.disconnect()
      }, [width])

      const snapshot = filtered ?? panel.data?.panel ?? null
      const mode = panel.data?.mode?.on ?? null
      const curve = useCurve(remote, sessionId, curveSeries, snapshot?.chapter, section === 'curve', bookPicked)
      const sourceIndex = useSourceIndex(remote, sessionId, section === 'source', bookPicked)

      const switchBook = (next) => {
        if (!next || next === (snapshot?.book ?? null)) return
        setBookPicked(next)
        setQuery('')
        setDebounced('')
        setChapterFilter(null)
        setEntityFilter(null)
        setPlaceFilter(null)
        setFadedOnly(false)
        setFiltered(null)
        setSelected(null)
        setMore([])
        setSourceCursor(null)
        setBrief({ phase: 'idle', data: null, error: null })
      }

      // 「加载更多」只在事件列表里用；换筛选/快照/章号时清空。
      const [more, setMore] = React.useState([])
      const [moreBusy, setMoreBusy] = React.useState(false)
      const moreKey = `${snapshot?.generatedAt ?? ''}|${debounced}|${chapterFilter ?? ''}|${entityFilter ?? ''}|${placeFilter ?? ''}`
      React.useEffect(() => { setMore([]) }, [moreKey])

      const cards = (snapshot?.cards ?? []).concat(more)
      const totalCards = snapshot?.pagination?.total ?? cards.length
      const loadMore = async () => {
        if (!remote || !sessionId || moreBusy) return
        setMoreBusy(true)
        try {
          const options = { offset: cards.length, limit: 60 }
          if (bookPicked) options.book = bookPicked
          if (debounced) options.query = debounced
          if (chapterFilter) options.chapter = chapterFilter
          if (entityFilter) options.entity = entityFilter
          if (placeFilter) options.place = placeFilter
          if (fadedOnly) options.permission = ['gist', 'feeling']
          const next = unwrap(await remote.panel(sessionId, options))
          setMore((prev) => {
            const seen = new Set((snapshot?.cards ?? []).map((card) => card.id))
            for (const card of prev) seen.add(card.id)
            return prev.concat((next.cards ?? []).filter((card) => !seen.has(card.id)))
          })
        } catch (error) {
          console.error('[novel-fade] 加载更多失败', error)
        } finally {
          setMoreBusy(false)
        }
      }

      const toggleMode = async () => {
        if (!remote || !sessionId || mode == null) return
        try {
          unwrap(await remote.setMode(sessionId, !mode))
          panel.reload()
        } catch (error) {
          console.error('[novel-fade] 切换失败', error)
        }
      }

      const generateBrief = async () => {
        if (!remote || !sessionId) return
        setBrief({ phase: 'loading', data: null, error: null })
        try {
          const value = unwrap(await remote.brief(sessionId, bookPicked ? { book: bookPicked } : {}))
          setBrief({ phase: 'ready', data: value, error: null })
        } catch (error) {
          setBrief({ phase: 'error', data: null, error: String(error?.message ?? error) })
        }
      }

      const go = (next, nextKind, selectedId) => {
        setSection(next)
        if (nextKind) setKind(nextKind)
        if (selectedId) setSelected(selectedId)
      }

      const locateSource = (card) => {
        setSourceCursor({ chapter: card.chapter, query: card.quote || '' })
        setSection('source')
      }

      const healthAction = (action) => {
        if (!action) return
        if (action.kind === 'brief') {
          setSection('overview')
          return
        }
        setSection('cards')
        setKind('events')
        if (Number.isInteger(action.chapter) && action.chapter > 0) setChapterFilter(action.chapter)
        if (action.kind === 'card' && action.cardId) setSelected(action.cardId)
      }

      const clearFilter = () => {
        setQuery('')
        setDebounced('')
        setChapterFilter(null)
        setEntityFilter(null)
        setPlaceFilter(null)
        setFadedOnly(false)
        setFiltered(null)
      }

      const header = h('div', { className: 'fade-head' },
        h('div', { className: 'fade-title-row' },
          h(Mark),
          h('span', { className: 'fade-title' }, '长篇记忆'),
          mode == null ? null : h('button', {
            type: 'button', className: 'fade-chip', 'data-a': mode ? '1' : '0',
            style: mode ? {
              height: 18, fontSize: 9.5,
              color: T.ok,
              borderColor: `color-mix(in srgb, ${T.ok} 45%, transparent)`,
              background: `color-mix(in srgb, ${T.ok} 12%, transparent)`,
            } : { height: 18, fontSize: 9.5 },
            onClick: toggleMode,
            title: '切换 /memo on | off',
          }, mode ? '开' : '关'),
          snapshot?.revision != null
            ? h('span', {
              className: 'fade-chip',
              style: { height: 18, fontSize: 9.5, color: T.muted },
              title: '记忆版本',
            }, `v${snapshot.revision}`)
            : null,
          h('div', { className: 'fade-grow' }),
          h('button', {
            type: 'button', className: 'fade-chip', onClick: () => { clearFilter(); panel.reload() },
            title: '重新读取快照',
          }, '↻')),
        snapshot
          ? h('div', { className: 'fade-sub' },
            (snapshot.books?.length ?? 0) > 1
              ? h('select', {
                className: 'fade-select',
                value: snapshot.book ?? '',
                onChange: (event) => switchBook(event.target.value),
                title: `这个工作区有 ${snapshot.books.length} 本书`,
              }, snapshot.books.map((entry) => h('option', {
                key: entry.book, value: entry.book,
              }, entry.title || entry.book)))
              : h('span', { style: { overflow: 'hidden', textOverflow: 'ellipsis' } }, snapshot.title ?? snapshot.book ?? ''),
            h('span', null, '·'),
            h('span', { className: 'fade-num' }, `第 ${snapshot.chapter} 章`),
            snapshot.book && snapshot.book !== snapshot.title && (snapshot.books?.length ?? 0) <= 1
              ? h('span', null, `· ${snapshot.book}`)
              : null)
          : null)

      let body = null
      if (panel.phase === 'loading' && !snapshot) body = h(Loading, { label: '读取记忆…' })
      else if (panel.phase === 'error' && !snapshot) body = h(ErrorBox, { error: panel.error, onRetry: panel.reload })
      else if (!snapshot) body = h(Empty, null, '还没有数据。')
      else if (snapshot.exists === false) {
        body = h(Empty, null,
          h('div', null, snapshot.message ?? '这个工作区还没有 fade 记忆。'),
          h('div', { style: { marginTop: 10 } },
            h('button', { type: 'button', className: 'fade-btn', onClick: panel.reload }, '重新检查')))
      } else if (section === 'overview') {
        body = h(Overview, {
          snapshot, mode, onToggleMode: toggleMode, onGo: go, onBrief: generateBrief, brief,
          onFaded: () => { setFadedOnly(true); setKind('events'); setSection('cards') },
          onHealthAction: healthAction,
        })
      } else if (section === 'cards') {
        body = h(CardsSection, {
          snapshot, kind, onKind: setKind, query, onQuery: setQuery, selected,
          onSelect: (id) => { setSelected(id); if (id) setChapterOpen(null) },
          chapter: snapshot.chapter,
          onChapter: (chapterNumber) => {
            setKind('events')
            setChapterFilter((prev) => (prev === chapterNumber ? null : chapterNumber))
          },
          onLocateSource: locateSource,
          cards, total: totalCards, hasMore: totalCards > cards.length, onMore: loadMore,
          loadingMore: moreBusy, chapterFilter, onClearChapter: () => setChapterFilter(null),
          entityFilter, placeFilter,
          onEntity: (name) => { setEntityFilter(name ?? null); if (name) setKind('events') },
          onPlace: (name) => { setPlaceFilter(name ?? null); if (name) setKind('events') },
          remote, sessionId, book: snapshot?.book ?? null,
          chapterOpen,
          onOpenChapter: (value) => {
            setChapterOpen(value ?? null)
            if (value) { setSelected(null); setKind('chapters') }
          },
          onCloseChapter: () => setChapterOpen(null),
          onChapterCards: (chapterNumber) => {
            setKind('events')
            setChapterFilter(chapterNumber)
            setChapterOpen(null)
          },
          fadedOnly,
          onFaded: () => { setFadedOnly((prev) => !prev); setKind('events') },
          fadedCount: (snapshot.overview?.cards?.distribution?.gist ?? 0) + (snapshot.overview?.cards?.distribution?.feeling ?? 0),
          cachedChapters: snapshot?.overview?.source?.list ?? [],
        })
      } else if (section === 'curve') {
        body = h(CurveSection, { curve, series: curveSeries, onSeries: setCurveSeries, width: width - 60 })
      } else {
        body = h(SourceSection, {
          index: sourceIndex, remote, sessionId, inline: sourceCursor,
          fadedChapters: (snapshot.chapters ?? []).filter((row) => row.faded > 0),
          book: bookPicked ?? snapshot?.book ?? null,
        })
      }

      return h('div', { className: 'fade-root', ref: rootRef, 'data-scheme': scheme },
        h(Styles),
        header,
        h('div', { className: 'fade-tabs' }, SECTIONS.map(([id, label]) => h('button', {
          key: id, type: 'button', className: 'fade-tab', 'data-a': section === id ? '1' : '0',
          onClick: () => setSection(id),
        }, label))),
        h('div', { className: 'fade-body' }, body),
        h('div', { className: 'fade-foot' },
          h('span', null, snapshot?.revision != null
            ? `记忆 v${snapshot.revision} · 快照 ${snapshot.generatedAt ? new Date(snapshot.generatedAt).toLocaleTimeString('zh-CN', { hour12: false }) : '未加载'}`
            : (snapshot?.generatedAt ? `快照 ${new Date(snapshot.generatedAt).toLocaleTimeString('zh-CN', { hour12: false })}` : '未加载')),
          h('span', null, `${(snapshot?.warnings ?? []).length} 条提示`)))
    }

    function FadeOpenButton(props) {
      return h('button', {
        type: 'button',
        title: '长篇记忆：人物 / 事件 / 章节 / 衰退曲线 / 原文',
        onClick: props.open,
        style: {
          appearance: 'none',
          border: `1px solid ${T.border}`,
          background: 'transparent',
          color: T.muted,
          borderRadius: 6,
          padding: '2px 8px',
          fontSize: 12,
          lineHeight: '18px',
          cursor: 'pointer',
          fontFamily: 'inherit',
          marginRight: 6,
        },
      }, '长篇记忆')
    }

    /* ════════════════════════════════════════════════════════════════════════
     * 10. Plugin
     * ════════════════════════════════════════════════════════════════════════ */
    const TAB_ID = 'dsh-novel-fade'
    const TAB_KIND = 'novel-fade'
    const TAB_TITLE = '长篇记忆'

    return {
      inject: ['slots', 'remote'],
      async apply(ctx) {
        let remote = null
        try {
          const dispose = await ctx.remote.$mount(TYPERT_REMOTE)
          remote = ctx.get('remote.memoMode') ?? null
          if (typeof dispose === 'function') {
            ctx.effect(() => () => {
              try { dispose() } catch { /* already gone */ }
            })
          }
          if (!remote) console.error('[novel-fade] remote.memoMode 未注册')
        } catch (error) {
          console.error('[novel-fade] remote mount 失败', error)
        }

        // Everything below needs the Host right Sidebar. `ctx.inject` keeps the
        // plugin inactive (instead of throwing) in a profile without it, and
        // re-registers when the seat comes back.
        const seat = ctx.inject(['sidebarRightTabs', 'sidebarRight'], (scoped) => {
          const tabs = scoped.get('sidebarRightTabs')
          const right = scoped.get('sidebarRight')
          if (!tabs || !right) {
            console.warn('[novel-fade] 宿主右栏服务缺失，不注册页签。')
            return
          }

          // 1) 页签类型 —— 打开时按 kind 找；id 是 body/title 槽位的 key。
          scoped.effect(() => tabs.register({
            id: TAB_ID,
            kind: TAB_KIND,
            priority: 'extension',
            keepMounted: true,
            title: () => TAB_TITLE,
            guide: [{
              id: TAB_ID,
              order: 10,
              title: () => TAB_TITLE,
              description: () => '人物 / 事件 / 章节记忆卡、衰退曲线、按需原文',
            }],
          }), 'novel-fade: tab type')

          // 2) 页签主体
          scoped.effect(() => scoped.slots.inject('sidebar.right.pane.tab', () => scoped.slots.register(
            { name: 'sidebar.right.pane.tab', key: TAB_ID, inject: (sessionId) => ({ sessionId, remote }) },
            FadeTab,
          )), 'novel-fade: tab body')

          // 3) 会话头入口
          scoped.effect(() => scoped.slots.inject('conversation.session.header.utilities', () => scoped.slots.register(
            {
              name: 'conversation.session.header.utilities',
              id: 'dsh-novel-fade-open',
              order: 35,
              inject: () => ({
                open: () => {
                  try { right.openTab(TAB_KIND) } catch (error) { console.error('[novel-fade] openTab 失败', error) }
                },
              }),
            },
            FadeOpenButton,
          )), 'novel-fade: header button')
        })

        ctx.effect(() => () => {
          try { seat?.() } catch { /* scope already gone */ }
        })
      },
    }
  },
})
