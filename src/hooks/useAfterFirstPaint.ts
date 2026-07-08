import { useEffect, useState } from 'react'

/** Включает тяжёлую работу после первого кадра (не блокирует ввод на старте) */
export function useAfterFirstPaint(): boolean {
  const [ready, setReady] = useState(false)

  useEffect(() => {
    const win = window as Window & {
      requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number
      cancelIdleCallback?: (id: number) => void
    }

    if (win.requestIdleCallback) {
      const id = win.requestIdleCallback(() => setReady(true), { timeout: 120 })
      return () => win.cancelIdleCallback?.(id)
    }

    const id = window.setTimeout(() => setReady(true), 0)
    return () => window.clearTimeout(id)
  }, [])

  return ready
}
