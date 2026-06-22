import type { ThemeMode } from '../types'

export const THEME_TRANSITION_CLASS = 'theme-transitioning'
export const THEME_TRANSITION_DURATION_MS = 220

interface ApplyThemeModeOptions {
  transition?: boolean
  schedule?: (callback: () => void, delay: number) => void
}

export function normalizeThemeMode(value: unknown): ThemeMode {
  return value === 'dark' ? 'dark' : 'light'
}

export function applyThemeMode(
  themeMode: ThemeMode,
  root: HTMLElement = document.documentElement,
  options: ApplyThemeModeOptions = {},
) {
  if (options.transition) {
    root.classList.add(THEME_TRANSITION_CLASS)
    const schedule = options.schedule ?? ((callback: () => void, delay: number) => window.setTimeout(callback, delay))
    schedule(() => root.classList.remove(THEME_TRANSITION_CLASS), THEME_TRANSITION_DURATION_MS)
  }
  root.classList.toggle('dark', themeMode === 'dark')
  root.style.colorScheme = themeMode
}
