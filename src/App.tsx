import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { flushSync } from 'react-dom'
import type { ChangeEvent, CSSProperties, MouseEvent as ReactMouseEvent } from 'react'
import { ALargeSmall, ArrowLeft, ChevronRight, CircleHelp, Download, Files, FolderOpen, Fullscreen, Image as ImageIcon, Keyboard, Languages, Layers, Minus, Moon, Palette, Plus, Save, ScanEye, Settings, StickyNote, SunMedium, SunMoon, Tag, TextCursorInput, Trash2, ZoomIn } from 'lucide-react'
import './App.css'
import packageJson from '../package.json'
import {
  createDesktopWorkspace,
  isTauriRuntime,
  loadDesktopWorkspace,
  loadDesktopImageSrc,
  openDesktopProjectDirectory,
  openDesktopWorkspace,
  saveDesktopWorkspace,
} from './lib/tauri'
import {
  applyStoredLabelTexts,
  attachBrowserImages,
  buildStoredLabelTexts,
  getWorkspaceStorageKey,
  parseLabelPlusText,
  readTextFile,
  serializeLabelPlusText,
} from './lib/labelplus'
import { text } from './lib/i18n'
import { defaultPalette, isPaletteId, paletteOptions } from './lib/palettes'
import { useSlidingIndicator } from './lib/slidingIndicator'
import type { LabelEntry, PaletteId, ReadingMode, ThemeMode, WorkspaceData } from './types'

const themeStorageKey = 'labelplusx-theme'
const readingModeStorageKey = 'labelplusx-reading-mode'
const settingsStorageKey = 'labelplusx-settings'
type SettingsDetail = 'quickText' | 'shortcuts'

const minUiScale = 0.8
const maxUiScale = 1.5
const exportFileName = 'labelplus-export.txt'
const minPreviewZoom = 0.1
const maxPreviewZoom = 8
const categoryColors = ['#ef4444', '#3b82f6', '#22c55e', '#f59e0b', '#a855f7', '#06b6d4', '#ec4899', '#f97316', '#64748b']
const appVersion = packageJson.version
const projectHomepage = 'https://github.com/AlanWanco/LabelPlusX'
const editableSelector = 'input, textarea, select, [contenteditable="true"]'
const defaultGroupNames = ['框内', '框外']

function clampUiScale(value: number) {
  if (!Number.isFinite(value)) {
    return 1
  }

  return Math.min(maxUiScale, Math.max(minUiScale, Math.round(value * 100) / 100))
}

function getNowTimestamp() {
  return Date.now()
}

function renderShortcutText(value: string) {
  return value.split('`').map((part, index) => (index % 2 === 1 ? <code key={index}>{part}</code> : part))
}

const defaultQuickTexts = [
  { text: '啊', key: 'A' },
  { text: '嗯', key: 'E' },
  { text: '呜', key: 'W' },
  { text: '唔', key: 'W' },
  { text: '咕', key: 'G' },
  { text: '咿', key: 'Y' },
  { text: '呀', key: 'Y' },
  { text: '啾', key: 'J' },
  { text: '噗', key: 'P' },
  { text: '♥', key: '1' },
  { text: '♡', key: '2' },
  { text: '♪', key: '3' },
]

interface QuickTextItem {
  text: string
  key: string
}

interface AppSettings {
  autoSave: boolean
  checkFontSize: number
  groupColors: string[]
  markerFontSize: number
  palette: PaletteId
  quickTexts: QuickTextItem[]
  uiScale: number
}

interface EditorSnapshot {
  workspace: WorkspaceData
  activeFileName: string
  activeLabelId: number | null
  selectedCategory: number
}

function getWorkspaceMetaStorageKey(workspace: WorkspaceData) {
  return `${getWorkspaceStorageKey(workspace)}:meta`
}

function getInitialReadingMode(): ReadingMode {
  if (typeof window === 'undefined') {
    return 'vertical'
  }

  const savedMode = window.localStorage.getItem(readingModeStorageKey)
  return savedMode === 'horizontal' ? 'horizontal' : 'vertical'
}

function getInitialTheme(): ThemeMode {
  if (typeof window === 'undefined') {
    return 'dark'
  }

  const savedTheme = window.localStorage.getItem(themeStorageKey)
  if (savedTheme === 'light' || savedTheme === 'dark') {
    return savedTheme
  }

  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

const defaultMarkerFontSize = 16
const minMarkerFontSize = 12
const maxMarkerFontSize = 22

function createDefaultSettings(): AppSettings {
  return {
    autoSave: true,
    checkFontSize: 16,
    groupColors: [...categoryColors],
    markerFontSize: defaultMarkerFontSize,
    palette: defaultPalette,
    quickTexts: defaultQuickTexts,
    uiScale: 1,
  }
}

function normalizeGroupColors(value: unknown): string[] {
  const source = Array.isArray(value) ? value : []
  return categoryColors.map((fallback, index) => {
    const candidate = source[index]
    return typeof candidate === 'string' && /^#[0-9a-f]{6}$/i.test(candidate) ? candidate : fallback
  })
}

function getInitialSettings(): AppSettings {
  if (typeof window === 'undefined') {
    return createDefaultSettings()
  }

  try {
    const raw = window.localStorage.getItem(settingsStorageKey)
    if (!raw) {
      return createDefaultSettings()
    }

    const parsed = JSON.parse(raw) as Partial<AppSettings> & { labelFontSize?: number }
    return {
      autoSave: parsed.autoSave ?? true,
      checkFontSize: Math.min(24, Math.max(12, parsed.checkFontSize ?? 16)),
      groupColors: normalizeGroupColors(parsed.groupColors),
      markerFontSize: Math.min(
        maxMarkerFontSize,
        Math.max(minMarkerFontSize, parsed.markerFontSize ?? parsed.labelFontSize ?? defaultMarkerFontSize),
      ),
      palette: isPaletteId(parsed.palette) ? parsed.palette : defaultPalette,
      quickTexts: Array.isArray(parsed.quickTexts) && parsed.quickTexts.length > 0
        ? parsed.quickTexts
          .map((item) => ({
            text: String(item.text ?? '').slice(0, 32),
            key: String(item.key ?? '').slice(0, 1).toUpperCase(),
          }))
          .filter((item) => item.text)
        : defaultQuickTexts,
      uiScale: clampUiScale(parsed.uiScale ?? 1),
    }
  } catch {
    return createDefaultSettings()
  }
}

function App() {
  const isDesktop = isTauriRuntime()
  const isMacPlatform = typeof navigator !== 'undefined' && /mac/i.test(navigator.platform)
  const isWindowsPlatform = typeof navigator !== 'undefined' && /win/i.test(navigator.userAgent)
  const [theme, setTheme] = useState<ThemeMode>(getInitialTheme)
  const [settings, setSettings] = useState<AppSettings>(getInitialSettings)
  const [uiScaleDraft, setUiScaleDraft] = useState(() => Math.round(settings.uiScale * 100))
  const [workspace, setWorkspace] = useState<WorkspaceData | null>(null)
  const [activeFileName, setActiveFileName] = useState<string>('')
  const [activeLabelId, setActiveLabelId] = useState<number | null>(null)
  const [status, setStatus] = useState<string>(text.status.waitingWorkspace)
  const [isBusy, setIsBusy] = useState(false)
  const [isDragging, setIsDragging] = useState(false)
  const [isSettingsOpen, setIsSettingsOpen] = useState(false)
  const [groupColorIndex, setGroupColorIndex] = useState<number | null>(null)
  const [hasUnsavedLocalEdits, setHasUnsavedLocalEdits] = useState(false)
  const [previewZoom, setPreviewZoom] = useState(1)
  const [previewPan, setPreviewPan] = useState({ x: 0, y: 0 })
  const [isCheckMode, setIsCheckMode] = useState(false)
  const [readingMode, setReadingMode] = useState<ReadingMode>(getInitialReadingMode)
  const [imageNaturalSize, setImageNaturalSize] = useState({ width: 0, height: 0 })
  const [selectedCategory, setSelectedCategory] = useState(1)
  const [labelPanelWidth, setLabelPanelWidth] = useState(360)
  const [filePanelWidth, setFilePanelWidth] = useState(260)
  const [arePreviewLabelsHidden, setArePreviewLabelsHidden] = useState(false)
  const [isQuickTextOpen, setIsQuickTextOpen] = useState(false)
  const [quickTextMode, setQuickTextMode] = useState<'editor' | 'preview' | null>(null)
  const [settingsDetail, setSettingsDetail] = useState<SettingsDetail | null>(null)
  const [previewQuickTextAnchor, setPreviewQuickTextAnchor] = useState<{ x: number; y: number; xPercent: number; yPercent: number } | null>(null)
  const [desktopImageSrcMap, setDesktopImageSrcMap] = useState<Record<string, string>>({})
  const objectUrlsRef = useRef<string[]>([])
  const importDroppedFilesRef = useRef<(fileList: FileList | File[]) => Promise<void>>(async () => {})
  const importDesktopDroppedPathsRef = useRef<(paths: string[]) => Promise<void>>(async () => {})
  const undoHistoryRef = useRef<EditorSnapshot[]>([])
  const redoHistoryRef = useRef<EditorSnapshot[]>([])
  const pendingDragHistoryPointerIdRef = useRef<number | null>(null)
  const hasManualPreviewTransformRef = useRef(false)
  const fileListRef = useRef<HTMLDivElement | null>(null)
  const labelListRef = useRef<HTMLDivElement | null>(null)
  const newWorkspaceImageInputRef = useRef<HTMLInputElement | null>(null)
  const labelFileInputRef = useRef<HTMLInputElement | null>(null)
  const quickTextPanelRef = useRef<HTMLDivElement | null>(null)
  const detailPageRef = useRef<HTMLDivElement | null>(null)
  const labelEditorRef = useRef<HTMLTextAreaElement | null>(null)
  const detailBackButtonRef = useRef<HTMLButtonElement | null>(null)
  const detailOriginRef = useRef<DOMRect | null>(null)
  const detailReturnFocusRef = useRef<HTMLButtonElement | null>(null)
  const detailIsAnimatingRef = useRef(false)
  const settingsOverlayRef = useRef<HTMLDivElement | null>(null)
  const settingsPopupRef = useRef<HTMLDivElement | null>(null)
  const settingsCloseTimerRef = useRef<number | null>(null)
  const workspaceLayoutRef = useRef<HTMLElement | null>(null)
  const panelResizeStateRef = useRef<{ panel: 'file' | 'label'; startX: number; startWidth: number } | null>(null)
  const labelTextUndoCapturedRef = useRef(false)
  const labelTextUndoLastCaptureAtRef = useRef(0)
  const labelTextUndoLastValueRef = useRef('')
  const commentUndoCapturedRef = useRef(false)
  const commentUndoLastCaptureAtRef = useRef(0)
  const commentUndoLastValueRef = useRef('')
  const groupUndoCapturedRef = useRef<number | null>(null)
  const pendingFileZoomModeRef = useRef<'fit' | 'preserve'>('fit')
  const pendingFileZoomRef = useRef<number | null>(null)
  const previewPointerRef = useRef<{ xPercent: number; yPercent: number; clientX: number; clientY: number; inside: boolean }>({
    xPercent: 0.5,
    yPercent: 0.5,
    clientX: 0,
    clientY: 0,
    inside: false,
  })
  const imageFrameRef = useRef<HTMLDivElement | null>(null)
  const previewImageRef = useRef<HTMLImageElement | null>(null)
  const interactionRef = useRef<
    | {
        type: 'pan'
        pointerId: number
        startX: number
        startY: number
        basePanX: number
        basePanY: number
      }
    | {
        type: 'label'
        pointerId: number
        labelId: number
      }
    | null
  >(null)
  const activeFile = workspace?.files.find((file) => file.name === activeFileName) ?? null
  const activeFileImageSrc = activeFile ? activeFile.imageSrc ?? desktopImageSrcMap[activeFile.name] : undefined
  const activeLabel = activeFile?.labels.find((label) => label.id === activeLabelId) ?? null
  const activeLabelIndex = activeFile?.labels.findIndex((label) => label.id === activeLabelId) ?? -1
  const untranslatedLabels = activeFile?.labels.filter((label) => label.text.trim().length === 0) ?? []
  const firstUntranslatedLabel = untranslatedLabels[0] ?? null
  const scaledPreviewWidth = imageNaturalSize.width > 0 ? imageNaturalSize.width * previewZoom : 0
  const scaledPreviewHeight = imageNaturalSize.height > 0 ? imageNaturalSize.height * previewZoom : 0
  const uiScale = settings.uiScale

  useEffect(() => {
    document.documentElement.dataset.theme = theme
    window.localStorage.setItem(themeStorageKey, theme)
  }, [theme])

  useEffect(() => {
    document.documentElement.dataset.palette = settings.palette
  }, [settings.palette])

  useEffect(() => {
    document.documentElement.style.setProperty('--ui-scale', String(settings.uiScale))
  }, [settings.uiScale])

  useEffect(() => {
    if (isDesktop && isWindowsPlatform) {
      document.documentElement.dataset.platform = 'windows-tauri'
      return
    }

    delete document.documentElement.dataset.platform
  }, [isDesktop, isWindowsPlatform])

  useEffect(() => {
    window.localStorage.setItem(settingsStorageKey, JSON.stringify(settings))
  }, [settings])

  useEffect(() => {
    window.localStorage.setItem(readingModeStorageKey, readingMode)
  }, [readingMode])

  useEffect(() => {
    return () => {
      for (const url of objectUrlsRef.current) {
        URL.revokeObjectURL(url)
      }
    }
  }, [])

  function hydrateWorkspaceWithStoredTexts(nextWorkspace: WorkspaceData) {
    const storageKey = getWorkspaceStorageKey(nextWorkspace)
    const storedValue = window.localStorage.getItem(storageKey)

    if (!storedValue) {
      setHasUnsavedLocalEdits(false)
      return nextWorkspace
    }

    try {
      const storedTexts = JSON.parse(storedValue) as Record<string, string>
      const hydratedWorkspace = applyStoredLabelTexts(nextWorkspace, storedTexts)
      const storedMeta = window.localStorage.getItem(getWorkspaceMetaStorageKey(nextWorkspace))
      if (!storedMeta) {
        return hydratedWorkspace
      }

      try {
        const parsedMeta = JSON.parse(storedMeta) as { comment?: string }
        return {
          ...hydratedWorkspace,
          comment: parsedMeta.comment ?? hydratedWorkspace.comment,
        }
      } catch {
        return hydratedWorkspace
      }
    } catch {
      return nextWorkspace
    }
  }

  function applyWorkspace(nextWorkspace: WorkspaceData) {
    const hydratedWorkspace = hydrateWorkspaceWithStoredTexts(nextWorkspace)
    setWorkspace(hydratedWorkspace)
    setDesktopImageSrcMap({})
    setActiveFileName(hydratedWorkspace.files[0]?.name ?? '')
    setActiveLabelId(hydratedWorkspace.files[0]?.labels[0]?.id ?? null)
    setSelectedCategory(1)
    undoHistoryRef.current = []
    redoHistoryRef.current = []
    setPreviewZoom(1)
    setPreviewPan({ x: 0, y: 0 })
    setImageNaturalSize({ width: 0, height: 0 })
  }

  function cloneWorkspaceSnapshot(source: WorkspaceData) {
    return structuredClone(source)
  }

  function captureEditorSnapshot(): EditorSnapshot | null {
    if (!workspace) {
      return null
    }

    return {
      workspace: cloneWorkspaceSnapshot(workspace),
      activeFileName,
      activeLabelId,
      selectedCategory,
    }
  }

  function applyEditorSnapshot(snapshot: EditorSnapshot) {
    setWorkspace(cloneWorkspaceSnapshot(snapshot.workspace))
    setActiveFileName(snapshot.activeFileName)
    setActiveLabelId(snapshot.activeLabelId)
    setSelectedCategory(snapshot.selectedCategory)
    setHasUnsavedLocalEdits(true)
  }

  function pushUndoSnapshot() {
    const snapshot = captureEditorSnapshot()
    if (!snapshot) {
      return
    }

    undoHistoryRef.current.push(snapshot)
    if (undoHistoryRef.current.length > 120) {
      undoHistoryRef.current.shift()
    }
    redoHistoryRef.current = []
  }

  function captureProgressiveUndo(
    value: string,
    capturedRef: { current: boolean },
    lastCaptureAtRef: { current: number },
    lastValueRef: { current: string },
  ) {
    if (!capturedRef.current) {
      return
    }

    const now = getNowTimestamp()
    const elapsed = now - lastCaptureAtRef.current
    const lastValue = lastValueRef.current
    const isBigJump = Math.abs(value.length - lastValue.length) >= 20

    if (elapsed < 700 && !isBigJump) {
      return
    }

    pushUndoSnapshot()
    lastCaptureAtRef.current = now
    lastValueRef.current = value
  }

  function undoLastChange() {
    const snapshot = undoHistoryRef.current.pop()
    const current = captureEditorSnapshot()
    if (!snapshot || !current) {
      return
    }

    redoHistoryRef.current.push(current)
    applyEditorSnapshot(snapshot)
  }

  function redoLastChange() {
    const snapshot = redoHistoryRef.current.pop()
    const current = captureEditorSnapshot()
    if (!snapshot || !current) {
      return
    }

    undoHistoryRef.current.push(current)
    applyEditorSnapshot(snapshot)
  }

  function replaceObjectUrls(urls: string[]) {
    for (const url of objectUrlsRef.current) {
      URL.revokeObjectURL(url)
    }

    objectUrlsRef.current = urls
  }

  async function loadWebWorkspaceFromFile(labelFile: File) {
    const labelText = await readTextFile(labelFile)
    const nextWorkspace = parseLabelPlusText(labelText, labelFile.name)
    applyWorkspace(nextWorkspace)
    setStatus(text.status.webWorkspaceLoaded(labelFile.name))
    return nextWorkspace
  }

  function attachImagesToWorkspace(baseWorkspace: WorkspaceData, imageFiles: File[]) {
    const nextWorkspace = attachBrowserImages(baseWorkspace, imageFiles)
    const urls = nextWorkspace.files
      .map((file) => file.imageSrc)
      .filter((value): value is string => Boolean(value))
    replaceObjectUrls(urls)
    applyWorkspace(nextWorkspace)
    setStatus(text.status.localImagesLinked(imageFiles.length))
  }

  function createWebWorkspaceFromImages(imageFiles: File[]) {
    if (imageFiles.length === 0) {
      setStatus(text.status.imageFilesRequired)
      return
    }

    const nextWorkspace: WorkspaceData = {
      source: 'web',
      groups: [...defaultGroupNames],
      comment: '',
      files: imageFiles
        .filter((file) => file.type.startsWith('image/'))
        .sort((left, right) => left.name.localeCompare(right.name, 'zh-CN'))
        .map((file) => ({
          name: file.name,
          labels: [],
          imageSrc: URL.createObjectURL(file),
        })),
    }

    if (nextWorkspace.files.length === 0) {
      setStatus(text.status.imageFilesRequired)
      return
    }

    replaceObjectUrls(nextWorkspace.files.map((file) => file.imageSrc!).filter(Boolean))
    applyWorkspace(nextWorkspace)
    setStatus(text.status.webWorkspaceCreated(nextWorkspace.files.length))
  }

  async function importDroppedFiles(fileList: FileList | File[]) {
    const files = Array.from(fileList)
    if (files.length === 0) {
      return
    }

    const labelFile = files.find((file) => /\.txt$/i.test(file.name))
    const imageFiles = files.filter((file) => file.type.startsWith('image/'))

    if (!labelFile && imageFiles.length === 0) {
      setStatus(text.status.droppedFileUnsupported)
      return
    }

    setIsBusy(true)

    try {
      let baseWorkspace = workspace

      if (labelFile) {
        baseWorkspace = await loadWebWorkspaceFromFile(labelFile)
      }

      if (imageFiles.length > 0) {
        if (!baseWorkspace) {
          setStatus(text.status.importTextBeforeImages)
          return
        }

        attachImagesToWorkspace(baseWorkspace, imageFiles)
      }
    } catch (error) {
      setStatus(error instanceof Error ? error.message : text.status.dropImportFailed)
    } finally {
      setIsBusy(false)
      setIsDragging(false)
    }
  }

  async function handleDesktopImport() {
    setIsBusy(true)

    try {
      const selectedPath = await openDesktopWorkspace()
      if (!selectedPath) {
        setStatus(text.status.fileSelectionCancelled)
        return
      }

      const nextWorkspace = await loadDesktopWorkspace(selectedPath)
      applyWorkspace(nextWorkspace)
      setStatus(text.status.desktopWorkspaceLoaded(nextWorkspace.labelPath ?? selectedPath))
    } catch (error) {
      setStatus(error instanceof Error ? error.message : text.status.desktopWorkspaceLoadFailed)
    } finally {
      setIsBusy(false)
    }
  }

  async function handleDesktopCreateWorkspace() {
    setIsBusy(true)

    try {
      const selectedPath = await openDesktopProjectDirectory()
      if (!selectedPath) {
        setStatus(text.status.fileSelectionCancelled)
        return
      }

      const nextWorkspace = await createDesktopWorkspace(selectedPath)
      applyWorkspace(nextWorkspace)
      setStatus(text.status.desktopWorkspaceCreated(nextWorkspace.labelPath ?? selectedPath))
    } catch (error) {
      setStatus(error instanceof Error ? error.message : text.status.desktopWorkspaceCreateFailed)
    } finally {
      setIsBusy(false)
    }
  }

  async function importDesktopDroppedPaths(paths: string[]) {
    const labelPath = paths.find((path) => /\.txt$/i.test(path))
    if (!labelPath) {
      setStatus(text.status.droppedFileUnsupported)
      setIsDragging(false)
      return
    }

    setIsBusy(true)
    try {
      const nextWorkspace = await loadDesktopWorkspace(labelPath)
      applyWorkspace(nextWorkspace)
      setStatus(text.status.desktopWorkspaceLoaded(nextWorkspace.labelPath ?? labelPath))
    } catch (error) {
      setStatus(error instanceof Error ? error.message : text.status.desktopWorkspaceLoadFailed)
    } finally {
      setIsBusy(false)
      setIsDragging(false)
    }
  }

  async function handleImportLabelText() {
    if (isDesktop) {
      await handleDesktopImport()
      return
    }

    labelFileInputRef.current?.click()
  }

  async function handleCreateWorkspace() {
    if (isDesktop) {
      await handleDesktopCreateWorkspace()
      return
    }

    newWorkspaceImageInputRef.current?.click()
  }

  async function handleLabelFileChange(event: ChangeEvent<HTMLInputElement>) {
    const selectedFile = event.target.files?.[0]
    if (!selectedFile) {
      return
    }

    setIsBusy(true)

    try {
      await loadWebWorkspaceFromFile(selectedFile)
    } catch (error) {
      setStatus(error instanceof Error ? error.message : text.status.labelFileReadFailed)
    } finally {
      setIsBusy(false)
      event.target.value = ''
    }
  }

  function handleImageFilesChange(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? [])
    if (!workspace || files.length === 0) {
      return
    }

    attachImagesToWorkspace(workspace, files)
    event.target.value = ''
  }

  function handleNewWorkspaceImageFilesChange(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? [])
    createWebWorkspaceFromImages(files)
    event.target.value = ''
  }

  function handleDragOver(event: React.DragEvent<HTMLElement>) {
    event.preventDefault()
    setIsDragging(true)
  }

  function handleDragLeave(event: React.DragEvent<HTMLElement>) {
    if (event.currentTarget.contains(event.relatedTarget as Node | null)) {
      return
    }

    setIsDragging(false)
  }

  function handleDrop(event: React.DragEvent<HTMLElement>) {
    event.preventDefault()
    void importDroppedFiles(event.dataTransfer.files)
  }

  function selectFile(fileName: string) {
    const file = workspace?.files.find((item) => item.name === fileName)

    if (imageNaturalSize.width > 0 && imageNaturalSize.height > 0) {
      const fitZoom = getFitZoomForSize(imageNaturalSize.width, imageNaturalSize.height)
      const isUsingFitZoom = Math.abs(previewZoom - fitZoom) <= 0.001
      pendingFileZoomModeRef.current = isUsingFitZoom ? 'fit' : 'preserve'
      pendingFileZoomRef.current = isUsingFitZoom ? null : previewZoom
    } else {
      pendingFileZoomModeRef.current = 'fit'
      pendingFileZoomRef.current = null
    }

    setActiveFileName(fileName)
    setActiveLabelId(file?.labels[0]?.id ?? null)
    setPreviewPan({ x: 0, y: 0 })
    setImageNaturalSize({ width: 0, height: 0 })
  }

  function getCategoryColor(category: number) {
    const index = (Math.max(1, category) - 1) % categoryColors.length
    return settings.groupColors[index] ?? categoryColors[index]
  }

  function focusLabelInPreview(label: LabelEntry) {
    const frame = imageFrameRef.current
    if (!frame || imageNaturalSize.width <= 0 || imageNaturalSize.height <= 0) {
      return
    }

    const frameRect = frame.getBoundingClientRect()
    const frameWidth = frameRect.width / uiScale
    const frameHeight = frameRect.height / uiScale
    const scaledWidth = imageNaturalSize.width * previewZoom
    const scaledHeight = imageNaturalSize.height * previewZoom
    const baseX = (frameWidth - scaledWidth) / 2
    const targetX = frameWidth / 2
    const targetY = frameHeight * 0.36

    setPreviewPan({
      x: targetX - baseX - label.xPercent * scaledWidth,
      y: targetY - label.yPercent * scaledHeight,
    })
    hasManualPreviewTransformRef.current = true
  }

  function getCategoryChipStyle(category: number): CSSProperties {
    return {
      '--chip-color': getCategoryColor(category),
    } as CSSProperties
  }

  function getMarkerStyle(category: number): CSSProperties {
    return {
      '--marker-color': getCategoryColor(category),
    } as CSSProperties
  }

  function getResolvedGroupName(index: number) {
    const name = workspace?.groups[index - 1]?.trim()
    return name || defaultGroupNames[index - 1] || `G${index}`
  }

  function getVisibleGroupNames() {
    if (!workspace) {
      return defaultGroupNames
    }

    return workspace.groups.length > 0 ? workspace.groups : defaultGroupNames
  }

  function getFileImageSrc(file: { name: string; imageSrc?: string }) {
    return file.imageSrc ?? desktopImageSrcMap[file.name]
  }

  function selectLabel(label: LabelEntry, shouldCenter = false) {
    setActiveLabelId(label.id)
    if (shouldCenter) {
      focusLabelInPreview(label)
    }
  }

  function focusActiveLabelEditor() {
    requestAnimationFrame(() => {
      labelEditorRef.current?.focus()
    })
  }

  function selectRelativeFile(offset: number) {
    if (!workspace?.files.length || !activeFileName) {
      return
    }

    const currentIndex = workspace.files.findIndex((file) => file.name === activeFileName)
    if (currentIndex < 0) {
      return
    }

    const nextIndex = currentIndex + offset
    if (nextIndex < 0 || nextIndex >= workspace.files.length) {
      return
    }

    selectFile(workspace.files[nextIndex].name)
  }

  function selectRelativeLabel(offset: number, options?: { shouldFocusEditor?: boolean; shouldCenter?: boolean }) {
    if (!activeFile?.labels.length) {
      return
    }

    const currentIndex = activeLabelIndex >= 0 ? activeLabelIndex : 0
    const nextIndex = currentIndex + offset
    if (nextIndex < 0 || nextIndex >= activeFile.labels.length) {
      return
    }

    selectLabel(activeFile.labels[nextIndex], options?.shouldCenter ?? false)
    if (options?.shouldFocusEditor) {
      focusActiveLabelEditor()
    }
  }

  function closeQuickText() {
    setIsQuickTextOpen(false)
    setQuickTextMode(null)
    setPreviewQuickTextAnchor(null)
  }

  function insertQuickText(insertedText: string) {
    if (quickTextMode === 'preview') {
      if (!previewQuickTextAnchor) {
        return
      }

      addLabelAtPosition(previewQuickTextAnchor.xPercent, previewQuickTextAnchor.yPercent, insertedText)
      closeQuickText()
      return
    }

    if (!activeLabel || !labelEditorRef.current) {
      return
    }

    const textarea = labelEditorRef.current
    const start = textarea.selectionStart ?? activeLabel.text.length
    const end = textarea.selectionEnd ?? activeLabel.text.length
    const nextText = `${activeLabel.text.slice(0, start)}${insertedText}${activeLabel.text.slice(end)}`
    updateActiveLabelText(nextText, { captureHistory: false })
    closeQuickText()

    requestAnimationFrame(() => {
      textarea.focus()
      const nextCaret = start + insertedText.length
      textarea.setSelectionRange(nextCaret, nextCaret)
    })
  }

  function updateActiveLabelText(nextText: string, options?: { captureHistory?: boolean }) {
    if (!workspace || !activeFileName || activeLabelId === null) {
      return
    }

    if (options?.captureHistory !== false) {
      pushUndoSnapshot()
    }

    const nextWorkspace: WorkspaceData = {
      ...workspace,
      files: workspace.files.map((file) => {
        if (file.name !== activeFileName) {
          return file
        }

        return {
          ...file,
          labels: file.labels.map((label) =>
            label.id === activeLabelId ? { ...label, text: nextText } : label,
          ),
        }
      }),
    }

    setWorkspace(nextWorkspace)
    setHasUnsavedLocalEdits(true)
    setStatus(text.status.browserSaved)
  }

  function updateActiveLabelCategory(category: number) {
    if (!workspace || !activeFileName || activeLabelId === null) {
      return
    }

    pushUndoSnapshot()

    const normalizedCategory = Math.max(1, Math.min(9, category))
    const nextWorkspace: WorkspaceData = {
      ...workspace,
      files: workspace.files.map((file) => {
        if (file.name !== activeFileName) {
          return file
        }

        return {
          ...file,
          labels: file.labels.map((label) =>
            label.id === activeLabelId ? { ...label, category: normalizedCategory } : label,
          ),
        }
      }),
    }

    setWorkspace(nextWorkspace)
    setSelectedCategory(normalizedCategory)
    setHasUnsavedLocalEdits(true)
    setStatus(text.status.labelCategoryChanged(normalizedCategory))
  }

  function updateComment(comment: string, options?: { captureHistory?: boolean }) {
    if (!workspace) {
      return
    }

    if (options?.captureHistory !== false) {
      pushUndoSnapshot()
    }

    setWorkspace({
      ...workspace,
      comment,
    })
    setHasUnsavedLocalEdits(true)
    setStatus(text.status.commentSaved)
  }

  function updateGroupName(index: number, name: string, options?: { captureHistory?: boolean }) {
    if (!workspace) {
      return
    }

    if (options?.captureHistory !== false) {
      pushUndoSnapshot()
    }

    const nextGroups = [...getVisibleGroupNames()]
    nextGroups[index] = name
    setWorkspace({
      ...workspace,
      groups: nextGroups.slice(0, 9),
    })
    setHasUnsavedLocalEdits(true)
  }

  function addGroup() {
    if (!workspace || getVisibleGroupNames().length >= 9) {
      return
    }

    pushUndoSnapshot()

    const nextGroups = [...getVisibleGroupNames(), defaultGroupNames[getVisibleGroupNames().length] ?? '']
    setWorkspace({
      ...workspace,
      groups: nextGroups.slice(0, 9),
    })
    setHasUnsavedLocalEdits(true)
  }

  function canDeleteGroup(index: number) {
    const groupCount = getVisibleGroupNames().length
    if (!workspace || groupCount <= 1) {
      return false
    }

    return !workspace.files.some((file) => file.labels.some((label) => label.category === index + 1))
  }

  function deleteGroup(index: number) {
    if (!workspace || !canDeleteGroup(index)) {
      return
    }

    pushUndoSnapshot()

    const nextGroups = getVisibleGroupNames().filter((_, groupIndex) => groupIndex !== index)
    setWorkspace({
      ...workspace,
      groups: nextGroups,
      files: workspace.files.map((file) => ({
        ...file,
        labels: file.labels.map((label) => ({
          ...label,
          category: label.category > index + 1 ? label.category - 1 : label.category,
        })),
      })),
    })
    setSelectedCategory((current) => Math.min(current, nextGroups.length))
    setHasUnsavedLocalEdits(true)
  }

  function setGroupColor(index: number, color: string) {
    setSettings((current) => ({
      ...current,
      groupColors: current.groupColors.map((item, itemIndex) => (itemIndex === index ? color : item)),
    }))
  }

  function addLabelAtPosition(xPercent: number, yPercent: number, textValue = '') {
    if (!workspace || !activeFileName) {
      return
    }

    pushUndoSnapshot()

    const activeLabels = activeFile?.labels ?? []
    const nextId = activeLabels.reduce((maxId, label) => Math.max(maxId, label.id), 0) + 1
    const nextLabel: LabelEntry = {
      id: nextId,
      xPercent: Math.min(1, Math.max(0, xPercent)),
      yPercent: Math.min(1, Math.max(0, yPercent)),
      category: selectedCategory,
      text: textValue,
    }

    setWorkspace({
      ...workspace,
      files: workspace.files.map((file) => {
        if (file.name !== activeFileName) {
          return file
        }

        return {
          ...file,
          labels: [...file.labels, nextLabel],
        }
      }),
    })
    setActiveLabelId(nextId)
    setHasUnsavedLocalEdits(true)
    setStatus(text.status.labelAdded(nextId, selectedCategory))
  }

  function deleteLabel(labelId: number) {
    if (!workspace || !activeFileName || !activeFile) {
      return
    }

    pushUndoSnapshot()

    const remainingLabels = activeFile.labels.filter((label) => label.id !== labelId)
    setWorkspace({
      ...workspace,
      files: workspace.files.map((file) => {
        if (file.name !== activeFileName) {
          return file
        }

        return {
          ...file,
          labels: file.labels.filter((label) => label.id !== labelId),
        }
      }),
    })
    setActiveLabelId(remainingLabels[0]?.id ?? null)
    setHasUnsavedLocalEdits(true)
    setStatus(text.status.labelDeleted(labelId))
  }

  function handleExport() {
    if (!workspace) {
      setStatus(text.status.nothingToExport)
      return
    }

    const workspaceText = serializeLabelPlusText(workspace)
    const blob = new Blob([workspaceText], { type: 'text/plain;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    const baseName = workspace.labelPath?.split(/[\\/]/).pop() || exportFileName

    link.href = url
    link.download = baseName.endsWith('.txt') ? baseName : `${baseName}.txt`
    document.body.append(link)
    link.click()
    link.remove()
    URL.revokeObjectURL(url)
    setStatus(text.status.exportedFile(link.download))
  }

  const persistWorkspace = useCallback(async (mode: 'manual' | 'auto') => {
    if (!workspace) {
      if (mode === 'manual') {
        setStatus(text.status.nothingToSave)
      }
      return
    }

    if (workspace.source === 'desktop') {
      if (!workspace.labelPath) {
        if (mode === 'manual') {
          setStatus(text.status.desktopPathMissing)
        }
        return
      }

      const workspaceText = serializeLabelPlusText(workspace)
      await saveDesktopWorkspace(workspace.labelPath, workspaceText)
    } else {
      const storageKey = getWorkspaceStorageKey(workspace)
      const metaStorageKey = getWorkspaceMetaStorageKey(workspace)
      const storedTexts = buildStoredLabelTexts(workspace)
      window.localStorage.setItem(storageKey, JSON.stringify(storedTexts))
      window.localStorage.setItem(metaStorageKey, JSON.stringify({ comment: workspace.comment }))
    }

    setHasUnsavedLocalEdits(false)
    if (mode === 'manual') {
      setStatus(workspace.source === 'desktop' ? text.status.desktopSaved : text.status.webSaved)
    }
  }, [workspace])

  async function handleSaveLocal() {
    if (!workspace) {
      setStatus(text.status.nothingToSave)
      return
    }

    try {
      await persistWorkspace('manual')
    } catch (error) {
      setStatus(error instanceof Error ? error.message : text.status.saveFailed)
      return
    }
  }

  function clampZoom(nextZoom: number) {
    return Math.min(maxPreviewZoom, Math.max(minPreviewZoom, Number(nextZoom.toFixed(3))))
  }

  function getFitZoomForSize(width: number, height: number) {
    const frame = imageFrameRef.current
    if (!frame || width <= 0 || height <= 0) {
      return 1
    }

    const frameRect = frame.getBoundingClientRect()
    const frameWidth = frameRect.width / uiScale
    const frameHeight = frameRect.height / uiScale
    const fitByHeight = frameWidth >= frameHeight
    const nextZoom = fitByHeight ? frameHeight / height : frameWidth / width
    return clampZoom(nextZoom)
  }

  function fitPreviewToSize(width: number, height: number) {
    if (width <= 0 || height <= 0) {
      return
    }

    setPreviewZoom(getFitZoomForSize(width, height))
    setPreviewPan({ x: 0, y: 0 })
    hasManualPreviewTransformRef.current = false
  }

  function zoomPreview(delta: number) {
    hasManualPreviewTransformRef.current = true
    setPreviewZoom((current) => {
      return clampZoom(current + delta)
    })
  }

  function fitPreview() {
    fitPreviewToSize(imageNaturalSize.width, imageNaturalSize.height)
  }

  function toggleReadingMode() {
    setReadingMode((current) => (current === 'vertical' ? 'horizontal' : 'vertical'))
  }

  function changeMarkerFontSize(delta: number) {
    setSettings((current) => ({
      ...current,
      markerFontSize: Math.min(maxMarkerFontSize, Math.max(minMarkerFontSize, current.markerFontSize + delta)),
    }))
  }

  function runCircularReveal(origin: HTMLElement, update: () => void, point?: { x: number; y: number }) {
    const viewTransitionDocument = document as Document & {
      startViewTransition?: (callback: () => void) => { finished: Promise<void> }
    }

    if (!viewTransitionDocument.startViewTransition || window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      update()
      return
    }

    const rect = origin.getBoundingClientRect()
    const hasPoint = point !== undefined && (point.x !== 0 || point.y !== 0)
    const x = hasPoint ? point.x : rect.left + rect.width / 2
    const y = hasPoint ? point.y : rect.top + rect.height / 2
    const radius = Math.hypot(Math.max(x, window.innerWidth - x), Math.max(y, window.innerHeight - y))
    document.documentElement.style.setProperty('--theme-reveal-x', `${x}px`)
    document.documentElement.style.setProperty('--theme-reveal-y', `${y}px`)
    document.documentElement.style.setProperty('--theme-reveal-radius', `${radius}px`)

    viewTransitionDocument.startViewTransition(() => {
      flushSync(update)
    })
  }

  function applyTheme(nextTheme: ThemeMode, event: ReactMouseEvent<HTMLButtonElement>) {
    if (theme === nextTheme) {
      return
    }

    runCircularReveal(
      event.currentTarget,
      () => {
        document.documentElement.dataset.theme = nextTheme
        setTheme(nextTheme)
      },
      { x: event.clientX, y: event.clientY },
    )
  }

  function handleThemeToggle(event: ReactMouseEvent<HTMLButtonElement>) {
    applyTheme(theme === 'dark' ? 'light' : 'dark', event)
  }

  const openSettings = useCallback(() => {
    if (settingsCloseTimerRef.current !== null) {
      window.clearTimeout(settingsCloseTimerRef.current)
      settingsCloseTimerRef.current = null
      settingsOverlayRef.current?.classList.remove('is-closing')
    }
    setSettingsDetail(null)
    setUiScaleDraft(Math.round(settings.uiScale * 100))
    setIsSettingsOpen(true)
  }, [settings.uiScale])

  function applyUiScale() {
    setSettings((current) => ({ ...current, uiScale: clampUiScale(uiScaleDraft / 100) }))
  }

  const closeSettings = useCallback(() => {
    setSettingsDetail(null)

    if (settingsCloseTimerRef.current !== null) {
      return
    }

    const overlay = settingsOverlayRef.current
    if (!overlay || window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      setIsSettingsOpen(false)
      return
    }

    overlay.classList.add('is-closing')
    settingsCloseTimerRef.current = window.setTimeout(() => {
      settingsCloseTimerRef.current = null
      setIsSettingsOpen(false)
    }, 150)
  }, [])

  useEffect(() => () => {
    if (settingsCloseTimerRef.current !== null) {
      window.clearTimeout(settingsCloseTimerRef.current)
    }
  }, [])

  const closeSettingsDetail = useCallback(() => {
    if (!settingsDetail || detailIsAnimatingRef.current) {
      return
    }

    const page = detailPageRef.current
    const origin = detailOriginRef.current
    const finish = () => {
      detailIsAnimatingRef.current = false
      setSettingsDetail(null)
      requestAnimationFrame(() => detailReturnFocusRef.current?.focus())
    }

    if (!page || !origin) {
      finish()
      return
    }

    page.classList.remove('is-open')

    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      finish()
      return
    }

    const target = page.getBoundingClientRect()
    const translateX = (origin.left - target.left) / uiScale
    const translateY = (origin.top - target.top) / uiScale
    const scaleX = origin.width / target.width
    const scaleY = origin.height / target.height
    detailIsAnimatingRef.current = true
    const animation = page.animate(
      [
        { transform: 'translate(0, 0) scale(1, 1)', borderRadius: '18px' },
        {
          transform: `translate(${translateX}px, ${translateY}px) scale(${scaleX}, ${scaleY})`,
          borderRadius: '12px',
        },
      ],
      { duration: 320, easing: 'cubic-bezier(0.4, 0, 0.2, 1)', fill: 'both' },
    )
    animation.finished.then(finish).catch(() => {
      detailIsAnimatingRef.current = false
    })
  }, [settingsDetail, uiScale])

  useLayoutEffect(() => {
    if (!settingsDetail) {
      return
    }

    const page = detailPageRef.current
    const origin = detailOriginRef.current
    if (!page || !origin) {
      return
    }

    const focusTimer = window.setTimeout(() => detailBackButtonRef.current?.focus(), 90)

    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      page.classList.add('is-open')
      detailIsAnimatingRef.current = false
      return () => window.clearTimeout(focusTimer)
    }

    const target = page.getBoundingClientRect()
    if (!target.width || !target.height) {
      page.classList.add('is-open')
      return () => window.clearTimeout(focusTimer)
    }

    const translateX = (origin.left - target.left) / uiScale
    const translateY = (origin.top - target.top) / uiScale
    const scaleX = origin.width / target.width
    const scaleY = origin.height / target.height
    const initialTransform = `translate(${translateX}px, ${translateY}px) scale(${scaleX}, ${scaleY})`
    page.style.transform = initialTransform
    page.style.borderRadius = '12px'
    detailIsAnimatingRef.current = true
    const animation = page.animate(
      [
        { transform: initialTransform, borderRadius: '12px' },
        { transform: 'translate(0, 0) scale(1, 1)', borderRadius: '18px' },
      ],
      { duration: 420, easing: 'cubic-bezier(0.22, 1, 0.36, 1)', fill: 'both' },
    )
    const frame = requestAnimationFrame(() => page.classList.add('is-open'))
    animation.finished
      .then(() => {
        if (page.isConnected) {
          page.style.transform = ''
          page.style.borderRadius = ''
          animation.cancel()
        }
        detailIsAnimatingRef.current = false
      })
      .catch(() => {
        detailIsAnimatingRef.current = false
      })

    return () => {
      window.clearTimeout(focusTimer)
      cancelAnimationFrame(frame)
      animation.cancel()
    }
  }, [settingsDetail, uiScale])

  useEffect(() => {
    if (!settingsDetail) {
      return
    }

    function handleDetailKeyDown(event: KeyboardEvent) {
      if (event.key !== 'Escape') {
        return
      }

      event.preventDefault()
      event.stopPropagation()
      closeSettingsDetail()
    }

    window.addEventListener('keydown', handleDetailKeyDown, true)
    return () => window.removeEventListener('keydown', handleDetailKeyDown, true)
  }, [settingsDetail, closeSettingsDetail])


  function openSettingsDetail(kind: SettingsDetail, event: ReactMouseEvent<HTMLButtonElement>) {
    settingsPopupRef.current?.getAnimations().forEach((animation) => animation.finish())
    const card = event.currentTarget.closest('.settings-section')
    detailOriginRef.current = (card instanceof HTMLElement ? card : event.currentTarget).getBoundingClientRect()
    detailReturnFocusRef.current = event.currentTarget
    setSettingsDetail(kind)
  }


  function updateLabelPosition(labelId: number, xPercent: number, yPercent: number) {
    if (!workspace || !activeFileName) {
      return
    }

    const clampedX = Math.min(1, Math.max(0, xPercent))
    const clampedY = Math.min(1, Math.max(0, yPercent))
    const nextWorkspace: WorkspaceData = {
      ...workspace,
      files: workspace.files.map((file) => {
        if (file.name !== activeFileName) {
          return file
        }

        return {
          ...file,
          labels: file.labels.map((label) =>
            label.id === labelId
              ? { ...label, xPercent: clampedX, yPercent: clampedY }
              : label,
          ),
        }
      }),
    }

    setWorkspace(nextWorkspace)
    setActiveLabelId(labelId)
    setHasUnsavedLocalEdits(true)
  }

  function handleImageWheel(event: React.WheelEvent<HTMLDivElement>) {
    event.preventDefault()
    event.stopPropagation()
    zoomPreview(event.deltaY > 0 ? -0.1 : 0.1)
  }

  function handlePreviewImageLoad(event: React.SyntheticEvent<HTMLImageElement>) {
    const image = event.currentTarget
    const nextSize = {
      width: image.naturalWidth,
      height: image.naturalHeight,
    }

    setImageNaturalSize(nextSize)

    requestAnimationFrame(() => {
      if (pendingFileZoomModeRef.current === 'preserve' && pendingFileZoomRef.current !== null) {
        setPreviewZoom(clampZoom(pendingFileZoomRef.current))
        setPreviewPan({ x: 0, y: 0 })
        hasManualPreviewTransformRef.current = true
        pendingFileZoomModeRef.current = 'fit'
        pendingFileZoomRef.current = null
        return
      }

      fitPreviewToSize(nextSize.width, nextSize.height)
      pendingFileZoomModeRef.current = 'fit'
      pendingFileZoomRef.current = null
    })
  }

  function handleFramePointerDown(event: React.PointerEvent<HTMLDivElement>) {
    if ((event.target as HTMLElement).closest('.marker')) {
      return
    }

    interactionRef.current = {
      type: 'pan',
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      basePanX: previewPan.x,
      basePanY: previewPan.y,
    }
    hasManualPreviewTransformRef.current = true
    event.currentTarget.setPointerCapture(event.pointerId)
  }

  function handleFrameDoubleClick(event: React.MouseEvent<HTMLDivElement>) {
    if ((event.target as HTMLElement).closest('.marker')) {
      return
    }

    const image = previewImageRef.current
    if (!image) {
      return
    }

    const rect = image.getBoundingClientRect()
    if (rect.width <= 0 || rect.height <= 0) {
      return
    }

    const xPercent = (event.clientX - rect.left) / rect.width
    const yPercent = (event.clientY - rect.top) / rect.height
    addLabelAtPosition(xPercent, yPercent)
  }

  function handleMarkerPointerDown(event: React.PointerEvent<HTMLButtonElement>, labelId: number) {
    event.preventDefault()
    event.stopPropagation()
    setActiveLabelId(labelId)
    pendingDragHistoryPointerIdRef.current = event.pointerId
    interactionRef.current = {
      type: 'label',
      pointerId: event.pointerId,
      labelId,
    }
    event.currentTarget.setPointerCapture(event.pointerId)
  }

  function handleFramePointerMove(event: React.PointerEvent<HTMLDivElement>) {
    const previewImage = previewImageRef.current
    if (previewImage) {
      const rect = previewImage.getBoundingClientRect()
      if (rect.width > 0 && rect.height > 0) {
        previewPointerRef.current = {
          xPercent: Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width)),
          yPercent: Math.min(1, Math.max(0, (event.clientY - rect.top) / rect.height)),
          clientX: event.clientX,
          clientY: event.clientY,
          inside: event.clientX >= rect.left && event.clientX <= rect.right && event.clientY >= rect.top && event.clientY <= rect.bottom,
        }
      }
    }

    const session = interactionRef.current
    if (!session || session.pointerId !== event.pointerId) {
      return
    }

    if (session.type === 'pan') {
      setPreviewPan({
        x: session.basePanX + (event.clientX - session.startX) / uiScale,
        y: session.basePanY + (event.clientY - session.startY) / uiScale,
      })
      return
    }

    if (pendingDragHistoryPointerIdRef.current === event.pointerId) {
      pushUndoSnapshot()
      pendingDragHistoryPointerIdRef.current = null
    }

    if (!previewImage) {
      return
    }

    const rect = previewImage.getBoundingClientRect()
    if (rect.width <= 0 || rect.height <= 0) {
      return
    }

    const xPercent = (event.clientX - rect.left) / rect.width
    const yPercent = (event.clientY - rect.top) / rect.height
    updateLabelPosition(session.labelId, xPercent, yPercent)
  }

  function handleFramePointerUp(event: React.PointerEvent<HTMLDivElement>) {
    const session = interactionRef.current
    if (!session || session.pointerId !== event.pointerId) {
      return
    }

    interactionRef.current = null
    pendingDragHistoryPointerIdRef.current = null
    if (session.type === 'label') {
      setStatus(text.status.labelMoved(session.labelId))
    }
    event.currentTarget.releasePointerCapture(event.pointerId)
  }

  useEffect(() => {
    const frame = imageFrameRef.current
    if (!frame || imageNaturalSize.width <= 0 || imageNaturalSize.height <= 0 || !activeFileImageSrc) {
      return
    }

    const observer = new ResizeObserver(() => {
      if (hasManualPreviewTransformRef.current) {
        return
      }

      requestAnimationFrame(() => {
        const rect = frame.getBoundingClientRect()
        const frameWidth = rect.width / uiScale
        const frameHeight = rect.height / uiScale
        const fitByHeight = frameWidth >= frameHeight
        const nextZoom = fitByHeight
          ? frameHeight / imageNaturalSize.height
          : frameWidth / imageNaturalSize.width

        setPreviewZoom(clampZoom(nextZoom))
        setPreviewPan({ x: 0, y: 0 })
      })
    })

    observer.observe(frame)
    return () => observer.disconnect()
  }, [activeFileImageSrc, imageNaturalSize.height, imageNaturalSize.width, uiScale])

  useEffect(() => {
    importDroppedFilesRef.current = importDroppedFiles
  })

  useEffect(() => {
    importDesktopDroppedPathsRef.current = importDesktopDroppedPaths
  })

  useEffect(() => {
    if (typeof window === 'undefined') {
      return
    }

    function containsFiles(event: DragEvent) {
      return Array.from(event.dataTransfer?.types ?? []).includes('Files')
    }

    function handleWindowDragOver(event: DragEvent) {
      if (!containsFiles(event)) {
        return
      }

      event.preventDefault()
      setIsDragging(true)
    }

    function handleWindowDragLeave(event: DragEvent) {
      if (!containsFiles(event)) {
        return
      }

      if (event.clientX <= 0 || event.clientY <= 0 || event.clientX >= window.innerWidth || event.clientY >= window.innerHeight) {
        setIsDragging(false)
      }
    }

    function handleWindowDrop(event: DragEvent) {
      if (!containsFiles(event)) {
        return
      }

      event.preventDefault()
      void importDroppedFilesRef.current(event.dataTransfer?.files ?? [])
    }

    window.addEventListener('dragover', handleWindowDragOver)
    window.addEventListener('dragleave', handleWindowDragLeave)
    window.addEventListener('drop', handleWindowDrop)

    return () => {
      window.removeEventListener('dragover', handleWindowDragOver)
      window.removeEventListener('dragleave', handleWindowDragLeave)
      window.removeEventListener('drop', handleWindowDrop)
    }
  }, [])

  useEffect(() => {
    if (!isDesktop) {
      return
    }

    let disposed = false
    let unlisten: (() => void) | undefined

    void import('@tauri-apps/api/window').then(async ({ getCurrentWindow }) => {
      if (disposed) {
        return
      }

      unlisten = await getCurrentWindow().onDragDropEvent((event) => {
        if (event.payload.type === 'over') {
          setIsDragging(true)
          return
        }

        if (event.payload.type === 'drop') {
          void importDesktopDroppedPathsRef.current(event.payload.paths)
          return
        }

        setIsDragging(false)
      })
    })

    return () => {
      disposed = true
      unlisten?.()
    }
  }, [isDesktop])

  useEffect(() => {
    if (!workspace || !settings.autoSave || !hasUnsavedLocalEdits) {
      return
    }

    const timer = window.setTimeout(() => {
      void persistWorkspace('auto').catch((error) => {
        setStatus(error instanceof Error ? error.message : text.status.autoSaveFailed)
      })
    }, 500)

    return () => window.clearTimeout(timer)
  }, [hasUnsavedLocalEdits, persistWorkspace, settings.autoSave, workspace])

  useEffect(() => {
    if (typeof window === 'undefined') {
      return
    }

    function isEditableTarget(target: EventTarget | null) {
      return target instanceof HTMLElement && Boolean(target.closest(editableSelector))
    }

    function handleKeyDown(event: KeyboardEvent) {
      const key = event.key.toLowerCase()
      const isEditable = isEditableTarget(event.target)
      const hasPrimaryModifier = isMacPlatform ? event.metaKey : event.ctrlKey

      if (isSettingsOpen) {
        return
      }

      if (isQuickTextOpen) {
        const matchedQuickText = settings.quickTexts.find((item) => item.key.toLowerCase() === key)
        if (matchedQuickText) {
          event.preventDefault()
          insertQuickText(matchedQuickText.text)
          return
        }

        if (event.key === 'Escape') {
          event.preventDefault()
          closeQuickText()
          return
        }
      }

      if (hasPrimaryModifier && !event.altKey) {
        if (key === 's') {
          event.preventDefault()
          void handleSaveLocal()
          return
        }

        if (key === 'z') {
          event.preventDefault()
          if (isMacPlatform && event.shiftKey) {
            redoLastChange()
          } else {
            undoLastChange()
          }
          return
        }

        if (key === 'y') {
          event.preventDefault()
          redoLastChange()
          return
        }

        if (key === 'enter' && isEditable) {
          event.preventDefault()
          selectRelativeLabel(1, { shouldFocusEditor: true, shouldCenter: true })
          return
        }

        if (event.key === 'ArrowUp') {
          event.preventDefault()
          selectRelativeLabel(-1, { shouldFocusEditor: isEditable, shouldCenter: true })
          return
        }

        if (event.key === 'ArrowDown') {
          event.preventDefault()
          selectRelativeLabel(1, { shouldFocusEditor: isEditable, shouldCenter: true })
          return
        }

        if (event.key === 'ArrowLeft' && isEditable) {
          event.preventDefault()
          selectRelativeFile(-1)
          return
        }

        if (event.key === 'ArrowRight' && isEditable) {
          event.preventDefault()
          selectRelativeFile(1)
          return
        }
      }

      if (event.altKey && key === 'a' && isEditable) {
        event.preventDefault()
        setQuickTextMode('editor')
        setIsQuickTextOpen(true)
        return
      }

      if (event.altKey && key === 'a' && activeFileImageSrc && previewPointerRef.current.inside) {
        event.preventDefault()
        setQuickTextMode('preview')
        setPreviewQuickTextAnchor({
          x: previewPointerRef.current.clientX,
          y: previewPointerRef.current.clientY,
          xPercent: previewPointerRef.current.xPercent,
          yPercent: previewPointerRef.current.yPercent,
        })
        setIsQuickTextOpen(true)
        return
      }

      if (isEditable) {
        return
      }

      if (/^[1-9]$/.test(key)) {
        event.preventDefault()
        setSelectedCategory(Number(key))
        return
      }

      if ((event.key === 'Delete' || event.key === 'Backspace') && activeLabelId !== null) {
        event.preventDefault()
        deleteLabel(activeLabelId)
        return
      }

      if (event.key === 'ArrowLeft') {
        event.preventDefault()
        selectRelativeFile(-1)
        return
      }

      if (event.key === 'ArrowRight') {
        event.preventDefault()
        selectRelativeFile(1)
        return
      }

      if (key === 'r') {
        event.preventDefault()
        fitPreview()
        return
      }

      if (key === 'c') {
        event.preventDefault()
        setIsCheckMode((current) => !current)
        return
      }

      if (key === 'w') {
        event.preventDefault()
        toggleReadingMode()
        return
      }

      if (event.key === 'Enter' && activeLabel) {
        event.preventDefault()
        focusActiveLabelEditor()
        return
      }

      if (key === 'v' && !event.repeat) {
        event.preventDefault()
        setArePreviewLabelsHidden(true)
      }
    }

    function handleKeyUp(event: KeyboardEvent) {
      if (event.key.toLowerCase() === 'v') {
        setArePreviewLabelsHidden(false)
      }
    }

    function handleWindowBlur() {
      setArePreviewLabelsHidden(false)
    }

    window.addEventListener('keydown', handleKeyDown)
    window.addEventListener('keyup', handleKeyUp)
    window.addEventListener('blur', handleWindowBlur)

    return () => {
      window.removeEventListener('keydown', handleKeyDown)
      window.removeEventListener('keyup', handleKeyUp)
      window.removeEventListener('blur', handleWindowBlur)
    }
  })

  useEffect(() => {
    if (!isQuickTextOpen) {
      return
    }

    function handlePointerDown(event: MouseEvent) {
      if (
        quickTextPanelRef.current?.contains(event.target as Node) ||
        labelEditorRef.current?.contains(event.target as Node)
      ) {
        return
      }

      closeQuickText()
    }

    window.addEventListener('mousedown', handlePointerDown)
    return () => window.removeEventListener('mousedown', handlePointerDown)
  }, [isQuickTextOpen])

  useEffect(() => {
    if (!activeFileName || !fileListRef.current) {
      return
    }

    const activeItem = fileListRef.current.querySelector<HTMLElement>(`[data-file-name="${CSS.escape(activeFileName)}"]`)
    activeItem?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  }, [activeFileName])

  useSlidingIndicator(fileListRef, '.file-item.active', activeFileName, workspace?.files.length ?? 0)
  useSlidingIndicator(labelListRef, '.label-item.active', `${activeFile?.name ?? ''}:${activeLabelId ?? ''}`, activeFile?.labels.length ?? 0)

  useEffect(() => {
    if (!workspace || workspace.source !== 'desktop') {
      return
    }

    let cancelled = false
    const pendingFiles = workspace.files.filter((file) => file.imagePath && !desktopImageSrcMap[file.name])

    if (pendingFiles.length === 0) {
      return
    }

    void Promise.all(
      pendingFiles.map(async (file) => ({
        name: file.name,
        imageSrc: await loadDesktopImageSrc(file.imagePath!),
      })),
    )
      .then((entries) => {
        if (cancelled) {
          return
        }

        setDesktopImageSrcMap((current) => ({
          ...current,
          ...Object.fromEntries(entries.map((entry) => [entry.name, entry.imageSrc])),
        }))
      })
      .catch((error) => {
        if (!cancelled) {
          setStatus(error instanceof Error ? error.message : text.status.imageLoadFailed(activeFileName || 'image'))
        }
      })

    return () => {
      cancelled = true
    }
  }, [desktopImageSrcMap, workspace, activeFileName])

  const resizePanel = useCallback((panel: 'file' | 'label', width: number) => {
    const layout = workspaceLayoutRef.current
    if (!layout || window.innerWidth < 960) return
    const other = layout.querySelector(panel === 'file' ? '.label-panel' : '.file-panel')
    const otherWidth = (other?.getBoundingClientRect().width ?? 0) / uiScale
    const available = layout.clientWidth - otherWidth - 344
    const minimum = 240
    const maximum = Math.min(panel === 'file' ? 420 : 720, available)
    const next = Math.max(minimum, Math.min(maximum, width))
    if (panel === 'file') setFilePanelWidth(next)
    else setLabelPanelWidth(next)
  }, [uiScale])

  function startPanelResize(event: React.PointerEvent<HTMLDivElement>, panel: 'file' | 'label') {
    if (event.button !== 0) return
    event.preventDefault()
    event.currentTarget.setPointerCapture(event.pointerId)
    const element = workspaceLayoutRef.current?.querySelector(`.${panel}-panel`)
    const measuredWidth = element?.getBoundingClientRect().width
    panelResizeStateRef.current = {
      panel,
      startX: event.clientX,
      startWidth: measuredWidth ? measuredWidth / uiScale : (panel === 'file' ? filePanelWidth : labelPanelWidth),
    }
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
  }

  function handlePanelResizeKey(event: React.KeyboardEvent<HTMLDivElement>, panel: 'file' | 'label') {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
    event.preventDefault()
    event.stopPropagation()
    const direction = event.key === 'ArrowRight' ? 1 : -1
    resizePanel(panel, (panel === 'file' ? filePanelWidth : labelPanelWidth) + direction * (panel === 'file' ? 24 : -24))
  }

  useEffect(() => {
    const layout = workspaceLayoutRef.current
    if (!layout) return
    const observer = new ResizeObserver(() => {
      if (window.innerWidth < 960) return
      const fileRect = layout.querySelector('.file-panel')?.getBoundingClientRect().width
      const labelRect = layout.querySelector('.label-panel')?.getBoundingClientRect().width
      const fileWidth = fileRect ? fileRect / uiScale : 260
      const labelWidth = labelRect ? labelRect / uiScale : 360
      const available = layout.clientWidth - 344
      if (fileWidth + labelWidth <= available) return
      const nextFile = Math.max(180, Math.min(fileWidth, available - 240))
      setFilePanelWidth(nextFile)
      setLabelPanelWidth(Math.max(240, available - nextFile))
    })
    observer.observe(layout)
    return () => observer.disconnect()
  }, [uiScale])

  useEffect(() => {
    function handlePointerMove(event: PointerEvent) {
      const session = panelResizeStateRef.current
      if (!session) {
        return
      }

      const delta = (event.clientX - session.startX) / uiScale
      resizePanel(session.panel, session.startWidth + (session.panel === 'file' ? delta : -delta))
    }

    function handlePointerUp() {
      panelResizeStateRef.current = null
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
    }

    window.addEventListener('pointermove', handlePointerMove)
    window.addEventListener('pointerup', handlePointerUp)
    window.addEventListener('pointercancel', handlePointerUp)

    return () => {
      window.removeEventListener('pointermove', handlePointerMove)
      window.removeEventListener('pointerup', handlePointerUp)
      window.removeEventListener('pointercancel', handlePointerUp)
      handlePointerUp()
    }
  }, [resizePanel, uiScale])

  return (
    <div className={isDesktop ? 'shell shell-desktop' : 'shell'}>
      <section className={isDragging ? 'top-section drag-active' : 'top-section'}>
        <div className="top-section-controls">
          <button
            type="button"
            className="ghost-button theme-toggle-button"
            onClick={handleThemeToggle}
            aria-label={theme === 'dark' ? text.top.switchToLight : text.top.switchToDark}
            title={theme === 'dark' ? text.top.switchToLight : text.top.switchToDark}
          >
            {theme === 'dark' ? (
              <SunMedium className="theme-toggle-icon" aria-hidden="true" />
            ) : (
              <Moon className="theme-toggle-icon" aria-hidden="true" />
            )}
          </button>

          <button
            type="button"
            className={isSettingsOpen ? 'ghost-button settings-button active' : 'ghost-button settings-button'}
            onClick={() => {
              if (isSettingsOpen) {
                closeSettings()
                return
              }
              openSettings()
            }}
            aria-label={text.top.openSettings}
            title={text.top.openSettings}
          >
            <Settings className="settings-icon" aria-hidden="true" />
          </button>
        </div>

        {isSettingsOpen ? (
          <div
            ref={settingsOverlayRef}
            className={settingsDetail ? 'settings-overlay is-detail-open' : 'settings-overlay'}
            onClick={closeSettings}
          >
            <div
              ref={settingsPopupRef}
              className={settingsDetail ? 'settings-popup is-detail-open' : 'settings-popup'}
              onClick={(event) => event.stopPropagation()}
              inert={settingsDetail !== null}
              aria-hidden={settingsDetail ? true : undefined}
            >
              <div className="settings-popup-header">
                <div className="brand-banner settings-brand-banner">
                  <img className="brand-logo" src={`${import.meta.env.BASE_URL}logo.svg`} alt="LabelPlusX logo" />
                  <div className="brand-text">
                    <div className="settings-title-row">
                      <h1>LabelPlusX</h1>
                      <span className="version-badge">v{appVersion}</span>
                    </div>
                    <p className="subtitle">{text.top.subtitle}</p>
                  </div>
                  <a
                    className="settings-github-button"
                    href={projectHomepage}
                    target="_blank"
                    rel="noreferrer"
                    aria-label={text.settings.githubHomepage}
                    title={text.settings.githubHomepage}
                  >
                    <svg className="github-mark" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
                      <path
                        fill="currentColor"
                        d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27s1.36.09 2 .27c1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8Z"
                      />
                    </svg>
                    <span>GitHub</span>
                  </a>
                </div>
                <h3>{text.settings.title}</h3>
              </div>

              <div className="settings-section settings-palette-section">
                <div className="settings-palette-head">
                  <span className="settings-palette-title">
                    <Palette className="settings-section-icon" aria-hidden="true" />
                    {text.settings.palette}
                  </span>
                  <span className="settings-inline-hint">{text.settings.paletteHint}</span>
                </div>
                <div className="palette-grid" role="group" aria-label={text.settings.palette}>
                  {paletteOptions.map((option) => (
                    <button
                      key={option.id}
                      type="button"
                      className="palette-option"
                      aria-pressed={settings.palette === option.id}
                      onClick={(event) => {
                        if (settings.palette === option.id) {
                          return
                        }

                        runCircularReveal(
                          event.currentTarget,
                          () => {
                            document.documentElement.dataset.palette = option.id
                            setSettings((current) => ({ ...current, palette: option.id }))
                          },
                          { x: event.clientX, y: event.clientY },
                        )
                      }}
                    >
                      <span className="palette-swatch" data-palette={option.id} aria-hidden="true">
                        <span className="palette-dot palette-dot-bg" />
                        <span className="palette-dot palette-dot-panel" />
                        <span className="palette-dot palette-dot-accent" />
                      </span>
                      <span>{option.name}</span>
                    </button>
                  ))}
                </div>
                <div className="settings-theme-divider" aria-hidden="true" />
                <div className="settings-theme-row">
                  <span className="settings-row-label">
                    <SunMoon className="settings-section-icon" aria-hidden="true" />
                    <span>{text.settings.themeMode}</span>
                  </span>
                  <div className="theme-mode-options" role="group" aria-label={text.settings.themeMode}>
                    <button
                      type="button"
                      className="theme-mode-option"
                      aria-pressed={theme === 'light'}
                      onClick={(event) => applyTheme('light', event)}
                    >
                      <SunMedium aria-hidden="true" />
                      <span>{text.settings.themeLight}</span>
                    </button>
                    <button
                      type="button"
                      className="theme-mode-option"
                      aria-pressed={theme === 'dark'}
                      onClick={(event) => applyTheme('dark', event)}
                    >
                      <Moon aria-hidden="true" />
                      <span>{text.settings.themeDark}</span>
                    </button>
                  </div>
                </div>
              </div>

              <div className="settings-section">
                <div className="settings-scale-row">
                  <span className="settings-row-label">
                    <ZoomIn className="settings-section-icon" aria-hidden="true" />
                    <span>{text.settings.uiScale}</span>
                  </span>
                  <div className="settings-range-wrap">
                    <input
                      type="range"
                      min={80}
                      max={150}
                      step={5}
                      value={uiScaleDraft}
                      onChange={(event) => setUiScaleDraft(Number(event.target.value))}
                    />
                    <strong>{uiScaleDraft}%</strong>
                  </div>
                  <button
                    type="button"
                    className="ghost-button settings-scale-apply"
                    disabled={uiScaleDraft === Math.round(settings.uiScale * 100)}
                    onClick={applyUiScale}
                  >
                    {text.settings.applyUiScale}
                  </button>
                </div>
                <span className="settings-inline-hint settings-scale-hint">{text.settings.uiScaleHint}</span>
              </div>

              <div className="settings-section">
                <label className="settings-row">
                  <span className="settings-row-label">
                    <Save className="settings-section-icon" aria-hidden="true" />
                    <span>{text.settings.autoSave}</span>
                  </span>
                  <input
                    type="checkbox"
                    checked={settings.autoSave}
                    onChange={(event) => {
                      setSettings((current) => ({ ...current, autoSave: event.target.checked }))
                    }}
                  />
                </label>

                <label className="settings-row">
                  <span className="settings-row-label">
                    <ALargeSmall className="settings-section-icon" aria-hidden="true" />
                    <span>{text.settings.checkFontSize}</span>
                  </span>
                  <div className="settings-range-wrap">
                    <input
                      type="range"
                      min={12}
                      max={24}
                      value={settings.checkFontSize}
                      onChange={(event) => {
                        setSettings((current) => ({ ...current, checkFontSize: Number(event.target.value) }))
                      }}
                    />
                    <strong>{settings.checkFontSize}px</strong>
                  </div>
                </label>
              </div>

              <div className="settings-section settings-shortcut-section">
                <button
                  type="button"
                  className="ghost-button settings-collapse-button"
                  aria-haspopup="dialog"
                  aria-expanded={settingsDetail === 'quickText'}
                  onClick={(event) => openSettingsDetail('quickText', event)}
                >
                  <span className="settings-collapse-label">
                    <TextCursorInput className="settings-section-icon" aria-hidden="true" />
                    <span>{text.settings.quickText}</span>
                  </span>
                  <ChevronRight className="settings-detail-chevron" aria-hidden="true" />
                </button>
              </div>

              <div className="settings-section settings-shortcut-section">
                <button
                  type="button"
                  className="ghost-button settings-collapse-button"
                  aria-haspopup="dialog"
                  aria-expanded={settingsDetail === 'shortcuts'}
                  onClick={(event) => openSettingsDetail('shortcuts', event)}
                >
                  <span className="settings-collapse-label">
                    <Keyboard className="settings-section-icon" aria-hidden="true" />
                    <span>{text.settings.shortcutOverview}</span>
                  </span>
                  <ChevronRight className="settings-detail-chevron" aria-hidden="true" />
                </button>
              </div>
            </div>

            {settingsDetail ? (
              <div
                className="settings-detail-layer"
                onClick={(event) => {
                  event.stopPropagation()
                  closeSettingsDetail()
                }}
              >
                <div className="settings-detail-frame">
                  <div
                    ref={detailPageRef}
                    className="settings-detail-page"
                    role="dialog"
                    aria-modal="true"
                    aria-labelledby="settings-detail-title"
                    onClick={(event) => event.stopPropagation()}
                  >
                    <div className="settings-detail-header">
                      <button
                        ref={detailBackButtonRef}
                        type="button"
                        className="settings-detail-back"
                        onClick={closeSettingsDetail}
                        aria-label={text.settings.backToSettings}
                        title={text.settings.backToSettings}
                      >
                        <ArrowLeft aria-hidden="true" />
                      </button>
                      <span className="settings-detail-heading">
                        {settingsDetail === 'quickText' ? (
                          <TextCursorInput aria-hidden="true" />
                        ) : (
                          <Keyboard aria-hidden="true" />
                        )}
                        <strong id="settings-detail-title">
                          {settingsDetail === 'quickText'
                            ? text.settings.quickText
                            : text.settings.shortcutOverview}
                        </strong>
                      </span>
                    </div>

                    <div className="settings-detail-body">
                      {settingsDetail === 'quickText' ? (
                        <>
                          <p className="settings-detail-hint">{text.settings.quickTextKeyHint}</p>
                          <div className="settings-quicktext-list">
                            {settings.quickTexts.map((item, index) => (
                              <div key={`${item.key}-${index}`} className="settings-quicktext-row">
                                <input
                                  type="text"
                                  className="settings-text-input"
                                  value={item.text}
                                  placeholder={text.settings.quickTextText}
                                  onChange={(event) => {
                                    setSettings((current) => ({
                                      ...current,
                                      quickTexts: current.quickTexts.map((entry, entryIndex) =>
                                        entryIndex === index ? { ...entry, text: event.target.value } : entry,
                                      ),
                                    }))
                                  }}
                                />
                                <input
                                  type="text"
                                  className="settings-key-input"
                                  value={item.key}
                                  maxLength={1}
                                  placeholder={text.settings.quickTextKey}
                                  onChange={(event) => {
                                    setSettings((current) => ({
                                      ...current,
                                      quickTexts: current.quickTexts.map((entry, entryIndex) =>
                                        entryIndex === index
                                          ? { ...entry, key: event.target.value.toUpperCase() }
                                          : entry,
                                      ),
                                    }))
                                  }}
                                />
                                <button
                                  type="button"
                                  className="settings-quicktext-delete"
                                  aria-label={text.settings.deleteQuickText}
                                  title={text.settings.deleteQuickText}
                                  onClick={() => {
                                    setSettings((current) => ({
                                      ...current,
                                      quickTexts: current.quickTexts.filter((_, entryIndex) => entryIndex !== index),
                                    }))
                                  }}
                                >
                                  <Trash2 aria-hidden="true" />
                                </button>
                              </div>
                            ))}
                          </div>
                          <button
                            type="button"
                            className="ghost-button settings-detail-add"
                            onClick={() => {
                              setSettings((current) => ({
                                ...current,
                                quickTexts: [...current.quickTexts, { text: '', key: '' }],
                              }))
                            }}
                          >
                            <Plus aria-hidden="true" />
                            {text.settings.addQuickText}
                          </button>
                        </>
                      ) : (
                        <div className="settings-shortcut-list settings-shortcut-list-detail">
                          {[
                            text.preview.shortcutCategory,
                            text.preview.shortcutDelete,
                            text.preview.shortcutUndoRedo,
                            text.preview.shortcutFile,
                            text.preview.shortcutAdvance,
                            text.preview.shortcutQuickText,
                            text.preview.shortcutHide,
                            text.preview.shortcutFit,
                            text.preview.shortcutCheck,
                            text.preview.shortcutReading,
                            text.preview.shortcutFocusEditor,
                          ].map((shortcut) => (
                            <p key={shortcut}>{renderShortcutText(shortcut)}</p>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            ) : null}
          </div>
        ) : null}

        <div className="top-section-body">
          <div className="toolbar-brand">
            <img className="brand-logo" src={`${import.meta.env.BASE_URL}logo.svg`} alt="" />
            <h1>LabelPlusX</h1>
          </div>
          <div
            className="workspace-toolbar"
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
          >
            <button
              type="button"
              className="toolbar-button"
              onClick={() => void handleCreateWorkspace()}
              disabled={isBusy}
              title={isDesktop ? text.import.createWorkspaceDesktopHint : text.import.createWorkspaceWebHint}
            >
              <Plus aria-hidden="true" />
              {text.import.createTitle}
            </button>
            <button
              type="button"
              className="toolbar-button"
              onClick={() => void handleImportLabelText()}
              disabled={isBusy}
              title={isDesktop ? text.import.importTextDesktopSubHint : text.import.importTextWebSubHint}
            >
              <FolderOpen aria-hidden="true" />
              {isBusy ? text.import.loading : text.import.title}
            </button>
            {!isDesktop ? (
              <label
                className={workspace ? 'toolbar-button' : 'toolbar-button is-disabled'}
                title={workspace ? text.import.linkImagesHint : text.import.linkImagesNeedsWorkspace}
                aria-disabled={!workspace}
                onClick={(event) => {
                  if (!workspace) {
                    event.preventDefault()
                  }
                }}
              >
                <ImageIcon aria-hidden="true" />
                {text.import.linkImages}
                <input className="hidden-file-input" type="file" accept="image/*" multiple onChange={handleImageFilesChange} disabled={isBusy || !workspace} />
              </label>
            ) : null}
            <input
              ref={newWorkspaceImageInputRef}
              className="hidden-file-input"
              type="file"
              accept="image/*"
              multiple
              onChange={handleNewWorkspaceImageFilesChange}
            />
            <input
              ref={labelFileInputRef}
              className="hidden-file-input"
              type="file"
              accept=".txt,text/plain"
              onChange={handleLabelFileChange}
            />
          </div>
          {hasUnsavedLocalEdits ? (
            <p className="storage-hint" role="status">
              {settings.autoSave
                ? isDesktop ? text.import.autoSaveDesktopHint : text.import.autoSaveWebHint
                : text.import.unsavedHint}
            </p>
          ) : null}
        </div>
      </section>

      <main ref={workspaceLayoutRef} className="workspace-layout" style={{ '--file-panel-width': `${filePanelWidth}px`, '--label-panel-width': `${labelPanelWidth}px` } as CSSProperties}>
        <aside className="panel file-panel">
          <div className="panel-header">
            <h3 className="panel-heading">
              <Files className="heading-icon" aria-hidden="true" />
              <span>{text.workspace.files}</span>
            </h3>
          </div>

          <div ref={fileListRef} className="file-list">
            <span className="sliding-indicator" aria-hidden="true" />
            {workspace?.files.length ? (
              workspace.files.map((file) => (
                <button
                  key={file.name}
                  data-file-name={file.name}
                  type="button"
                  className={file.name === activeFileName ? 'file-item active' : 'file-item'}
                  onClick={() => selectFile(file.name)}
                >
                  <div className="file-item-main">
                    <div className="file-item-copy">
                      <span>{file.name}</span>
                      <small>{text.workspace.labelCount(file.labels.length)}</small>
                    </div>
                    <div className="file-item-thumb">
                       {getFileImageSrc(file) ? (
                         <img src={getFileImageSrc(file)} alt={file.name} className="file-item-thumb-image" />
                      ) : (
                        <span className="file-item-thumb-empty">{text.workspace.noImage}</span>
                      )}
                    </div>
                  </div>
                </button>
              ))
            ) : (
              <div className="empty-state compact">{text.workspace.emptyWorkspace}</div>
            )}
          </div>

          <div className="workspace-meta">
            <div className="workspace-meta-head">
              <h4 className="panel-heading">
                <Layers className="heading-icon" aria-hidden="true" />
                <span>{text.workspace.groups}</span>
              </h4>
              {workspace && getVisibleGroupNames().length < 9 ? (
                <button
                  type="button"
                  className="chip chip-selectable chip-add"
                  onClick={addGroup}
                  aria-label={text.workspace.addGroup}
                  title={text.workspace.addGroup}
                >
                  <Plus aria-hidden="true" />
                </button>
              ) : null}
            </div>

            {workspace ? (
              <div className="group-edit-list">
                {getVisibleGroupNames().map((group, index) => (
                  <div key={`group-edit-${index}`} className="group-edit-item">
                    <div className="group-edit-row">
                      <button
                        type="button"
                        className={
                          groupColorIndex === index
                            ? 'group-edit-index group-edit-color-trigger active'
                            : 'group-edit-index group-edit-color-trigger'
                        }
                        style={getCategoryChipStyle(index + 1)}
                        onClick={() => setGroupColorIndex(groupColorIndex === index ? null : index)}
                        aria-expanded={groupColorIndex === index}
                        aria-label={`修改分组 ${index + 1} 颜色`}
                        title="点击修改分组颜色"
                      >
                        {index + 1}
                      </button>
                      <input
                        value={group}
                        onFocus={() => {
                          if (groupUndoCapturedRef.current !== index) {
                            pushUndoSnapshot()
                            groupUndoCapturedRef.current = index
                          }
                        }}
                        onBlur={() => {
                          if (groupUndoCapturedRef.current === index) {
                            groupUndoCapturedRef.current = null
                          }
                        }}
                        onChange={(event) => updateGroupName(index, event.target.value, { captureHistory: false })}
                      />
                      <button
                        type="button"
                        className="group-delete-button"
                        onClick={() => deleteGroup(index)}
                        disabled={!canDeleteGroup(index)}
                        aria-label={`删除分组 ${index + 1}`}
                        title={canDeleteGroup(index) ? `删除分组 ${index + 1}` : '仅空分组可删除，且至少保留一个分组'}
                      >
                        <Minus aria-hidden="true" />
                      </button>
                    </div>
                    {groupColorIndex === index ? (
                      <div className="group-color-row">
                        {categoryColors.map((color) => (
                          <button
                            key={color}
                            type="button"
                            className={
                              getCategoryColor(index + 1) === color
                                ? 'group-color-swatch active'
                                : 'group-color-swatch'
                            }
                            style={{ '--swatch-color': color } as CSSProperties}
                            onClick={() => {
                              setGroupColor(index, color)
                              setGroupColorIndex(null)
                            }}
                            aria-label={`设为 ${color}`}
                          />
                        ))}
                      </div>
                    ) : null}
                  </div>
                ))}
              </div>
            ) : null}

            <h4 className="panel-heading">
              <StickyNote className="heading-icon" aria-hidden="true" />
              <span>{text.workspace.comment}</span>
            </h4>
            <textarea
              className="comment-box comment-editor"
              value={workspace?.comment ?? ''}
              onFocus={() => {
                if (!commentUndoCapturedRef.current) {
                  pushUndoSnapshot()
                  commentUndoCapturedRef.current = true
                  commentUndoLastCaptureAtRef.current = getNowTimestamp()
                  commentUndoLastValueRef.current = workspace?.comment ?? ''
                }
              }}
              onBlur={() => {
                commentUndoCapturedRef.current = false
              }}
              onChange={(event) => {
                const value = event.target.value
                updateComment(value, { captureHistory: false })
                captureProgressiveUndo(
                  value,
                  commentUndoCapturedRef,
                  commentUndoLastCaptureAtRef,
                  commentUndoLastValueRef,
                )
              }}
              placeholder={text.workspace.commentPlaceholder}
            />
          </div>
        </aside>

        <div
          className="panel-resizer"
          onPointerDown={(event) => startPanelResize(event, 'file')}
          onKeyDown={(event) => handlePanelResizeKey(event, 'file')}
          role="separator"
          tabIndex={0}
          aria-orientation="vertical"
          aria-label="调整工作区文件宽度"
          aria-valuemin={180}
          aria-valuemax={420}
          aria-valuenow={Math.round(filePanelWidth)}
        />

        <section className="panel preview-panel">
          <div className="panel-header">
            <div className="panel-heading-row">
              <h3 className="panel-heading">
                <ImageIcon className="heading-icon" aria-hidden="true" />
                <span>{text.preview.title}</span>
              </h3>
              <p className="panel-subtitle">{activeFileImageSrc ? text.preview.imageMatched : status}</p>
            </div>
            <div className={isCheckMode ? 'preview-toolbar is-check-mode' : 'preview-toolbar'}>
              <div className="preview-marker-group" role="group" aria-label={text.preview.markerSize}>
                <button
                  type="button"
                  className="ghost-button preview-marker-button"
                  onClick={() => changeMarkerFontSize(-1)}
                  aria-label={text.preview.markerSizeDown}
                  title={text.preview.markerSizeDown}
                  disabled={settings.markerFontSize <= minMarkerFontSize}
                >
                  <span aria-hidden="true">A−</span>
                </button>
                <span className="preview-marker-value" title={text.preview.markerSize}>
                  {settings.markerFontSize}
                </span>
                <button
                  type="button"
                  className="ghost-button preview-marker-button"
                  onClick={() => changeMarkerFontSize(1)}
                  aria-label={text.preview.markerSizeUp}
                  title={text.preview.markerSizeUp}
                  disabled={settings.markerFontSize >= maxMarkerFontSize}
                >
                  <span aria-hidden="true">A+</span>
                </button>
              </div>
              <span className="preview-toolbar-divider" aria-hidden="true" />
              <div className="preview-help-wrap">
                <button
                  type="button"
                  className="ghost-button preview-help-button"
                  aria-label={text.preview.helpLabel}
                  title={text.preview.helpLabel}
                >
                  <CircleHelp aria-hidden="true" />
                </button>
                <div className="preview-help-tooltip" role="tooltip">
                  <strong>{text.preview.helpTitle}</strong>
                  <p>{text.preview.helpMove}</p>
                  <p>{text.preview.helpAdd}</p>
                  <p>{text.preview.helpDelete}</p>
                  <p>{text.preview.helpDrag}</p>
                  <p>{text.preview.helpZoom}</p>
                </div>
              </div>
              <div className="preview-zoom-cluster">
                <button
                  type="button"
                  className="ghost-button preview-reset-button"
                  onClick={fitPreview}
                  aria-label={text.preview.fit}
                  title={text.preview.fit}
                >
                  <Fullscreen aria-hidden="true" />
                </button>
                <div className="preview-zoom-group">
                  <button type="button" className="ghost-button preview-zoom-button" onClick={() => zoomPreview(-0.1)} aria-label="缩小">
                    <Minus aria-hidden="true" />
                  </button>
                  <span className="preview-zoom-value">{Math.round(previewZoom * 100)}%</span>
                  <button type="button" className="ghost-button preview-zoom-button" onClick={() => zoomPreview(0.1)} aria-label="放大">
                    <Plus aria-hidden="true" />
                  </button>
                </div>
              </div>
              <div className="preview-check-cluster">
                <button
                  type="button"
                  className={isCheckMode ? 'export-button preview-check-button' : 'ghost-button preview-check-button'}
                  aria-pressed={isCheckMode}
                  onClick={() => setIsCheckMode((current) => !current)}
                >
                  <ScanEye aria-hidden="true" />
                  <span>{isCheckMode ? text.preview.checkModeOn : text.preview.checkModeOff}</span>
                </button>
                {isCheckMode ? (
                  <button type="button" className="ghost-button reading-mode-button" onClick={toggleReadingMode}>
                    {readingMode === 'vertical' ? text.labels.readingVertical : text.labels.readingHorizontal}
                  </button>
                ) : null}
              </div>
            </div>
          </div>

          {activeFile ? (
            <div className="image-stage">
              {activeFileImageSrc ? (
                <div
                  ref={imageFrameRef}
                  className="image-frame"
                  onWheelCapture={handleImageWheel}
                  onWheel={handleImageWheel}
                  onDoubleClick={handleFrameDoubleClick}
                  onPointerDown={handleFramePointerDown}
                  onPointerMove={handleFramePointerMove}
                  onPointerUp={handleFramePointerUp}
                  onPointerCancel={handleFramePointerUp}
                  onPointerLeave={() => {
                    previewPointerRef.current.inside = false
                  }}
                >
                  <div className="preview-pan-layer" style={{ transform: `translate(${previewPan.x}px, ${previewPan.y}px)` }}>
                    <div
                      className="preview-content-layer"
                      style={{
                        width: scaledPreviewWidth > 0 ? `${scaledPreviewWidth}px` : undefined,
                        height: scaledPreviewHeight > 0 ? `${scaledPreviewHeight}px` : undefined,
                      }}
                    >
                      <div className="preview-scale-layer" style={{ transform: `scale(${previewZoom})` }}>
                        <img
                          ref={previewImageRef}
                          src={activeFileImageSrc}
                          alt={activeFile.name}
                          className="preview-image"
                          onLoad={handlePreviewImageLoad}
                          onError={() => setStatus(text.status.imageLoadFailed(activeFile.name))}
                          style={{
                            width: imageNaturalSize.width > 0 ? `${imageNaturalSize.width}px` : undefined,
                            height: imageNaturalSize.height > 0 ? `${imageNaturalSize.height}px` : undefined,
                          }}
                        />
                      </div>
                      <div
                        className={arePreviewLabelsHidden ? 'marker-layer marker-layer-hidden' : 'marker-layer'}
                        style={
                          {
                            '--marker-size': `${settings.markerFontSize * 2}px`,
                            '--marker-font-size': `${settings.markerFontSize}px`,
                          } as CSSProperties
                        }
                      >
                        {activeFile.labels.map((label) => (
                          <div key={label.id} className="marker-group" style={{ left: `${label.xPercent * 100}%`, top: `${label.yPercent * 100}%` }}>
                            <button
                              type="button"
                              className={
                                label.id === activeLabelId
                                  ? 'marker active'
                                  : 'marker'
                              }
                              style={getMarkerStyle(label.category)}
                              onClick={() => selectLabel(label)}
                              onDoubleClick={() => selectLabel(label, true)}
                              onContextMenu={(event) => {
                                event.preventDefault()
                                event.stopPropagation()
                                deleteLabel(label.id)
                              }}
                              onPointerDown={(event) => handleMarkerPointerDown(event, label.id)}
                              title={label.text || `Label ${label.id}`}
                            >
                              {label.id}
                            </button>

                            {isCheckMode && label.text ? (
                              <div
                                className={
                                  readingMode === 'vertical'
                                    ? 'check-label check-label-vertical'
                                    : 'check-label check-label-horizontal'
                                }
                                style={{ fontSize: `${settings.checkFontSize}px` }}
                              >
                                {label.text}
                              </div>
                            ) : null}
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                  {isQuickTextOpen && quickTextMode === 'preview' && previewQuickTextAnchor ? (
                    <div
                      ref={quickTextPanelRef}
                      className="quicktext-panel quicktext-panel-preview"
                      style={{ left: `${previewQuickTextAnchor.x / uiScale}px`, top: `${previewQuickTextAnchor.y / uiScale}px` }}
                    >
                      {settings.quickTexts.filter((item) => item.text).map((item, index) => (
                        <button
                          key={`${item.key}-${item.text}-${index}`}
                          type="button"
                          className="quicktext-item"
                          onClick={() => insertQuickText(item.text)}
                        >
                          <span>{item.text}</span>
                          <kbd>{item.key || '-'}</kbd>
                        </button>
                      ))}
                    </div>
                  ) : null}
                </div>
              ) : (
                <div className="empty-state">{text.preview.emptyWithDesktop}</div>
              )}
            </div>
          ) : (
            <div className="empty-state">{text.preview.emptyBeforeWorkspace}</div>
          )}
        </section>

        <div
          className="panel-resizer"
          onPointerDown={(event) => startPanelResize(event, 'label')}
          onKeyDown={(event) => handlePanelResizeKey(event, 'label')}
          tabIndex={0}
          aria-valuemin={240}
          aria-valuemax={720}
          aria-valuenow={Math.round(labelPanelWidth)}
          role="separator"
          aria-orientation="vertical"
          aria-label="调整翻译内容宽度"
        />

        <aside className="panel label-panel">
          <div className="panel-header">
            <div className="panel-heading-row">
              <h3 className="panel-heading">
                <Languages className="heading-icon" aria-hidden="true" />
                <span>{text.labels.title}</span>
              </h3>
              <p className="panel-subtitle">{activeFile ? text.labels.lineCount(activeFile.labels.length) : text.labels.selectedFileEmpty}</p>
            </div>

          </div>

          {activeFile ? (
            <>
              <div ref={labelListRef} className="label-list">
                <span className="sliding-indicator" aria-hidden="true" />
                {activeFile.labels.map((label) => (
                  <button
                    key={label.id}
                    type="button"
                    className={label.id === activeLabelId ? (label.text.trim() ? 'label-item active' : 'label-item label-item-empty active') : (label.text.trim() ? 'label-item' : 'label-item label-item-empty')}
                    onClick={() => selectLabel(label)}
                    onDoubleClick={() => selectLabel(label, true)}
                  >
                      <div className="label-item-top label-item-row">
                        <span className="label-index">#{label.id}</span>
                        <span className="label-category" style={getCategoryChipStyle(label.category)}>
                          <span className="label-category-name">{getResolvedGroupName(label.category)}</span>
                          <span className="label-category-index">{label.category}</span>
                        </span>
                        <span className="label-item-text">{label.text || text.labels.emptyText}</span>
                      </div>
                    </button>
                ))}
              </div>

              <div className="label-detail">
                <div className="label-detail-header">
                  <h4 className="panel-heading">
                    <Tag className="heading-icon" aria-hidden="true" />
                    <span>{text.labels.currentLabel}</span>
                  </h4>
                  {firstUntranslatedLabel ? (
                    <button type="button" className="ghost-button untranslated-jump-button" onClick={() => selectLabel(firstUntranslatedLabel)}>
                      {text.labels.untranslatedCount(untranslatedLabels.length)}
                    </button>
                  ) : null}
                </div>
                {activeLabel ? (
                  <>
                    <div className="label-position-row">
                      <span className="label-position-pill is-x">X {activeLabel.xPercent.toFixed(3)}</span>
                      <span className="label-position-pill is-y">Y {activeLabel.yPercent.toFixed(3)}</span>
                    </div>
                    <div className="label-category-block">
                      <span className="label-category-block-title">{text.labels.category}</span>
                      <div className="label-category-tags" role="group" aria-label={text.labels.category}>
                        {getVisibleGroupNames().map((group, index) => (
                          <button
                            key={`${group}-${index + 1}`}
                            type="button"
                            className={activeLabel.category === index + 1 ? 'label-category-tag active' : 'label-category-tag'}
                            style={getCategoryChipStyle(index + 1)}
                            onClick={() => updateActiveLabelCategory(index + 1)}
                            aria-pressed={activeLabel.category === index + 1}
                          >
                            <span className="label-category-tag-name">
                              {group || text.labels.groupFallback(index + 1)}
                            </span>
                            <span className="label-category-tag-index">{index + 1}</span>
                          </button>
                        ))}
                      </div>
                    </div>
                    <div className="label-editor-wrap">
                      <textarea
                        ref={labelEditorRef}
                        value={activeLabel.text}
                        onFocus={() => {
                          if (!labelTextUndoCapturedRef.current) {
                            pushUndoSnapshot()
                            labelTextUndoCapturedRef.current = true
                            labelTextUndoLastCaptureAtRef.current = getNowTimestamp()
                            labelTextUndoLastValueRef.current = activeLabel?.text ?? ''
                          }
                        }}
                        onBlur={() => {
                          labelTextUndoCapturedRef.current = false
                        }}
                        onChange={(event) => {
                          const value = event.target.value
                          updateActiveLabelText(value, { captureHistory: false })
                          captureProgressiveUndo(
                            value,
                            labelTextUndoCapturedRef,
                            labelTextUndoLastCaptureAtRef,
                            labelTextUndoLastValueRef,
                          )
                        }}
                        placeholder={text.labels.textPlaceholder}
                      />
                      {isQuickTextOpen && quickTextMode === 'editor' ? (
                        <div ref={quickTextPanelRef} className="quicktext-panel">
                          {settings.quickTexts.filter((item) => item.text).map((item, index) => (
                            <button
                              key={`${item.key}-${item.text}-${index}`}
                              type="button"
                              className="quicktext-item"
                              onClick={() => insertQuickText(item.text)}
                            >
                              <span>{item.text}</span>
                              <kbd>{item.key || '-'}</kbd>
                            </button>
                          ))}
                        </div>
                      ) : null}
                    </div>
                    <div className="editor-actions">
                      <button type="button" className="ghost-button" onClick={handleSaveLocal}>
                        <Save aria-hidden="true" />
                        {isDesktop ? text.labels.saveDesktop : text.labels.saveBrowser}
                      </button>
                      <button type="button" className="export-button" onClick={handleExport}>
                        <Download aria-hidden="true" />
                        {text.labels.exportTxt}
                      </button>
                    </div>
                  </>
                ) : (
                  <div className="empty-state compact">{text.labels.noLabelInCurrentImage}</div>
                )}
              </div>
            </>
          ) : (
            <div className="empty-state">{text.labels.emptyBeforeText}</div>
          )}
        </aside>
      </main>
    </div>
  )
}

export default App
