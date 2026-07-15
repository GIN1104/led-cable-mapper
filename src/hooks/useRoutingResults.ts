import { useMemo } from 'react'
import type { RoutingResult, ScreenConfig, ScreenRoutingState } from '../types'
import { EMPTY_SCREEN_ROUTING } from '../types'
import { computeRouting } from '../lib/routingEngine'
import { allScreensRoutingKey, fullRoutingKey, screenRoutingKey } from '../lib/screenConfigHash'
import { useAfterFirstPaint } from './useAfterFirstPaint'

function computeForScreen(
  screen: ScreenConfig,
  routing: ScreenRoutingState,
): RoutingResult {
  return computeRouting(screen, {
    manualModeData: routing.manualModeData,
    manualModePower: routing.manualModePower,
    manualOverrides:
      routing.manualModeData || routing.manualModePower
        ? routing.manualOverrides
        : undefined,
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
  const screenKey = screenRoutingKey(screen)
  const anyManual = routing.manualModeData || routing.manualModePower

  const result = useMemo(() => {
    if (!afterPaint) return null
    return computeForScreen(screen, routing)
    // routingKey — единственный триггер для ручных overrides; routing читается из замыкания текущего рендера
  }, [afterPaint, routingKey, screen, routing])

  const autoResult = useMemo(() => {
    if (!afterPaint) return null
    if (!anyManual) return result
    return computeRouting(screen)
    // autoResult зависит только от конфигурации экрана, не от ручных правок
  }, [afterPaint, screenKey, screen, anyManual, result])

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
      result: computeForScreen(screen, routingByScreen[screen.id] ?? EMPTY_SCREEN_ROUTING),
    }))
  }, [enabled, afterPaint, screens, combinedRoutingKey, routingByScreen])
}
