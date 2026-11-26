/**
 * Library-level sync runner: pull remote changes, apply them locally, push
 * local changes, then advance the cursor. Failures are queued in kb_queue so
 * the UI can show pending work and retry later.
 */
export async function syncLibrary({ store, remote, library, remoteDb, manual = false }) {
  const cursor =
    store.meta.prepare('SELECT pulled_at AS pulledAt, pushed_at AS pushedAt FROM kb_cursor WHERE lib = ?').get(library) ?? {}
  const stamp = () => new Date().toISOString()

  const run = async () => {
    // Snapshot local changes before pulling so rows just received from the
    // remote are not echoed straight back.
    const outgoing = store.exportChanges(library, cursor.pushedAt ?? '')
    const pulled = await remote.pull(remoteDb, cursor.pulledAt ?? '')
    const applied = await store.applyRemoteChanges(library, pulled)
    const pushed = await remote.push(remoteDb, outgoing)
    const nowIso = stamp()
    store.meta
      .prepare('INSERT OR REPLACE INTO kb_cursor(lib, pulled_at, pushed_at) VALUES (?, ?, ?)')
      .run(library, nowIso, nowIso)
    return { library, applied, pushed, manual }
  }

  try {
    return await run()
  } catch (error) {
    store.meta
      .prepare('INSERT INTO kb_queue(id, lib, op, row_id, attempts, last_error, created_at) VALUES (?, ?, ?, ?, 0, ?, ?)')
      .run(`${Date.now()}-${library}`, library, 'sync', '', String(error?.message ?? error), stamp())
    return { library, error: String(error?.message ?? error), manual }
  }
}
