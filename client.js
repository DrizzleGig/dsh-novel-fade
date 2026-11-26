window.__ModuleLoader__.load({
  id: 'dsh-novel-fade',
  factory(require) {
    const React = require('react')
    const h = React.createElement

    /* ════════════════════════════════════════════════════════════════════════
     * 0. Remote contract — keep in sync with lib/remote-contract.js.
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
        ['timeline', [param('sessionId', sessionIdSchema), param('options', jsonObjectSchema)], panelResultSchema, 'FadePanel'],
        ['character', [param('sessionId', sessionIdSchema), param('options', jsonObjectSchema)], panelResultSchema, 'FadePanel'],
        ['artifact', [param('sessionId', sessionIdSchema), param('options', jsonObjectSchema)], panelResultSchema, 'FadePanel'],
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
    const shortHash = (value) => {
      const text = String(value ?? '').replace(/^sha256:/, '')
      return text.length > 12 ? `${text.slice(0, 6)}…${text.slice(-4)}` : text || '—'
    }
    const clock = (value) => {
      if (!value) return '—'
      const date = new Date(value)
      if (Number.isNaN(date.getTime())) return '—'
      return date.toLocaleTimeString('zh-CN', { hour12: false, hour: '2-digit', minute: '2-digit' })
    }
    const dayLabel = (value) => {
      if (!value) return '—'
      const date = new Date(value)
      if (Number.isNaN(date.getTime())) return '—'
      const now = new Date()
      const start = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
      const then = new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime()
      const diff = Math.round((start - then) / 86400000)
      if (diff === 0) return '今天'
      if (diff === 1) return '昨天'
      return `${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
    }
    const parseNames = (value) => String(value ?? '')
      .split(/[、,，\s]+/)
      .map((name) => name.trim())
      .filter(Boolean)

    /* ════════════════════════════════════════════════════════════════════════
     * 2. Palette + CSS
     * ════════════════════════════════════════════════════════════════════════ */
    const PALETTE_CSS = `
.fade-root[data-scheme="dark"]{
  --fade-text:#e8edf5; --fade-muted:#98a6b8; --fade-faint:#6f7d90;
  --fade-bg:#111722; --fade-surface:#18212d; --fade-surface-2:#1f2b3a;
  --fade-line:rgba(255,255,255,.08); --fade-line-2:rgba(255,255,255,.15);
  --fade-brand:#7db5f2; --fade-brand-soft:rgba(125,181,242,.12);
  --fade-ok:#63c7a3; --fade-warn:#e6b95c; --fade-danger:#f07f76;
  --fade-mono:"Cascadia Mono","SFMono-Regular",Consolas,monospace;
  --fade-shadow:0 1px 0 rgba(255,255,255,.035) inset,0 18px 50px rgba(0,0,0,.45);
}
.fade-root[data-scheme="light"]{
  --fade-text:#202a36; --fade-muted:#758194; --fade-faint:#7b8695;
  --fade-bg:#f5f6f8; --fade-surface:#ffffff; --fade-surface-2:#f3f5f8;
  --fade-line:rgba(32,42,54,.09); --fade-line-2:rgba(32,42,54,.16);
  --fade-brand:#286fb7; --fade-brand-soft:rgba(40,111,183,.08);
  --fade-ok:#1f7a5a; --fade-warn:#8f6410; --fade-danger:#b8443c;
  --fade-mono:"Cascadia Mono","SFMono-Regular",Consolas,monospace;
  --fade-shadow:0 1px 2px rgba(16,24,40,.04);
}
.fade-root[data-scheme="light"] .fade-tag.danger{color:#9d352e;background:rgba(184,68,60,.09);border-color:rgba(184,68,60,.24)}
.fade-root[data-scheme="light"] .fade-tag.warn{color:#7d570d;background:rgba(143,100,16,.09);border-color:rgba(143,100,16,.24)}
.fade-root[data-scheme="light"] .fade-tag.ok{color:#176b4e;background:rgba(31,122,90,.09);border-color:rgba(31,122,90,.24)}
.fade-root[data-scheme="light"] .fade-pin{color:#7d570d}
.fade-root[data-scheme="light"] .fade-layer{color:#6b7685}
.fade-root[data-scheme="light"] .fade-cta{background:var(--fade-brand);border-color:var(--fade-brand);color:#fff}`

    function detectScheme() {
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
.fade-root{display:flex;flex-direction:column;height:100%;min-height:0;color:var(--fade-text);background:var(--fade-bg);font-family:"Microsoft YaHei","PingFang SC","Noto Sans SC","Segoe UI",system-ui,sans-serif;font-size:13px;line-height:1.55;position:relative;overflow:hidden}
.fade-root *{box-sizing:border-box}
.fade-root button{font-family:inherit}
.fade-head{flex:none;padding:13px 14px 0;position:relative;z-index:1}
.fade-title-row{display:flex;align-items:center;gap:8px;min-height:28px}
.fade-brand{width:26px;height:26px;border-radius:8px;display:grid;place-items:center;flex:none;background:linear-gradient(145deg,#4f83c8,#7db5f2);box-shadow:0 3px 12px rgba(79,131,200,.28)}
.fade-title{font-size:15px;font-weight:650;letter-spacing:.02em;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.fade-switch{width:36px;height:20px;border-radius:99px;border:0;position:relative;cursor:pointer;flex:none;background:color-mix(in srgb,var(--fade-ok) 24%,transparent);transition:background .15s ease}
.fade-switch::after{content:"";position:absolute;width:16px;height:16px;border-radius:50%;right:2px;top:2px;background:var(--fade-ok);box-shadow:0 0 0 2px color-mix(in srgb,var(--fade-ok) 12%,transparent);transition:transform .15s ease}
.fade-switch[data-on="0"]{background:var(--fade-line-2)}
.fade-switch[data-on="0"]::after{right:auto;left:2px;background:var(--fade-faint);box-shadow:none}
.fade-switch-label{font-size:10px;color:var(--fade-muted);font-family:var(--fade-mono);margin-left:-3px}
.fade-ver{font-size:10px;font-family:var(--fade-mono);color:var(--fade-faint);border:1px solid var(--fade-line);border-radius:5px;padding:2px 5px;white-space:nowrap}
.fade-grow{flex:1;min-width:0}
.fade-iconbtn{width:30px;height:30px;border-radius:8px;border:1px solid transparent;background:transparent;color:var(--fade-muted);display:grid;place-items:center;cursor:pointer;flex:none}
.fade-iconbtn:hover{background:var(--fade-surface);border-color:var(--fade-line);color:var(--fade-text)}
.fade-iconbtn:focus-visible,.fade-tab:focus-visible,.fade-cta:focus-visible,.fade-chip:focus-visible,.fade-btn:focus-visible{outline:2px solid var(--fade-brand);outline-offset:2px}
.fade-bookrow{display:flex;align-items:center;gap:7px;min-height:28px;margin-top:7px}
.fade-book{max-width:250px;min-width:0;display:flex;align-items:center;gap:5px;border:0;background:transparent;padding:0;cursor:pointer;color:var(--fade-text);font-size:12px;font-weight:500;white-space:nowrap;overflow:hidden}
.fade-book b{font-weight:600;overflow:hidden;text-overflow:ellipsis}
.fade-book svg{color:var(--fade-faint);flex:none}
.fade-select{max-width:240px;height:24px;border:1px solid var(--fade-line);border-radius:6px;background:var(--fade-surface);color:var(--fade-text);font:inherit;font-size:11px;padding:0 4px;outline:none}
.fade-chap{font-family:var(--fade-mono);font-size:10px;color:var(--fade-muted);border:1px solid var(--fade-line);border-radius:5px;padding:2px 5px;white-space:nowrap}
.fade-healthpill{margin-left:auto;display:flex;align-items:center;gap:4px;font-size:9.5px;font-family:var(--fade-mono);color:var(--fade-danger);background:color-mix(in srgb,var(--fade-danger) 8%,transparent);border:1px solid color-mix(in srgb,var(--fade-danger) 22%,transparent);border-radius:99px;padding:2px 7px;white-space:nowrap}
.fade-healthpill[data-ok="1"]{color:var(--fade-ok);background:color-mix(in srgb,var(--fade-ok) 8%,transparent);border-color:color-mix(in srgb,var(--fade-ok) 22%,transparent)}
.fade-dot{width:5px;height:5px;border-radius:50%;background:currentColor;flex:none}
.fade-nav{display:flex;gap:3px;margin-top:9px;padding:3px;border-radius:10px;background:color-mix(in srgb,var(--fade-text) 4%,transparent);border:1px solid var(--fade-line)}
.fade-tab{flex:1;height:36px;border:0;border-radius:7px;background:transparent;color:var(--fade-muted);font-size:11.5px;cursor:pointer}
.fade-tab[data-a="1"]{background:var(--fade-surface-2);color:var(--fade-text);box-shadow:inset 0 0 0 1px var(--fade-line-2);font-weight:600}
.fade-cta{height:36px;padding:0 10px;border-radius:7px;border:1px solid color-mix(in srgb,var(--fade-brand) 38%,transparent);background:var(--fade-brand-soft);color:var(--fade-brand);font-size:10.5px;font-weight:600;display:flex;align-items:center;gap:5px;cursor:pointer;white-space:nowrap}
.fade-body{flex:1;min-height:0;overflow-y:auto;overscroll-behavior:contain;scrollbar-width:thin;scrollbar-color:var(--fade-line-2) transparent;padding:12px 14px 18px;display:flex;flex-direction:column;gap:12px}
.fade-body::-webkit-scrollbar{width:8px}
.fade-body::-webkit-scrollbar-thumb{background:var(--fade-line-2);border-radius:99px}
.fade-card{background:var(--fade-surface);border:1px solid var(--fade-line);border-radius:12px;padding:12px;position:relative}
.fade-card-h{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:7px}
.fade-kicker{font-size:10px;letter-spacing:.1em;color:var(--fade-muted);font-weight:650}
.fade-meta{font-size:10px;color:var(--fade-faint);font-family:var(--fade-mono);white-space:nowrap}
.fade-hero{font-size:20px;line-height:1.2;font-weight:700;letter-spacing:-.01em}
.fade-sub{font-size:10.5px;color:var(--fade-muted)}
.fade-issue{display:grid;grid-template-columns:3px 1fr;gap:9px;padding:9px 0 8px;border-top:1px solid var(--fade-line)}
.fade-issue:first-of-type{border-top:0}
.fade-issue-bar{width:3px;border-radius:2px;background:var(--fade-danger);margin-top:2px}
.fade-issue-bar.warn{background:var(--fade-warn)}
.fade-issue-bar.info{background:var(--fade-muted)}
.fade-issue-top{display:flex;align-items:center;gap:5px;margin-bottom:2px}
.fade-tag{font-size:9px;line-height:1;padding:3px 5px;border-radius:4px;font-family:var(--fade-mono);white-space:nowrap;border:1px solid var(--fade-line);color:var(--fade-muted)}
.fade-tag.danger{color:#ffb0a9;background:color-mix(in srgb,var(--fade-danger) 10%,transparent);border-color:color-mix(in srgb,var(--fade-danger) 26%,transparent)}
.fade-tag.warn{color:#f1ce86;background:color-mix(in srgb,var(--fade-warn) 9%,transparent);border-color:color-mix(in srgb,var(--fade-warn) 24%,transparent)}
.fade-tag.ok{color:#9fe3c6;background:color-mix(in srgb,var(--fade-ok) 9%,transparent);border-color:color-mix(in srgb,var(--fade-ok) 24%,transparent)}
.fade-issue-title{font-size:12px;line-height:1.45;font-weight:600}
.fade-issue-detail{font-size:11px;line-height:1.5;color:var(--fade-muted);margin-top:2px}
.fade-link{border:0;background:transparent;padding:0;color:var(--fade-brand);font-size:10.5px;cursor:pointer;display:inline-flex;align-items:center;gap:3px;margin-top:3px}
.fade-budget-line{display:flex;align-items:flex-end;justify-content:space-between;gap:8px}
.fade-budget-num{font-family:var(--fade-mono);font-size:24px;font-weight:600;letter-spacing:-.03em;line-height:1}
.fade-budget-num small{font-size:10px;color:var(--fade-muted);font-weight:400;margin-left:2px}
.fade-budget-save{text-align:right;font-family:var(--fade-mono);font-size:10px;color:var(--fade-ok);line-height:1.4}
.fade-bar{height:5px;border-radius:99px;background:color-mix(in srgb,var(--fade-text) 7%,transparent);overflow:hidden;margin:9px 0 6px}
.fade-bar i{display:block;height:5px;border-radius:99px;background:linear-gradient(90deg,#5f9fe0,#7db5f2)}
.fade-scale{display:flex;justify-content:space-between;color:var(--fade-faint);font-family:var(--fade-mono);font-size:9px}
.fade-quick{display:grid;grid-template-columns:1.2fr 1fr 1fr;gap:6px}
.fade-qbtn{height:54px;border:1px solid var(--fade-line);border-radius:10px;background:var(--fade-surface);text-align:left;padding:8px 9px;cursor:pointer;color:var(--fade-text);display:flex;flex-direction:column;justify-content:center;gap:3px}
.fade-qbtn:hover{background:var(--fade-surface-2)}
.fade-qbtn[data-p="1"]{background:var(--fade-brand-soft);border-color:color-mix(in srgb,var(--fade-brand) 32%,transparent)}
.fade-qtop{display:flex;align-items:center;gap:5px;font-size:10.5px;font-weight:600}
.fade-qsub{font-size:9px;color:var(--fade-faint);font-family:var(--fade-mono);white-space:nowrap}
.fade-qbtn[data-p="1"] .fade-qsub{color:var(--fade-brand)}
.fade-sec{display:flex;align-items:baseline;justify-content:space-between;gap:8px;margin:2px 0 -4px}
.fade-sec h3{margin:0;font-size:10px;font-weight:650;color:var(--fade-muted);letter-spacing:.08em}
.fade-sec span{font-size:10px;color:var(--fade-faint);font-family:var(--fade-mono)}
.fade-person{display:flex;align-items:center;gap:8px;padding:6px 0;border-top:1px solid var(--fade-line);width:100%;border-left:0;border-right:0;border-bottom:0;background:transparent;color:inherit;text-align:left;cursor:pointer}
.fade-person:first-of-type{border-top:0}
.fade-avatar{width:28px;height:28px;border-radius:8px;display:grid;place-items:center;background:var(--fade-surface-2);border:1px solid var(--fade-line);font-family:var(--fade-mono);font-size:10px;color:var(--fade-muted);flex:none}
.fade-person-main{min-width:0;flex:1}
.fade-person-name{font-size:11.5px;font-weight:600;display:flex;align-items:center;gap:4px}
.fade-person-sub{font-size:9.5px;color:var(--fade-faint);margin-top:1px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.fade-spark{display:flex;align-items:flex-end;gap:2px;width:42px;flex:none}
.fade-spark i{width:5px;border-radius:2px;background:var(--fade-brand);opacity:.45}
.fade-spark i:nth-child(2){background:#8fb4d9;opacity:.6}
.fade-spark i:nth-child(3){background:var(--fade-ok);opacity:.55}
.fade-curve-card{padding:11px 12px 10px;background:linear-gradient(180deg,color-mix(in srgb,var(--fade-brand) 7%,var(--fade-surface)),var(--fade-surface));border-color:color-mix(in srgb,var(--fade-brand) 20%,var(--fade-line));cursor:pointer;text-align:left;width:100%;font-family:inherit;color:inherit}
.fade-curve-card:hover{border-color:color-mix(in srgb,var(--fade-brand) 36%,var(--fade-line))}
.fade-curve-top{display:flex;align-items:flex-start;gap:8px}
.fade-curve-kicker{font-size:9px;letter-spacing:.12em;color:var(--fade-brand);font-family:var(--fade-mono)}
.fade-curve-title{font-size:13px;font-weight:650;margin-top:1px}
.fade-curve-sub{font-size:9.5px;color:var(--fade-muted);margin-top:2px;line-height:1.45}
.fade-curve-score{margin-left:auto;text-align:right;font-family:var(--fade-mono);flex:none}
.fade-curve-score b{display:block;font-size:19px;line-height:1;color:var(--fade-text);font-weight:600}
.fade-curve-score span{font-size:8.5px;color:var(--fade-faint)}
.fade-curve-mini{height:58px;margin:5px -2px -3px;overflow:hidden;color:var(--fade-brand)}
.fade-curve-mini svg{width:100%;height:58px;display:block}
.fade-curve-foot{display:flex;align-items:center;gap:6px;margin-top:3px;font-size:9px;color:var(--fade-faint);font-family:var(--fade-mono)}
.fade-curve-foot .warn{color:var(--fade-warn)}
.fade-curve-foot .go{margin-left:auto;color:var(--fade-brand);font-family:inherit}
.fade-curve-badge{font-size:8.5px;border:1px solid color-mix(in srgb,var(--fade-brand) 28%,var(--fade-line));border-radius:4px;padding:2px 4px;color:var(--fade-brand);font-family:var(--fade-mono)}
.fade-cseg{display:flex;gap:2px;padding:2px;border:1px solid var(--fade-line);border-radius:7px;background:color-mix(in srgb,var(--fade-text) 4%,transparent);flex:none}
.fade-cseg button{border:0;background:transparent;color:var(--fade-muted);font:9.5px var(--fade-mono);padding:3px 6px;border-radius:5px;cursor:pointer}
.fade-cseg button[data-a="1"]{background:var(--fade-brand-soft);color:var(--fade-brand);box-shadow:inset 0 0 0 1px color-mix(in srgb,var(--fade-brand) 24%,transparent)}
.fade-cfilters{display:flex;flex-wrap:wrap;gap:5px;margin-top:8px}
.fade-cfilter{border:1px solid var(--fade-line);background:var(--fade-surface);color:var(--fade-muted);border-radius:99px;font:9px var(--fade-mono);padding:3px 7px;cursor:pointer}
.fade-cfilter[data-a="1"]{border-color:color-mix(in srgb,var(--fade-brand) 34%,var(--fade-line));color:var(--fade-brand);background:var(--fade-brand-soft)}
.fade-curve-hero{background:var(--fade-surface);border:1px solid var(--fade-line);border-radius:11px;padding:10px 11px}
.fade-curve-hero svg{display:block;width:100%;height:auto;max-height:230px;overflow:visible}
.fade-curve-note{font-size:9px;color:var(--fade-faint);line-height:1.5;margin-top:5px;font-family:var(--fade-mono)}
.fade-clegend{display:flex;flex-wrap:wrap;gap:5px 10px;margin-top:7px;font:9px var(--fade-mono);color:var(--fade-muted)}
.fade-clegend span{display:inline-flex;align-items:center;gap:4px}
.fade-clegend i{width:12px;height:2px;border-radius:2px;background:currentColor}
.fade-marker-list{display:flex;flex-direction:column;gap:5px}
.fade-marker{display:flex;align-items:center;gap:7px;border-top:1px solid var(--fade-line);padding-top:6px;font-size:10px;color:var(--fade-muted)}
button.fade-marker{width:100%;border-left:0;border-right:0;border-bottom:0;background:transparent;text-align:left;cursor:pointer;font-family:inherit}
button.fade-marker:hover{color:var(--fade-text)}
.fade-marker:first-child{border-top:0;padding-top:0}
.fade-marker b{font:9px var(--fade-mono);color:var(--fade-text);font-weight:500}
.fade-marker .tag{margin-left:auto;font:8.5px var(--fade-mono);color:var(--fade-faint)}
.fade-curve-empty{padding:18px 8px;text-align:center;color:var(--fade-faint);font-size:10px}
.fade-series{display:flex;align-items:center;gap:5px;padding:8px 9px;border:1px dashed var(--fade-line-2);border-radius:8px;color:var(--fade-muted);font-size:9px;flex:none;flex-wrap:wrap}
.fade-series .fade-dot{width:5px;height:5px}
.fade-series .sep{color:var(--fade-faint)}
.fade-series .more{margin-left:auto;color:var(--fade-brand);font-size:9px;border:0;background:transparent;cursor:pointer}
.fade-search{height:36px;border:1px solid var(--fade-line);border-radius:9px;background:var(--fade-surface);display:flex;align-items:center;gap:7px;padding:0 9px;flex:none;color:var(--fade-faint)}
.fade-search input{flex:1;min-width:0;border:0;background:transparent;color:var(--fade-text);font:inherit;font-size:11.5px;outline:none}
.fade-search .kbd{font-family:var(--fade-mono);font-size:8.5px;border:1px solid var(--fade-line);border-radius:4px;padding:2px 4px;color:var(--fade-faint)}
.fade-seg{display:grid;grid-template-columns:repeat(2,1fr);gap:3px;padding:3px;border-radius:9px;background:color-mix(in srgb,var(--fade-text) 4%,transparent);border:1px solid var(--fade-line);flex:none}
.fade-seg button{height:30px;border:0;border-radius:6px;background:transparent;color:var(--fade-muted);font-size:10.5px;cursor:pointer}
.fade-seg button[data-a="1"]{background:var(--fade-surface-2);color:var(--fade-text);font-weight:600;box-shadow:inset 0 0 0 1px var(--fade-line-2)}
.fade-chips{display:flex;gap:4px;overflow-x:auto;scrollbar-width:none;flex:none;padding-bottom:1px}
.fade-chips::-webkit-scrollbar{display:none}
.fade-chip{height:28px;padding:0 8px;border-radius:6px;border:1px solid var(--fade-line);background:transparent;color:var(--fade-muted);font-family:var(--fade-mono);font-size:9px;white-space:nowrap;display:inline-flex;align-items:center;gap:4px;cursor:pointer;flex:none}
.fade-chip[data-a="1"]{color:var(--fade-brand);border-color:color-mix(in srgb,var(--fade-brand) 40%,transparent);background:var(--fade-brand-soft)}
.fade-listmeta{display:flex;align-items:center;justify-content:space-between;color:var(--fade-faint);font-size:9px;font-family:var(--fade-mono);flex:none}
.fade-mcard{border:1px solid var(--fade-line);border-radius:10px;background:var(--fade-surface);padding:10px 10px 9px;display:flex;flex-direction:column;gap:4px;flex:none;cursor:pointer;text-align:left;font:inherit;color:inherit}
.fade-mcard:hover{background:var(--fade-surface-2);border-color:var(--fade-line-2)}
.fade-mcard-h{display:flex;align-items:center;gap:5px;font-family:var(--fade-mono);font-size:9px;color:var(--fade-faint)}
.fade-layer{font-size:8px;border-radius:3px;padding:1px 3px;border:1px solid var(--fade-line-2);color:var(--fade-muted)}
.fade-layer[data-l0="1"]{color:var(--fade-warn);border-color:color-mix(in srgb,var(--fade-warn) 32%,transparent)}
.fade-pin{display:inline-flex;align-items:center;gap:3px;color:var(--fade-brand);font-family:var(--fade-sans,sans-serif);font-size:8.5px}
.fade-mcard-t{font-size:12px;font-weight:600;line-height:1.45}
.fade-mcard-s{font-size:10.5px;color:var(--fade-muted);line-height:1.5;overflow:hidden;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical}
.fade-mcard-f{display:flex;align-items:center;gap:5px;margin-top:1px;flex-wrap:wrap}
.fade-mini{font-size:8.5px;color:var(--fade-faint);border:1px solid var(--fade-line);border-radius:3px;padding:1px 4px;font-family:var(--fade-mono);white-space:nowrap}
.fade-mini.ok{color:var(--fade-ok);border-color:color-mix(in srgb,var(--fade-ok) 26%,transparent)}
.fade-mini.warn{color:var(--fade-warn);border-color:color-mix(in srgb,var(--fade-warn) 26%,transparent)}
.fade-finger{display:flex;gap:2px;align-items:flex-end;margin-left:auto}
.fade-finger i{width:4px;border-radius:2px;background:var(--fade-brand);opacity:.55}
.fade-finger i:nth-child(2){background:#8fb4d9}
.fade-finger i:nth-child(3){background:var(--fade-ok)}
.fade-empty{padding:24px 10px;text-align:center;color:var(--fade-muted);font-size:11.5px;line-height:1.7}
.fade-empty b{display:block;color:var(--fade-text);font-size:12px;margin-bottom:4px}
.fade-error{padding:10px;border:1px solid var(--fade-line-2);border-radius:8px;color:var(--fade-danger);background:var(--fade-surface);font-size:11px;word-break:break-word}
.fade-loading{display:flex;align-items:center;justify-content:center;gap:7px;padding:24px 8px;color:var(--fade-muted);font-size:11px}
.fade-spin{width:12px;height:12px;border:1.5px solid var(--fade-line-2);border-top-color:var(--fade-brand);border-radius:50%;animation:fade-spin .8s linear infinite}
@keyframes fade-spin{to{transform:rotate(360deg)}}
.fade-tl{display:flex;flex-direction:column}
.fade-tlgroup{display:flex;gap:8px}
.fade-tldate{width:42px;flex:none;text-align:right;padding-top:2px}
.fade-tldate b{display:block;font-family:var(--fade-mono);font-size:9px;color:var(--fade-muted);font-weight:500}
.fade-tldate span{font-family:var(--fade-mono);font-size:8px;color:var(--fade-faint)}
.fade-tlrail{width:9px;flex:none;display:flex;flex-direction:column;align-items:center}
.fade-tlrail i{width:7px;height:7px;border-radius:50%;background:var(--fade-brand);margin-top:4px;flex:none;box-shadow:0 0 0 3px color-mix(in srgb,var(--fade-brand) 12%,transparent)}
.fade-tlrail i.warn{background:var(--fade-warn);box-shadow:0 0 0 3px color-mix(in srgb,var(--fade-warn) 12%,transparent)}
.fade-tlrail i.danger{background:var(--fade-danger);box-shadow:0 0 0 3px color-mix(in srgb,var(--fade-danger) 12%,transparent)}
.fade-tlrail .line{width:1px;flex:1;background:var(--fade-line-2);margin-top:3px}
.fade-tlbody{flex:1;min-width:0;padding:0 0 13px 2px}
.fade-tlcard{border:1px solid var(--fade-line);border-radius:9px;background:var(--fade-surface);padding:9px;cursor:pointer}
.fade-tlcard:hover{background:var(--fade-surface-2)}
.fade-tlh{display:flex;align-items:center;gap:5px;font-family:var(--fade-mono);font-size:8.5px;color:var(--fade-faint)}
.fade-type{font-family:var(--fade-sans,sans-serif);font-size:8.5px;border-radius:3px;padding:1px 4px;color:#b9d9ff;background:var(--fade-brand-soft)}
.fade-type.forget{color:#ffb0a9;background:color-mix(in srgb,var(--fade-danger) 10%,transparent)}
.fade-type.restore,.fade-type.pin{color:#9fe3c6;background:color-mix(in srgb,var(--fade-ok) 10%,transparent)}
.fade-tlh .rev{margin-left:auto}
.fade-tlt{font-size:11px;font-weight:600;margin-top:3px;line-height:1.45}
.fade-tls{font-size:9.5px;color:var(--fade-muted);margin-top:2px;line-height:1.45}
.fade-tlf{display:flex;align-items:center;gap:4px;margin-top:5px;flex-wrap:wrap}
.fade-source-chapters{display:flex;flex-direction:column;gap:4px}
.fade-source-ch{display:flex;align-items:center;gap:7px;padding:7px 8px;border:1px solid var(--fade-line);border-radius:8px;background:var(--fade-surface);cursor:pointer;color:inherit;text-align:left;width:100%}
.fade-source-ch[data-a="1"]{border-color:color-mix(in srgb,var(--fade-brand) 38%,transparent);background:var(--fade-brand-soft)}
.fade-source-ch b{font-family:var(--fade-mono);font-size:10px}
.fade-source-ch span{font-size:9.5px;color:var(--fade-muted)}
.fade-source-ch .chars{margin-left:auto;font-family:var(--fade-mono);font-size:8.5px;color:var(--fade-faint)}
.fade-sourcebox{margin-top:4px;border:1px solid var(--fade-line);border-radius:9px;background:var(--fade-surface);padding:10px}
.fade-sourcebox .excerpt{white-space:pre-wrap;word-break:break-word;font-size:11px;line-height:1.75;color:var(--fade-text);max-height:280px;overflow:auto}
.fade-sourcebox mark{background:color-mix(in srgb,var(--fade-brand) 28%,transparent);color:inherit;border-radius:2px;padding:0 1px}
.fade-stale{display:flex;gap:6px;align-items:flex-start;padding:8px;border-radius:7px;border:1px solid color-mix(in srgb,var(--fade-warn) 28%,transparent);background:color-mix(in srgb,var(--fade-warn) 8%,transparent);color:var(--fade-warn);font-size:10px;line-height:1.5}
.fade-sheet-mask{position:absolute;inset:0;background:rgba(4,6,9,.52);backdrop-filter:blur(2px);z-index:20;border-radius:12px}
.fade-sheet{position:absolute;left:0;right:0;bottom:0;max-height:90%;z-index:21;border-radius:16px 16px 0 0;background:var(--fade-bg);border-top:1px solid var(--fade-line-2);box-shadow:0 -20px 60px rgba(0,0,0,.45);display:flex;flex-direction:column;overflow:hidden}
.fade-sheet-head{flex:none;padding:9px 14px 0}
.fade-grab{width:36px;height:4px;border-radius:99px;background:var(--fade-line-2);margin:0 auto 9px}
.fade-sheet-title{display:flex;align-items:center;gap:8px}
.fade-sheet-title h2{margin:0;font-size:15px;font-weight:650}
.fade-sheet-body{flex:1;min-height:0;overflow-y:auto;overscroll-behavior:contain;scrollbar-width:thin;padding:12px 14px 0;display:flex;flex-direction:column;gap:10px}
.fade-sheet-foot{flex:none;border-top:1px solid var(--fade-line);padding:10px 14px 13px;display:flex;align-items:center;gap:7px}
.fade-sheet-note{font-size:9px;color:var(--fade-faint);line-height:1.45;flex:1}
.fade-field{display:flex;align-items:center;gap:8px}
.fade-flabel{font-size:9.5px;color:var(--fade-muted);width:46px;flex:none}
.fade-input{height:30px;border:1px solid var(--fade-line);border-radius:7px;background:var(--fade-surface);color:var(--fade-text);font:inherit;font-size:11px;padding:0 8px;outline:none;min-width:0}
.fade-input:focus{border-color:var(--fade-brand)}
.fade-btn{height:32px;border-radius:8px;border:1px solid var(--fade-line);background:transparent;color:var(--fade-muted);font-size:10.5px;padding:0 11px;cursor:pointer;white-space:nowrap}
.fade-btn:hover{background:var(--fade-surface)}
.fade-btn[data-p="1"]{background:var(--fade-brand);border-color:var(--fade-brand);color:var(--fade-bg);font-weight:600}
.fade-btn[data-p="1"]:hover{filter:brightness(1.05)}
.fade-btn:disabled{opacity:.5;cursor:default}
.fade-stepper{display:flex;align-items:center;gap:2px;border:1px solid var(--fade-line);border-radius:7px;background:var(--fade-surface);padding:2px}
.fade-stepper button{width:30px;height:30px;border:0;border-radius:5px;background:transparent;color:var(--fade-muted);cursor:pointer;font-size:15px}
.fade-stepper button:hover{background:var(--fade-surface-2)}
.fade-stepper b{font-family:var(--fade-mono);font-size:10px;padding:0 5px;white-space:nowrap}
.fade-preset{display:flex;gap:3px;flex:1}
.fade-preset button{flex:1;height:27px;border:1px solid var(--fade-line);border-radius:6px;background:transparent;color:var(--fade-muted);font-family:var(--fade-mono);font-size:9px;cursor:pointer}
.fade-preset button[data-a="1"]{color:var(--fade-brand);border-color:color-mix(in srgb,var(--fade-brand) 40%,transparent);background:var(--fade-brand-soft)}
.fade-range{position:relative;flex:1;height:22px;display:flex;align-items:center}
.fade-range input{width:100%;accent-color:var(--fade-brand);height:22px}
.fade-range-num{font-family:var(--fade-mono);font-size:9px;color:var(--fade-muted);width:38px;text-align:right}
.fade-cast{display:flex;gap:4px;flex-wrap:wrap}
.fade-cast button{height:26px;display:inline-flex;align-items:center;gap:4px;padding:0 8px;border-radius:99px;border:1px solid var(--fade-line);color:var(--fade-muted);font-size:9px;background:transparent;cursor:pointer}
.fade-cast button[data-a="1"]{color:var(--fade-text);border-color:var(--fade-line-2);background:var(--fade-surface)}
.fade-sum{display:flex;align-items:center;justify-content:space-between;gap:6px;padding:8px 9px;border:1px solid var(--fade-line);border-radius:9px;background:var(--fade-brand-soft);font-size:9px;color:var(--fade-muted)}
.fade-sum b{color:var(--fade-text);font-weight:600}
.fade-sum .ok{color:var(--fade-ok);font-family:var(--fade-mono)}
.fade-srow{border:1px solid var(--fade-line);border-radius:9px;background:var(--fade-surface);padding:9px}
.fade-srow-h{display:flex;align-items:center;gap:6px}
.fade-srow-h b{font-size:10.5px;font-weight:600}
.fade-srow-h .count{margin-left:auto;font-family:var(--fade-mono);font-size:8.5px;color:var(--fade-faint)}
.fade-srow-h .clip{font-size:8px;color:var(--fade-warn);border:1px solid color-mix(in srgb,var(--fade-warn) 30%,transparent);border-radius:3px;padding:1px 4px}
.fade-srow-bar{height:3px;border-radius:99px;background:color-mix(in srgb,var(--fade-text) 7%,transparent);overflow:hidden;margin-top:6px}
.fade-srow-bar i{display:block;height:3px;background:var(--fade-brand);opacity:.7}
.fade-srow-bar.warn i{background:var(--fade-warn)}
.fade-srow-body{margin-top:7px;color:var(--fade-muted);font-size:10px;line-height:1.6;white-space:pre-wrap}
.fade-srow-body em{font-style:normal;color:var(--fade-text)}
.fade-srow-body .more{color:var(--fade-warn)}
.fade-sourcemeta{display:flex;justify-content:space-between;gap:6px;color:var(--fade-faint);font-size:9px;font-family:var(--fade-mono);margin-bottom:5px}
.fade-artifact{display:flex;flex-direction:column;gap:8px}
.fade-artifact-row{display:grid;grid-template-columns:64px 1fr;gap:6px;font-size:10px}
.fade-artifact-row dt{color:var(--fade-faint);font-family:var(--fade-mono);font-size:9px;margin:0}
.fade-artifact-row dd{margin:0;color:var(--fade-text);word-break:break-word;font-size:10px}
.fade-menu{display:flex;flex-direction:column;gap:2px}
.fade-menu button{display:flex;align-items:center;gap:8px;padding:10px 8px;border:0;border-bottom:1px solid var(--fade-line);background:transparent;color:var(--fade-text);text-align:left;font-size:11px;cursor:pointer;width:100%}
.fade-menu button:hover{background:var(--fade-surface)}
.fade-menu small{color:var(--fade-faint);font-size:9px;display:block}
.fade-foot{flex:none;display:flex;justify-content:space-between;gap:8px;padding:7px 14px;border-top:1px solid var(--fade-line);color:var(--fade-faint);font-size:9px;font-family:var(--fade-mono)}
.fade-num{font-family:var(--fade-mono);font-variant-numeric:tabular-nums}
@media (max-width:380px){
  .fade-head{padding-left:10px;padding-right:10px}
  .fade-body{padding-left:10px;padding-right:10px}
  .fade-title{font-size:14px}
  .fade-cta{padding:0 7px;font-size:9.5px}
  .fade-nav .fade-tab{font-size:10.5px}
  .fade-quick{grid-template-columns:1fr 1fr;gap:6px}
  .fade-quick :first-child{grid-column:span 2}
}
@media (min-width:560px){
  .fade-body{padding-left:18px;padding-right:18px}
  .fade-head{padding-left:18px;padding-right:18px}
  .fade-foot{padding-left:18px;padding-right:18px}
}
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
        setState({ phase: 'loading', data: null, error: null })
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

    function useTimeline(remote, sessionId, book, filter, enabled) {
      const call = React.useCallback(() => {
        if (!enabled) return Promise.resolve(null)
        if (!remote || !sessionId) throw new Error('会话还没准备好')
        const options = { filter, limit: 50 }
        if (book) options.book = book
        return remote.timeline(sessionId, options).then(unwrap)
      }, [remote, sessionId, book, filter, enabled])
      return useRemoteCall(call, [call])
    }

    function useCharacter(remote, sessionId, book, name, enabled) {
      const call = React.useCallback(() => {
        if (!enabled || !name) return Promise.resolve(null)
        if (!remote || !sessionId) throw new Error('会话还没准备好')
        const options = { name, limit: 100 }
        if (book) options.book = book
        return remote.character(sessionId, options).then(unwrap)
      }, [remote, sessionId, book, name, enabled])
      return useRemoteCall(call, [call])
    }

    function useSourceIndex(remote, sessionId, book, enabled) {
      const call = React.useCallback(() => {
        if (!enabled) return Promise.resolve(null)
        if (!remote || !sessionId) throw new Error('会话还没准备好')
        return remote.sourceIndex(sessionId, book ? { book } : EMPTY_OPTS).then(unwrap)
      }, [remote, sessionId, book, enabled])
      return useRemoteCall(call, [call])
    }

    /* ════════════════════════════════════════════════════════════════════════
     * 4. Icons + primitives
     * ════════════════════════════════════════════════════════════════════════ */
    function Icon({ name, size = 14 }) {
      const common = {
        width: size, height: size, viewBox: '0 0 16 16', fill: 'none',
        stroke: 'currentColor', strokeWidth: 1.5, strokeLinecap: 'round', strokeLinejoin: 'round',
        'aria-hidden': 'true', focusable: 'false', style: { flex: 'none', display: 'block' },
      }
      if (name === 'brand') {
        return h('svg', { width: 15, height: 15, viewBox: '0 0 15 15', fill: 'none', 'aria-hidden': 'true' },
          h('path', { d: 'M2 4h11', stroke: 'white', strokeOpacity: .95, strokeWidth: 1.4, strokeLinecap: 'round' }),
          h('path', { d: 'M2 7.5h8', stroke: 'white', strokeOpacity: .7, strokeWidth: 1.4, strokeLinecap: 'round' }),
          h('path', { d: 'M2 11h4.5', stroke: 'white', strokeOpacity: .42, strokeWidth: 1.4, strokeLinecap: 'round' }))
      }
      if (name === 'search') return h('svg', common, h('circle', { cx: 7, cy: 7, r: 4.2 }), h('path', { d: 'M10.2 10.2 14 14' }))
      if (name === 'spark') return h('svg', { ...common, fill: 'currentColor', stroke: 'none' },
        h('path', { d: 'M8 1.4l1.5 4.1 4.1 1.5-4.1 1.5L8 12.6 6.5 8.5 2.4 7l4.1-1.5L8 1.4z' }),
        h('path', { d: 'M13 9.4l.6 1.7 1.7.6-1.7.6-.6 1.7-.6-1.7-1.7-.6 1.7-.6.6-1.7z', opacity: .55 }))
      if (name === 'pin') return h('svg', common, h('path', { d: 'M9.7 2.2l4.1 4.1-2 .6-2.6 2.6.2 2.1-1.3 1.3-4.1-4.1 1.3-1.3 2.1.2 2.6-2.6.6-2z' }), h('path', { d: 'M6.2 9.8 2.5 13.5' }))
      if (name === 'book') return h('svg', common, h('path', { d: 'M2.5 3h6A2 2 0 0 1 10.5 5v8H4.5A2 2 0 0 1 2.5 11V3z' }), h('path', { d: 'M2.5 3v8A2 2 0 0 0 4.5 13h6' }))
      if (name === 'timeline') return h('svg', common, h('circle', { cx: 8, cy: 2.8, r: 1.3 }), h('path', { d: 'M8 4.4v8.4' }), h('path', { d: 'M5.5 12.8h5' }))
      if (name === 'more') return h('svg', { ...common, fill: 'currentColor', stroke: 'none' }, h('circle', { cx: 3.2, cy: 8, r: 1.2 }), h('circle', { cx: 8, cy: 8, r: 1.2 }), h('circle', { cx: 12.8, cy: 8, r: 1.2 }))
      if (name === 'refresh') return h('svg', common, h('path', { d: 'M13 6.3A5 5 0 1 0 13.5 9' }), h('path', { d: 'M13.5 3v3.5H10' }))
      if (name === 'close') return h('svg', common, h('path', { d: 'M3.5 3.5l9 9M12.5 3.5l-9 9' }))
      if (name === 'arrow') return h('svg', common, h('path', { d: 'M3 8h10' }), h('path', { d: 'M9.5 4.5 13 8l-3.5 3.5' }))
      if (name === 'check') return h('svg', common, h('path', { d: 'M3 8.5 6.2 11.5 13 4.5' }))
      if (name === 'alert') return h('svg', common, h('path', { d: 'M8 2.5 14 13H2L8 2.5z' }), h('path', { d: 'M8 6.2v3.2' }), h('path', { d: 'M8 11.3h.01' }))
      if (name === 'chevron') return h('svg', common, h('path', { d: 'M4 6l4 4 4-4' }))
      return null
    }

    function Btn({ children, primary, onClick, disabled, title }) {
      return h('button', {
        type: 'button', className: 'fade-btn', 'data-p': primary ? '1' : '0',
        onClick, disabled, title,
      }, children)
    }

    function Chip({ active, onClick, children, title }) {
      return h('button', {
        type: 'button', className: 'fade-chip', 'data-a': active ? '1' : '0', onClick, title,
      }, children)
    }

    function Tag({ tone = '', children }) {
      return h('span', { className: `fade-tag ${tone}` }, children)
    }

    function Bar({ value, tone }) {
      const v = Math.max(0, Math.min(1, Number(value) || 0))
      return h('div', { className: 'fade-bar' }, h('i', { style: { width: `${v * 100}%`, background: tone } }))
    }

    function Empty({ title, children }) {
      return h('div', { className: 'fade-empty' }, title ? h('b', null, title) : null, children)
    }

    function Loading({ label }) {
      return h('div', { className: 'fade-loading' }, h('span', { className: 'fade-spin' }), label ?? '读取中…')
    }

    function ErrorBox({ error, onRetry }) {
      const text = String(error ?? '')
      const staleHost = /unknown|not found|not registered|未注册|没有.*注册|invalid invocation|cannot find/i.test(text)
      return h('div', null,
        h('div', { className: 'fade-error' },
          staleHost ? '宿主还在跑旧版；重载插件后再试（插件管理器关→开，或 Ctrl+R）。' : text),
        onRetry ? h('div', { style: { marginTop: 8 } }, h(Btn, { onClick: onRetry }, '重试')) : null)
    }

    function SectionTitle({ children, aside }) {
      return h('div', { className: 'fade-sec' }, h('h3', null, children), aside ? h('span', null, aside) : null)
    }

    function Sheet({ title, subtitle, onClose, children, footer, wide }) {
      React.useEffect(() => {
        const onKey = (event) => { if (event.key === 'Escape') onClose?.() }
        window.addEventListener('keydown', onKey)
        return () => window.removeEventListener('keydown', onKey)
      }, [onClose])
      return h(React.Fragment, null,
        h('div', { className: 'fade-sheet-mask', onClick: onClose }),
        h('div', { className: 'fade-sheet', role: 'dialog', 'aria-modal': 'true', style: wide ? { maxHeight: '94%' } : undefined },
          h('div', { className: 'fade-sheet-head' },
            h('div', { className: 'fade-grab' }),
            h('div', { className: 'fade-sheet-title' },
              h('h2', null, title),
              subtitle ? h('span', { className: 'fade-meta' }, subtitle) : null,
              h('div', { className: 'fade-grow' }),
              h('button', { type: 'button', className: 'fade-iconbtn', onClick: onClose, 'aria-label': '关闭' }, h(Icon, { name: 'close' })))),
          h('div', { className: 'fade-sheet-body' }, children),
          footer ? h('div', { className: 'fade-sheet-foot' }, footer) : null))
    }

    /* ════════════════════════════════════════════════════════════════════════
     * 5. Overview
     * ════════════════════════════════════════════════════════════════════════ */
    function HealthCard({ health, onAction }) {
      const [expanded, setExpanded] = React.useState(false)
      const all = Array.isArray(health?.issues) ? health.issues : []
      const issues = expanded ? all : all.slice(0, 3)
      const counts = health?.counts ?? {}
      const actionable = (counts.block ?? 0) + (counts.warn ?? 0)
      const total = actionable
      const tone = counts.block ? 'var(--fade-danger)' : counts.warn ? 'var(--fade-warn)' : 'var(--fade-ok)'
      return h('section', { className: 'fade-card' },
        h('div', { className: 'fade-card-h' },
          h('div', { className: 'fade-kicker' }, '记忆健康'),
          h('div', { className: 'fade-meta' }, health?.chapter ? `第 ${health.chapter} 章 · 只读` : '只读')),
        h('div', { style: { display: 'flex', alignItems: 'baseline', gap: 8, margin: '2px 0 3px' } },
          h('div', { className: 'fade-hero', style: { color: total ? 'var(--fade-text)' : 'var(--fade-ok)' } },
            total ? `${total} 项待处理` : (counts.info ? `本章体检 · ${counts.info} 条提醒` : '本章体检 · 通过')),
          total ? h('div', { className: 'fade-sub' },
            `${counts.block ? `${counts.block} 项阻断` : ''}${counts.block && counts.warn ? ' · ' : ''}${counts.warn ? `${counts.warn} 项待确认` : ''}${counts.info ? `${counts.block || counts.warn ? ' · ' : ''}${counts.info} 条提醒` : ''}`) : null),
        issues.length
          ? h('div', null, issues.map((issue) => h('button', {
            key: issue.id,
            type: 'button',
            className: 'fade-issue',
            style: { border: 0, background: 'transparent', textAlign: 'left', padding: '9px 0 8px', color: 'inherit', cursor: 'pointer', width: '100%' },
            onClick: () => onAction?.(issue.action),
          },
          h('span', { className: `fade-issue-bar ${issue.severity === 'block' ? '' : issue.severity === 'warn' ? 'warn' : 'info'}` }),
          h('div', null,
            h('div', { className: 'fade-issue-top' },
              h(Tag, { tone: issue.severity === 'block' ? 'danger' : issue.severity === 'warn' ? 'warn' : '' },
                issue.severity === 'block' ? '阻断' : issue.severity === 'warn' ? '待确认' : '提醒'),
              issue.chapter ? h('span', { className: 'fade-meta' }, `第 ${issue.chapter} 章`) : null),
            h('div', { className: 'fade-issue-title' }, issue.title),
            h('div', { className: 'fade-issue-detail' }, issue.detail),
            issue.action?.label ? h('span', { className: 'fade-link' }, issue.action.label, h(Icon, { name: 'arrow', size: 11 })) : null))))
          : h('div', { className: 'fade-sub', style: { padding: '5px 0' } }, '这一章没有发现需要处理的问题。'),
        h('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6, paddingTop: 7, borderTop: '1px solid var(--fade-line)', marginTop: 4 } },
          h('span', { className: 'fade-sub', style: { color: 'var(--fade-faint)' } },
            h('span', { style: { color: 'var(--fade-ok)' } }, '✓ '),
            health?.passed?.length ? `检查通过 ${health.passed.length} 项` : '只读检查'),
          all.length > 3
            ? h('button', { type: 'button', className: 'fade-link', onClick: () => setExpanded((value) => !value) }, expanded ? '收起' : `展开 ${all.length} 项`)
            : null))
    }

    function BudgetCard({ snapshot }) {
      const overview = snapshot?.overview ?? {}
      const savings = overview.savings ?? {}
      const currency = overview.currency
      const budget = overview.budget ?? {}
      const ratio = currency?.ratio != null
        ? currency.ratio
        : (savings.rawChars ? savings.memChars / savings.rawChars : null)
      const saved = savings.savedTokens
      const scope = currency
        ? `本章 ${fmt(currency.rawChars)} 字 → 记忆 ${fmt(currency.memChars)} 字`
        : savings.rawChars
          ? `${savings.chapterCount} 章 ${fmt(savings.rawChars)} → ${fmt(savings.memChars)} 字`
          : '还没有可统计的章'
      return h('section', { className: 'fade-card' },
        h('div', { className: 'fade-card-h' },
          h('div', { className: 'fade-kicker' }, '记忆预算'),
          h('div', { className: 'fade-meta' }, `${overview.chapters ?? 0} 章 · ${overview.cards?.active ?? 0} 张卡`)),
        h('div', { className: 'fade-budget-line' },
          h('div', { className: 'fade-budget-num', style: ratio != null && ratio > 1 ? { color: 'var(--fade-warn)' } : undefined },
            ratio == null ? '—' : String(Math.round((1 - ratio) * 100)), ratio == null ? null : h('small', null, '%')),
          h('div', { className: 'fade-budget-save' },
            h('div', null, saved == null ? '—' : saved >= 0 ? `省 ${fmt(saved)} token` : `多耗 ${fmt(-saved)} token`),
            h('div', { style: { color: 'var(--fade-faint)' } }, `本章简报 ${fmt(budget.briefChars)} 字`))),
        h(Bar, { value: ratio == null ? 0 : 1 - ratio, tone: ratio != null && ratio > 1 ? 'var(--fade-warn)' : undefined }),
        h('div', { className: 'fade-scale' }, h('span', null, scope), h('span', null, `预算 ${fmt(budget.budget)} 字`)))
    }

    function PeopleCard({ people, onPerson }) {
      return h('section', { className: 'fade-card', style: { paddingBottom: 8 } },
        h('div', { className: 'fade-card-h' },
          h('div', { className: 'fade-kicker' }, '最近人物'),
          h('div', { className: 'fade-meta' }, '按出场章')),
        people.length
          ? h('div', null, people.slice(0, 3).map((person) => h('button', {
            key: person.id, type: 'button', className: 'fade-person', onClick: () => onPerson(person.name),
          },
          h('div', { className: 'fade-avatar' }, (person.name ?? '?').slice(0, 1)),
          h('div', { className: 'fade-person-main' },
            h('div', { className: 'fade-person-name' }, person.name,
              h('span', { className: 'fade-mini', style: { border: 0, padding: 0 } }, person.layer ?? '')),
            h('div', { className: 'fade-person-sub' },
              `第 ${person.lastChapter ?? '?'} 章 · 出场 ${person.appearances ?? 0} 次`,
              person.relationship ? ` · ${person.relationship}` : '')),
          h('div', { className: 'fade-spark' },
            h('i', { style: { height: 5 + Math.round((person.familiarity ?? 0) * 10) } }),
            h('i', { style: { height: 4 + Math.round((person.accessibility ?? 0) * 9) } }),
            h('i', { style: { height: 3 + Math.round((person.fidelity ?? 0) * 8) } })))))
          : h(Empty, { title: '还没有人物卡' }, 'memo_digest 时会自动建。'))
    }

    function SeriesStrip({ companions, onOpen }) {
      const beat = companions?.beat
      const beatLabel = !beat ? '未加载'
        : beat.state === 'available' ? '账本已关联'
          : beat.state === 'adapted' ? '本地账本'
            : '未发现'
      const beatTone = beat?.state === 'available' ? 'var(--fade-ok)'
        : beat?.state === 'adapted' ? 'var(--fade-warn)' : 'var(--fade-faint)'
      const others = [
        ['conductor', companions?.conductor],
        ['voice', companions?.voice],
        ['fanfic', companions?.fanfic],
      ]
      const missing = others.filter(([, row]) => !row || row.state === 'unavailable').length
      const labelFor = (name, row) => {
        if (!row) return '未加载'
        if (row.state === 'available') return '可用'
        if (row.state === 'adapted') return '未适配'
        return '未发现'
      }
      const toneFor = (row) => row?.state === 'available' ? 'var(--fade-ok)'
        : row?.state === 'adapted' ? 'var(--fade-warn)'
          : row?.state === 'unknown' ? 'var(--fade-muted)' : 'var(--fade-faint)'
      return h('div', { className: 'fade-series' },
        h('i', { className: 'fade-dot', style: { color: beatTone } }),
        h('span', null, `beat ${beatLabel}`),
        h('span', { className: 'sep' }, '·'),
        missing === others.length
          ? h('span', null, `其余 ${others.length} 个未发现`)
          : others.map(([name, row], index) => h(React.Fragment, { key: name },
            index ? h('span', { className: 'sep' }, '·') : null,
            h('i', { className: 'fade-dot', style: { color: toneFor(row) } }),
            h('span', null, `${name} ${labelFor(name, row)}`))),
        h('button', { type: 'button', className: 'more', onClick: onOpen }, '协作详情'))
    }

    function miniCurvePath(layer, width = 320, height = 56) {
      const from = 1
      const to = 120
      const floor = Number(layer.floor) || 0
      const h0 = layer.h0 == null ? null : Number(layer.h0)
      const y = (value) => 4 + (1 - Math.max(0, Math.min(1, value))) * (height - 10)
      const x = (chapter) => (chapter - from) / (to - from) * width
      if (h0 == null) return `M0,${y(1)} L${width},${y(1)}`
      const points = []
      for (let index = 0; index <= 24; index += 1) {
        const chapter = from + (to - from) * (index / 24)
        const age = Math.max(0, chapter - 6)
        const R = 2 ** (-age / h0)
        points.push(`${x(chapter).toFixed(1)},${y(floor + (1 - floor) * R).toFixed(1)}`)
      }
      return `M${points.join(' L')}`
    }

    function CurveSummaryCard({ curve, onOpen }) {
      if (!curve) return null
      const layers = Array.isArray(curve.layers) ? curve.layers : []
      const pathFor = (layer) => miniCurvePath(layer)
      const legacy = curve.policy !== 'v4-basic'
      return h('button', {
        type: 'button', className: 'fade-card fade-curve-card', onClick: onOpen,
        'aria-label': '打开记忆衰退曲线',
      },
      h('div', { className: 'fade-curve-top' },
        h('div', null,
          h('div', { className: 'fade-curve-kicker' }, 'RETENTION · V4 MODEL'),
          h('div', { className: 'fade-curve-title' }, '记忆衰退曲线'),
          h('div', { className: 'fade-curve-sub' }, `第 ${curve.chapter} 章 · 可用度 A · ${curve.eligible ?? 0} 张纳入`)),
        h('div', { className: 'fade-curve-score' },
          h('b', null, curve.A == null ? '—' : Number(curve.A).toFixed(2)),
          h('span', null, 'median A'))),
      h('div', { className: 'fade-curve-mini', 'aria-hidden': 'true' },
        h('svg', { viewBox: '0 0 320 56', preserveAspectRatio: 'none' },
          h('line', { x1: 0, y1: 4 + (1 - 0.15) * 46, x2: 320, y2: 4 + (1 - 0.15) * 46, stroke: 'var(--fade-danger)', strokeOpacity: .35, strokeDasharray: '3 4' }),
          layers.map((layer) => h('path', {
            key: layer.layer, d: pathFor(layer), fill: 'none', stroke: layer.color,
            strokeWidth: layer.layer === 'L2' ? 1.8 : 1.4, strokeDasharray: layer.dash || undefined,
            opacity: layer.layer === 'L0' ? .55 : .9,
          })))),
      h('div', { className: 'fade-curve-foot' },
        h('span', null, `沉没 ${curve.sunk ?? 0} / 纳入 ${curve.eligible ?? 0}`),
        h('span', null, `保护 ${curve.protected ?? 0}`),
        legacy ? h('span', { className: 'warn' }, '模型预览') : null,
        h('span', { className: 'go' }, '查看曲线 →')))
    }

    function Overview({ snapshot, onPerson, onSearch, onSource, onProvenance, onBrief, onSeries, onHealthAction, onCurve }) {
      const people = snapshot.people ?? []
      return h(React.Fragment, null,
        snapshot.health ? h(HealthCard, { health: snapshot.health, onAction: onHealthAction }) : null,
        h(BudgetCard, { snapshot }),
        h(CurveSummaryCard, { curve: snapshot.curve, onOpen: onCurve }),
        h('div', { className: 'fade-quick' },
          h('button', { type: 'button', className: 'fade-qbtn', 'data-p': '1', onClick: onSearch },
            h('div', { className: 'fade-qtop' }, h(Icon, { name: 'search', size: 12 }), '搜记忆'),
            h('div', { className: 'fade-qsub' }, `${snapshot.overview?.cards?.active ?? 0} 张卡 · 人物`)),
          h('button', { type: 'button', className: 'fade-qbtn', onClick: onSource },
            h('div', { className: 'fade-qtop' }, h(Icon, { name: 'book', size: 12 }), '补原文'),
            h('div', { className: 'fade-qsub' }, `${snapshot.overview?.source?.chapters ?? 0} / ${snapshot.overview?.chapters ?? 0} 章`)),
          h('button', { type: 'button', className: 'fade-qbtn', onClick: onProvenance },
            h('div', { className: 'fade-qtop' }, h(Icon, { name: 'timeline', size: 12 }), '看溯源'),
            h('div', { className: 'fade-qsub' }, '时间线 · 收据'))),
        h(PeopleCard, { people, onPerson }),
        h(SeriesStrip, { companions: snapshot.companions, onOpen: onSeries }))
    }

    /* ════════════════════════════════════════════════════════════════════════
     * 6. Memory
     * ════════════════════════════════════════════════════════════════════════ */
    function CardItem({ card, onOpen }) {
      return h('button', { type: 'button', className: 'fade-mcard', onClick: () => onOpen(card) },
        h('div', { className: 'fade-mcard-h' },
          h('span', null, `第 ${card.chapter} 章`),
          h('span', { className: 'fade-layer', 'data-l0': card.layer === 'L0' ? '1' : '0' }, card.layer),
          card.pinned ? h('span', { className: 'fade-pin' }, h(Icon, { name: 'pin', size: 10 }), '作者钉住') : null),
        h('div', { className: 'fade-mcard-t' }, card.topic),
        card.gist ? h('div', { className: 'fade-mcard-s' }, card.gist) : null,
        h('div', { className: 'fade-mcard-f' },
          h('span', { className: `fade-mini ${card.permission === 'precise' ? 'ok' : card.permission === 'recall' ? 'warn' : ''}` }, card.permissionLabel),
          (card.entityNames ?? []).slice(0, 2).map((name) => h('span', { key: name, className: 'fade-mini' }, name)),
          card.placeName ? h('span', { className: 'fade-mini' }, card.placeName) : null,
          h('span', { className: 'fade-finger' },
            h('i', { style: { height: 3 + Math.round((card.familiarity ?? 0) * 6) } }),
            h('i', { style: { height: 3 + Math.round((card.accessibility ?? 0) * 6) } }),
            h('i', { style: { height: 3 + Math.round((card.fidelity ?? 0) * 6) } }))))
    }

    function PersonRow({ person, onOpen }) {
      return h('button', { type: 'button', className: 'fade-person', onClick: () => onOpen(person.name) },
        h('div', { className: 'fade-avatar' }, (person.name ?? '?').slice(0, 1)),
        h('div', { className: 'fade-person-main' },
          h('div', { className: 'fade-person-name' }, person.name,
            person.layer ? h('span', { className: 'fade-mini', style: { border: 0, padding: 0 } }, person.layer) : null),
          h('div', { className: 'fade-person-sub' },
            `第 ${person.lastChapter ?? '?'} 章 · 出场 ${person.appearances ?? 0} 次 · ${person.cards ?? 0} 张卡`,
            person.relationship ? ` · ${person.relationship}` : '')),
        h('div', { className: 'fade-spark' },
          h('i', { style: { height: 5 + Math.round((person.familiarity ?? 0) * 10) } }),
          h('i', { style: { height: 4 + Math.round((person.accessibility ?? 0) * 9) } }),
          h('i', { style: { height: 3 + Math.round((person.fidelity ?? 0) * 8) } })))
    }

    function MemoryPane({
      snapshot, cards, total, hasMore, onMore, loadingMore, people,
      query, onQuery, onSearchFocus, searchRef,
      pinnedOnly, onPinned, fadedOnly, onFaded,
      view, onView, onCard, onPerson, chapterFilter, onClearChapter,
    }) {
      const fadedCount = (snapshot.overview?.cards?.distribution?.gist ?? 0) + (snapshot.overview?.cards?.distribution?.feeling ?? 0)
      const pinnedCount = snapshot.overview?.pinned ?? cards.filter((card) => card.pinned).length
      const shownPeople = query
        ? people.filter((person) => `${person.name} ${(person.aliases ?? []).join(' ')} ${person.relationship ?? ''}`.includes(query))
        : people
      return h(React.Fragment, null,
        h('div', { className: 'fade-search' },
          h(Icon, { name: 'search', size: 14 }),
          h('input', {
            ref: searchRef,
            value: query,
            onChange: (event) => onQuery(event.target.value),
            placeholder: view === 'cards' ? '搜人物、事件、地点…' : '搜人物…',
            'aria-label': '搜记忆',
            onFocus: onSearchFocus,
          }),
          query
            ? h('button', { type: 'button', className: 'fade-link', style: { marginTop: 0 }, onClick: () => onQuery('') }, '清空')
            : h('span', { className: 'kbd' }, '/')),
        h('div', { className: 'fade-seg' },
          h('button', { type: 'button', 'data-a': view === 'cards' ? '1' : '0', onClick: () => onView('cards') }, `卡片 ${total}`),
          h('button', { type: 'button', 'data-a': view === 'people' ? '1' : '0', onClick: () => onView('people') }, `人物 ${people.length}`)),
        view === 'cards'
          ? h(React.Fragment, null,
            h('div', { className: 'fade-chips' },
              h(Chip, { active: !pinnedOnly && !fadedOnly && !chapterFilter, onClick: () => { onPinned(false); onFaded(false); onClearChapter() } }, '全部'),
              h(Chip, { active: pinnedOnly, onClick: () => { onPinned(!pinnedOnly); onFaded(false) } }, `已钉住 ${pinnedCount}`),
              h(Chip, { active: fadedOnly, onClick: () => { onFaded(!fadedOnly); onPinned(false) } }, `已褪 ${fadedCount}`),
              chapterFilter ? h(Chip, { active: true, onClick: onClearChapter }, `第 ${chapterFilter} 章 ×`) : null),
            h('div', { className: 'fade-listmeta' }, h('span', null, `${total} 张 · 按章降序`), h('span', null, '⌄')),
            cards.length
              ? cards.map((card) => h(CardItem, { key: card.id, card, onOpen: onCard }))
              : h(Empty, { title: '没有匹配的记忆' }, query ? '换更短的词，或清空筛选。' : '先写完一章跑 memo_digest。'),
            hasMore ? h('button', { type: 'button', className: 'fade-btn', onClick: onMore, disabled: loadingMore }, loadingMore ? '加载中…' : '加载更多') : null)
          : (shownPeople.length
            ? h('div', null, shownPeople.map((person) => h(PersonRow, { key: person.id, person, onOpen: onPerson })))
            : h(Empty, { title: '没有匹配的人物' }, '人物来自 digest 时的 entities；没有卡不等于没出场。')))
    }

    /* ════════════════════════════════════════════════════════════════════════
     * 7. Provenance
     * ════════════════════════════════════════════════════════════════════════ */
    const TIMELINE_TYPES = [
      ['all', '全部'],
      ['digest', '沉淀'],
      ['replace', '重做'],
      ['forget', '遗忘'],
      ['restore', '恢复'],
      ['pin', '钉住'],
    ]
    const TIMELINE_LABEL = { digest: '沉淀', replace: '重做', forget: '遗忘', restore: '恢复', pin: '钉住', unpin: '取消钉住' }
    const TIMELINE_TONE = { digest: '', replace: 'warn', forget: 'danger', restore: '', pin: '' }

    function TimelinePane({ data, phase, error, onRetry, filter, onFilter, onOpen }) {
      if (!data) return phase === 'error' ? h(ErrorBox, { error, onRetry }) : h(Loading, { label: '读取变更记录…' })
      if (data.exists === false) return h(Empty, { title: '这本书还没有变更记录' }, '第一次 digest 后，这里会出现时间线。')
      const entries = data.entries ?? []
      return h(React.Fragment, null,
        h('div', { className: 'fade-chips' },
          TIMELINE_TYPES.map(([id, label]) => h(Chip, {
            key: id, active: filter === id, onClick: () => onFilter(id),
          }, `${label} ${data.counts?.[id] ?? 0}`))),
        h('div', { className: 'fade-listmeta' }, h('span', null, `${data.counts?.all ?? 0} 条 · 最新在前`), h('span', null, '只读')),
        entries.length
          ? h('div', { className: 'fade-tl' }, entries.map((entry, index) => h('div', { key: entry.eventId, className: 'fade-tlgroup' },
            h('div', { className: 'fade-tldate' }, h('b', null, dayLabel(entry.at)), h('span', null, clock(entry.at))),
            h('div', { className: 'fade-tlrail' },
              h('i', { className: TIMELINE_TONE[entry.type] ?? '' }),
              index < entries.length - 1 ? h('span', { className: 'line' }) : null),
            h('div', { className: 'fade-tlbody' },
              h('div', { className: 'fade-tlcard', onClick: () => onOpen(entry) },
                h('div', { className: 'fade-tlh' },
                  h('span', { className: `fade-type ${entry.type}` }, TIMELINE_LABEL[entry.type] ?? entry.type),
                  entry.chapter ? h('span', null, `第 ${entry.chapter} 章`) : null,
                  entry.revision != null ? h('span', { className: 'rev' }, `rev ${entry.revision}`) : null),
                h('div', { className: 'fade-tlt' }, entry.title),
                entry.summary ? h('div', { className: 'fade-tls' }, entry.summary) : null,
                h('div', { className: 'fade-tlf' },
                  entry.artifactId ? h('span', { className: 'fade-mini' }, entry.artifactId) : null,
                  entry.cardIds?.length ? h('span', { className: 'fade-mini' }, `${entry.cardIds.length} 张`) : null,
                  entry.canOpen ? h('span', { className: 'fade-mini ok' }, '可打开') : null))))))
          : h(Empty, { title: '这个筛选下没有事件' }, '换一个筛选。'))
    }

    function SourceResult({ result }) {
      if (!result) return null
      if (!result.ok) return h(Empty, { title: '原文未缓存' }, result.message ?? '先 memo_ingest 把这一章存进来。')
      if (!result.text) return h(Empty, { title: '没有命中' }, '换一个关键词，或直接看这一章。')
      return h('div', { className: 'fade-sourcebox' },
        result.stale === true
          ? h('div', { className: 'fade-stale' },
            h(Icon, { name: 'alert', size: 13 }),
            h('span', null, '原文已变化，无法保证定位准确。记忆时的 sha 与当前文件不一致；建议重新 digest 这一章。'))
          : null,
        h('div', { className: 'fade-sourcemeta' },
          h('span', null, `第 ${result.chapter} 章 · 第 ${fmt(result.offset)} 字`),
          h('span', null, result.sha256 ? `sha ${shortHash(result.sha256)}${result.stale === false ? ' · 校验通过' : ''}` : 'sha 未校验')),
        h('div', { className: 'excerpt' }, result.text),
        h('div', { className: 'fade-scroll-note', style: { marginTop: 6, color: 'var(--fade-faint)', fontSize: 9, fontFamily: 'var(--fade-mono)' } },
          `共 ${fmt(result.total)} 字${result.truncated ? ' · 已截取' : ''}`))
    }

    function ArtifactLookup({ input, onInput, result, busy, onLookup }) {
      const artifact = result?.artifact
      return h('section', { className: 'fade-card' },
        h('div', { className: 'fade-card-h' },
          h('div', { className: 'fade-kicker' }, '按 ID 回查'),
          h('div', { className: 'fade-meta' }, '只读')),
        h('div', { style: { display: 'flex', gap: 6 } },
          h('input', {
            className: 'fade-input', value: input, placeholder: 'digest:ch12:v2 / forget:… / pin:…',
            onChange: (event) => onInput(event.target.value),
            onKeyDown: (event) => { if (event.key === 'Enter') onLookup(false) },
            'aria-label': 'artifactId',
          }),
          h(Btn, { onClick: () => onLookup(false), disabled: busy || !input.trim() }, busy ? '查…' : '回查'),
          h(Btn, { onClick: () => onLookup(true), disabled: busy || !input.trim(), title: '重新计算原文 sha' }, '验证')),
        result && result.found === false
          ? h('div', { className: 'fade-sub', style: { marginTop: 8 } }, result.reason === 'not-found' ? '没有这条产物；可能是 id 写错，或旧账没有收据。' : (result.message ?? '没有找到。'))
          : null,
        artifact
          ? h('dl', { className: 'fade-artifact-row', style: { marginTop: 9 } },
            h('dt', null, 'kind'), h('dd', null, artifact.kind),
            h('dt', null, 'revision'), h('dd', null, artifact.revision ?? '—（旧账）'),
            h('dt', null, 'hash'), h('dd', { className: 'fade-num' }, shortHash(artifact.hash)),
            h('dt', null, 'exists'), h('dd', null, artifact.exists === false ? '已被后续版本覆盖' : '仍在'),
            h('dt', null, 'legacy'), h('dd', null, artifact.legacy ? '旧账，无完整收据' : '完整收据'),
            h('dt', null, 'integrity'), h('dd', null, artifact.integrity ?? 'declared'),
            artifact.ids?.length ? h('dt', null, 'ids') : null,
            artifact.ids?.length ? h('dd', { className: 'fade-num' }, artifact.ids.join('、')) : null)
          : null)
    }

    function ProvenancePane({
      view, onView, timeline, timelineData, timelineFilter, onTimelineFilter, onTimelineEntry,
      sourceIndex, sourceChapter, onSourceChapter, sourceQuery, onSourceQuery, onLoadSource,
      sourceResult, sourceBusy, artifactInput, onArtifactInput, artifactResult, artifactBusy, onArtifact,
    }) {
      return h(React.Fragment, null,
        h('div', { className: 'fade-seg' },
          h('button', { type: 'button', 'data-a': view === 'timeline' ? '1' : '0', onClick: () => onView('timeline') }, `时间线 ${timeline?.counts?.all ?? 0}`),
          h('button', { type: 'button', 'data-a': view === 'source' ? '1' : '0', onClick: () => onView('source') }, `原文 ${sourceIndex?.chapters?.length ?? 0}`)),
        view === 'timeline'
          ? h(TimelinePane, { data: timeline, phase: timelineData.phase, error: timelineData.error, onRetry: timelineData.reload, filter: timelineFilter, onFilter: onTimelineFilter, onOpen: onTimelineEntry })
          : h(React.Fragment, null,
            h('div', { className: 'fade-search' },
              h(Icon, { name: 'search', size: 14 }),
              h('input', {
                value: sourceQuery,
                onChange: (event) => onSourceQuery(event.target.value),
                onKeyDown: (event) => { if (event.key === 'Enter' && sourceChapter) onLoadSource(sourceChapter) },
                placeholder: '在原文里找一句…',
                'aria-label': '搜原文',
              }),
              h('button', { type: 'button', className: 'fade-link', style: { marginTop: 0 }, onClick: () => sourceChapter && onLoadSource(sourceChapter) }, '定位')),
            sourceIndex?.chapters?.length
              ? h('div', { className: 'fade-source-chapters' }, sourceIndex.chapters.map((entry) => h('button', {
                key: entry.chapter, type: 'button', className: 'fade-source-ch', 'data-a': sourceChapter === entry.chapter ? '1' : '0',
                onClick: () => onSourceChapter(entry.chapter),
              },
              h('b', null, `第 ${entry.chapter} 章`),
              h('span', null, entry.title || '已存原文'),
              h('span', { className: 'chars' }, `${fmt(entry.chars)} 字`))))
              : h(Empty, { title: '还没有原文缓存' }, '新章 digest 会自动存；旧章用 memo_ingest。'),
            sourceBusy ? h(Loading, { label: '读原文…' }) : h(SourceResult, { result: sourceResult }),
            h(ArtifactLookup, {
              input: artifactInput, onInput: onArtifactInput,
              result: artifactResult, busy: artifactBusy, onLookup: onArtifact,
            })))
    }

    /* ════════════════════════════════════════════════════════════════════════
     * 8. Tab shell
     * ════════════════════════════════════════════════════════════════════════ */
    function FadeTab(props) {
      const sessionId = sessionIdOf(props?.sessionId)
      const remote = props?.remote ?? null
      const [bookPicked, setBookPicked] = React.useState(null)
      const panel = usePanel(remote, sessionId, bookPicked)
      const base = panel.data?.panel ?? null
      const mode = panel.data?.mode?.on ?? null
      const harness = (() => {
        try { return window.__FADE_UI_HARNESS__ ?? null } catch { return null }
      })()
      const [tab, setTab] = React.useState(harness?.tab ?? 'overview')
      const [memoryView, setMemoryView] = React.useState(harness?.memoryView ?? 'cards')
      const [provenanceView, setProvenanceView] = React.useState(harness?.provenanceView ?? 'timeline')
      const [query, setQuery] = React.useState('')
      const [debounced, setDebounced] = React.useState('')
      const [chapterFilter, setChapterFilter] = React.useState(null)
      const [pinnedOnly, setPinnedOnly] = React.useState(false)
      const [fadedOnly, setFadedOnly] = React.useState(false)
      const [filtered, setFiltered] = React.useState(null)
      const [more, setMore] = React.useState([])
      const [moreBusy, setMoreBusy] = React.useState(false)
      const [sheet, setSheet] = React.useState(harness?.sheet ?? null)
      const [timelineFilter, setTimelineFilter] = React.useState('all')
      const [sourceChapter, setSourceChapter] = React.useState(null)
      const [sourceQuery, setSourceQuery] = React.useState('')
      const [sourceResult, setSourceResult] = React.useState(null)
      const [sourceBusy, setSourceBusy] = React.useState(false)
      const [artifactInput, setArtifactInput] = React.useState('')
      const [artifactResult, setArtifactResult] = React.useState(null)
      const [artifactBusy, setArtifactBusy] = React.useState(false)
      const [width, setWidth] = React.useState(420)
      const [scheme] = React.useState(() => detectScheme())
      const rootRef = React.useRef(null)
      const searchRef = React.useRef(null)
      const sourceSeq = React.useRef(0)
      const artifactSeq = React.useRef(0)

      const snapshot = filtered ?? base
      const book = bookPicked ?? snapshot?.book ?? null

      React.useEffect(() => {
        const id = setTimeout(() => setDebounced(query.trim()), 240)
        return () => clearTimeout(id)
      }, [query])

      React.useEffect(() => {
        if (!remote || !sessionId) return undefined
        const onKey = (event) => {
          const el = event.target
          const tag = el?.tagName
          if (tag === 'INPUT' || tag === 'TEXTAREA' || el?.isContentEditable) return
          if (event.key === '/') {
            event.preventDefault()
            searchRef.current?.focus()
          } else if (event.key === 'b') {
            event.preventDefault()
            setSheet({ type: 'brief' })
          }
        }
        window.addEventListener('keydown', onKey)
        return () => window.removeEventListener('keydown', onKey)
      }, [remote, sessionId])

      React.useEffect(() => {
        if (!rootRef.current || typeof ResizeObserver !== 'function') return undefined
        const observer = new ResizeObserver((entries) => {
          const next = entries[0]?.contentRect?.width
          if (next && Math.abs(next - width) > 24) setWidth(Math.round(next))
        })
        observer.observe(rootRef.current)
        return () => observer.disconnect()
      }, [width])

      const hasFilter = Boolean(debounced || chapterFilter || pinnedOnly || fadedOnly)
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
        if (pinnedOnly) options.pinned = true
        if (fadedOnly) options.permission = ['gist', 'feeling']
        remote.panel(sessionId, options)
          .then(unwrap)
          .then((value) => { if (!cancelled) setFiltered(value) })
          .catch((error) => { if (!cancelled) console.error('[novel-fade] 筛选失败', error) })
        return () => { cancelled = true }
      }, [hasFilter, debounced, chapterFilter, pinnedOnly, fadedOnly, remote, sessionId, bookPicked])

      const cards = React.useMemo(() => {
        const rows = [...(snapshot?.cards ?? []), ...more]
        rows.sort((a, b) => ((b.pinned ? 1 : 0) - (a.pinned ? 1 : 0)) || ((b.chapter ?? 0) - (a.chapter ?? 0)))
        return rows
      }, [snapshot?.cards, more])
      const totalCards = snapshot?.pagination?.total ?? cards.length
      const hasMore = totalCards > cards.length

      React.useEffect(() => { setMore([]) }, [snapshot?.generatedAt, debounced, chapterFilter, pinnedOnly, fadedOnly])

      const timeline = useTimeline(remote, sessionId, book, timelineFilter, tab === 'provenance')
      const sourceIndex = useSourceIndex(remote, sessionId, book, tab === 'provenance')

      const switchBook = (next) => {
        if (!next || next === snapshot?.book) return
        sourceSeq.current += 1
        artifactSeq.current += 1
        setBookPicked(next)
        setQuery('')
        setDebounced('')
        setChapterFilter(null)
        setPinnedOnly(false)
        setFadedOnly(false)
        setFiltered(null)
        setMore([])
        setSheet(null)
        setTab('overview')
        setTimelineFilter('all')
        setSourceChapter(null)
        setSourceQuery('')
        setSourceResult(null)
        setSourceBusy(false)
        setArtifactInput('')
        setArtifactResult(null)
        setArtifactBusy(false)
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

      const loadMore = async () => {
        if (!remote || !sessionId || moreBusy) return
        setMoreBusy(true)
        try {
          const options = { offset: cards.length, limit: 60 }
          if (bookPicked) options.book = bookPicked
          if (debounced) options.query = debounced
          if (chapterFilter) options.chapter = chapterFilter
          if (pinnedOnly) options.pinned = true
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

      const clearFilters = () => {
        setQuery('')
        setDebounced('')
        setChapterFilter(null)
        setPinnedOnly(false)
        setFadedOnly(false)
        setFiltered(null)
      }

      const openPerson = (name) => {
        if (!name) return
        setSheet({ type: 'character', name })
      }

      const openSource = (chapter, search = '') => {
        setSheet({ type: 'source', chapter, query: search })
      }

      const loadSource = async (chapter, search = sourceQuery) => {
        if (!remote || !sessionId || !chapter) return
        const mine = ++sourceSeq.current
        setSourceChapter(chapter)
        setSourceBusy(true)
        setSourceResult(null)
        try {
          const value = unwrap(await remote.sourceSlice(sessionId, {
            book,
            chapter,
            query: String(search ?? '').trim(),
          }))
          if (mine !== sourceSeq.current) return
          setSourceResult(value)
        } catch (error) {
          if (mine !== sourceSeq.current) return
          setSourceResult({ ok: false, message: String(error?.message ?? error) })
        } finally {
          if (mine === sourceSeq.current) setSourceBusy(false)
        }
      }

      const loadArtifact = async (verify) => {
        if (!remote || !sessionId || !artifactInput.trim()) return
        const mine = ++artifactSeq.current
        setArtifactBusy(true)
        try {
          const value = unwrap(await remote.artifact(sessionId, {
            book,
            artifactId: artifactInput.trim(),
            verify: verify === true,
          }))
          if (mine !== artifactSeq.current) return
          setArtifactResult(value)
        } catch (error) {
          if (mine !== artifactSeq.current) return
          setArtifactResult({ found: false, message: String(error?.message ?? error) })
        } finally {
          if (mine === artifactSeq.current) setArtifactBusy(false)
        }
      }

      const healthAction = (action) => {
        if (!action) return
        if (action.kind === 'brief') { setSheet({ type: 'brief' }); return }
        if (action.cardId) {
          const card = (snapshot?.cards ?? []).find((item) => item.id === action.cardId)
          if (card) { setSheet({ type: 'card', card }); return }
        }
        if (Number.isInteger(action.chapter) && action.chapter > 0) {
          setTab('memory')
          setMemoryView('cards')
          setChapterFilter(action.chapter)
          setSheet(null)
        }
      }

      const navTabs = [
        ['overview', '总览'],
        ['memory', '记忆'],
        ['provenance', '溯源'],
      ]
      const healthCounts = snapshot?.health?.counts ?? {}
      const healthTotal = (healthCounts.block ?? 0) + (healthCounts.warn ?? 0)

      const header = h('div', { className: 'fade-head' },
        h('div', { className: 'fade-title-row' },
          h('div', { className: 'fade-brand' }, h(Icon, { name: 'brand' })),
          h('span', { className: 'fade-title' }, '长篇记忆'),
          h('button', {
            type: 'button', className: 'fade-switch', 'data-on': mode === false ? '0' : '1',
            onClick: toggleMode, 'aria-label': mode ? '关闭褪色记忆' : '开启褪色记忆',
            title: '切换 /memo on | off',
          }),
          h('span', { className: 'fade-switch-label' }, mode == null ? '…' : mode ? '开' : '关'),
          snapshot?.revision != null ? h('span', { className: 'fade-ver' }, `v${snapshot.revision}`) : null,
          h('div', { className: 'fade-grow' }),
          h('button', {
            type: 'button', className: 'fade-iconbtn', 'aria-label': '协作状态',
            onClick: () => setSheet({ type: 'companions' }),
          }, h(Icon, { name: 'more' })),
          h('button', {
            type: 'button', className: 'fade-iconbtn', 'aria-label': '刷新',
            onClick: () => { clearFilters(); panel.reload() },
          }, h(Icon, { name: 'refresh' }))),
        h('div', { className: 'fade-bookrow' },
          snapshot && (snapshot.books?.length ?? 0) > 1
            ? h('select', {
              className: 'fade-select', value: snapshot.book ?? '', onChange: (event) => switchBook(event.target.value),
              'aria-label': '切换书',
            }, snapshot.books.map((entry) => h('option', { key: entry.book, value: entry.book }, entry.title || entry.book)))
            : h('button', {
              type: 'button', className: 'fade-book',
              onClick: () => { if (snapshot?.books?.length > 1) setSheet({ type: 'books' }) },
              title: snapshot?.title ?? snapshot?.book ?? '',
            }, h('b', null, snapshot?.title ?? snapshot?.book ?? '正在读取…'), snapshot?.books?.length > 1 ? h(Icon, { name: 'chevron', size: 10 }) : null),
          snapshot?.chapter ? h('span', { className: 'fade-chap' }, `第 ${snapshot.chapter} 章`) : null,
          snapshot?.health
            ? h('button', {
              type: 'button', className: 'fade-healthpill', 'data-ok': healthTotal ? '0' : '1',
              onClick: () => setTab('overview'),
              title: '看本章体检',
            }, h('i', { className: 'fade-dot' }), healthTotal ? `${healthTotal} 项` : '通过')
            : null),
        h('div', { className: 'fade-nav' },
          navTabs.map(([id, label]) => h('button', {
            key: id, type: 'button', className: 'fade-tab', 'data-a': tab === id ? '1' : '0',
            onClick: () => { setTab(id); setSheet(null) },
          }, label)),
          h('button', {
            type: 'button', className: 'fade-cta', onClick: () => setSheet({ type: 'brief' }),
            title: '生成下一章简报',
          }, h(Icon, { name: 'spark', size: 11 }), '本章简报')))

      let body = null
      if (panel.phase === 'loading' && !snapshot) body = h(Loading, { label: '读取记忆…' })
      else if (panel.phase === 'error' && !snapshot) body = h(ErrorBox, { error: panel.error, onRetry: panel.reload })
      else if (!snapshot) body = h(Empty, { title: '还没有数据' }, '检查当前工作区是否已 /memo on。')
      else if (snapshot.exists === false) {
        body = h(Empty, { title: '这个工作区还没有 fade 记忆' }, snapshot.message ?? '先 /memo on，写完一章跑 memo_digest。')
      } else if (tab === 'overview') {
        body = h(Overview, {
          snapshot,
          onPerson: openPerson,
          onSearch: () => { setTab('memory'); setMemoryView('cards'); setTimeout(() => searchRef.current?.focus(), 30) },
          onSource: () => { setTab('provenance'); setProvenanceView('source') },
          onProvenance: () => { setTab('provenance'); setProvenanceView('timeline') },
          onBrief: () => setSheet({ type: 'brief' }),
          onSeries: () => setSheet({ type: 'companions' }),
          onHealthAction: healthAction,
          onCurve: () => setSheet({ type: 'curve' }),
        })
      } else if (tab === 'memory') {
        body = h(MemoryPane, {
          snapshot, cards, total: totalCards, hasMore, onMore: loadMore, loadingMore: moreBusy,
          people: snapshot.people ?? [],
          query, onQuery: setQuery, searchRef, onSearchFocus: () => {},
          pinnedOnly, onPinned: setPinnedOnly, fadedOnly, onFaded: setFadedOnly,
          view: memoryView, onView: setMemoryView, onCard: (card) => setSheet({ type: 'card', card }),
          onPerson: openPerson, chapterFilter, onClearChapter: () => setChapterFilter(null),
        })
      } else {
        body = h(ProvenancePane, {
          view: provenanceView, onView: setProvenanceView,
          timeline: timeline.data, timelineData: timeline, timelineFilter, onTimelineFilter: setTimelineFilter,
          onTimelineEntry: (entry) => {
            if (entry.chapter) {
              setTab('memory'); setMemoryView('cards'); setChapterFilter(entry.chapter); setSheet(null)
            }
          },
          sourceIndex: sourceIndex.data, sourceChapter,
          onSourceChapter: (chapter) => { setSourceChapter(chapter); loadSource(chapter, sourceQuery) },
          sourceQuery, onSourceQuery: setSourceQuery,
          onLoadSource: (chapter) => loadSource(chapter, sourceQuery),
          sourceResult, sourceBusy,
          artifactInput, onArtifactInput: setArtifactInput, artifactResult, artifactBusy, onArtifact: loadArtifact,
        })
      }

      const sheetBook = snapshot?.book ?? book
      const sheetSheet = sheet
        ? sheet.type === 'brief'
          ? h(BriefSheet, {
            remote, sessionId, book: sheetBook, chapter: snapshot?.chapter ?? 1,
            people: snapshot?.people ?? [], onClose: () => setSheet(null),
          })
          : sheet.type === 'curve'
            ? h(CurveSheet, {
              remote, sessionId, book: sheetBook, chapter: snapshot?.chapter ?? 1, scheme,
              onOpenChapter: (chapter) => {
                setTab('memory'); setMemoryView('cards'); setChapterFilter(chapter); setSheet(null)
              },
              onOpenCard: (cardId, markerChapter) => {
                const card = (snapshot?.cards ?? []).find((item) => item.id === cardId)
                if (card) {
                  setSheet({ type: 'card', card })
                } else if (Number.isInteger(markerChapter)) {
                  setTab('memory'); setMemoryView('cards'); setChapterFilter(markerChapter); setSheet(null)
                } else {
                  // Superseded markers may have no validTo/chapter and the card
                  // can be outside the 60-card snapshot. Make the fallback
                  // explicit instead of silently doing nothing.
                  setTab('memory'); setMemoryView('cards'); setChapterFilter(null); setSheet(null)
                }
              },
              onClose: () => setSheet(null),
            })
            : sheet.type === 'card'
            ? h(CardSheet, {
              card: sheet.card, chapter: snapshot?.chapter ?? sheet.card.chapter,
              sourceChapters: snapshot?.overview?.source?.list ?? [],
              onLocate: (card) => openSource(card.chapter, card.quote ?? ''),
              onEntity: (name) => openPerson(name),
              onClose: () => setSheet(null),
            })
            : sheet.type === 'character'
              ? h(CharacterSheet, {
                remote, sessionId, book: sheetBook, name: sheet.name, onClose: () => setSheet(null),
              })
              : sheet.type === 'source'
                ? h(SourceSheet, {
                  remote, sessionId, book: sheetBook, chapter: sheet.chapter, query: sheet.query ?? '',
                  onClose: () => setSheet(null),
                })
                : sheet.type === 'companions'
                  ? h(CompanionsSheet, { companions: snapshot?.companions, onClose: () => setSheet(null) })
                  : sheet.type === 'books'
                    ? h(Sheet, { title: '切换书', subtitle: '同一工作区', onClose: () => setSheet(null) },
                      h('div', { className: 'fade-menu' }, (snapshot?.books ?? []).map((entry) => h('button', {
                        key: entry.book, type: 'button', onClick: () => { switchBook(entry.book); setSheet(null) },
                      }, h('div', null, entry.title || entry.book, h('small', null, `${entry.chapters} 章 · ${entry.cards} 张卡`))))))
                    : null
        : null

      return h('div', {
        className: 'fade-root', ref: rootRef, 'data-scheme': scheme,
      },
      h(Styles),
      header,
      h('div', { className: 'fade-body' }, body),
      h('div', { className: 'fade-foot' },
        h('span', null, snapshot?.revision != null
          ? `记忆 v${snapshot.revision} · 快照 ${clock(snapshot.generatedAt)}`
          : (snapshot?.generatedAt ? `快照 ${clock(snapshot.generatedAt)}` : '未加载')),
        h('span', null, `${(snapshot?.warnings ?? []).length} 条提示 · 只读`)),
      sheetSheet)
    }

    /* ════════════════════════════════════════════════════════════════════════
     * 9. Sheets
     * ════════════════════════════════════════════════════════════════════════ */
    function copyText(text) {
      const value = String(text ?? '')
      try {
        if (navigator?.clipboard?.writeText) return navigator.clipboard.writeText(value)
      } catch { /* fall through */ }
      try {
        const area = document.createElement('textarea')
        area.value = value
        area.style.cssText = 'position:fixed;left:-9999px;top:0'
        document.body.appendChild(area)
        area.select()
        document.execCommand('copy')
        area.remove()
        return Promise.resolve()
      } catch {
        return Promise.reject(new Error('复制失败'))
      }
    }

    function downloadText(filename, text) {
      try {
        const blob = new Blob([String(text ?? '')], { type: 'text/markdown;charset=utf-8' })
        const url = URL.createObjectURL(blob)
        const link = document.createElement('a')
        link.href = url
        link.download = filename
        document.body.appendChild(link)
        link.click()
        link.remove()
        setTimeout(() => URL.revokeObjectURL(url), 1000)
      } catch (error) {
        console.error('[novel-fade] 导出失败', error)
      }
    }

    function parseBriefSections(markdown) {
      const text = String(markdown ?? '')
      const sections = []
      let current = null
      for (const line of text.split('\n')) {
        if (line.startsWith('## ')) {
          current = { title: line.slice(3).trim(), body: [] }
          sections.push(current)
        } else if (current && line.trim()) {
          current.body.push(line)
        }
      }
      return sections.map((section) => ({ title: section.title, body: section.body.join('\n') }))
    }

    function BriefSheet({ remote, sessionId, book, chapter, people, onClose }) {
      const [target, setTarget] = React.useState(Math.max(1, Number(chapter) || 1))
      const [mode, setMode] = React.useState('chapter')
      const [budget, setBudget] = React.useState(1400)
      const [cast, setCast] = React.useState([])
      const [location, setLocation] = React.useState('')
      const [propsText, setPropsText] = React.useState('')
      const [state, setState] = React.useState({ phase: 'loading', data: null, error: null })
      const [openIds, setOpenIds] = React.useState(() => new Set(['hard', 'threads']))
      const [notice, setNotice] = React.useState('')
      const requestSeq = React.useRef(0)

      React.useEffect(() => {
        const next = Number(chapter)
        if (Number.isInteger(next) && next > 0) setTarget(next)
      }, [chapter])

      const castKey = cast.join('|')
      const load = React.useCallback(async () => {
        if (!remote || !sessionId) return
        const mine = ++requestSeq.current
        setState({ phase: 'loading', data: null, error: null })
        try {
          const options = {
            book, chapter: target, mode, budget,
            scene: {
              entities: cast,
              location: location.trim(),
              props: parseNames(propsText),
            },
          }
          const value = unwrap(await remote.brief(sessionId, options))
          if (mine !== requestSeq.current) return
          setState({ phase: 'ready', data: value, error: null })
        } catch (error) {
          if (mine !== requestSeq.current) return
          setState({ phase: 'error', data: null, error: String(error?.message ?? error) })
        }
      // eslint-disable-next-line react-hooks/exhaustive-deps
      }, [remote, sessionId, book, target, mode, budget, castKey, location, propsText])

      React.useEffect(() => {
        setState({ phase: 'loading', data: null, error: null })
        const id = setTimeout(load, 240)
        return () => {
          clearTimeout(id)
          requestSeq.current += 1
        }
      }, [load])

      const data = state.data
      const limit = mode === 'handoff' ? 2600 : 1800
      const sections = parseBriefSections(data?.markdown)
      const byTitle = new Map(sections.map((section) => [section.title, section]))
      const breakdown = (data?.breakdown ?? []).filter((section) => section.included)
      const budgetValue = Math.min(budget, limit)
      const setPreset = (value) => {
        if (value === 2200) {
          setMode('handoff')
          setBudget(2200)
          return
        }
        setBudget(value)
      }
      const toggleCast = (name) => {
        setCast((prev) => prev.includes(name) ? prev.filter((item) => item !== name) : prev.concat(name))
      }
      const toggleSection = (id) => {
        setOpenIds((prev) => {
          const next = new Set(prev)
          if (next.has(id)) next.delete(id)
          else next.add(id)
          return next
        })
      }
      const copy = async () => {
        try {
          await copyText(data?.markdown ?? '')
          setNotice('已复制到剪贴板')
          setTimeout(() => setNotice(''), 1800)
        } catch {
          setNotice('复制失败，请换浏览器重试')
        }
      }

      return h(Sheet, {
        title: '本章简报',
        subtitle: `第 ${target} 章 · 只读预览`,
        onClose,
        footer: h(React.Fragment, null,
          h('div', { className: 'fade-sheet-note' },
            '只生成上下文，不写入记忆。',
            notice ? h('div', { style: { color: 'var(--fade-ok)', marginTop: 2 } }, notice) : null),
          h(Btn, { disabled: !data?.markdown, onClick: () => downloadText(`第${target}章-褪色简报.md`, data?.markdown ?? '') }, '导出 .md'),
          h(Btn, { primary: true, onClick: copy, disabled: !data?.markdown }, '复制简报')),
      },
      h('div', { className: 'fade-field' },
        h('span', { className: 'fade-flabel' }, '目标章'),
        h('div', { className: 'fade-stepper' },
          h('button', { type: 'button', onClick: () => setTarget((value) => Math.max(1, value - 1)), 'aria-label': '上一章' }, '−'),
          h('b', null, `第 ${target} 章`),
          h('button', { type: 'button', onClick: () => setTarget((value) => Math.min(9999, value + 1)), 'aria-label': '下一章' }, '＋')),
        h('span', { className: 'fade-flabel', style: { width: 'auto', marginLeft: 'auto' } }, '模式'),
        h('div', { className: 'fade-preset', style: { flex: '0 0 92px' } },
          h('button', { type: 'button', 'data-a': mode === 'chapter' ? '1' : '0', onClick: () => { setMode('chapter'); setBudget((value) => Math.min(value, 1800)) } }, '本章'),
          h('button', { type: 'button', 'data-a': mode === 'handoff' ? '1' : '0', onClick: () => setMode('handoff') }, '交接'))),
      h('div', { className: 'fade-field' },
        h('span', { className: 'fade-flabel' }, '预算'),
        h('div', { className: 'fade-preset' },
          [1000, 1400, 2200].map((value) => h('button', {
            key: value, type: 'button', 'data-a': budget === value ? '1' : '0',
            onClick: () => setPreset(value),
          }, String(value))))),
      h('div', { className: 'fade-field' },
        h('span', { className: 'fade-flabel' }, '细调'),
        h('div', { className: 'fade-range' },
          h('input', {
            type: 'range', min: 300, max: limit, step: 100, value: budgetValue,
            onChange: (event) => setBudget(Number(event.target.value)),
            'aria-label': '简报预算',
          })),
        h('span', { className: 'fade-range-num' }, `${budgetValue} 字`)),
      budget > limit
        ? h('div', { className: 'fade-sub' }, `普通模式上限 ${limit} 字；想要 ${budget} 字请切「交接」模式。`)
        : null,
      h('div', { className: 'fade-field', style: { alignItems: 'flex-start' } },
        h('span', { className: 'fade-flabel', style: { marginTop: 4 } }, '在场'),
        h('div', { className: 'fade-cast' },
          people.slice(0, 8).map((person) => h('button', {
            key: person.id, type: 'button', 'data-a': cast.includes(person.name) ? '1' : '0',
            onClick: () => toggleCast(person.name),
          }, person.name)),
          h('span', { className: 'fade-sub', style: { alignSelf: 'center' } }, '不选则不收窄'))),
      h('div', { className: 'fade-field' },
        h('span', { className: 'fade-flabel' }, '地点'),
        h('input', {
          className: 'fade-input', value: location, placeholder: '冰火两仪眼废墟',
          onChange: (event) => setLocation(event.target.value),
        })),
      h('div', { className: 'fade-field' },
        h('span', { className: 'fade-flabel' }, '道具'),
        h('input', {
          className: 'fade-input', value: propsText, placeholder: '钥匙、铁护腕（用顿号分隔）',
          onChange: (event) => setPropsText(event.target.value),
        })),
      state.phase === 'error' ? h(ErrorBox, { error: state.error, onRetry: load }) : null,
      state.phase === 'loading' && !data ? h(Loading, { label: '生成简报…' }) : null,
      data
        ? h(React.Fragment, null,
          h('div', { className: 'fade-sum' },
            h('span', null,
              h('b', null, `${breakdown.length} 段`), ` · ${fmt(data.chars)} 字 · 预算 ${fmt(data.budget)}`,
              data.budgetLimit && data.budgetLimit !== data.budget ? `（上限 ${data.budgetLimit}）` : ''),
            h('span', { className: 'ok' },
              data.sources?.l0Omitted ? `L0 ${data.sources.l0Included}/${data.sources.l0Total}` : `L0 ${data.sources?.l0Total ?? 0} 张全部进入`)),
          data.overBudget
            ? h('div', { className: 'fade-stale' }, h(Icon, { name: 'alert', size: 13 }), h('span', null, `超出预算 ${fmt(data.chars - data.budget)} 字；硬契约段不会被裁，只能裁后面的段。`))
            : null,
          data.sources?.partial
            ? h('div', { className: 'fade-sub' }, '有段落被裁剪；来源只统计实际进入正文的卡。')
            : null,
          breakdown.map((section) => {
            const body = byTitle.get(section.title)
            const open = openIds.has(section.id)
            return h('div', { key: section.id, className: 'fade-srow' },
              h('button', {
                type: 'button', style: { border: 0, background: 'transparent', padding: 0, width: '100%', cursor: 'pointer', color: 'inherit' },
                onClick: () => toggleSection(section.id),
              },
              h('div', { className: 'fade-srow-h' },
                h('b', null, section.title),
                section.clipped ? h('span', { className: 'clip' }, section.omitted ? `裁 ${section.omitted} 张` : '已裁') : null,
                h('span', { className: 'count' }, `${section.chars} 字`)),
              h('div', { className: `fade-srow-bar ${section.clipped ? 'warn' : ''}` },
                h('i', { style: { width: `${Math.min(100, section.budget ? (section.chars / section.budget) * 100 : 30)}%` } }))),
              open && body
                ? h('div', { className: 'fade-srow-body' }, body.body)
                : null)
          }),
          data.sources
            ? h('div', { className: 'fade-sub', style: { marginTop: 2 } },
              `来源 L0 ${data.sources.l0Included ?? 0} · L1 ${data.sources.cardIds?.length ?? 0} · 章节 ${(data.sources.chapters ?? []).length}`)
            : null)
        : null)
    }

    function CardSheet({ card, chapter, sourceChapters, onLocate, onEntity, onClose }) {
      const cached = Array.isArray(sourceChapters) && sourceChapters.includes(card.chapter)
      return h(Sheet, {
        title: '记忆卡',
        subtitle: `第 ${card.chapter} 章 · ${card.layer}`,
        onClose,
        footer: h(React.Fragment, null,
          h('div', { className: 'fade-sheet-note' }, '面板只读；钉住/遗忘请让 agent 调 memo_pin / memo_forget。'),
          h(Btn, { primary: true, onClick: () => onLocate(card) }, cached ? '回查原句' : '按需取原文')),
      },
      h('div', { style: { display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' } },
        h(Tag, { tone: card.permission === 'precise' ? 'ok' : card.permission === 'recall' ? 'warn' : '' }, card.permissionLabel),
        card.pinned ? h('span', { className: 'fade-pin' }, h(Icon, { name: 'pin', size: 11 }), '作者钉住') : null),
      h('div', { style: { fontSize: 16, fontWeight: 650, lineHeight: 1.4 } }, card.topic),
      card.gist ? h('div', { style: { fontSize: 12, lineHeight: 1.7, color: 'var(--fade-text)' } }, card.gist) : null,
      card.gist === '' && card.permission !== 'precise' && card.permission !== 'recall'
        ? h('div', { className: 'fade-sub' }, '这张卡已经褪色：只保留主题与情绪，不补细节。')
        : null,
      card.quote ? h('div', { className: 'fade-quote', style: { borderLeft: '2px solid var(--fade-line-2)', paddingLeft: 9, color: 'var(--fade-muted)', fontSize: 11, lineHeight: 1.7 } }, `锚句「${card.quote}」`) : null,
      h('dl', { className: 'fade-artifact-row', style: { marginTop: 4 } },
        h('dt', null, '三维'), h('dd', { className: 'fade-num' }, `熟 ${card.familiarity} · 可及 ${card.accessibility} · 保真 ${card.fidelity}`),
        card.entityNames?.length ? h('dt', null, '人物') : null,
        card.entityNames?.length ? h('dd', null, card.entityNames.map((name) => h('button', {
          key: name, type: 'button', className: 'fade-link', style: { marginRight: 8, marginTop: 0 }, onClick: () => onEntity?.(name),
        }, name))) : null,
        card.placeName ? h('dt', null, '地点') : null,
        card.placeName ? h('dd', null, card.placeName) : null,
        card.pinnedReason ? h('dt', null, '钉住原因') : null,
        card.pinnedReason ? h('dd', null, card.pinnedReason) : null),
      h('div', { className: 'fade-sub' }, cached ? '这一章原文已存；定位时会校验 sha。' : '这一章还没有原文缓存；先 memo_ingest（只存不用）。'))
    }

    function CurveChart({ data, mode = 'A', scheme = 'dark', onSelect = null }) {
      const lineColor = (line) => scheme === 'light'
        ? (line.colorLight ?? line.color ?? 'var(--fade-brand)')
        : (line.color ?? 'var(--fade-brand)')
      const [activeKey, setActiveKey] = React.useState(null)
      const pointRefs = React.useRef(new Map())
      const W = 360
      const H = 210
      const ML = 30
      const MR = 12
      const MT = 14
      const MB = 24
      const plotW = W - ML - MR
      const plotH = H - MT - MB
      const from = data?.meta?.window?.from ?? 1
      const to = data?.meta?.window?.to ?? 1
      const x = (chapter) => ML + ((chapter - from) / Math.max(1, to - from)) * plotW
      const y = (value) => MT + (1 - Math.max(0, Math.min(1, Number(value) || 0))) * plotH
      const showA = mode !== 'R'
      const showR = mode !== 'A'
      const grid = showA ? [0, 0.15, 0.5, 1] : [0, 0.5, 1]
      const markers = (data?.markers ?? []).filter((marker) => Number.isInteger(marker.chapter))
      const allPoints = []
      for (const line of data?.lines ?? []) {
        for (const [index, point] of line.points.entries()) {
          allPoints.push({ key: `${line.id}:${point.chapter}`, line, point, index })
        }
      }
      const movePoint = (entry, delta) => {
        const points = entry.line.points
        const next = Math.max(0, Math.min(points.length - 1, entry.index + delta))
        const target = points[next]
        if (!target) return
        setActiveKey(`${entry.line.id}:${target.chapter}`)
        pointRefs.current.get(`${entry.line.id}:${target.chapter}`)?.focus?.()
        onSelect?.(target.chapter)
      }
      const parts = []
      for (const value of grid) {
        parts.push(h('line', {
          key: `g${value}`, x1: ML, y1: y(value), x2: W - MR, y2: y(value),
          stroke: value === 0.15 ? 'var(--fade-danger)' : 'var(--fade-line)',
          strokeOpacity: value === 0.15 ? .55 : .7,
          strokeDasharray: value === 0.15 ? '3 4' : undefined,
        }))
        parts.push(h('text', {
          key: `gl${value}`, x: ML - 5, y: y(value) + 3, fill: value === 0.15 ? 'var(--fade-danger)' : 'var(--fade-faint)',
          fontSize: 8, fontFamily: 'var(--fade-mono)', textAnchor: 'end',
        }, value === 0.15 ? 'A .15' : value))
      }
      for (const chapter of [...new Set([from, Math.round((from + to) / 2), to])]) {
        parts.push(h('text', {
          key: `x${chapter}`, x: x(chapter), y: H - 6, fill: 'var(--fade-faint)',
          fontSize: 8, fontFamily: 'var(--fade-mono)', textAnchor: 'middle',
        }, chapter))
      }
      for (const marker of markers.slice(0, 120)) {
        parts.push(h('line', {
          key: `m${marker.id}`, x1: x(marker.chapter), y1: MT, x2: x(marker.chapter), y2: MT + plotH,
          stroke: marker.type === 'validTo' ? 'var(--fade-warn)' : 'var(--fade-line-2)',
          strokeOpacity: marker.type === 'validTo' ? .45 : .35,
          strokeDasharray: '2 4',
        }))
      }
      parts.push(h('line', {
        x1: x(data?.meta?.chapter ?? to), y1: MT, x2: x(data?.meta?.chapter ?? to), y2: MT + plotH,
        stroke: 'var(--fade-text)', strokeOpacity: .24, strokeDasharray: '2 4',
      }))
      for (const line of data?.lines ?? []) {
        const stroke = lineColor(line)
        const segments = line.segments?.length
          ? line.segments
          : [{ fromChapter: line.points[0]?.chapter, toChapter: line.points.at(-1)?.chapter }]
        for (const [segmentIndex, segment] of segments.entries()) {
          const points = line.points.filter((point) => point.chapter >= segment.fromChapter && point.chapter <= segment.toChapter)
          if (points.length < 2) continue
          const d = (key) => points.map((point, index) => `${index ? 'L' : 'M'}${x(point.chapter).toFixed(1)},${y(point[key]).toFixed(1)}`).join(' ')
          if (showR) parts.push(h('path', {
            key: `r${line.id}:${segmentIndex}`,
            d: d('R'), fill: 'none', stroke, strokeWidth: 1, strokeOpacity: .32,
            strokeDasharray: '2 4', strokeLinecap: 'round',
          }))
          if (showA) parts.push(h('path', {
            key: `a${line.id}:${segmentIndex}`,
            d: d('A'), fill: 'none', stroke, strokeWidth: 1.8,
            strokeDasharray: line.dash || undefined, strokeLinecap: 'round', strokeLinejoin: 'round',
          }))
        }
        const last = line.points.at(-1)
        if (line.points.length === 1) {
          const only = line.points[0]
          const value = mode === 'R' ? only.R : only.A
          parts.push(h('circle', {
            key: `single${line.id}`, cx: x(only.chapter), cy: y(value), r: 3.2,
            fill: stroke, stroke: 'var(--fade-bg)', strokeWidth: 1.2,
          }))
        }
        if (last) {
          const labelValue = mode === 'R' ? last.R : last.A
          parts.push(h('text', {
            key: `label${line.id}`, x: x(last.chapter) + 3, y: y(labelValue) + 2, fill: stroke,
            fontSize: 7.5, fontFamily: 'var(--fade-mono)',
          }, line.label ?? line.layer ?? ''))
        }
      }
      const active = allPoints.some((entry) => entry.key === activeKey)
        ? activeKey
        : (allPoints[0]?.key ?? null)
      for (const entry of allPoints) {
        const { key, line, point, index } = entry
        const stroke = lineColor(line)
        const isActive = key === active
        const value = mode === 'R' ? point.R : point.A
        parts.push(h('circle', {
          key: `dot${key}`, cx: x(point.chapter), cy: y(value), r: 2.1, fill: stroke,
          stroke: 'var(--fade-bg)', strokeWidth: 0.8, pointerEvents: 'none',
        }))
        parts.push(h('circle', {
          key: `pt${key}`,
          ref: (element) => {
            if (element) pointRefs.current.set(key, element)
            else pointRefs.current.delete(key)
          },
          cx: x(point.chapter), cy: y(value), r: 9, fill: 'transparent',
          role: 'button', tabIndex: isActive ? 0 : -1,
          'aria-label': `第 ${point.chapter} 章，${line.label ?? line.layer ?? '曲线'}，可用度 ${Number(point.A).toFixed(3)}，留存 ${Number(point.R).toFixed(3)}，纳入 ${point.eligibleCount} 张`,
          onFocus: () => setActiveKey(key),
          onClick: () => { setActiveKey(key); onSelect?.(point.chapter) },
          onKeyDown: (event) => {
            if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
              event.preventDefault(); movePoint(entry, 1)
            } else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
              event.preventDefault(); movePoint(entry, -1)
            } else if (event.key === 'Home') {
              event.preventDefault(); movePoint(entry, -index)
            } else if (event.key === 'End') {
              event.preventDefault(); movePoint(entry, line.points.length - 1 - index)
            } else if (event.key === 'Enter' || event.key === ' ') {
              event.preventDefault(); setActiveKey(key); onSelect?.(point.chapter)
            }
          },
        }, h('title', null, `第 ${point.chapter} 章 · A ${Number(point.A).toFixed(3)} · R ${Number(point.R).toFixed(3)}`)))
      }
      return h('svg', {
        viewBox: `0 0 ${W} ${H}`, role: 'img',
        'aria-label': `记忆衰退曲线，第 ${from} 到 ${to} 章，${mode === 'both' ? '留存与激活' : mode === 'R' ? '留存率' : '激活度'}${showA ? '，单卡沉没线 0.15' : ''}`,
      }, parts)
    }

    function CurveSheet({ remote, sessionId, book, chapter, scheme, onOpenChapter, onOpenCard, onClose }) {
      const [series, setSeries] = React.useState('cards')
      const [mode, setMode] = React.useState('A')
      const [win, setWin] = React.useState('50')
      const [layerFilter, setLayerFilter] = React.useState([])
      const [selectedChapter, setSelectedChapter] = React.useState(null)
      const [state, setState] = React.useState({ phase: 'loading', data: null, error: null })
      const seq = React.useRef(0)
      const layersKey = layerFilter.join('|')
      const load = React.useCallback(async () => {
        if (!remote || !sessionId) return
        const mine = ++seq.current
        setState({ phase: 'loading', data: null, error: null })
        try {
          const value = unwrap(await remote.curve(sessionId, {
            book, chapter, curveVersion: 2, series, mode, window: win,
            layers: layerFilter.length ? layerFilter : undefined, pointBudget: 48,
          }))
          if (mine !== seq.current) return
          setState({ phase: 'ready', data: value, error: null })
        } catch (error) {
          if (mine !== seq.current) return
          setState({ phase: 'error', data: null, error: String(error?.message ?? error) })
        }
      // eslint-disable-next-line react-hooks/exhaustive-deps
      }, [remote, sessionId, book, chapter, series, mode, win, layersKey])
      React.useEffect(() => {
        const id = setTimeout(load, 160)
        return () => { clearTimeout(id); seq.current += 1 }
      }, [load])
      const toggleLayer = (layer) => setLayerFilter((prev) => prev.includes(layer) ? prev.filter((item) => item !== layer) : prev.concat(layer))
      const data = state.data
      const currentPoints = (data?.lines ?? []).map((line) => line.points.find((point) => point.chapter === data.meta.chapter)).filter(Boolean)
      const eligible = currentPoints.reduce((sum, point) => sum + (point.eligibleCount ?? 0), 0)
      const sunk = currentPoints.reduce((sum, point) => sum + (point.stageCounts?.sunk ?? 0), 0)
      const usedBytes = data?.meta?.budget?.usedBytes
      const budgetText = Number.isFinite(usedBytes)
        ? `主库 ${(usedBytes / (1024 * 1024)).toFixed(2)} / 3.00 MiB`
        : '主库容量未知'
      return h(Sheet, {
        wide: true, title: '记忆衰退曲线', subtitle: `第 ${data?.meta?.chapter ?? chapter} 章 · 只读 · v4 模型`, onClose,
      },
      h('div', { className: 'fade-cfilters' },
        [['cards', '卡片'], ['people', '人物'], ['chapters', '全书']].map(([id, label]) => h('button', {
          key: id, type: 'button', className: 'fade-cfilter', 'data-a': series === id ? '1' : '0',
          'aria-pressed': series === id, onClick: () => setSeries(id),
        }, label)),
        h('span', { style: { width: 4 } }),
        ['L0', 'L1', 'L2', 'L3'].map((layer) => h('button', {
          key: layer, type: 'button', className: 'fade-cfilter', 'data-a': layerFilter.includes(layer) ? '1' : '0',
          'aria-pressed': layerFilter.includes(layer), onClick: () => toggleLayer(layer),
        }, layer)),
        h('span', { style: { width: 4 } }),
        [['50', '近50'], ['100', '近100'], ['all', '全部']].map(([id, label]) => h('button', {
          key: id, type: 'button', className: 'fade-cfilter', 'data-a': win === id ? '1' : '0',
          'aria-pressed': win === id, onClick: () => setWin(id),
        }, label))),
      h('div', { className: 'fade-cseg', style: { marginTop: 7, width: 'fit-content' } },
        [['A', 'A 激活'], ['R', 'R 留存'], ['both', 'A + R']].map(([id, label]) => h('button', {
          key: id, type: 'button', 'data-a': mode === id ? '1' : '0',
          'aria-pressed': mode === id, onClick: () => setMode(id),
        }, label))),
      state.phase === 'loading' ? h(Loading, { label: '计算衰退曲线…' })
        : state.phase === 'error' ? h(ErrorBox, { error: state.error, onRetry: load })
          : !data || data.exists === false || !(data.lines ?? []).some((line) => line.points.length)
            ? h('div', { className: 'fade-curve-empty' }, '还没有可计算的卡片；先完成一章 memo_digest。')
            : h(React.Fragment, null,
              h('div', { className: 'fade-curve-hero', style: { marginTop: 9 } },
                h(CurveChart, { data, mode, scheme, onSelect: setSelectedChapter }),
                h('div', { className: 'fade-curve-note' }, `按当前记忆状态推算，不是逐章历史实测 · ${series === 'people' ? `关联 ${eligible} 次` : `纳入 ${eligible} 张`} · ${series === 'people' ? `沉没关联 ${sunk} 次` : `沉没 ${sunk} 张`} · 窗口第 ${data.meta.window.from}–${data.meta.window.to} 章 · ${budgetText}`)),
              h('div', { className: 'fade-clegend' },
                (data.legend ?? []).map((item) => {
                  const color = scheme === 'light' ? (item.colorLight ?? item.color) : item.color
                  return h('span', { key: item.id, style: { color } },
                    h('i', { style: { background: color } }), item.label)
                }),
                mode !== 'R' ? h('span', { style: { color: 'var(--fade-danger)' } },
                  h('i', { style: { background: 'var(--fade-danger)' } }), '沉没线 A .15') : null),
              h('div', { className: 'fade-sec' }, h('h3', null, '数值读数'), h('span', null, selectedChapter ? `已选第 ${selectedChapter} 章` : '点图表或按 Enter')),
              h('label', { className: 'fade-curve-note', style: { display: 'flex', alignItems: 'center', gap: 7 } },
                '章节读数',
                h('select', {
                  className: 'fade-select', value: selectedChapter ?? data.meta.chapter,
                  'aria-label': '选择曲线章节读数',
                  onChange: (event) => setSelectedChapter(Number(event.target.value)),
                }, [...new Set((data.lines ?? []).flatMap((line) => line.points.map((point) => point.chapter)))]
                  .sort((a, b) => a - b)
                  .map((chapter) => h('option', { key: chapter, value: chapter }, `第 ${chapter} 章`)))),
              h('div', { className: 'fade-marker-list' },
                (data.lines ?? []).map((line) => {
                  const target = selectedChapter ?? data.meta.chapter
                  const point = line.points.find((item) => item.chapter === target)
                    ?? (selectedChapter == null ? line.points.at(-1) : null)
                  if (!point) return null
                  return h('button', {
                    key: `read${line.id}`, type: 'button', className: 'fade-marker',
                    onClick: () => setSelectedChapter(point.chapter),
                    'aria-label': `${line.label ?? line.layer ?? '曲线'} 第 ${point.chapter} 章，可用度 ${Number(point.A).toFixed(3)}，留存 ${Number(point.R).toFixed(3)}，纳入 ${point.eligibleCount} 张`,
                  },
                  h('b', null, `第 ${point.chapter} 章`),
                  h('span', null, line.label ?? line.layer ?? '曲线'),
                  h('span', { className: 'tag' }, `A ${Number(point.A).toFixed(3)} · R ${Number(point.R).toFixed(3)} · ${point.eligibleCount} 张`))
                })),
              h('div', { className: 'fade-sec' }, h('h3', null, '边界与保护'), h('span', null, `${data.markers?.length ?? 0} 个标记`)),
              selectedChapter && onOpenChapter
                ? h('button', { type: 'button', className: 'fade-link', onClick: () => onOpenChapter(selectedChapter) },
                  `在记忆里看第 ${selectedChapter} 章 →`)
                : null,
              h('div', { className: 'fade-marker-list' },
                (data.markers ?? []).filter((marker) => marker.type !== 'sinkThreshold').slice(0, 10).map((marker) => h('button', {
                  key: marker.id, type: 'button', className: 'fade-marker',
                  onClick: () => {
                    if (marker.cardId && onOpenCard) onOpenCard(marker.cardId, marker.chapter)
                    else if (Number.isInteger(marker.chapter)) setSelectedChapter(marker.chapter)
                  },
                  'aria-label': `${marker.label}${Number.isInteger(marker.chapter) ? `，第 ${marker.chapter} 章` : ''}`,
                },
                h('b', null, Number.isInteger(marker.chapter) ? `第 ${marker.chapter} 章` : '时间未知'),
                h('span', null, marker.label),
                h('span', { className: 'tag' }, marker.layer ?? marker.type))),
                (data.warnings ?? []).map((warning) => h('div', { key: warning.code, className: 'fade-marker' },
                  h('b', null, '提示'), h('span', null, warning.code), h('span', { className: 'tag' }, warning.severity ?? 'info')))),
              h('div', { className: 'fade-curve-note', style: { marginTop: 10 } },
                '只读曲线：不写卡片、不强化、不归档。what-if 与写库维护留在 0.8.2。')))
    }

    function CharacterSheet({ remote, sessionId, book, name, onClose }) {
      const detail = useCharacter(remote, sessionId, book, name, true)
      const data = detail.data
      return h(Sheet, {
        title: name || '人物记忆',
        subtitle: '只读聚合 · 不是人物档案',
        onClose,
        footer: h('div', { className: 'fade-sheet-note' }, '不生成新事实；没有卡不等于没出场。'),
      },
      detail.phase === 'loading' ? h(Loading, { label: '聚合人物记忆…' }) : null,
      detail.phase === 'error' ? h(ErrorBox, { error: detail.error, onRetry: detail.reload }) : null,
      data && data.found === false ? h(Empty, { title: '记忆里没有这个人物' }, data.message ?? '可以先用 memo_recall 搜一下名字。') : null,
      data && data.found
        ? h(React.Fragment, null,
          h('div', { className: 'fade-card' },
            h('div', { style: { display: 'flex', alignItems: 'baseline', gap: 8 } },
              h('div', { style: { fontSize: 18, fontWeight: 650 } }, data.entity?.name ?? data.name),
              data.entity?.relationship ? h('span', { className: 'fade-sub' }, data.entity.relationship) : null),
            data.entity?.aliases?.length
              ? h('div', { className: 'fade-sub' }, `别名：${data.entity.aliases.join('、')}`)
              : null,
            h('div', { className: 'fade-sub', style: { marginTop: 5 } },
              `出场 ${data.appearances ?? 0} 章 · ${(data.cards ?? []).length} 张卡${data.l0 ? ` · ${data.l0} 张 L0` : ''}`),
            h('div', { className: 'fade-stale', style: { marginTop: 8 } },
              h(Icon, { name: 'alert', size: 13 }),
              h('span', null, data.coverage?.note ?? '当前记忆对这个人物的覆盖不完整。'))),
          h('div', { className: 'fade-sec' }, h('h3', null, '按章记忆'), h('span', null, `${(data.cards ?? []).length} 张`)),
          (data.cards ?? []).length
            ? (data.cards ?? []).map((card) => h('div', { key: card.id, className: 'fade-mcard', style: { cursor: 'default' } },
              h('div', { className: 'fade-mcard-h' },
                h('span', null, `第 ${card.chapter} 章`),
                h('span', { className: 'fade-layer', 'data-l0': card.layer === 'L0' ? '1' : '0' }, card.layer),
                card.pinned ? h('span', { className: 'fade-pin' }, h(Icon, { name: 'pin', size: 10 })) : null),
              h('div', { className: 'fade-mcard-t' }, card.topic),
              card.gist ? h('div', { className: 'fade-mcard-s' }, card.gist) : null,
              h('div', { className: 'fade-mcard-f' },
                h('span', { className: 'fade-mini' }, card.permissionLabel),
                card.quote ? h('span', { className: 'fade-mini' }, `锚句「${card.quote}」`) : null)))
            : h(Empty, { title: '当前记忆中没有相关卡' }, '这不等于没出场；可以继续写，或补 digest。'))
        : null)
    }

    function SourceSheet({ remote, sessionId, book, chapter, query, onClose }) {
      const call = React.useCallback(async () => {
        const value = unwrap(await remote.sourceSlice(sessionId, {
          book, chapter, query: String(query ?? '').trim(),
        }))
        return value
      }, [remote, sessionId, book, chapter, query])
      const result = useRemoteCall(call, [call])
      return h(Sheet, {
        title: `原文 · 第 ${chapter} 章`,
        subtitle: query ? '按锚句定位' : '按章读取',
        onClose,
        footer: h('div', { className: 'fade-sheet-note' }, '原文不是记忆；只用于核对，不要当摘要。'),
      },
      result.phase === 'loading' ? h(Loading, { label: '读原文…' }) : null,
      result.phase === 'error' ? h(ErrorBox, { error: result.error, onRetry: result.reload }) : null,
      result.data ? h(SourceResult, { result: result.data }) : null)
    }

    function companionReason(row) {
      if (!row) return '未加载'
      if (row.reason === 'no-service') return '当前会话没有发现服务；可能未安装、未启用或版本过旧'
      if (row.reason === 'capability-missing') return '服务在，但没有 fade 需要的能力'
      if (row.reason === 'identity-failed') return '服务在，但 identity 读取失败'
      if (row.reason === 'service-unavailable') return '服务没应答；本地账本仍可读'
      return row.reason ?? ''
    }

    function CompanionsSheet({ companions, onClose }) {
      const rows = [
        ['beat', '事件账本', companions?.beat],
        ['voice', '文风', companions?.voice],
        ['fanfic', '同人', companions?.fanfic],
        ['conductor', '编排', companions?.conductor],
      ]
      const stateLabel = (row) => {
        if (!row) return '未加载'
        if (row.state === 'available') return '可用'
        if (row.state === 'adapted') return '已适配'
        if (row.state === 'unknown') return '状态未知'
        return '未发现'
      }
      const tone = (row) => row?.state === 'available' ? 'var(--fade-ok)'
        : row?.state === 'adapted' ? 'var(--fade-warn)'
          : row?.state === 'unknown' ? 'var(--fade-muted)' : 'var(--fade-faint)'
      return h(Sheet, {
        title: '协作状态',
        subtitle: '只读探测 · 不显示安装/启用',
        onClose,
        footer: h('div', { className: 'fade-sheet-note' }, 'fade 只读兄弟账本，不写入；缺席时自动降级。'),
      },
      h('div', { className: 'fade-card' },
        h('div', { className: 'fade-sub', style: { marginBottom: 6 } }, '服务发现只能证明「能力可调用」，不能证明插件已安装或已启用。'),
        rows.map(([key, label, row]) => h('div', { key, style: { padding: '8px 0', borderTop: '1px solid var(--fade-line)' } },
          h('div', { style: { display: 'flex', alignItems: 'center', gap: 7 } },
            h('i', { className: 'fade-dot', style: { color: tone(row) } }),
            h('b', { style: { fontSize: 11 } }, label),
            h('span', { className: 'fade-meta' }, key),
            h('span', { className: 'fade-grow' }),
            h('span', { className: 'fade-sub', style: { color: tone(row) } }, stateLabel(row))),
          h('div', { className: 'fade-sub', style: { marginTop: 3 } },
            row?.version ? `v${row.version}` : '版本未知',
            row?.via ? ` · via ${row.via}` : '',
            row?.file?.status ? ` · 本地账本 ${row.file.status}` : ''),
          h('div', { className: 'fade-sub', style: { color: 'var(--fade-faint)' } }, companionReason(row)),
          row?.capabilities?.length
            ? h('div', { className: 'fade-sub', style: { fontFamily: 'var(--fade-mono)', fontSize: 9, marginTop: 2 } }, row.capabilities.join(' · '))
            : null))),
      h('div', { className: 'fade-sub' }, '契约：adapter-contract v1 · service_version 1'))
    }

    /* __PART2D__ */




    /* ════════════════════════════════════════════════════════════════════════
     * 10. Plugin registration
     * ════════════════════════════════════════════════════════════════════════ */
    function FadeOpenButton(props) {
      return h('button', {
        type: 'button',
        title: '长篇记忆：总览 / 记忆 / 溯源 / 简报',
        onClick: props.open,
        style: {
          appearance: 'none',
          border: '1px solid var(--fade-line, rgba(127,127,127,.24))',
          background: 'transparent',
          color: 'var(--fade-muted, inherit)',
          borderRadius: 7,
          padding: '3px 9px',
          fontSize: 11.5,
          lineHeight: '18px',
          cursor: 'pointer',
          fontFamily: 'inherit',
          marginRight: 6,
        },
      }, '长篇记忆')
    }

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
              description: () => '总览 / 记忆 / 溯源；记忆检索、变更记录、原文与本章简报',
            }],
          }), 'novel-fade: tab type')

          scoped.effect(() => scoped.slots.inject('sidebar.right.pane.tab', () => scoped.slots.register(
            { name: 'sidebar.right.pane.tab', key: TAB_ID, inject: (sessionId) => ({ sessionId, remote }) },
            FadeTab,
          )), 'novel-fade: tab body')

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
