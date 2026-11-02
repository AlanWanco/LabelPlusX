import type { PaletteId } from '../types'

/**
 * 配色主题注册表。颜色值定义在 src/index.css 的 [data-palette] 规则中，
 * 这里只保存选择器需要的 id 与展示名称。
 */
export interface PaletteOption {
  id: PaletteId
  name: string
}

export const paletteOptions: PaletteOption[] = [
  { id: 'default', name: '默认' },
  { id: 'catppuccin', name: 'Catppuccin' },
  { id: 'nord', name: 'Nord' },
  { id: 'gruvbox', name: 'Gruvbox' },
  { id: 'rose-pine', name: 'Rosé Pine' },
  { id: 'tokyo-night', name: 'Tokyo Night' },
  { id: 'dracula', name: 'Dracula' },
]

export const defaultPalette: PaletteId = 'default'

export function isPaletteId(value: unknown): value is PaletteId {
  return typeof value === 'string' && paletteOptions.some((option) => option.id === value)
}
