export interface LabelEntry {
  id: number
  xPercent: number
  yPercent: number
  category: number
  text: string
}

export interface WorkspaceFile {
  name: string
  labels: LabelEntry[]
  imagePath?: string
  imageSrc?: string
}

export interface WorkspaceData {
  source: 'web' | 'desktop'
  labelPath?: string
  groups: string[]
  comment: string
  files: WorkspaceFile[]
}

export type ThemeMode = 'light' | 'dark'
export type ReadingMode = 'horizontal' | 'vertical'
