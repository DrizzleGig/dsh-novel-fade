/**
 * Host half of the session-header switch and the read-only sidebar panel.
 *
 * The Client cannot call a Host command directly with a session id; it mounts
 * this Typert remote instead. The mode methods resolve the Agent from the
 * session id and delegate to the existing /memo command so the command and the
 * button share one implementation. Panel methods resolve the active workspace
 * and return read-only snapshots; they never call a model.
 */
var __runInitializers = (this && this.__runInitializers) || function (thisArg, initializers, value) {
  var useValue = arguments.length > 2
  for (var i = 0; i < initializers.length; i++) {
    value = useValue ? initializers[i].call(thisArg, value) : initializers[i].call(thisArg)
  }
  return useValue ? value : void 0
}
var __esDecorate = (this && this.__esDecorate) || function (ctor, descriptorIn, decorators, contextIn, initializers, extraInitializers) {
  function accept(f) { if (f !== void 0 && typeof f !== 'function') throw new TypeError('Function expected'); return f }
  var kind = contextIn.kind, key = kind === 'getter' ? 'get' : kind === 'setter' ? 'set' : 'value'
  var target = !descriptorIn && ctor ? contextIn['static'] ? ctor : ctor.prototype : null
  var descriptor = descriptorIn || (target ? Object.getOwnPropertyDescriptor(target, contextIn.name) : {})
  var _, done = false
  for (var i = decorators.length - 1; i >= 0; i--) {
    var context = {}
    for (var p in contextIn) context[p] = p === 'access' ? {} : contextIn[p]
    for (var p in contextIn.access) context.access[p] = contextIn.access[p]
    context.addInitializer = function (f) { if (done) throw new Error('Cannot add initializers after decoration has completed'); extraInitializers.push(accept(f || null)) }
    var result = (0, decorators[i])(kind === 'accessor' ? { get: descriptor.get, set: descriptor.set } : descriptor[key], context)
    if (kind === 'accessor') {
      if (result === void 0) continue
      if (result === null || typeof result !== 'object') throw new Error('Object expected')
      if (_ = accept(result.get)) descriptor.get = _
      if (_ = accept(result.set)) descriptor.set = _
      if (_ = accept(result.init)) initializers.unshift(_)
    } else if (_ = accept(result)) {
      if (kind === 'field') initializers.unshift(_)
      else descriptor[key] = _
    }
  }
  if (target) Object.defineProperty(target, contextIn.name, descriptor)
  done = true
}

import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import { SessionId } from '@deepseek-ai/dsh-session'
import { DESCRIPTORS } from './remote-contract.js'
import { resolve } from 'node:path'
import { getSessionMode, readMemory } from './store.js'
import { readLibrary } from './library.js'
import { readPanelBooks, readPanelSnapshot, readBriefPreview, readCurve, readChapterDetail } from './panel.js'
import { readSourceIndex, readSourceSlice } from './source.js'

let FadeRemote = (() => {
  let _classSuper = TypertRemoteService
  let _instanceExtraInitializers = []
  let _status_decorators
  let _setMode_decorators
  let _panel_decorators
  let _curve_decorators
  let _chapter_decorators
  let _sourceIndex_decorators
  let _sourceSlice_decorators
  let _brief_decorators
  return class FadeRemote extends _classSuper {
    static {
      const _metadata = typeof Symbol === 'function' && Symbol.metadata ? Object.create(_classSuper[Symbol.metadata] ?? null) : void 0
      _status_decorators = [Remote('status')]
      _setMode_decorators = [Remote('setMode')]
      _panel_decorators = [Remote('panel')]
      _curve_decorators = [Remote('curve')]
      _chapter_decorators = [Remote('chapter')]
      _sourceIndex_decorators = [Remote('sourceIndex')]
      _sourceSlice_decorators = [Remote('sourceSlice')]
      _brief_decorators = [Remote('brief')]
      __esDecorate(this, null, _status_decorators, { kind: 'method', name: 'status', static: false, private: false, access: { has: (obj) => 'status' in obj, get: (obj) => obj.status }, metadata: _metadata }, null, _instanceExtraInitializers)
      __esDecorate(this, null, _setMode_decorators, { kind: 'method', name: 'setMode', static: false, private: false, access: { has: (obj) => 'setMode' in obj, get: (obj) => obj.setMode }, metadata: _metadata }, null, _instanceExtraInitializers)
      __esDecorate(this, null, _panel_decorators, { kind: 'method', name: 'panel', static: false, private: false, access: { has: (obj) => 'panel' in obj, get: (obj) => obj.panel }, metadata: _metadata }, null, _instanceExtraInitializers)
      __esDecorate(this, null, _curve_decorators, { kind: 'method', name: 'curve', static: false, private: false, access: { has: (obj) => 'curve' in obj, get: (obj) => obj.curve }, metadata: _metadata }, null, _instanceExtraInitializers)
      __esDecorate(this, null, _chapter_decorators, { kind: 'method', name: 'chapter', static: false, private: false, access: { has: (obj) => 'chapter' in obj, get: (obj) => obj.chapter }, metadata: _metadata }, null, _instanceExtraInitializers)
      __esDecorate(this, null, _sourceIndex_decorators, { kind: 'method', name: 'sourceIndex', static: false, private: false, access: { has: (obj) => 'sourceIndex' in obj, get: (obj) => obj.sourceIndex }, metadata: _metadata }, null, _instanceExtraInitializers)
      __esDecorate(this, null, _sourceSlice_decorators, { kind: 'method', name: 'sourceSlice', static: false, private: false, access: { has: (obj) => 'sourceSlice' in obj, get: (obj) => obj.sourceSlice }, metadata: _metadata }, null, _instanceExtraInitializers)
      __esDecorate(this, null, _brief_decorators, { kind: 'method', name: 'brief', static: false, private: false, access: { has: (obj) => 'brief' in obj, get: (obj) => obj.brief }, metadata: _metadata }, null, _instanceExtraInitializers)
      if (_metadata) Object.defineProperty(this, Symbol.metadata, { enumerable: true, configurable: true, writable: true, value: _metadata })
    }

    static inject = ['agents', 'commands', 'workingDirectory', 'typert']

    constructor(ctx) {
      super(ctx, 'memoMode')
      __runInitializers(this, _instanceExtraInitializers)
      ctx.typert.register({
        package: 'dsh-novel-fade',
        face: 'host',
        schemas: [],
        model: { services: [], events: [], objects: [] },
        invocations: DESCRIPTORS,
      })
    }

    agent(id) {
      const agent = this.ctx.agents.get(SessionId(id))
      if (!agent) throw new Error('会话尚未加载或已关闭，请重新打开会话后重试。')
      return agent
    }

    async status(id) {
      const agent = this.agent(id)
      const dir = await this.ctx.workingDirectory.ensure(agent)
      const { mode } = await getSessionMode(dir, agent.id)
      return { on: mode === 'on' }
    }

    async setMode(id, on) {
      if (typeof on !== 'boolean') throw new Error('on 必须是布尔值。')
      const agent = this.agent(id)
      const result = await this.ctx.commands.execute(agent, on ? '/memo on' : '/memo off', [], new AbortController().signal)
      if (!result) throw new Error('/memo 命令未注册，请重载后端。')
      if (result.result.kind !== 'success') throw new Error(result.result.text || '/memo 命令执行失败。')
      const dir = await this.ctx.workingDirectory.ensure(agent)
      const { mode } = await getSessionMode(dir, agent.id)
      return { on: mode === 'on' }
    }

    /**
     * Resolve a Session to its book. The right-sidebar tab is session-scoped, so
     * every read method below is addressed by session id, never by a workspace
     * id the Client would have to guess.
     */
    async context(id) {
      const agent = this.agent(id)
      const dir = await this.ctx.workingDirectory.ensure(agent)
      let books = []
      try {
        books = await readPanelBooks(dir)
      } catch {
        books = []
      }
      if (books.length === 0) {
        try {
          const library = await readLibrary()
          const entries = library.books.filter((entry) => entry?.workspacePath && resolve(entry.workspacePath) === resolve(dir))
          books = entries.map((entry) => ({
            book: entry.book,
            title: entry.title || entry.book,
            chapters: entry.chapters || 0,
            cards: entry.cards || 0,
            stale: true,
          }))
        } catch {
          books = []
        }
      }
      return { dir, books, book: books[0]?.book ?? null }
    }

    async nextChapter(dir, book) {
      const { memory } = await readMemory(dir, book)
      if (!memory) return 1
      const numbers = Object.keys(memory.chapters ?? {}).map(Number).filter(Number.isFinite)
      return (numbers.length ? Math.max(...numbers) : 0) + 1
    }

    /** 一个工作区可能有好几本书；options.book 落在列表里才认，否则用第一本。 */
    resolveBook(scene, options) {
      const wanted = typeof options?.book === 'string' ? options.book : ''
      if (wanted && scene.books.some((entry) => entry.book === wanted)) return wanted
      return scene.book
    }

    async panel(id, options = {}) {
      const scene = await this.context(id)
      if (!scene.book) {
        return {
          ok: true,
          snapshotVersion: 2,
          exists: false,
          book: null,
          books: [],
          workspacePath: scene.dir,
          message: '这个工作区还没有 fade 记忆；先 /memo on，写完一章跑 memo_digest。',
        }
      }
      const book = this.resolveBook(scene, options)
      const requested = Number.isInteger(options?.chapter) && options.chapter > 0
        ? options.chapter
        : await this.nextChapter(scene.dir, book)
      const snapshot = await readPanelSnapshot(scene.dir, book, { chapter: requested, filters: options ?? {} })
      return {
        ...snapshot,
        workspacePath: scene.dir,
        books: scene.books,
        requestedChapter: requested,
      }
    }

    async curve(id, options = {}) {
      const scene = await this.context(id)
      if (!scene.book) {
        return { ok: true, exists: false, book: null, series: options?.series ?? 'cards', lines: [], threshold: 0.55 }
      }
      const book = this.resolveBook(scene, options)
      const chapter = Number.isInteger(options?.chapter) && options.chapter > 0
        ? options.chapter
        : await this.nextChapter(scene.dir, book)
      const curve = await readCurve(scene.dir, book, { series: options?.series, chapter, points: options?.points })
      return { ...curve, workspacePath: scene.dir }
    }

    async chapter(id, options = {}) {
      const scene = await this.context(id)
      if (!scene.book) {
        return { ok: true, exists: false, book: null, chapter: options?.chapter ?? null, message: '这个工作区还没有 fade 记忆。' }
      }
      const book = this.resolveBook(scene, options)
      const chapter = Number.isInteger(options?.chapter) && options.chapter > 0
        ? options.chapter
        : await this.nextChapter(scene.dir, book)
      const detail = await readChapterDetail(scene.dir, book, { chapter })
      return { ...detail, workspacePath: scene.dir, books: scene.books }
    }

    async sourceIndex(id, options = {}) {
      const scene = await this.context(id)
      if (!scene.book) return { ok: true, exists: false, enabled: false, chapters: [], bytes: 0 }
      const book = this.resolveBook(scene, options)
      const index = await readSourceIndex(scene.dir, book)
      return {
        ok: true,
        exists: true,
        book,
        enabled: index.enabled !== false,
        chapters: index.chapters.map(({ chapter, title, chars, at }) => ({ chapter, title, chars, at })),
        bytes: index.bytes,
        updatedAt: index.updatedAt,
      }
    }

    async sourceSlice(id, options = {}) {
      const scene = await this.context(id)
      if (!scene.book) return { ok: false, code: 'no-book', message: '这个工作区还没有 fade 记忆。' }
      const book = this.resolveBook(scene, options)
      return await readSourceSlice(scene.dir, book, options ?? {})
    }

    async brief(id, options = {}) {
      const scene = await this.context(id)
      if (!scene.book) return { ok: false, error: 'no-book', message: '这个工作区还没有 fade 记忆。' }
      const book = this.resolveBook(scene, options)
      const chapter = Number.isInteger(options?.chapter) && options.chapter > 0
        ? options.chapter
        : await this.nextChapter(scene.dir, book)
      const preview = await readBriefPreview(scene.dir, book, {
        chapter,
        scene: options?.scene ?? {},
        mode: options?.mode ?? 'chapter',
        ...(options?.budget == null ? {} : { budget: options.budget }),
      })
      return { ...preview, workspacePath: scene.dir }
    }

  }
})()

export default FadeRemote
