/**
 * Typert remote contract for the session-header switch and the global library.
 *
 * The panel is deliberately workspace-addressed, not session-addressed:
 * a Session is a conversation, a Workspace is the book's directory, and Fade
 * memory belongs to the latter. The mode methods stay session-addressed
 * because /memo on|off is per conversation.
 */

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
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error('sessionId must be a non-empty string')
  }
})

const workspaceIdSchema = scalar((value) => {
  if (typeof value !== 'string' || value.length === 0 || value.length > 128) {
    throw new Error('workspaceId must be a non-empty string, at most 128 characters')
  }
})

const booleanSchema = scalar((value) => {
  if (typeof value !== 'boolean') throw new Error('on must be a boolean')
})

const modeResultSchema = scalar((value) => {
  if (!value || typeof value.on !== 'boolean') {
    throw new Error('result must be { on: boolean }')
  }
})

const bookSchema = scalar((value) => {
  if (typeof value !== 'string' || value.length === 0 || value.length > 64) {
    throw new Error('book must be a non-empty string, at most 64 characters')
  }
})

const chapterSchema = scalar((value) => {
  if (!Number.isInteger(value) || value < 1 || value > 9999) {
    throw new Error('chapter must be an integer from 1 to 9999')
  }
})

const jsonObjectSchema = scalar((value) => {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('expected a JSON object')
  }
})

const panelResultSchema = scalar((value) => {
  if (!value || typeof value !== 'object') throw new Error('panel result must be an object')
})

function strictCodec(typeSymbol, schema) {
  return { mode: 'strict', typeSymbol, create: () => schema }
}

function parameter(name, schema) {
  return { name, wire: name, source: 'json', codec: strictCodec(name, schema) }
}

const methods = [
  ['status', 'memoMode', [parameter('sessionId', sessionIdSchema)], modeResultSchema],
  ['setMode', 'memoMode', [parameter('sessionId', sessionIdSchema), parameter('on', booleanSchema)], modeResultSchema],
  // v0.6 — every read method is session-addressed: the right-sidebar tab belongs
  // to a Session, and the Host resolves the book from the Session's workspace.
  ['panel', 'memoMode', [parameter('sessionId', sessionIdSchema), parameter('options', jsonObjectSchema)], panelResultSchema],
  ['curve', 'memoMode', [parameter('sessionId', sessionIdSchema), parameter('options', jsonObjectSchema)], panelResultSchema],
  ['chapter', 'memoMode', [parameter('sessionId', sessionIdSchema), parameter('options', jsonObjectSchema)], panelResultSchema],
  ['sourceIndex', 'memoMode', [parameter('sessionId', sessionIdSchema), parameter('options', jsonObjectSchema)], panelResultSchema],
  ['sourceSlice', 'memoMode', [parameter('sessionId', sessionIdSchema), parameter('options', jsonObjectSchema)], panelResultSchema],
  ['brief', 'memoMode', [parameter('sessionId', sessionIdSchema), parameter('options', jsonObjectSchema)], panelResultSchema],
  ['timeline', 'memoMode', [parameter('sessionId', sessionIdSchema), parameter('options', jsonObjectSchema)], panelResultSchema],
  ['character', 'memoMode', [parameter('sessionId', sessionIdSchema), parameter('options', jsonObjectSchema)], panelResultSchema],
  ['artifact', 'memoMode', [parameter('sessionId', sessionIdSchema), parameter('options', jsonObjectSchema)], panelResultSchema],
]

export const DESCRIPTORS = methods.map(([method, service, parameters, result]) => ({
  id: `dsh-novel-fade#${service}/${method}`,
  namespace: service,
  service,
  method,
  invocation: { kind: 'direct' },
  parameters,
  result: strictCodec(method === 'status' || method === 'setMode' ? 'FadeMode' : 'FadePanel', result),
}))

export const TYPERT_REMOTE = { package: 'dsh-novel-fade', descriptors: DESCRIPTORS }
