import fs from 'node:fs/promises'
import path from 'node:path'
import { projectSlug } from '@main/paths'

async function exists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath)
    return true
  } catch {
    return false
  }
}

export async function findTranscript(sessionId: string, cwd: string, projectsRoot: string): Promise<string | null> {
  const direct = path.join(projectsRoot, projectSlug(cwd), `${sessionId}.jsonl`)
  if (await exists(direct)) return direct

  let dirs: string[]
  try {
    dirs = await fs.readdir(projectsRoot)
  } catch {
    return null
  }

  for (const dir of dirs) {
    const candidate = path.join(projectsRoot, dir, `${sessionId}.jsonl`)
    if (await exists(candidate)) return candidate
  }
  return null
}
