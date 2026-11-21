export type CrewState = 'working' | 'done' | 'error'

/**
 * One agent instance of the crew, keyed in the atom by its agentId (or by
 * `spawn:<tool_use_id>:<n>` while its spawn has not resolved yet).
 */
export type CrewStatus = {
  /** The member's id (`joonie`, `kookie`, ...). */
  member: string
  state: CrewState
  /** The Agent call's description of the task; may be empty. */
  task: string
  /** Why it ended in error: a spawn's deny, or the turn's reason. */
  reason?: string
}

export type RoleId = 'docs' | 'ideas' | 'dev' | 'qa' | 'ux' | 'negocio' | 'devops'

declare module 'claude-code' {
  interface PluginState {
    borahae: {
      crew: Shaped<Record<string, CrewStatus>>
      roles: Shaped<Record<string, RoleId>>
    }
  }
}
