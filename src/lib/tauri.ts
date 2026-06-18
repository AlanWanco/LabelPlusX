import { invoke } from '@tauri-apps/api/core'
import { text } from './i18n'
import type { WorkspaceData } from '../types'

interface DesktopWorkspacePayload {
  labelPath?: string
  groups: string[]
  comment: string
  files: Array<{
    name: string
    labels: Array<{
      id: number
      xPercent: number
      yPercent: number
      category: number
      text: string
    }>
    imagePath?: string
    imageSrc?: string
  }>
}

export function isTauriRuntime() {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window
}

export async function openDesktopWorkspace() {
  if (!isTauriRuntime()) {
    throw new Error(text.status.notTauriRuntime)
  }

  const { open } = await import('@tauri-apps/plugin-dialog')
  const result = await open({
    directory: false,
    multiple: false,
    filters: [{ name: 'LabelPlus Text', extensions: ['txt'] }],
  })

  return typeof result === 'string' ? result : null
}

export async function loadDesktopWorkspace(path: string): Promise<WorkspaceData> {
  const payload = await invoke<DesktopWorkspacePayload>('load_workspace', { path })

  return {
    source: 'desktop',
    labelPath: payload.labelPath,
    groups: payload.groups,
    comment: payload.comment,
    files: payload.files.map((file) => ({
      ...file,
      imageSrc: file.imageSrc,
    })),
  }
}

export async function saveDesktopWorkspace(path: string, content: string) {
  await invoke('save_workspace', { path, content })
}
