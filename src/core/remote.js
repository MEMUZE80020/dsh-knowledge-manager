import { createRequire } from 'node:module'

const SYSTEM_DBS = new Set(['mysql', 'information_schema', 'performance_schema', 'sys'])

function ident(name) {
  if (!/^[a-z0-9_]{1,64}$/i.test(String(name))) throw new Error(`invalid identifier: ${name}`)
  return `\`${name}\``
}

/**
 * Minimal MariaDB / MySQL remote used by the sync engine.
 * mysql2 ships with the plugin, so no separate driver install is needed.
 */
export function createMysqlRemote(options) {
  const {
    host,
    port = 3306,
    user,
    password,
    tls = false,
    prefix = 'dsh_kb_',
    connectTimeout = 8000,
    database,
  } = options ?? {}

  let connectionPromise = null

  async function connection() {
    if (!connectionPromise) {
      connectionPromise = (async () => {
        const require = createRequire(import.meta.url)
        const mysql = require('mysql2/promise')
        return mysql.createConnection({
          host,
          port,
          user,
          password,
          database: database || undefined,
          ssl: tls ? { rejectUnauthorized: false } : undefined,
          connectTimeout,
          charset: 'utf8mb4_unicode_ci',
        })
      })()
    }
    return connectionPromise
  }

  async function close() {
    if (!connectionPromise) return
    try {
      const conn = await connectionPromise
      await conn.end()
    } finally {
      connectionPromise = null
    }
  }

  async function listDatabases() {
    const conn = await connection()
    const [rows] = await conn.query('SHOW DATABASES')
    return rows
      .map((row) => Object.values(row)[0])
      .filter((name) => !SYSTEM_DBS.has(String(name).toLowerCase()))
  }

  async function createDatabase(name) {
    const conn = await connection()
    await conn.query(`CREATE DATABASE IF NOT EXISTS ${ident(name)} CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`)
    return name
  }

  async function ensureSchema(db) {
    const conn = await connection()
    const k = ident(`${prefix}knowledge`)
    const r = ident(`${prefix}revisions`)
    const t = ident(`${prefix}tombstones`)
    const c = ident(`${prefix}catalog`)
    const m = ident(`${prefix}meta`)
    await conn.query(`CREATE TABLE IF NOT EXISTS ${k} (
      id VARCHAR(64) PRIMARY KEY,
      title TEXT NOT NULL,
      body MEDIUMTEXT NOT NULL,
      tags VARCHAR(1024) NOT NULL DEFAULT '',
      tier VARCHAR(16) NOT NULL DEFAULT 'tentative',
      sensitivity VARCHAR(16) NOT NULL DEFAULT 'safe',
      version INT NOT NULL DEFAULT 1,
      hash VARCHAR(64) NOT NULL DEFAULT '',
      created_at DATETIME(3) NOT NULL,
      updated_at DATETIME(3) NOT NULL,
      deleted TINYINT NOT NULL DEFAULT 0,
      INDEX updated_at (updated_at)
    )`)
    await conn.query(`CREATE TABLE IF NOT EXISTS ${r} (
      knowledge_id VARCHAR(64) NOT NULL,
      version INT NOT NULL,
      title TEXT NOT NULL,
      body MEDIUMTEXT NOT NULL,
      tags VARCHAR(1024) NOT NULL DEFAULT '',
      updated_at DATETIME(3) NOT NULL,
      reason VARCHAR(32) NOT NULL DEFAULT '',
      PRIMARY KEY (knowledge_id, version)
    )`)
    await conn.query(`CREATE TABLE IF NOT EXISTS ${t} (
      id VARCHAR(64) PRIMARY KEY,
      deleted_at DATETIME(3) NOT NULL,
      deleted_by VARCHAR(64) NOT NULL DEFAULT ''
    )`)
    await conn.query(`CREATE TABLE IF NOT EXISTS ${c} (
      table_name VARCHAR(64) PRIMARY KEY,
      title VARCHAR(255) NOT NULL DEFAULT '',
      description TEXT NOT NULL,
      kind VARCHAR(16) NOT NULL DEFAULT 'base',
      columns_json TEXT NOT NULL,
      created_at DATETIME(3) NOT NULL
    )`)
    await conn.query(`CREATE TABLE IF NOT EXISTS ${m} (
      name VARCHAR(64) PRIMARY KEY,
      value TEXT NOT NULL
    )`)
  }

  async function pull(db, sinceIso = '') {
    const conn = await connection()
    await conn.query(`USE ${ident(db)}`)
    const [rows] = sinceIso
      ? await conn.query(`SELECT id, title, body, tags, tier, sensitivity, version, hash, created_at AS createdAt, updated_at AS updatedAt FROM ${ident(`${prefix}knowledge`)} WHERE updated_at > ?`, [new Date(sinceIso)])
      : await conn.query(`SELECT id, title, body, tags, tier, sensitivity, version, hash, created_at AS createdAt, updated_at AS updatedAt FROM ${ident(`${prefix}knowledge`)}`)
    const [stones] = sinceIso
      ? await conn.query(`SELECT id, deleted_at AS deletedAt FROM ${ident(`${prefix}tombstones`)} WHERE deleted_at > ?`, [new Date(sinceIso)])
      : await conn.query(`SELECT id, deleted_at AS deletedAt FROM ${ident(`${prefix}tombstones`)}`)
    return {
      knowledge: rows.map((row) => ({
        ...row,
        createdAt: new Date(row.createdAt).toISOString(),
        updatedAt: new Date(row.updatedAt).toISOString(),
      })),
      tombstones: stones.map((row) => ({ id: row.id, deletedAt: new Date(row.deletedAt).toISOString() })),
    }
  }

  async function push(db, changes) {
    const conn = await connection()
    await conn.query(`USE ${ident(db)}`)
    let pushed = 0
    for (const row of changes.knowledge ?? []) {
      await conn.query(
        `INSERT INTO ${ident(`${prefix}knowledge`)}(id, title, body, tags, tier, sensitivity, version, hash, created_at, updated_at, deleted)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE title = VALUES(title), body = VALUES(body), tags = VALUES(tags), tier = VALUES(tier),
           sensitivity = VALUES(sensitivity), version = VALUES(version), hash = VALUES(hash), updated_at = VALUES(updated_at)`,
        [
          row.id,
          row.title,
          row.body,
          row.tags,
          row.tier,
          row.sensitivity,
          row.version,
          row.hash,
          new Date(row.createdAt),
          new Date(row.updatedAt),
          0,
        ],
      )
      pushed += 1
    }
    for (const stone of changes.tombstones ?? []) {
      await conn.query(
        `INSERT INTO ${ident(`${prefix}tombstones`)}(id, deleted_at, deleted_by) VALUES (?, ?, 'local')
         ON DUPLICATE KEY UPDATE deleted_at = VALUES(deleted_at)`,
        [stone.id, new Date(stone.deletedAt)],
      )
      await conn.query(`UPDATE ${ident(`${prefix}knowledge`)} SET deleted = 1 WHERE id = ?`, [stone.id])
    }
    return pushed
  }

  return { listDatabases, createDatabase, ensureSchema, pull, push, close }
}
