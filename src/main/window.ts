import { BrowserWindow } from 'electron'
import { join } from 'node:path'
import type { PrefsStore } from './prefs'

export function createMainWindow(prefs: PrefsStore): BrowserWindow {
  const saved = prefs.get().window
  const isMac = process.platform === 'darwin'
  const win = new BrowserWindow({
    ...(saved ?? { width: 1360, height: 760 }),
    minWidth: 1100,
    minHeight: 600,
    show: false,
    backgroundColor: '#252525',
    ...(isMac ? { titleBarStyle: 'hiddenInset' as const, trafficLightPosition: { x: 14, y: 14 } } : { frame: false }),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
    },
  })

  win.once('ready-to-show', () => win.show())

  let timer: NodeJS.Timeout | undefined
  const persist = () => {
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => {
      if (win.isDestroyed()) return
      const bounds = win.getBounds()
      prefs.set({ window: { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height } })
    }, 300)
  }
  win.on('resize', persist)
  win.on('move', persist)

  if (process.env.ELECTRON_RENDERER_URL) win.loadURL(process.env.ELECTRON_RENDERER_URL)
  else win.loadFile(join(__dirname, '../renderer/index.html'))

  return win
}
