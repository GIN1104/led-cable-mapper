import { useMemo } from 'react'
import type { RoutingResult, ScreenConfig, ScreenRoutingState } from '../types'
import { EMPTY_SCREEN_ROUTING } from '../types'
import { computeRouting } from '../lib/routingEngine'
import { allScreensRoutingKey, fullRoutingKey, screenRoutingKey } from '../lib/screenConfigHash'
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

  const result = useMemo(() => {
    if (!afterPaint) return null
    return computeForScreenCached(screen, routing, projectScreens)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- только routingKey/projectKey
  }, [afterPaint, routingKey, projectKey])

  const autoResult = useMemo(() => {
    if (!afterPaint) return null
    if (!anyManual) return result
    return computeForScreenCached(screen, EMPTY_SCREEN_ROUTING, projectScreens)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- screenKey / anyManual / result / projectKey
  }, [afterPaint, screenKey, anyManual, result, projectKey])

  return {
    result,
    autoResult,
    isRouting: !afterPaint,
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
