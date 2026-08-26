import { useEffect } from 'react'
import { useStore } from '../store'

export function useHotkeys(): void {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const mod = event.metaKey || event.ctrlKey
      if (mod && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        useStore.getState().setSearchOpen(true)
      } else if (event.key === 'Escape') {
        useStore.getState().setSearchOpen(false)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
}
