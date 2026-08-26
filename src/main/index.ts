import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron'
import fs from 'node:fs/promises'
import path from 'node:path'
import { Bridge } from './bridge'
import { FeedBuilder } from './feed'
import { registerIpc, wirePush } from './ipc'
import { claudeHome, projectsDir, sessionsDir } from './paths'
import { PrefsStore } from './prefs'
import { RegistryWatcher } from './registry'
import { loadRecentTranscripts, SearchIndex } from './search'
import { SessionStore } from './store'
import { createMainWindow } from './window'

const BRIDGE_NAME = 'csm-bridge'

async function main(): Promise<void> {
  if (!app.requestSingleInstanceLock()) {
    app.quit()
    return
  }

  app.on('second-instance', () => {
    const [win] = BrowserWindow.getAllWindows()
    if (!win) return
    if (win.isMinimized()) win.restore()
    win.focus()
  })

  await app.whenReady()

  const home = claudeHome()
  const projectsRoot = projectsDir(home)
  const prefs = new PrefsStore(path.join(app.getPath('userData'), 'prefs.json'))
  await prefs.load()

  const bridge = new Bridge({
    cwd: app.getPath('userData'),
    name: BRIDGE_NAME,
    command: process.platform === 'win32' ? 'claude.cmd' : 'claude',
  })
  const registry = new RegistryWatcher(sessionsDir(home))
  const store = new SessionStore({
    registry,
    projectsRoot,
    excludeNames: [BRIDGE_NAME],
    isExcludedPid: (pid) => pid === bridge.pid,
  })
  store.setPinned(prefs.get().pinned)
  const feed = new FeedBuilder({ bridgeName: BRIDGE_NAME })
  const search = new SearchIndex()

  let win = createMainWindow(prefs)
  const send = (channel: string, payload: unknown) => {
    for (const window of BrowserWindow.getAllWindows()) window.webContents.send(channel, payload)
  }

  registerIpc(ipcMain, {
    store,
    bridge,
    feed,
    search,
    prefs,
    projectsRoot,
    send,
    saveMarkdown: async (defaultName, content) => {
      const result = await dialog.showSaveDialog(win, {
        defaultPath: defaultName,
        filters: [{ name: 'Markdown', extensions: ['md'] }],
      })
      if (result.canceled || !result.filePath) return { saved: false }
      await fs.writeFile(result.filePath, content, 'utf8')
      return { saved: true, path: result.filePath }
    },
    openPath: async (targetPath) => {
      await shell.openPath(targetPath)
    },
    reload: () => {
      for (const window of BrowserWindow.getAllWindows()) window.webContents.reload()
    },
    windowControl: (action) => {
      const target = BrowserWindow.getFocusedWindow() ?? win
      if (action === 'minimize') target.minimize()
      else if (action === 'close') target.close()
      else if (target.isMaximized()) target.unmaximize()
      else target.maximize()
    },
  })
  const unpush = wirePush({ store, bridge, feed, search, send })

  await registry.start()
  await store.start()
  bridge.start()

  void loadRecentTranscripts(projectsRoot, 7, new Set(store.sessions().map((session) => session.sessionId))).then((list) => {
    for (const transcript of list) search.replace(transcript.sessionId, transcript.name, transcript.events)
  })

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) win = createMainWindow(prefs)
  })

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
  })

  let cleanedUp = false
  app.on('before-quit', (event) => {
    if (cleanedUp) return
    event.preventDefault()
    void (async () => {
      cleanedUp = true
      unpush()
      await Promise.allSettled([bridge.stop(), store.stop(), registry.stop(), prefs.flush()])
      app.quit()
    })()
  })
}

void main()
