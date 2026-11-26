import { classifySensitivity, sensitivityForSync } from './sensitivity.js'

// Knowledge handed to the model through kb_search during the current turn.
const citedLog = []
const updatedLog = []

export function takeUpdatedSince(sinceMs) {
  const out = []
  for (const row of updatedLog) if (row.at >= sinceMs) out.push(row.id)
  return out
}

export function takeCitedSince(sinceMs) {
  const ids = []
  for (const row of citedLog) {
    if (row.at >= sinceMs && !ids.includes(row.id)) ids.push(row.id)
  }
  return ids
}

export function clearCitedBefore(ms) {
  while (citedLog.length && citedLog[0].at < ms) citedLog.shift()
}

const textOutput = {
  schema: { type: 'object', additionalProperties: true },
  render: (_args, value) => [{ type: 'text', text: JSON.stringify(value, null, 2) }],
}

const PROPERTY_TYPES = new Set(['string', 'number', 'integer', 'boolean'])

/**
 * ctx.tools.register expects a compiled JSON Schema in `parameters`
 * (defineTool would do this for us), so compile the property map here.
 */
function compileParameters(spec = {}) {
  const properties = {}
  const required = []
  for (const [name, property] of Object.entries(spec)) {
    if (!property || !PROPERTY_TYPES.has(property.type)) {
      throw new Error(`unsupported parameter type for ${name}`)
    }
    const node = { type: property.type }
    if (property.description) node.description = property.description
    properties[name] = node
    if (property.required === true) required.push(name)
  }
  const schema = { type: 'object', properties }
  if (required.length) schema.required = required
  return schema
}

function defineTool(definition) {
  return {
    ...definition,
    parameters: compileParameters(definition.parameters),
    output: definition.output ?? textOutput,
  }
}

function parseColumns(json) {
  if (!json) return []
  try {
    const value = JSON.parse(json)
    if (!Array.isArray(value)) throw new Error('columnsJson must be a JSON array')
    return value
  } catch (error) {
    throw new Error(`columnsJson is not valid JSON: ${error.message}`)
  }
}

export function registerKnowledgeTools(ctx, getStore) {
  const store = async () => getStore()

  const disposers = []

  disposers.push(
    ctx.tools.register(
      defineTool({
        name: 'kb_catalog',
        description:
          'List knowledge libraries and their tables. Call it before searching when you do not know which library holds the answer.',
        parameters: {
          library: { type: 'string', description: 'Optional library name; omit to list every library' },
        },
        async execute(args) {
          const s = await store()
          const libraries = s.listLibraries()
          if (args.library) {
            return { libraries, library: args.library, catalog: s.listCatalog(args.library) }
          }
          return {
            libraries: libraries.map((lib) => ({ ...lib, catalog: s.listCatalog(lib.name) })),
          }
        },
      }),
    ),
  )

  disposers.push(
    ctx.tools.register(
      defineTool({
        name: 'kb_search',
        description:
          'Search recorded knowledge. Supports Chinese substring matching plus session, tag, time, source and sensitivity filters, and relevance or time order.',
        parameters: {
          query: { type: 'string', description: 'Keywords; 3+ characters use full-text, shorter uses substring', required: true },
          library: { type: 'string', description: 'Library name; omit to search every library' },
          sessionId: { type: 'string' },
          tag: { type: 'string' },
          from: { type: 'string', description: 'ISO time lower bound' },
          to: { type: 'string', description: 'ISO time upper bound' },
          source: { type: 'string', description: 'agent | human | subagent' },
          sensitivity: { type: 'string', description: 'safe | uncertain | sensitive' },
          sort: { type: 'string', description: 'relevance | time' },
          limit: { type: 'number' },
        },
        async execute(args) {
          const s = await store()
          const libs = args.library ? [args.library] : s.listLibraries().map((l) => l.name)
          const groups = []
          for (const lib of libs) {
            try {
              const hits = s.search(lib, { ...args, q: args.query })
              if (hits.length) {
                groups.push({ library: lib, hits })
                const at = Date.now()
                for (const hit of hits) citedLog.push({ id: hit.id, at })
              }
            } catch {
              // an unopened or removed library must not fail the whole search
            }
          }
          return { query: args.query, groups }
        },
      }),
    ),
  )

  disposers.push(
    ctx.tools.register(
      defineTool({
        name: 'kb_record',
        description:
          'Record one knowledge point the user explicitly praised or tacitly accepted. One fact per call; never record credentials, secrets, private or company-sensitive content.',
        parameters: {
          title: { type: 'string', required: true },
          body: { type: 'string', required: true },
          tags: { type: 'string' },
          tier: { type: 'string', description: 'accepted | tentative' },
          sensitivity: { type: 'string', description: 'safe | uncertain | sensitive hint; keyword rules may override' },
          library: { type: 'string', description: 'Defaults to dsh-main' },
          sessionId: { type: 'string' },
          turnId: { type: 'string' },
        },
        async execute(args) {
          const s = await store()
          const library = args.library || 'dsh-main'
          const sensitivity = classifySensitivity(`${args.title}\n${args.body}`, args.sensitivity)
          const result = await s.record(library, {
            title: args.title,
            body: args.body,
            tags: args.tags,
            tier: args.tier === 'accepted' ? 'accepted' : 'tentative',
            sensitivity,
            sessionId: args.sessionId,
            turnId: args.turnId,
            source: 'agent',
            createdBy: 'agent',
          })
          if (result.revision) updatedLog.push({ id: result.id, at: Date.now() })
          return { ...result, library, sensitivity, syncable: sensitivityForSync(sensitivity) }
        },
      }),
    ),
  )

  disposers.push(
    ctx.tools.register(
      defineTool({
        name: 'kb_create_table',
        description:
          'Create a topic table inside a library and register it in the library catalog and the global catalog. Pass extra columns as a JSON array string in columnsJson, e.g. [{"name":"env","type":"text"}].',
        parameters: {
          library: { type: 'string', required: true },
          table: { type: 'string', required: true, description: 'Lower-case snake_case table name' },
          title: { type: 'string' },
          description: { type: 'string' },
          columnsJson: { type: 'string', description: 'Optional JSON array of {name, type: text|integer}' },
        },
        async execute(args) {
          const s = await store()
          return s.createTable(args.library, {
            table: args.table,
            title: args.title,
            description: args.description,
            columns: parseColumns(args.columnsJson),
          })
        },
      }),
    ),
  )

  disposers.push(
    ctx.tools.register(
      defineTool({
        name: 'kb_create_library',
        description: 'Create a local library for a topic. The name must start with agent-.',
        parameters: {
          name: { type: 'string', required: true, description: 'agent- prefixed library name' },
          originHost: { type: 'string' },
        },
        async execute(args) {
          const s = await store()
          return s.ensureLibrary(args.name, { kind: 'agent', createdBy: 'agent', originHost: args.originHost })
        },
      }),
    ),
  )

  return disposers
}
