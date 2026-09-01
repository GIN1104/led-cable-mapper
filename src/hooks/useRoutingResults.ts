import { useEffect, useMemo, useRef, useState } from 'react'
import type { RoutingResult, ScreenConfig, ScreenRoutingState } from '../types'
import { EMPTY_SCREEN_ROUTING } from '../types'
import { computeRouting } from '../lib/routingEngine'
import { allScreensRoutingKey, fullRoutingKey, isLargeGrid, screenRoutingKey } from '../lib/screenConfigHash'
import { useAfterFirstPaint } from './useAfterFirstPaint'

/** Кэш маршрутизации — один экран не считается дважды (active + allScreens) */
const ROUTING_CACHE_MAX = 24
const routingCache = new Map<string, RoutingResult>()

function computeForScreenCached(
  screen: ScreenConfig,
  routing: ScreenRoutingState,
  projectScreens: ScreenConfig[] = [],
): RoutingResult {
  const key = `${fullRoutingKey(screen, routing)}::proj:${projectScreens
    .map((s) => `${s.id}:${s.pitchPreset}:${s.cabinetWidthMm}x${s.cabinetHeightMm}:${s.pixelPitchMm}`)
    .join(',')}`
  const hit = routingCache.get(key)
  if (hit) return hit
  const result = computeRouting(screen, {
    manualModeData: routing.manualModeData,
    manualModePower: routing.manualModePower,
    manualOverrides:
      routing.manualModeData || routing.manualModePower
        ? routing.manualOverrides
        : undefined,
    projectScreens,
  })
  routingCache.set(key, result)
  if (routingCache.size > ROUTING_CACHE_MAX) {
    const oldest = routingCache.keys().next().value
    if (oldest != null) routingCache.delete(oldest)
  }
  return result
}

/** Отложенный расчёт — не блокирует главный поток на больших сетках */
function useDeferredRouting(
  enabled: boolean,
  routingKey: string,
  defer: boolean,
  compute: () => RoutingResult,
): RoutingResult | null {
  const [result, setResult] = useState<RoutingResult | null>(null)
  const computeRef = useRef(compute)
  computeRef.current = compute

  useEffect(() => {
    if (!enabled) {
      setResult(null)
      return
    }
    let cancelled = false
    const run = () => {
      if (cancelled) return
      setResult(computeRef.current())
    }
    if (defer) {
      const win = window as Window & {
        requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number
        cancelIdleCallback?: (id: number) => void
      }
      if (win.requestIdleCallback) {
        const id = win.requestIdleCallback(run, { timeout: 400 })
        return () => {
          cancelled = true
          win.cancelIdleCallback?.(id)
        }
      }
      const id = window.setTimeout(run, 16)
      return () => {
        cancelled = true
        window.clearTimeout(id)
      }
    }
    run()
    return () => {
      cancelled = true
    }
  }, [enabled, defer, routingKey])

  return result
}

export interface ActiveRoutingState {
  result: RoutingResult | null
  autoResult: RoutingResult | null
  isRouting: boolean
  isDeferred: boolean
  routingKey: string
}

/**
 * Маршрутизация активного экрана — отложенный старт после первого paint.
 * Важно: пересчёт только по routingKey (цвета линий в ключ не входят → не вешают UI).
 */
export function useActiveRouting(
  screen: ScreenConfig,
  routing: ScreenRoutingState,
  projectScreens: ScreenConfig[] = [],
): ActiveRoutingState {
  const afterPaint = useAfterFirstPaint()
  const routingKey = fullRoutingKey(screen, routing)
  const screenKey = screenRoutingKey(screen)
  const anyManual = routing.manualModeData || routing.manualModePower
  const projectKey = projectScreens
    .map((s) => `${s.id}:${s.pitchPreset}:${s.cabinetWidthMm}x${s.cabinetHeightMm}`)
    .join('|')
  const deferHeavy = isLargeGrid(screen)

  const result = useDeferredRouting(
    afterPaint,
    routingKey,
    deferHeavy,
    () => computeForScreenCached(screen, routing, projectScreens),
  )

  const autoResult = useMemo(() => {
    if (!afterPaint || !result) return null
    if (!anyManual) return result
    return computeForScreenCached(screen, EMPTY_SCREEN_ROUTING, projectScreens)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- screenKey / anyManual / result / projectKey
  }, [afterPaint, screenKey, anyManual, result, projectKey])

  return {
    result,
    autoResult,
    isRouting: !afterPaint || (deferHeavy && result == null),
    isDeferred: !afterPaint,
    routingKey,
  }
}

/** Маршрутизация всех экранов — только когда нужна сводка / combined packing */
export function useAllScreensRouting(
  screens: ScreenConfig[],
  routingByScreen: Record<string, ScreenRoutingState>,
  enabled: boolean,
): Array<{ screen: ScreenConfig; result: RoutingResult }> {
  const afterPaint = useAfterFirstPaint()
  const combinedRoutingKey = allScreensRoutingKey(screens, routingByScreen)

  return useMemo(() => {
    if (!enabled || !afterPaint) return []
    return screens.map((screen) => ({
      screen,
      result: computeForScreenCached(
        screen,
        routingByScreen[screen.id] ?? EMPTY_SCREEN_ROUTING,
        screens,
      ),
    }))
    // eslint-disable-next-line react-hooks/exhaustive-deps -- только combinedRoutingKey
  }, [enabled, afterPaint, combinedRoutingKey])
}
