import { useMemo } from 'react'
import type { RoutingResult, ScreenConfig, ScreenRoutingState } from '../types'
import { EMPTY_SCREEN_ROUTING } from '../types'
import { computeRouting } from '../lib/routingEngine'
import { fullRoutingKey } from '../lib/screenConfigHash'
import { useAfterFirstPaint } from './useAfterFirstPaint'

function computeForScreen(
  screen: ScreenConfig,
  routing: ScreenRoutingState,
): RoutingResult {
  return computeRouting(screen, {
    manualMode: routing.manualMode,
    manualOverrides: routing.manualMode ? routing.manualOverrides : undefined,
  })
}

export interface ActiveRoutingState {
  result: RoutingResult | null
  autoResult: RoutingResult | null
  isRouting: boolean
  isDeferred: boolean
  routingKey: string
}

/** Маршрутизация активного экрана — отложенный старт после первого paint */
export function useActiveRouting(
  screen: ScreenConfig,
  routing: ScreenRoutingState,
): ActiveRoutingState {
  const afterPaint = useAfterFirstPaint()
  const routingKey = fullRoutingKey(screen, routing)

  const result = useMemo(() => {
    if (!afterPaint) return null
    return computeForScreen(screen, routing)
  }, [afterPaint, routingKey, screen, routing])

  const autoResult = useMemo(() => {
    if (!afterPaint) return null
    if (!routing.manualMode) return result
    return computeRouting(screen)
  }, [afterPaint, routingKey, screen, routing.manualMode, result])

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

  return useMemo(() => {
    if (!enabled || !afterPaint) return []
    return screens.map((screen) => ({
      screen,
      result: computeForScreen(screen, routingByScreen[screen.id] ?? EMPTY_SCREEN_ROUTING),
    }))
  }, [enabled, afterPaint, screens, routingByScreen])
}
