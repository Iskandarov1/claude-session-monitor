import { contextBridge, ipcRenderer } from 'electron'
import { IPC, PUSH, type CsmApi } from '@shared/types'

const api: CsmApi = {
  platform: process.platform,
  listSessions: () => ipcRenderer.invoke(IPC.sessionsList),
  loadTranscript: (sessionId) => ipcRenderer.invoke(IPC.transcriptLoad, sessionId),
  exportTranscript: (sessionId) => ipcRenderer.invoke(IPC.transcriptExport, sessionId),
  relay: (targets, text) => ipcRenderer.invoke(IPC.relaySend, targets, text),
  bridgeRetry: () => ipcRenderer.invoke(IPC.bridgeRetry),
  bridgeState: () => ipcRenderer.invoke(IPC.bridgeState),
  listFeed: () => ipcRenderer.invoke(IPC.feedList),
  search: (q) => ipcRenderer.invoke(IPC.searchQuery, q),
  getPrefs: () => ipcRenderer.invoke(IPC.prefsGet),
  setPrefs: (patch) => ipcRenderer.invoke(IPC.prefsSet, patch),
  openLogs: () => ipcRenderer.invoke(IPC.appOpenLogs),
  reload: () => ipcRenderer.invoke(IPC.appReload),
  windowControl: (action) => ipcRenderer.send(action === 'minimize' ? IPC.windowMinimize : action === 'maximize' ? IPC.windowMaximize : IPC.windowClose),
  on: (channel, cb) => {
    const allowed = new Set<string>(Object.values(PUSH))
    if (!allowed.has(channel)) throw new Error(`unknown push channel ${channel}`)
    const handler = (_event: Electron.IpcRendererEvent, payload: unknown) => cb(payload as never)
    ipcRenderer.on(channel, handler)
    return () => ipcRenderer.off(channel, handler)
  },
}

contextBridge.exposeInMainWorld('csm', api)
