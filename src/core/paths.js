import { homedir } from 'node:os'
import { join } from 'node:path'
import { mkdirSync } from 'node:fs'

export const DEFAULT_ROOT = join(homedir(), '.dsh', 'knowledge')
export const MAIN_LIBRARY = 'dsh-main'

export function libFile(root, name) {
  return join(root, 'libraries', `${name}.db`)
}

export function attachmentDir(root, name) {
  return join(root, 'attachments', name)
}

export function backupDir(root) {
  return join(root, 'backup')
}

export function ensureDirs(root) {
  for (const dir of [root, join(root, 'libraries'), join(root, 'attachments'), backupDir(root)]) {
    mkdirSync(dir, { recursive: true })
  }
}

const NAME_RE = /^[a-z][a-z0-9_-]{1,62}$/

export function validateLibraryName(name, kind) {
  if (typeof name !== 'string' || !NAME_RE.test(name)) {
    throw new Error(`invalid library name: ${String(name)}`)
  }
  if (name === MAIN_LIBRARY) {
    if (kind !== undefined && kind !== 'main') throw new Error('dsh-main is reserved for the main library')
    return name
  }
  if (kind === 'main') throw new Error('only dsh-main may be the main library')
  if (kind === 'agent' && !name.startsWith('agent-')) {
    throw new Error('agent libraries must use the agent- prefix')
  }
  return name
}

export function assertAgentPrefix(name) {
  if (!name.startsWith('agent-')) throw new Error('agent libraries must use the agent- prefix')
  return name
}
