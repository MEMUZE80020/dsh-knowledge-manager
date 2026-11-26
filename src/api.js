import { appendFileSync, cpSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { homedir } from 'node:os'
import { createMysqlRemote } from './core/remote.js'
import { syncAllLibraries } from './core/sync-all.js'

function json(res, status, body) {
  const payload = JSON.stringify(body)
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'access-control-allow-origin': '*',
    'access-control-allow-headers': 'content-type',
    'access-control-allow-methods': 'GET, POST, OPTIONS',
  })
  res.end(payload)
}

async function readJson(req) {
  const chunks = []
  for await (const chunk of req) chunks.push(chunk)
  if (!chunks.length) return {}
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'))
  } catch {
    return {}
  }
}

export function createApiHandler(getStore, options = {}) {
  return async (req, res) => {
    try {
      const store = await getStore()
      const url = new URL(req.url, 'http://local')
      const path = url.pathname.replace(/^\/kb-api\/?/, '')
      const q = url.searchParams

      if (req.method === 'OPTIONS') {
        res.writeHead(204, {
          'access-control-allow-origin': '*',
          'access-control-allow-headers': 'content-type',
          'access-control-allow-methods': 'GET, POST, OPTIONS',
        })
        return res.end()
      }
      if (req.method === 'GET' || req.method === 'HEAD') {
        if (path === '' || path === 'state') {
          return json(res, 200, {
            libraries: store.statsAll(),
            queue: store.meta.prepare('SELECT lib, op, attempts, last_error AS lastError, created_at AS createdAt FROM kb_queue ORDER BY created_at DESC').all(),
            backups: store.listBackups(),
            uncertain: store.listLibraries().reduce((acc, lib) => acc + store.listUncertain(lib.name).length, 0),
          })
        }
        if (path === 'search') {
          const library = q.get('lib') || ''
          const libs = library ? [library] : store.listLibraries().map((l) => l.name)
          const groups = []
          let total = 0
          for (const lib of libs) {
            try {
              total += store.countSearch(lib, {
                q: q.get('q') || '',
                sessionId: q.get('sessionId') || '',
                tag: q.get('tag') || '',
                from: q.get('from') || '',
                to: q.get('to') || '',
                source: q.get('source') || '',
                sensitivity: q.get('sensitivity') || '',
              })
              const hits = store.search(lib, {
                q: q.get('q') || '',
                sessionId: q.get('sessionId') || '',
                tag: q.get('tag') || '',
                from: q.get('from') || '',
                to: q.get('to') || '',
                source: q.get('source') || '',
                sensitivity: q.get('sensitivity') || '',
                sort: q.get('sort') || 'relevance',
                limit: Number(q.get('limit') || 30),
                offset: Number(q.get('offset') || 0),
              })
              if (hits.length) groups.push({ library: lib, hits })
            } catch {
              /* skip unopened library */
            }
          }
          return json(res, 200, { groups, total })
        }
        if (path === 'entry') {
          const lib = q.get('lib')
          const id = q.get('id')
          return json(res, 200, {
            entry: store.getEntry(lib, id),
            revisions: store.listRevisions(lib, id),
            attachments: store.listAttachments(lib, id),
          })
        }
        if (path === 'uncertain') {
          const libs = store.listLibraries().map((l) => ({ library: l.name, items: store.listUncertain(l.name) }))
          return json(res, 200, { groups: libs.filter((g) => g.items.length) })
        }
        if (path === 'recent') {
          const since = q.get('since') || ''
          const groups = store.listLibraries().map((l) => ({
            library: l.name,
            items: store.recent(l.name, { since, limit: Number(q.get('limit') || 50) }),
          }))
          return json(res, 200, { groups: groups.filter((g) => g.items.length) })
        }
        if (path === 'trash') {
          const groups = store.listLibraries().map((l) => ({ library: l.name, items: store.listTombstones(l.name) }))
          return json(res, 200, { groups: groups.filter((g) => g.items.length) })
        }
        if (path === 'tool-schemas') {
          const { registerKnowledgeTools } = await import('./tools.js')
          const captured = []
          registerKnowledgeTools(
            { tools: { register: (definition) => (captured.push(definition), () => {}) } },
            async () => null,
          )
          const candidates = [
            `${process.resourcesPath}/app.asar/dsh/node_modules/@deepseek-ai/dsh-tools/lib/index.js`,
            `${process.resourcesPath}/app.asar/node_modules/@deepseek-ai/dsh-tools/lib/index.js`,
          ]
          let compiler
          let compilerPath = ''
          for (const candidate of candidates) {
            try {
              compiler = await import(`file:///${candidate.replace(/\\/g, '/')}`)
              compilerPath = candidate
              break
            } catch {
              /* try next */
            }
          }
          if (!compiler) return json(res, 500, { error: 'dsh-tools not resolvable', candidates })
          return json(
            res,
            200,
            {
              compilerPath,
              tools: captured.map((tool) => ({
                name: tool.name,
                parameters:
                  tool.parameters?.type === 'object'
                    ? tool.parameters
                    : compiler.parameterSchemaSpecToJsonSchema(tool.parameters),
              })),
            },
          )
        }
        if (path === 'connections') {
          return json(res, 200, { connections: store.listConnections() })
        }
        if (path === 'backups') {
          return json(res, 200, { backups: store.listBackups(q.get('lib') || undefined) })
        }
        if (path === 'session-knowledge') {
          const sessionId = q.get('sessionId') || ''
          const rows = sessionId
            ? store.meta.prepare('SELECT turn_id, created_ids, cited_ids FROM kb_turn WHERE session_id = ? ORDER BY created_at DESC').all(sessionId)
            : []
          const ids = []
          for (const row of rows) {
            for (const raw of [row.created_ids, row.cited_ids]) {
              try {
                for (const id of JSON.parse(raw || '[]')) if (!ids.includes(id)) ids.push(id)
              } catch {
                /* skip malformed */
              }
            }
          }
          const groups = []
          for (const lib of store.listLibraries()) {
            const items = []
            for (const id of ids) {
              const entry = store.getEntry(lib.name, id)
              if (entry) items.push({ id: entry.id, title: entry.title, tags: entry.tags, sensitivity: entry.sensitivity, updatedAt: entry.updatedAt })
            }
            if (items.length) groups.push({ library: lib.name, items })
          }
          return json(res, 200, { sessionId, groups })
        }
        if (path === 'update-check') {
          try {
            const resp = await fetch('https://registry.npmjs.org/dsh-knowledge-manager/latest', { headers: { accept: 'application/json' } })
            const data = await resp.json()
            return json(res, 200, {
              latest: String(data.version || ''),
              url: 'https://www.npmjs.com/package/dsh-knowledge-manager',
              name: 'npm',
              body: String(data.description || ''),
            })
          } catch (error) {
            return json(res, 200, { latest: '', error: String(error?.message ?? error) })
          }
        }
        if (path === 'self-update') {
          const root = dirname(dirname(fileURLToPath(import.meta.url)))
          try {
            const meta = await (await fetch('https://registry.npmjs.org/dsh-knowledge-manager/latest', { headers: { accept: 'application/json' } })).json()
            const tarball = String(meta?.dist?.tarball || '')
            if (!tarball) return json(res, 200, { ok: false, error: 'npm 上没有找到包' })
            const buf = Buffer.from(await (await fetch(tarball)).arrayBuffer())
            const tmp = mkdtempSync(join(tmpdir(), 'kb-upd-'))
            const tgz = join(tmp, 'pkg.tgz')
            writeFileSync(tgz, buf)
            const out = join(tmp, 'x')
            execFileSync('tar', ['-xzf', tgz, '-C', tmp], { windowsHide: true })
            const base = join(tmp, 'package')
            for (const name of readdirSync(base)) cpSync(join(base, name), join(root, name), { recursive: true, force: true })
            rmSync(tmp, { recursive: true, force: true })
            return json(res, 200, { ok: true, needsRestart: true, version: String(meta.version || '') })
          } catch (error) {
            return json(res, 200, { ok: false, error: String(error?.message ?? error) })
          }
        }
        if (path === 'recent-updated') {
          const since = q.get('since') || new Date(new Date().setHours(0, 0, 0, 0)).toISOString()
          const ids = []
          for (const row of store.meta.prepare('SELECT updated_ids FROM kb_turn WHERE created_at >= ?').all(since)) {
            try {
              for (const id of JSON.parse(row.updated_ids || '[]')) if (!ids.includes(id)) ids.push(id)
            } catch {
              /* ignore */
            }
          }
          const groups = []
          for (const lib of store.listLibraries()) {
            const items = []
            for (const id of ids) {
              const entry = store.getEntry(lib.name, id)
              if (entry) items.push(entry)
            }
            if (items.length) groups.push({ library: lib.name, items })
          }
          return json(res, 200, { groups })
        }
        if (path === 'snapshot-states') {
          const states = {}
          for (const row of store.meta.prepare('SELECT states FROM kb_turn ORDER BY created_at').all()) {
            try {
              for (const [id, value] of Object.entries(JSON.parse(row.states || '{}'))) if (!states[id]) states[id] = value
            } catch {
              /* ignore */
            }
          }
          return json(res, 200, { states })
        }
        if (path === 'settings') {
          const defaults = {
            syncIntervalSec: 60,
            startupBackup: true,
            backupRetentionDays: 30,
            defaultSensitiveKeywords: ['密码','口令','token','密钥','身份证','手机号','合同','营收','客户名单'].join(String.fromCharCode(10)),
            attachmentMaxMB: 20,
            attachmentMaxTotalMB: 1024,
            injectMaxEntries: 3,
            injectMaxChars: 600,
          }
          if (req.method === 'POST') {
            const body = await readJson(req)
            return json(res, 200, { ok: true, settings: { ...defaults, ...store.setSettings(body.settings || {}) } })
          }
          return json(res, 200, { settings: { ...defaults, ...store.listSettings() } })
        }
        if (path === 'entries-by-ids') {
          const body = q.get('ids') ? { ids: q.get('ids').split(',').filter(Boolean) } : await readJson(req)
          const ids = Array.isArray(body.ids) ? body.ids : []
          const entries = []
          for (const lib of store.listLibraries()) {
            for (const id of ids) {
              const entry = store.getEntry(lib.name, id)
              if (entry) entries.push({ library: lib.name, entry })
            }
          }
          return json(res, 200, { entries })
        }
        if (path === 'turn-window') {
          const sessionId = q.get('sessionId') || ''
          const from = q.get('from') || ''
          const to = q.get('to') || ''
          const rows = sessionId
            ? store.meta
                .prepare('SELECT turn_id, created_ids, cited_ids, updated_ids, states, created_at FROM kb_turn WHERE session_id = ? AND created_at >= ? AND created_at <= ? ORDER BY created_at')
                .all(sessionId, from, to)
            : []
          const created = []
          const cited = []
          const updated = []
          const states = {}
          for (const row of rows) {
            try {
              for (const id of JSON.parse(row.created_ids || '[]')) if (!created.includes(id)) created.push(id)
            } catch {
              /* ignore */
            }
            try {
              for (const id of JSON.parse(row.cited_ids || '[]')) if (!cited.includes(id)) cited.push(id)
            } catch {
              /* ignore */
            }
            try {
              for (const id of JSON.parse(row.updated_ids || '[]')) if (!updated.includes(id)) updated.push(id)
            } catch {
              /* ignore */
            }
          }
          for (const row of rows) {
            try {
              Object.assign(states, JSON.parse(row.states || '{}'))
            } catch {
              /* ignore */
            }
          }
          return json(res, 200, { turns: rows, created, updated, states, cited: cited.filter((id) => !created.includes(id) && !updated.includes(id)) })
        }
        if (path === 'turn') {
          if (q.get('latest') === '1' && q.get('sessionId')) {
            const latest = store.latestTurn(q.get('sessionId'))
            const fresh = latest && Date.now() - Date.parse(latest.createdAt) < 10 * 60_000
            const ids = new Set([...(fresh ? latest.cited ?? [] : []), ...(fresh ? latest.created ?? [] : [])])
            const entries = []
            for (const lib of store.listLibraries()) {
              for (const id of ids) {
                const entry = store.getEntry(lib.name, id)
                if (entry) entries.push({ library: lib.name, entry })
              }
            }
            return json(res, 200, { turn: fresh ? latest : null, entries })
          }
          const turn = q.has('messageId')
            ? store.turnByMessage(q.get('messageId') || '')
            : q.has('turnId')
              ? store.getTurn(q.get('turnId') || '')
              : store.latestTurn(q.get('sessionId') || '')
          const entryIds = new Set([...(turn?.cited ?? []), ...(turn?.created ?? [])])
          const entries = []
          for (const lib of store.listLibraries()) {
            for (const id of entryIds) {
              const entry = store.getEntry(lib.name, id)
              if (entry) entries.push({ library: lib.name, entry })
            }
          }
          return json(res, 200, { turn, entries })
        }
        if (path === 'deploy') {
          const { readFileSync } = await import('node:fs')
          const { join } = await import('node:path')
          try {
            const text = readFileSync(join(import.meta.dirname, '..', 'docs', 'DEPLOY.md'), 'utf8')
            res.writeHead(200, { 'content-type': 'text/markdown; charset=utf-8', 'cache-control': 'no-store' })
            return res.end(text)
          } catch {
            return json(res, 404, { error: 'DEPLOY.md not found' })
          }
        }
        return json(res, 404, { error: `unknown endpoint: ${path}` })
      }

      if (req.method === 'POST') {
        const body = await readJson(req)
        if (path === 'wipe-all') {
          const result = await store.wipeAll()
          return json(res, 200, result)
        }
        if (path === 'clear-traces') {
          const turns = store.meta.prepare('DELETE FROM kb_turn').run()
          store.meta.prepare('DELETE FROM kb_attrib').run()
          try { store.meta.prepare('DELETE FROM kb_undo').run() } catch { /* optional */ }
          return json(res, 200, { ok: true, cleared: Number(turns.changes || 0) })
        }
        if (path === 'recent-updated') {
          const since = q.get('since') || new Date(new Date().setHours(0, 0, 0, 0)).toISOString()
          const ids = []
          for (const row of store.meta.prepare('SELECT updated_ids FROM kb_turn WHERE created_at >= ?').all(since)) {
            try {
              for (const id of JSON.parse(row.updated_ids || '[]')) if (!ids.includes(id)) ids.push(id)
            } catch {
              /* ignore */
            }
          }
          const groups = []
          for (const lib of store.listLibraries()) {
            const items = []
            for (const id of ids) {
              const entry = store.getEntry(lib.name, id)
              if (entry) items.push(entry)
            }
            if (items.length) groups.push({ library: lib.name, items })
          }
          return json(res, 200, { groups })
        }
        if (path === 'snapshot-states') {
          const states = {}
          for (const row of store.meta.prepare('SELECT states FROM kb_turn ORDER BY created_at').all()) {
            try {
              for (const [id, value] of Object.entries(JSON.parse(row.states || '{}'))) if (!states[id]) states[id] = value
            } catch {
              /* ignore */
            }
          }
          return json(res, 200, { states })
        }
        if (path === 'settings') {
          const defaults = {
            syncIntervalSec: 60,
            startupBackup: true,
            backupRetentionDays: 30,
            defaultSensitiveKeywords: ['密码','口令','token','密钥','身份证','手机号','合同','营收','客户名单'].join(String.fromCharCode(10)),
            attachmentMaxMB: 20,
            attachmentMaxTotalMB: 1024,
            injectMaxEntries: 3,
            injectMaxChars: 600,
          }
          return json(res, 200, { ok: true, settings: { ...defaults, ...store.setSettings(body.settings || {}) } })
        }
        if (path === 'delete') {
          const ids = body.ids ?? []
          if (ids.length) await store.snapshotRows(body.lib, ids, 'delete')
          return json(res, 200, await store.deleteMany(body.lib, ids, 'user'))
        }
        if (path === 'classify') {
          return json(res, 200, await store.classify(body.lib, body.ids ?? [], body.to))
        }
        if (path === 'restore') {
          let restored = 0
          for (const id of body.ids ?? []) {
            const out = await store.restoreEntry(body.lib, id)
            if (out.restored) restored += 1
          }
          return json(res, 200, { restored })
        }
        if (path === 'restore-backup') {
          return json(res, 200, await store.restoreBackup(body.path))
        }
        if (path === 'test-connection') {
          const remote = createMysqlRemote(body)
          try {
            const databases = await remote.listDatabases()
            return json(res, 200, { ok: true, databases })
          } catch (error) {
            return json(res, 200, { ok: false, error: String(error?.message ?? error) })
          } finally {
            await remote.close()
          }
        }
        if (path === 'connect/save') {
          const conn = await store.saveConnection({
            host: body.host,
            port: body.port,
            user: body.user,
            tls: body.tls,
          })
          if (body.password && options.credentials?.modifyRecord) {
            await options.credentials.modifyRecord(`dsh-knowledge-manager/${conn.id}`, async () => ({
              kind: 'database-login',
              payload: { password: body.password, host: body.host, user: body.user },
            }))
          }
          return json(res, 200, { ok: true, connection: conn })
        }
        if (path === 'disconnect') {
          const conn = store.getConnection(body.id)
          if (conn) {
            store.meta.prepare('DELETE FROM kb_connection WHERE id = ?').run(body.id)
            try {
              await options.credentials?.deleteRecord?.(`dsh-knowledge-manager/${conn.id}`)
            } catch {
              /* ignore */
            }
          }
          return json(res, 200, { ok: true })
        }
        if (path === 'sync') {
          const results = await syncAllLibraries({
            store,
            credentials: options.credentials,
            onlyId: body.connectionId,
          })
          return json(res, 200, { results })
        }
        if (path === 'debug-log') {
          try {
            appendFileSync(`${homedir()}/.dsh/knowledge/turntail-probe.jsonl`, `${JSON.stringify(body)}
`)
          } catch {
            /* ignore */
          }
          return json(res, 200, { ok: true })
        }
        if (path === 'session-knowledge') {
          const sessionId = q.get('sessionId') || ''
          const rows = sessionId
            ? store.meta.prepare('SELECT turn_id, created_ids, cited_ids FROM kb_turn WHERE session_id = ? ORDER BY created_at DESC').all(sessionId)
            : []
          const ids = []
          for (const row of rows) {
            for (const raw of [row.created_ids, row.cited_ids]) {
              try {
                for (const id of JSON.parse(raw || '[]')) if (!ids.includes(id)) ids.push(id)
              } catch {
                /* skip malformed */
              }
            }
          }
          const groups = []
          for (const lib of store.listLibraries()) {
            const items = []
            for (const id of ids) {
              const entry = store.getEntry(lib.name, id)
              if (entry) items.push({ id: entry.id, title: entry.title, tags: entry.tags, sensitivity: entry.sensitivity, updatedAt: entry.updatedAt })
            }
            if (items.length) groups.push({ library: lib.name, items })
          }
          return json(res, 200, { sessionId, groups })
        }
        if (path === 'turn') {
          store.recordTurn(body)
          return json(res, 200, { ok: true })
        }
        return json(res, 404, { error: `unknown endpoint: ${path}` })
      }

      return json(res, 405, { error: 'method not allowed' })
    } catch (error) {
      return json(res, 500, { error: String(error?.message ?? error) })
    }
  }
}

export function registerApi(ctx, getStore) {
  const webServer = ctx.get?.('webServer') ?? ctx.webServer
  if (!webServer) return () => {}
  const handler = createApiHandler(getStore, {
    credentials: ctx.get?.('credentials'),
  })
  let dispose
  try {
    dispose = webServer.register({ kind: 'prefix', path: '/kb-api', handler })
  } catch {
    return () => {}
  }
  return () => {
    try {
      dispose()
    } catch {
      /* ignore */
    }
  }
}
