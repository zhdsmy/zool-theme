import { useSyncExternalStore } from 'react'

type Dialogs = { login: boolean; search: boolean }

let dialogs: Dialogs = { login: false, search: false }
const listeners = new Set<() => void>()

const set = (patch: Partial<Dialogs>) => {
  dialogs = { ...dialogs, ...patch }
  listeners.forEach((l) => l())
}

export const openDialog = (name: keyof Dialogs) => set({ [name]: true })
export const closeDialog = (name: keyof Dialogs) => set({ [name]: false })

export const useDialog = (name: keyof Dialogs) =>
  useSyncExternalStore(
    (l) => {
      listeners.add(l)
      return () => listeners.delete(l)
    },
    () => dialogs[name],
    () => false,
  )

const useMatch = (query: string) =>
  useSyncExternalStore(
    (l) => {
      const mq = window.matchMedia(query)
      mq.addEventListener('change', l)
      return () => mq.removeEventListener('change', l)
    },
    () => window.matchMedia(query).matches,
  )

export const useIsMobile = () => useMatch('(width < 768px)')
/** Phones plus portrait tablets and foldable inner screens: below the lg breakpoint. */
export const useIsNarrow = () => useMatch('(width < 1024px)')
