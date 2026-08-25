import type { GridLayout, ScreenConfig, ScreenRoutingState } from '../types'
import {
  createScreen,
  DEFAULT_PROJECT,
  EMPTY_SCREEN_ROUTING,
} from '../types'
import type { EquipmentListState } from './equipmentList'

const STORAGE_KEY = 'led-cable-mapper:project:v1'

export interface PersistedProject {
  version: 1
  screens: ScreenConfig[]
  activeScreenId: string
  routingByScreen: Record<string, ScreenRoutingState>
  gridLayout: GridLayout
  showCombinedPacking: boolean
  equipmentList: EquipmentListState | null
}

export function createDefaultPersistedProject(): PersistedProject {
  const screens = DEFAULT_PROJECT.screens.map((s) => createScreen(s))
  const activeScreenId = screens[0]?.id ?? DEFAULT_PROJECT.activeScreenId
  return {
    version: 1,
    screens,
    activeScreenId,
    routingByScreen: { [activeScreenId]: { ...EMPTY_SCREEN_ROUTING } },
    gridLayout: 'stacked',
    showCombinedPacking: false,
    equipmentList: null,
  }
}

function normalizeRouting(
  raw: unknown,
  screenIds: string[],
): Record<string, ScreenRoutingState> {
  const src =
    raw && typeof raw === 'object'
      ? (raw as Record<string, Partial<ScreenRoutingState>>)
      : {}
  const out: Record<string, ScreenRoutingState> = {}
  for (const id of screenIds) {
    const r = src[id]
    out[id] = {
      manualModeData: Boolean(r?.manualModeData),
      manualModePower: Boolean(r?.manualModePower),
      manualOverrides: {
        ...EMPTY_SCREEN_ROUTING.manualOverrides,
        ...(r?.manualOverrides ?? {}),
        dataPorts: { ...(r?.manualOverrides?.dataPorts ?? {}) },
        powerLines: { ...(r?.manualOverrides?.powerLines ?? {}) },
        dataStartPoints: { ...(r?.manualOverrides?.dataStartPoints ?? {}) },
        powerStartPoints: { ...(r?.manualOverrides?.powerStartPoints ?? {}) },
        dataPortChains: { ...(r?.manualOverrides?.dataPortChains ?? {}) },
        powerLineChains: { ...(r?.manualOverrides?.powerLineChains ?? {}) },
        dataPortControllers: { ...(r?.manualOverrides?.dataPortControllers ?? {}) },
        dataPortColors: { ...(r?.manualOverrides?.dataPortColors ?? {}) },
        powerLineColors: { ...(r?.manualOverrides?.powerLineColors ?? {}) },
      },
    }
  }
  return out
}

/** Читает проект из localStorage (fallback: sessionStorage) */
export function loadPersistedProject(): PersistedProject | null {
  if (typeof localStorage === 'undefined') return null
  try {
    let raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) {
      try {
        raw = sessionStorage.getItem(STORAGE_KEY)
      } catch {
        raw = null
      }
    }
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<PersistedProject>
    if (!parsed || parsed.version !== 1 || !Array.isArray(parsed.screens)) {
      return null
    }
    const screens = parsed.screens.map((s) =>
      createScreen({
        ...s,
        id: s.id,
        name: s.name,
        emptyCabinets: s.emptyCabinets ?? [],
      }),
    )
    if (screens.length === 0) return null
    const ids = new Set(screens.map((s) => s.id))
    const activeScreenId =
      parsed.activeScreenId && ids.has(parsed.activeScreenId)
        ? parsed.activeScreenId
        : screens[0]!.id
    const gridLayout: GridLayout =
      parsed.gridLayout === 'side-by-side' ? 'side-by-side' : 'stacked'
    const project: PersistedProject = {
      version: 1,
      screens,
      activeScreenId,
      routingByScreen: normalizeRouting(parsed.routingByScreen, screens.map((s) => s.id)),
      gridLayout,
      showCombinedPacking: Boolean(parsed.showCombinedPacking),
      equipmentList: parsed.equipmentList ?? null,
    }
    // Восстановили из session — сразу закрепим в localStorage
    savePersistedProject(project)
    return project
  } catch {
    return null
  }
}

/** Сохраняет проект в localStorage (телефон и ПК — каждый в своём браузере) */
export function savePersistedProject(project: PersistedProject): boolean {
  if (typeof localStorage === 'undefined') return false
  try {
    const payload = JSON.stringify(project)
    localStorage.setItem(STORAGE_KEY, payload)
    // Дубль для надёжности на мобильных (иногда чистят один store)
    try {
      sessionStorage.setItem(STORAGE_KEY, payload)
    } catch {
      // ignore
    }
    return true
  } catch {
    return false
  }
}

/** Удаляет сохранённый проект */
export function clearPersistedProject(): void {
  if (typeof localStorage === 'undefined') return
  try {
    localStorage.removeItem(STORAGE_KEY)
  } catch {
    // ignore
  }
  try {
    sessionStorage.removeItem(STORAGE_KEY)
  } catch {
    // ignore
  }
}
