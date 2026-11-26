import { createMysqlRemote } from './remote.js'
import { syncLibrary } from './sync.js'

async function readPassword(credentials, connectionId) {
  if (!credentials?.readRecord) return ''
  try {
    const record = await credentials.readRecord(`dsh-knowledge-manager/${connectionId}`)
    return record?.payload?.password ?? ''
  } catch {
    return ''
  }
}

/**
 * Sync every saved connection: discover its databases, build local replicas,
 * snapshot before merging, then pull→push each replica.
 */
export async function syncAllLibraries({ store, credentials, remoteFactory = createMysqlRemote, onlyId } = {}) {
  const connections = onlyId ? [store.getConnection(onlyId)].filter(Boolean) : store.listConnections()
  const results = []
  for (const conn of connections) {
    const password = await readPassword(credentials, conn.id)
    const remote = remoteFactory({
      host: conn.host,
      port: conn.port,
      user: conn.user,
      password,
      tls: conn.tls === 1,
    })
    try {
      const databases = await remote.listDatabases()
      for (const db of databases) {
        await store.ensureLibrary(db, { kind: 'remote', originHost: conn.host, remoteDb: db, createdBy: 'plugin' })
        const ids = store.allIds(db)
        if (ids.length) await store.snapshotRows(db, ids, 'sync')
        results.push(await syncLibrary({ store, remote, library: db, remoteDb: db }))
      }
      store.markConnection(conn.id, { error: '' })
    } catch (error) {
      store.markConnection(conn.id, { error: String(error?.message ?? error) })
      results.push({ connection: conn.id, error: String(error?.message ?? error) })
    } finally {
      try {
        await remote.close?.()
      } catch {
        /* ignore */
      }
    }
  }
  return results
}
