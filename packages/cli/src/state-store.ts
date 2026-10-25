import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { InvalidInputError, isSessionExport } from '@unorder/core'
import type { SessionExport, SessionStore } from '@unorder/core'

interface StateFile {
  version: 1
  sessions: Record<string, SessionExport>
}

const emptyState = (): StateFile => ({ version: 1, sessions: {} })

export const defaultStatePath = (): string => {
  if (process.env.UNORDER_STATE) {
    return process.env.UNORDER_STATE
  }
  const configHome = process.env.XDG_CONFIG_HOME ?? join(homedir(), '.config')
  return join(configHome, 'unorder', 'sessions.json')
}

/** File-backed session store used by one-shot CLI runs. */
export class FileSessionStore implements SessionStore {
  readonly path: string

  constructor(path = defaultStatePath()) {
    this.path = path
  }

  async #read(): Promise<StateFile> {
    let text: string
    try {
      text = await readFile(this.path, 'utf8')
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return emptyState()
      }
      throw new InvalidInputError(`Failed to read state file: ${this.path}`, { cause: error })
    }
    let value: unknown
    try {
      value = JSON.parse(text)
    } catch (error) {
      throw new InvalidInputError(`State file is not valid JSON: ${this.path}`, { cause: error })
    }
    if (typeof value !== 'object' || value === null) {
      throw new InvalidInputError(`State file has an invalid shape: ${this.path}`)
    }
    const state = value as Partial<StateFile>
    if (state.version !== 1 || typeof state.sessions !== 'object' || state.sessions === null) {
      throw new InvalidInputError(`Unsupported state file version: ${this.path}`)
    }
    return { version: 1, sessions: state.sessions }
  }

  async #write(state: StateFile): Promise<void> {
    await mkdir(dirname(this.path), { recursive: true, mode: 0o700 })
    const temporary = `${this.path}.${process.pid}.tmp`
    await writeFile(temporary, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 })
    await rename(temporary, this.path)
  }

  async load(provider: string): Promise<SessionExport | null> {
    const session = (await this.#read()).sessions[provider]
    if (!session) {
      return null
    }
    if (!isSessionExport(session)) {
      throw new InvalidInputError(`Invalid session for provider "${provider}" in ${this.path}`)
    }
    return session
  }

  async save(session: SessionExport): Promise<void> {
    const state = await this.#read()
    state.sessions[session.provider] = session
    await this.#write(state)
  }

  async clear(provider: string): Promise<void> {
    const state = await this.#read()
    if (!(provider in state.sessions)) {
      return
    }
    delete state.sessions[provider]
    await this.#write(state)
  }
}
