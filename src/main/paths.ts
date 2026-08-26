import os from 'node:os'
import path from 'node:path'

export function claudeHome(env: NodeJS.ProcessEnv = process.env, home: string = os.homedir()): string {
  return env.CLAUDE_CONFIG_DIR && env.CLAUDE_CONFIG_DIR.length > 0 ? env.CLAUDE_CONFIG_DIR : path.join(home, '.claude')
}

export function sessionsDir(root: string = claudeHome()): string {
  return path.join(root, 'sessions')
}

export function projectsDir(root: string = claudeHome()): string {
  return path.join(root, 'projects')
}

export function projectSlug(cwd: string): string {
  return cwd.replace(/[^A-Za-z0-9]/g, '-')
}

export function transcriptPath(cwd: string, sessionId: string, root: string = claudeHome()): string {
  return path.join(projectsDir(root), projectSlug(cwd), `${sessionId}.jsonl`)
}
