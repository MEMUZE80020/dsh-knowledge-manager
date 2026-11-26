import { DatabaseSync } from 'node:sqlite'
import { createHash, randomUUID } from 'node:crypto'
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { LIB_SCHEMA, META_SCHEMA } from './schema.js'
import {
  DEFAULT_ROOT,
  MAIN_LIBRARY,
  attachmentDir,
  ensureDirs,
  backupDir,
  libFile,
  validateLibraryName,
} from './paths.js'

const MAX_BODY = 32 * 1024

function now() {
  return new Date().toISOString()
}

const created_at = now

export function contentHash(title, body, tags) {
  const norm = (s) => String(s ?? '').replace(/\r\n/g, '\n').trim()
  const tagList = norm(tags)
    .split(/[,，]/)
    .map((t) => t.trim())
    .filter(Boolean)
    .sort()
    .join(',')
  return createHash('sha256').update(`${norm(title)}\n${norm(body)}\n${tagList}`).digest('hex')
}

export class KnowledgeStore {
  constructor({ root = DEFAULT_ROOT } = {}) {
    this.root = root
    this.meta = null
    this.libs = new Map()
    this.chain = Promise.resolve()
  }

  /** Serialize every write so concurrent sessions cannot interleave. */
  run(fn) {
    const next = this.chain.then(fn, fn)
    this.chain = next.then(
      () => undefined,
      () => undefined,
    )
    return next
  }

  async init() {
    return this.run(() => {
      ensureDirs(this.root)
      if (!this.meta) {
        this.meta = new DatabaseSync(join(this.root, 'dsh-kb-meta.db'))
        this.meta.exec(META_SCHEMA)
        const columns = this.meta.prepare("PRAGMA table_info('kb_turn')").all().map((c) => c.name)
        if (!columns.includes('message_id')) {
          this.meta.exec("ALTER TABLE kb_turn ADD COLUMN message_id TEXT NOT NULL DEFAULT ''")
        }
        if (!columns.includes('updated_ids')) {
          this.meta.exec("ALTER TABLE kb_turn ADD COLUMN updated_ids TEXT NOT NULL DEFAULT '[]'")
        }
        if (!columns.includes('states')) {
          this.meta.exec("ALTER TABLE kb_turn ADD COLUMN states TEXT NOT NULL DEFAULT '{}'")
        }
      }
      const exists = this.meta.prepare('SELECT name FROM kb_library WHERE name = ?').get(MAIN_LIBRARY)
      if (!exists) {
        this.meta
          .prepare(
            'INSERT INTO kb_library(name, kind, created_by, created_at) VALUES (?, ?, ?, ?)',
          )
          .run(MAIN_LIBRARY, 'main', 'plugin', now())
      }
      this.#openLib(MAIN_LIBRARY)
      return this
    })
  }

  #openLib(name) {
    const cached = this.libs.get(name)
    if (cached) return cached
    const file = libFile(this.root, name)
    mkdirSync(join(this.root, 'libraries'), { recursive: true })
    const db = new DatabaseSync(file)
    db.exec(LIB_SCHEMA)
    this.libs.set(name, db)
    return db
  }

  #lib(name) {
    validateLibraryName(name)
    const db = this.libs.get(name)
    if (!db) throw new Error(`library not open: ${name}`)
    return db
  }

  // ------------------------------------------------------------------ libraries

  async ensureLibrary(name, { kind = 'remote', originHost = '', remoteDb = '', createdBy = 'plugin' } = {}) {
    validateLibraryName(name, kind === 'main' ? 'main' : kind === 'agent' ? 'agent' : undefined)
    return this.run(() => {
      const known = this.meta.prepare('SELECT name FROM kb_library WHERE name = ?').get(name)
      if (!known) {
        this.meta
          .prepare(
            `INSERT INTO kb_library(name, kind, origin_host, remote_db, created_by, created_at)
             VALUES (?, ?, ?, ?, ?, ?)`,
          )
          .run(name, kind, originHost, remoteDb, createdBy, now())
        this.#openLib(name)
        this.meta
          .prepare(
            `INSERT OR IGNORE INTO kb_global_entry(library, table_name, title, description, created_at)
             VALUES (?, 'knowledge', '知识条目', '标准知识点表', ?)`,
          )
          .run(name, now())
        this.meta
          .prepare(
            `INSERT OR IGNORE INTO kb_global_entry(library, table_name, title, description, created_at)
             VALUES (?, '_catalog', '本库目录', '本库表登记', ?)`,
          )
          .run(name, now())
      }
      this.#openLib(name)
      return this.getLibrary(name)
    })
  }

  getLibrary(name) {
    const row = this.meta
      .prepare(
        `SELECT name, kind, origin_host AS originHost, remote_db AS remoteDb, created_by AS createdBy,
                readonly, syncable, created_at AS createdAt
         FROM kb_library WHERE name = ?`,
      )
      .get(name)
    return row ?? null
  }

  listLibraries() {
    return this.meta
      .prepare(
        `SELECT name, kind, origin_host AS originHost, remote_db AS remoteDb, created_by AS createdBy,
                readonly, syncable, created_at AS createdAt
         FROM kb_library ORDER BY kind = 'main' DESC, name`,
      )
      .all()
  }

  // ------------------------------------------------------------------ knowledge

  async record(library, entry) {
    const {
      title = '',
      body = '',
      tags = '',
      sessionId = '',
      turnId = '',
      source = 'agent',
      createdBy = 'agent',
      tier = 'tentative',
      sensitivity = 'safe',
    } = entry ?? {}
    if (!String(title).trim()) throw new Error('title is required')
    if (Buffer.byteLength(String(body), 'utf8') > MAX_BODY) {
      throw new Error(`body exceeds ${MAX_BODY} bytes; split the knowledge point`)
    }
    const hash = contentHash(title, body, tags)
    const syncable = sensitivity === 'safe' ? 1 : 0

    return this.run(() => {
      const db = this.#lib(library)
      const same = db.prepare('SELECT id FROM knowledge WHERE hash = ? AND deleted = 0').get(hash)
      if (same) return { id: same.id, version: null, skipped: true, revision: false }

      const stamp = now()
      const existing = db
        .prepare('SELECT * FROM knowledge WHERE title = ? AND deleted = 0 ORDER BY updated_at DESC LIMIT 1')
        .get(String(title).trim())

      if (existing) {
        const nextVersion = existing.version + 1
        db.prepare(
          `INSERT OR REPLACE INTO revisions(knowledge_id, version, title, body, tags, updated_at, reason)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
        ).run(existing.id, existing.version, existing.title, existing.body, existing.tags, stamp, 'revised')
        const keep = Math.max(0, nextVersion - 11)
        db.prepare('DELETE FROM revisions WHERE knowledge_id = ? AND version <= ?').run(existing.id, keep)
        db.prepare(
          `UPDATE knowledge SET body = ?, tags = ?, hash = ?, version = ?, updated_at = ?,
             sensitivity = ?, syncable = ?, tier = ?, session_id = ?, turn_id = ?, flagged_modified = 0
           WHERE id = ?`,
        ).run(
          String(body),
          String(tags),
          hash,
          nextVersion,
          stamp,
          sensitivity,
          syncable,
          tier,
          sessionId,
          turnId,
          existing.id,
        )
        return { id: existing.id, version: nextVersion, skipped: false, revision: true }
      }

      const id = randomUUID()
      db.prepare(
        `INSERT INTO knowledge(id, title, body, tags, session_id, turn_id, source, created_by, tier,
             sensitivity, syncable, version, hash, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?)`,
      ).run(
        id,
        String(title).trim(),
        String(body),
        String(tags),
        sessionId,
        turnId,
        source,
        createdBy,
        tier,
        sensitivity,
        syncable,
        hash,
        stamp,
        stamp,
      )
      return { id, version: 1, skipped: false, revision: false }
    })
  }

  countSearch(library, { q = '', sessionId = '', tag = '', from = '', to = '', source = '', sensitivity = '' } = {}) {
    const db = this.#lib(library)
    const where = ['k.deleted = 0']
    const params = []
    if (sessionId) { where.push('k.session_id = ?'); params.push(sessionId) }
    if (tag) { where.push('k.tags LIKE ?'); params.push(`%${tag}%`) }
    if (from) { where.push('k.updated_at >= ?'); params.push(from) }
    if (to) { where.push('k.updated_at <= ?'); params.push(to) }
    if (source) { where.push('k.source = ?'); params.push(source) }
    if (sensitivity) { where.push('k.sensitivity = ?'); params.push(sensitivity) }
    const term = String(q).trim()
    try {
      if (term.length >= 3) {
        const escaped = term.replace(/"/g, '""')
        const row = db.prepare(`SELECT COUNT(*) AS n FROM knowledge_fts JOIN knowledge k ON k.rowid = knowledge_fts.rowid WHERE knowledge_fts MATCH ? AND ${where.join(' AND ')}`).get(`"${escaped}"`, ...params)
        return row?.n ?? 0
      }
      const like = `%${term}%`
      const row = db.prepare(`SELECT COUNT(*) AS n FROM knowledge k WHERE ${where.join(' AND ')} ${term ? 'AND (k.title LIKE ? OR k.body LIKE ? OR k.tags LIKE ?)' : ''}`).get(...params, ...(term ? [like, like, like] : []))
      return row?.n ?? 0
    } catch {
      return 0
    }
  }

  search(library, { q = '', sessionId = '', tag = '', from = '', to = '', source = '', sensitivity = '', sort = 'relevance', limit = 20, offset = 0 } = {}) {
    const db = this.#lib(library)
    const where = ['k.deleted = 0']
    const params = []
    if (sessionId) {
      where.push('k.session_id = ?')
      params.push(sessionId)
    }
    if (tag) {
      where.push('k.tags LIKE ?')
      params.push(`%${tag}%`)
    }
    if (from) {
      where.push('k.updated_at >= ?')
      params.push(from)
    }
    if (to) {
      where.push('k.updated_at <= ?')
      params.push(to)
    }
    if (source) {
      where.push('k.source = ?')
      params.push(source)
    }
    if (sensitivity) {
      where.push('k.sensitivity = ?')
      params.push(sensitivity)
    }

    const cap = Math.min(Math.max(Number(limit) || 20, 1), 1000)
    const skip = Math.max(Number(offset) || 0, 0)
    const term = String(q).trim()

    if (term.length >= 3) {
      const escaped = term.replace(/"/g, '""')
      const order = sort === 'time' ? 'k.updated_at DESC' : 'bm25(knowledge_fts)'
      const rows = db
        .prepare(
          `SELECT k.id, k.title, k.tags, k.tier, k.sensitivity, k.source, k.session_id AS sessionId,
                  k.updated_at AS updatedAt, substr(k.body, 1, 280) AS snippet
           FROM knowledge_fts
           JOIN knowledge k ON k.rowid = knowledge_fts.rowid
           WHERE knowledge_fts MATCH ? AND ${where.join(' AND ')}
           ORDER BY ${order} LIMIT ? OFFSET ?`,
        )
        .all(`"${escaped}"`, ...params, cap, skip)
      return rows
    }

    const like = `%${term}%`
    const rows = db
      .prepare(
        `SELECT k.id, k.title, k.tags, k.tier, k.sensitivity, k.source, k.session_id AS sessionId,
                k.updated_at AS updatedAt, substr(k.body, 1, 280) AS snippet
         FROM knowledge k
         WHERE ${where.join(' AND ')} ${term ? 'AND (k.title LIKE ? OR k.body LIKE ? OR k.tags LIKE ?)' : ''}
         ORDER BY k.updated_at DESC LIMIT ? OFFSET ?`,
      )
      .all(...params, ...(term ? [like, like, like] : []), cap, skip)
    return rows
  }

  getEntry(library, id) {
    const db = this.#lib(library)
    const row = db
      .prepare(
        `SELECT id, title, body, tags, session_id AS sessionId, turn_id AS turnId, source, created_by AS createdBy,
                tier, sensitivity, version, hash, created_at AS createdAt, updated_at AS updatedAt, flagged_modified AS flaggedModified
         FROM knowledge WHERE id = ? AND deleted = 0`,
      )
      .get(id)
    return row ?? null
  }

  listRevisions(library, id) {
    const db = this.#lib(library)
    return db
      .prepare(
        `SELECT version, title, body, tags, updated_at AS updatedAt, reason
         FROM revisions WHERE knowledge_id = ? ORDER BY version DESC`,
      )
      .all(id)
  }

  async deleteEntry(library, id, by = 'user') {
    return this.run(() => {
      const db = this.#lib(library)
      const row = db.prepare('SELECT * FROM knowledge WHERE id = ? AND deleted = 0').get(id)
      if (!row) return { deleted: false }

      // A row that superseded an older version on conflict reverts to that
      // version when deleted, instead of leaving a tombstone.
      const conflicted = row.flagged_modified === 1
      const revision = conflicted
        ? db
            .prepare('SELECT * FROM revisions WHERE knowledge_id = ? ORDER BY version DESC LIMIT 1')
            .get(id)
        : null
      if (revision) {
        const stamp = now()
        db.prepare(
          `UPDATE knowledge SET title = ?, body = ?, tags = ?, hash = ?, updated_at = ?,
             version = ?, flagged_modified = 0 WHERE id = ?`,
        ).run(revision.title, revision.body, revision.tags, contentHash(revision.title, revision.body, revision.tags), stamp, row.version + 1, id)
        return { deleted: false, reverted: true, id }
      }

      const stamp = now()
      db.prepare('UPDATE knowledge SET deleted = 1, updated_at = ? WHERE id = ?').run(stamp, id)
      db.prepare('INSERT OR REPLACE INTO tombstones(id, deleted_at, deleted_by) VALUES (?, ?, ?)').run(id, stamp, by)
      return { deleted: true, id }
    })
  }

  async restoreEntry(library, id) {
    return this.run(() => {
      const db = this.#lib(library)
      const row = db.prepare('SELECT id FROM knowledge WHERE id = ? AND deleted = 1').get(id)
      if (!row) return { restored: false }
      db.prepare('UPDATE knowledge SET deleted = 0, updated_at = ? WHERE id = ?').run(now(), id)
      db.prepare('DELETE FROM tombstones WHERE id = ?').run(id)
      return { restored: true, id }
    })
  }

  listTombstones(library) {
    const db = this.#lib(library)
    return db
      .prepare(
        `SELECT t.id, t.deleted_at AS deletedAt, t.deleted_by AS deletedBy, k.title
         FROM tombstones t LEFT JOIN knowledge k ON k.id = t.id ORDER BY t.deleted_at DESC`,
      )
      .all()
  }

  // ------------------------------------------------------------------ attachments

  async addAttachment(library, knowledgeId, filePath, name) {
    if (!existsSync(filePath)) throw new Error(`attachment not found: ${filePath}`)
    const size = statSync(filePath).size
    if (size > 20 * 1024 * 1024) throw new Error('attachment exceeds 20MB')
    const id = randomUUID()
    const dir = join(attachmentDir(this.root, library), id)
    mkdirSync(dir, { recursive: true })
    const target = join(dir, name || `file-${id}`)
    copyFileSync(filePath, target)
    const hash = createHash('sha256').update(readFileSync(target)).digest('hex')
    return this.run(() => {
      const db = this.#lib(library)
      db.prepare(
        `INSERT INTO attachments(id, knowledge_id, name, path, bytes, sha256)
         VALUES (?, ?, ?, ?, ?, ?)`,
      ).run(id, knowledgeId, name || '', target, size, hash)
      return { id, path: target, bytes: size }
    })
  }

  listAttachments(library, knowledgeId) {
    const db = this.#lib(library)
    return db
      .prepare(
        `SELECT id, name, path, bytes, sha256, pushed FROM attachments WHERE knowledge_id = ?`,
      )
      .all(knowledgeId)
  }

  // ------------------------------------------------------------------ catalog

  listCatalog(library) {
    const db = this.#lib(library)
    return db.prepare('SELECT * FROM _catalog ORDER BY kind, table_name').all()
  }

  async addCatalogEntry(library, { table, title = '', description = '', kind = 'agent', columns = [] }) {
    if (!/^[a-z_][a-z0-9_]{1,62}$/i.test(table)) throw new Error('invalid table name')
    return this.run(() => {
      const db = this.#lib(library)
      const stamp = now()
      db.prepare(
        `INSERT OR REPLACE INTO _catalog(table_name, title, description, kind, columns_json, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      ).run(table, title, description, kind, JSON.stringify(columns), stamp)
      this.meta
        .prepare(
          `INSERT OR REPLACE INTO kb_global_entry(library, table_name, title, description, created_at)
           VALUES (?, ?, ?, ?, ?)`,
        )
        .run(library, table, title, description, stamp)
      return { table }
    })
  }

  async createTable(library, { table, title = '', description = '', columns = [] } = {}) {
    if (!/^[a-z][a-z0-9_]{1,48}$/.test(String(table ?? ''))) throw new Error('table must be lower-case snake_case')
    const extra = Array.isArray(columns) ? columns : []
    const defs = []
    for (const col of extra) {
      const name = String(col?.name ?? '')
      const type = String(col?.type ?? 'text').toLowerCase()
      if (!/^[a-z][a-z0-9_]{0,40}$/.test(name)) throw new Error(`invalid column name: ${name}`)
      if (!['text', 'integer', 'number', 'real'].includes(type)) throw new Error(`unsupported column type: ${type}`)
      defs.push(`${name} ${type === 'text' ? 'TEXT' : type === 'integer' ? 'INTEGER' : 'REAL'}`)
    }
    return this.run(() => {
      const db = this.#lib(library)
      db.exec(
        `CREATE TABLE IF NOT EXISTS ${table} (
           id TEXT PRIMARY KEY,
           title TEXT NOT NULL DEFAULT '',
           body TEXT NOT NULL DEFAULT '',
           tags TEXT NOT NULL DEFAULT '',
           created_at TEXT NOT NULL,
           updated_at TEXT NOT NULL${defs.length ? `,\n           ${defs.join(',\n           ')}` : ''}
         )`,
      )
      const stamp = now()
      db.prepare(
        `INSERT OR REPLACE INTO _catalog(table_name, title, description, kind, columns_json, created_at)
         VALUES (?, ?, ?, 'agent', ?, ?)`,
      ).run(table, title, description, JSON.stringify(extra), stamp)
      this.meta
        .prepare(
          `INSERT OR REPLACE INTO kb_global_entry(library, table_name, title, description, created_at)
           VALUES (?, ?, ?, ?, ?)`,
        )
        .run(library, table, title, description, stamp)
      return { library, table, columns: extra }
    })
  }

  async wipeAll() {
    return this.run(() => {
      let removed = 0
      for (const lib of this.listLibraries()) {
        const db = this.#lib(lib.name)
        for (const table of ['knowledge_fts', 'attachments', 'revisions', 'tombstones', 'knowledge']) {
          try {
            removed += Number(db.prepare(`DELETE FROM ${table}`).run().changes || 0)
          } catch {
            /* table may not exist */
          }
        }
        try {
          rmSync(attachmentDir(this.root, lib.name), { recursive: true, force: true })
        } catch {
          /* ignore */
        }
      }
      for (const table of ['kb_turn', 'kb_attrib', 'kb_undo', 'kb_setting', 'kb_queue', 'kb_backup', 'kb_global_entry', 'kb_library', 'kb_connection', 'kb_cursor']) {
        try {
          this.meta.prepare(`DELETE FROM ${table}`).run()
        } catch {
          /* ignore */
        }
      }
      try {
        rmSync(backupDir(this.root), { recursive: true, force: true })
        mkdirSync(backupDir(this.root), { recursive: true })
      } catch {
        /* ignore */
      }
      return { ok: true, removed }
    })
  }

  // ------------------------------------------------------------------ connections

  async saveConnection({ host, port = 3306, user, tls = false }) {
    if (!host || !user) throw new Error('host and user are required')
    const id = `${host}:${port}:${user}`.replace(/[^a-zA-Z0-9:._-]/g, '_')
    return this.run(() => {
      this.meta
        .prepare(
          `INSERT OR REPLACE INTO kb_connection(id, host, port, user, tls, created_at)
           VALUES (?, ?, ?, ?, ?, ?)`,
        )
        .run(id, host, Number(port) || 3306, user, tls ? 1 : 0, created_at())
      return this.getConnection(id)
    })
  }

  getConnection(id) {
    return (
      this.meta
        .prepare('SELECT id, host, port, user, tls, created_at AS createdAt, last_sync_at AS lastSyncAt, last_error AS lastError FROM kb_connection WHERE id = ?')
        .get(id) ?? null
    )
  }

  listConnections() {
    return this.meta
      .prepare('SELECT id, host, port, user, tls, created_at AS createdAt, last_sync_at AS lastSyncAt, last_error AS lastError FROM kb_connection ORDER BY created_at')
      .all()
  }

  markConnection(id, { at = created_at(), error = '' } = {}) {
    this.meta.prepare('UPDATE kb_connection SET last_sync_at = ?, last_error = ? WHERE id = ?').run(at, error, id)
  }

  allIds(library) {
    return this.#lib(library).prepare('SELECT id FROM knowledge WHERE deleted = 0').all().map((r) => r.id)
  }

  // ------------------------------------------------------------------ ui queries

  recent(library, { since = '', limit = 50 } = {}) {
    const db = this.#lib(library)
    return db
      .prepare(
        `SELECT id, title, tags, tier, sensitivity, source, session_id AS sessionId,
                substr(body, 1, 280) AS snippet, updated_at AS updatedAt
         FROM knowledge WHERE deleted = 0 AND updated_at >= ? ORDER BY updated_at DESC LIMIT ?`,
      )
      .all(since, Math.min(Math.max(Number(limit) || 50, 1), 200))
  }

  listUncertain(library) {
    const db = this.#lib(library)
    return db
      .prepare(
        `SELECT id, title, tags, substr(body, 1, 280) AS snippet, updated_at AS updatedAt
         FROM knowledge WHERE deleted = 0 AND sensitivity = 'uncertain' ORDER BY updated_at DESC`,
      )
      .all()
  }

  async classify(library, ids = [], to = 'safe') {
    return this.run(() => {
      const db = this.#lib(library)
      let changed = 0
      for (const id of ids) {
        const row = db.prepare('SELECT id FROM knowledge WHERE id = ? AND deleted = 0').get(id)
        if (!row) continue
        const sensitivity = to === 'sensitive' ? 'sensitive' : 'safe'
        const syncable = sensitivity === 'safe' ? 1 : 0
        db.prepare('UPDATE knowledge SET sensitivity = ?, syncable = ?, updated_at = ? WHERE id = ?').run(
          sensitivity,
          syncable,
          now(),
          id,
        )
        changed += 1
      }
      return { changed }
    })
  }

  async deleteMany(library, ids = [], by = 'user') {
    const out = { deleted: 0, reverted: 0 }
    for (const id of ids) {
      const res = await this.deleteEntry(library, id, by)
      if (res.deleted) out.deleted += 1
      if (res.reverted) out.reverted += 1
    }
    return out
  }

  statsAll() {
    return this.listLibraries().map((lib) => ({ library: lib.name, ...this.stats(lib.name) }))
  }

  recordTurn({ turnId, messageId = '', sessionId = '', cited = [], created = [], updated = [], uncertain = [], states = {} }) {
    if (!turnId) return null
    this.meta
      .prepare(
        `INSERT OR REPLACE INTO kb_turn(turn_id, message_id, session_id, cited_ids, created_ids, updated_ids, uncertain_ids, states, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(turnId, messageId, sessionId, JSON.stringify(cited), JSON.stringify(created), JSON.stringify(updated), JSON.stringify(uncertain), JSON.stringify(states), now())
    return turnId
  }

  turnByMessage(messageId) {
    const row = this.meta.prepare('SELECT turn_id FROM kb_turn WHERE message_id = ? OR turn_id = ? ORDER BY created_at DESC LIMIT 1').get(messageId, messageId)
    return row ? this.getTurn(row.turn_id) : null
  }

  attributedIds() {
    const rows = this.meta.prepare('SELECT created_ids FROM kb_turn').all()
    const set = new Set()
    for (const row of rows) {
      try {
        for (const id of JSON.parse(row.created_ids || '[]')) set.add(id)
      } catch {
        /* ignore malformed row */
      }
    }
    return set
  }

  attribCursor(sessionId) {
    const row = this.meta.prepare('SELECT last_at FROM kb_attrib WHERE session_id = ?').get(sessionId)
    return row?.last_at ?? ''
  }

  setAttribCursor(sessionId, atIso) {
    this.meta
      .prepare('INSERT OR REPLACE INTO kb_attrib(session_id, last_at) VALUES (?, ?)')
      .run(sessionId, atIso)
  }

  idsCreatedSinceAllLibraries(sinceIso) {
    const out = []
    for (const lib of this.listLibraries()) {
      try {
        out.push(...this.idsCreatedSince(lib.name, sinceIso))
      } catch {
        /* skip unopened */
      }
    }
    return out
  }

  idsCreatedSince(library, sinceIso) {
    return this.#lib(library)
      .prepare('SELECT id FROM knowledge WHERE created_at >= ? AND deleted = 0')
      .all(sinceIso)
      .map((row) => row.id)
  }

  getTurn(turnId) {
    const row = this.meta.prepare('SELECT * FROM kb_turn WHERE turn_id = ?').get(turnId)
    if (!row) return null
    return {
      turnId: row.turn_id,
      sessionId: row.session_id,
      cited: JSON.parse(row.cited_ids || '[]'),
      created: JSON.parse(row.created_ids || '[]'),
      updated: JSON.parse(row.updated_ids || '[]'),
      states: JSON.parse(row.states || '{}'),
      uncertain: JSON.parse(row.uncertain_ids || '[]'),
      createdAt: row.created_at,
    }
  }

  latestTurn(sessionId = '') {
    const row = sessionId
      ? this.meta.prepare('SELECT turn_id FROM kb_turn WHERE session_id = ? ORDER BY created_at DESC LIMIT 1').get(sessionId)
      : this.meta.prepare('SELECT turn_id FROM kb_turn ORDER BY created_at DESC LIMIT 1').get()
    return row ? this.getTurn(row.turn_id) : null
  }

  // ------------------------------------------------------------------ sync

  /** Rows a remote should receive: syncable only, newer than the cursor. */
  exportChanges(library, sinceIso = '') {
    const db = this.#lib(library)
    const rows = db
      .prepare(
        `SELECT id, title, body, tags, tier, sensitivity, version, hash, created_at AS createdAt,
                updated_at AS updatedAt, deleted
         FROM knowledge
         WHERE syncable = 1 AND updated_at > ? AND sensitivity IN ('safe')
         ORDER BY updated_at`,
      )
      .all(sinceIso)
    const tombstones = db.prepare('SELECT id, deleted_at AS deletedAt FROM tombstones WHERE deleted_at > ?').all(sinceIso)
    const hidden = db
      .prepare("SELECT id, updated_at AS deletedAt FROM knowledge WHERE syncable = 1 AND sensitivity = 'sensitive' AND updated_at > ?")
      .all(sinceIso)
    return { knowledge: rows, tombstones: [...tombstones, ...hidden] }
  }

  /**
   * Apply remote rows locally.
   * - sensitive local rows are never overwritten or deleted;
   * - a newer remote row replaces the local one and the old body is kept as a
   *   conflict revision, marking the row flagged_modified so deleting it later
   *   restores that version;
   * - remote tombstones only delete rows the remote actually owns.
   */
  async applyRemoteChanges(library, { knowledge = [], tombstones = [] } = {}) {
    return this.run(() => {
      const db = this.#lib(library)
      let applied = 0
      let conflicts = 0
      let skipped = 0

      for (const remote of knowledge) {
        const local = db.prepare('SELECT * FROM knowledge WHERE id = ?').get(remote.id)
        if (local && local.sensitivity === 'sensitive') {
          skipped += 1
          continue
        }
        const stamp = now()
        if (!local) {
          db.prepare(
            `INSERT OR REPLACE INTO knowledge(id, title, body, tags, tier, sensitivity, syncable, version,
               hash, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?)`,
          ).run(
            remote.id,
            remote.title ?? '',
            remote.body ?? '',
            remote.tags ?? '',
            remote.tier ?? 'tentative',
            remote.sensitivity ?? 'safe',
            remote.version ?? 1,
            remote.hash ?? contentHash(remote.title, remote.body, remote.tags),
            remote.createdAt ?? stamp,
            remote.updatedAt ?? stamp,
          )
          applied += 1
          continue
        }
        if (String(remote.updatedAt ?? '') > String(local.updated_at)) {
          db.prepare(
            `INSERT OR REPLACE INTO revisions(knowledge_id, version, title, body, tags, updated_at, reason)
             VALUES (?, ?, ?, ?, ?, ?, 'conflict')`,
          ).run(local.id, local.version, local.title, local.body, local.tags, stamp)
          db.prepare(
            `UPDATE knowledge SET title = ?, body = ?, tags = ?, hash = ?, updated_at = ?, version = ?,
               sensitivity = ?, syncable = 1, flagged_modified = 1
             WHERE id = ?`,
          ).run(
            remote.title ?? local.title,
            remote.body ?? local.body,
            remote.tags ?? local.tags,
            remote.hash ?? contentHash(remote.title, remote.body, remote.tags),
            remote.updatedAt ?? stamp,
            local.version + 1,
            remote.sensitivity ?? 'safe',
            local.id,
          )
          applied += 1
          conflicts += 1
        }
      }

      for (const stone of tombstones) {
        const stamp = now()
        const local = db.prepare('SELECT * FROM knowledge WHERE id = ?').get(stone.id)
        if (!local) continue
        if (local.sensitivity === 'sensitive') {
          skipped += 1
          continue
        }
        if (String(local.updated_at) > String(stone.deletedAt)) continue
        db.prepare('UPDATE knowledge SET deleted = 1, updated_at = ? WHERE id = ?').run(stamp, stone.id)
        db.prepare('INSERT OR REPLACE INTO tombstones(id, deleted_at, deleted_by) VALUES (?, ?, ?)').run(
          stone.id,
          stone.deletedAt ?? stamp,
          'remote',
        )
      }

      return { applied, conflicts, skipped }
    })
  }

  // ------------------------------------------------------------------ backup

  /** Write a diff snapshot of the given rows before a destructive change. */
  async snapshotRows(library, ids = [], op = 'delete') {
    return this.run(() => {
      const db = this.#lib(library)
      const rows = []
      for (const id of ids) {
        const row = db.prepare('SELECT * FROM knowledge WHERE id = ?').get(id)
        if (row) rows.push(row)
        const revs = db.prepare('SELECT * FROM revisions WHERE knowledge_id = ?').all(id)
        rows.push(...revs.map((r) => ({ ...r, __kind: 'revision' })))
      }
      const stamp = now()
      const name = `${stamp.replace(/[:.]/g, '-')}-${library}.diff.json`
      const dir = backupDir(this.root)
      mkdirSync(dir, { recursive: true })
      const file = join(dir, name)
      writeFileSync(file, JSON.stringify({ version: 1, library, op, createdAt: stamp, rows }, null, 2))
      const expires = new Date(Date.now() + 30 * 24 * 3600 * 1000).toISOString()
      this.meta
        .prepare('INSERT OR REPLACE INTO kb_backup(path, covers_lib, created_at, expires_at) VALUES (?, ?, ?, ?)')
        .run(file, library, stamp, expires)
      return { path: file, rows: rows.length }
    })
  }

  /** Reverse-apply one diff snapshot: restore rows, drop their tombstones. */
  async restoreBackup(file) {
    return this.run(() => {
      const payload = JSON.parse(readFileSync(file, 'utf8'))
      const library = payload.library
      const db = this.#lib(library)
      let restored = 0
      for (const row of payload.rows ?? []) {
        if (row.__kind === 'revision') {
          db.prepare(
            `INSERT OR REPLACE INTO revisions(knowledge_id, version, title, body, tags, updated_at, reason)
             VALUES (?, ?, ?, ?, ?, ?, ?)`,
          ).run(row.knowledge_id, row.version, row.title, row.body, row.tags, row.updated_at, row.reason ?? 'restored')
          continue
        }
        db.prepare(
          `INSERT OR REPLACE INTO knowledge(id, title, body, tags, session_id, turn_id, source, created_by, tier,
             sensitivity, syncable, version, supersedes, hash, created_at, updated_at, flagged_modified, deleted)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        ).run(
          row.id,
          row.title,
          row.body,
          row.tags,
          row.session_id,
          row.turn_id,
          row.source,
          row.created_by,
          row.tier,
          row.sensitivity,
          row.syncable,
          row.version,
          row.supersedes,
          row.hash,
          row.created_at,
          row.updated_at,
          row.flagged_modified,
          row.deleted ?? 0,
        )
        db.prepare('DELETE FROM tombstones WHERE id = ?').run(row.id)
        restored += 1
      }
      return { library, restored }
    })
  }

  listBackups(library) {
    const rows = this.meta.prepare('SELECT path, covers_lib AS library, created_at AS createdAt, expires_at AS expiresAt FROM kb_backup ORDER BY created_at DESC').all()
    return library ? rows.filter((r) => r.library === library) : rows
  }

  getSetting(key, fallback = null) {
    const row = this.meta.prepare('SELECT value FROM kb_setting WHERE key = ?').get(key)
    if (!row) return fallback
    try {
      return JSON.parse(row.value)
    } catch {
      return fallback
    }
  }

  setSettings(values) {
    const now = new Date().toISOString()
    for (const [key, value] of Object.entries(values || {})) {
      this.meta.prepare('INSERT INTO kb_setting (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at').run(key, JSON.stringify(value), now)
    }
    return this.listSettings()
  }

  listSettings() {
    const out = {}
    for (const row of this.meta.prepare('SELECT key, value FROM kb_setting').all()) {
      try {
        out[row.key] = JSON.parse(row.value)
      } catch {
        /* skip */
      }
    }
    return out
  }

  async pruneBackups(days = 30) {
    return this.run(() => {
      const cutoff = new Date(Date.now() - days * 24 * 3600 * 1000).toISOString()
      const rows = this.meta.prepare('SELECT path FROM kb_backup WHERE created_at < ?').all(cutoff)
      for (const row of rows) {
        try {
          if (existsSync(row.path)) rmSync(row.path, { force: true })
        } catch {
          /* ignore */
        }
        this.meta.prepare('DELETE FROM kb_backup WHERE path = ?').run(row.path)
      }
      return rows.length
    })
  }

  // ------------------------------------------------------------------ stats

  stats(library) {
    const db = this.#lib(library)
    const total = db.prepare('SELECT COUNT(*) AS n FROM knowledge WHERE deleted = 0').get().n
    const bySensitivity = db
      .prepare('SELECT sensitivity, COUNT(*) AS n FROM knowledge WHERE deleted = 0 GROUP BY sensitivity')
      .all()
    const byTier = db.prepare('SELECT tier, COUNT(*) AS n FROM knowledge WHERE deleted = 0 GROUP BY tier').all()
    const revisions = db.prepare('SELECT COUNT(*) AS n FROM revisions').get().n
    const tombstones = db.prepare('SELECT COUNT(*) AS n FROM tombstones').get().n
    const attachments = db.prepare('SELECT COUNT(*) AS n, COALESCE(SUM(bytes),0) AS bytes FROM attachments').get()
    return { total, bySensitivity, byTier, revisions, tombstones, attachments }
  }

  close() {
    for (const db of this.libs.values()) db.close()
    this.libs.clear()
    if (this.meta) {
      this.meta.close()
      this.meta = null
    }
  }
}
