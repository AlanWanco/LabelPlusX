import { useCallback, useEffect, useRef, useState } from 'react'
import type { ChangeEvent, CSSProperties } from 'react'
import { ChevronDown, CircleHelp, Minus, Moon, Plus, Settings, SunMedium } from 'lucide-react'
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
import type { LabelEntry, ReadingMode, ThemeMode, WorkspaceData } from './types'

const themeStorageKey = 'labelplusx-theme'
const readingModeStorageKey = 'labelplusx-reading-mode'
const settingsStorageKey = 'labelplusx-settings'
const exportFileName = 'labelplus-export.txt'
const minPreviewZoom = 0.1
const maxPreviewZoom = 8
const categoryColors = ['#ef4444', '#3b82f6', '#22c55e', '#f59e0b', '#a855f7', '#06b6d4', '#ec4899', '#f97316', '#64748b']
const appVersion = packageJson.version
const projectHomepage = 'https://github.com/AlanWanco/LabelPlusX'
const editableSelector = 'input, textarea, select, [contenteditable="true"]'
const defaultGroupNames = ['框内', '框外']
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
  quickTexts: QuickTextItem[]
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

function getInitialSettings() {
  if (typeof window === 'undefined') {
    return {
      autoSave: true,
      checkFontSize: 16,
      quickTexts: defaultQuickTexts,
    }
  }

  try {
    const raw = window.localStorage.getItem(settingsStorageKey)
    if (!raw) {
      return {
        autoSave: true,
        checkFontSize: 16,
        quickTexts: defaultQuickTexts,
      }
    }

    const parsed = JSON.parse(raw) as { autoSave?: boolean; checkFontSize?: number; quickTexts?: QuickTextItem[] }
    return {
      autoSave: parsed.autoSave ?? true,
      checkFontSize: Math.min(24, Math.max(12, parsed.checkFontSize ?? 16)),
      quickTexts: Array.isArray(parsed.quickTexts) && parsed.quickTexts.length > 0
        ? parsed.quickTexts
          .map((item) => ({
            text: String(item.text ?? '').slice(0, 32),
            key: String(item.key ?? '').slice(0, 1).toUpperCase(),
          }))
          .filter((item) => item.text)
        : defaultQuickTexts,
    }
  } catch {
    return {
      autoSave: true,
      checkFontSize: 16,
      quickTexts: defaultQuickTexts,
    }
  }
}

function App() {
  const isDesktop = isTauriRuntime()
  const isMacPlatform = typeof navigator !== 'undefined' && /mac/i.test(navigator.platform)
  const isWindowsPlatform = typeof navigator !== 'undefined' && /win/i.test(navigator.userAgent)
  const [theme, setTheme] = useState<ThemeMode>(getInitialTheme)
  const [settings, setSettings] = useState<AppSettings>(getInitialSettings)
  const [workspace, setWorkspace] = useState<WorkspaceData | null>(null)
  const [activeFileName, setActiveFileName] = useState<string>('')
  const [activeLabelId, setActiveLabelId] = useState<number | null>(null)
  const [status, setStatus] = useState<string>(text.status.waitingWorkspace)
  const [isBusy, setIsBusy] = useState(false)
  const [isDragging, setIsDragging] = useState(false)
  const [isTopbarCollapsed, setIsTopbarCollapsed] = useState(false)
  const [isSettingsOpen, setIsSettingsOpen] = useState(false)
  const [hasUnsavedLocalEdits, setHasUnsavedLocalEdits] = useState(false)
  const [previewZoom, setPreviewZoom] = useState(1)
  const [previewPan, setPreviewPan] = useState({ x: 0, y: 0 })
  const [isCheckMode, setIsCheckMode] = useState(false)
  const [readingMode, setReadingMode] = useState<ReadingMode>(getInitialReadingMode)
  const [imageNaturalSize, setImageNaturalSize] = useState({ width: 0, height: 0 })
  const [selectedCategory, setSelectedCategory] = useState(1)
  const [labelPanelWidth, setLabelPanelWidth] = useState(360)
  const [arePreviewLabelsHidden, setArePreviewLabelsHidden] = useState(false)
  const [isQuickTextOpen, setIsQuickTextOpen] = useState(false)
  const [quickTextMode, setQuickTextMode] = useState<'editor' | 'preview' | null>(null)
  const [isQuickTextSettingsOpen, setIsQuickTextSettingsOpen] = useState(false)
  const [isShortcutListOpen, setIsShortcutListOpen] = useState(false)
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
  const newWorkspaceImageInputRef = useRef<HTMLInputElement | null>(null)
  const labelFileInputRef = useRef<HTMLInputElement | null>(null)
  const labelEditorRef = useRef<HTMLTextAreaElement | null>(null)
  const quickTextPanelRef = useRef<HTMLDivElement | null>(null)
  const labelPanelResizeStateRef = useRef<{ startX: number; startWidth: number } | null>(null)
  const labelTextUndoCapturedRef = useRef(false)
  const commentUndoCapturedRef = useRef(false)
  const groupUndoCapturedRef = useRef<number | null>(null)
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

  useEffect(() => {
    document.documentElement.dataset.theme = theme
    window.localStorage.setItem(themeStorageKey, theme)
  }, [theme])

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
    setActiveFileName(fileName)
    setActiveLabelId(file?.labels[0]?.id ?? null)
    setPreviewZoom(1)
    setPreviewPan({ x: 0, y: 0 })
    setImageNaturalSize({ width: 0, height: 0 })
  }

  function getCategoryColor(category: number) {
    return categoryColors[(Math.max(1, category) - 1) % categoryColors.length]
  }

  function focusLabelInPreview(label: LabelEntry) {
    const frame = imageFrameRef.current
    if (!frame || imageNaturalSize.width <= 0 || imageNaturalSize.height <= 0) {
      return
    }

    const frameRect = frame.getBoundingClientRect()
    const scaledWidth = imageNaturalSize.width * previewZoom
    const scaledHeight = imageNaturalSize.height * previewZoom
    const baseX = (frameRect.width - scaledWidth) / 2
    const targetX = frameRect.width / 2
    const targetY = frameRect.height * 0.36

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

  function getGroupDisplayName(index: number) {
    return `${getResolvedGroupName(index)}(${index})`
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

  function fitPreviewToSize(width: number, height: number) {
    const frame = imageFrameRef.current
    if (!frame || width <= 0 || height <= 0) {
      return
    }

    const frameRect = frame.getBoundingClientRect()
    const fitByHeight = frameRect.width >= frameRect.height
    const nextZoom = fitByHeight ? frameRect.height / height : frameRect.width / width

    setPreviewZoom(clampZoom(nextZoom))
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
    hasManualPreviewTransformRef.current = false

    requestAnimationFrame(() => {
      fitPreviewToSize(nextSize.width, nextSize.height)
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
        x: session.basePanX + event.clientX - session.startX,
        y: session.basePanY + event.clientY - session.startY,
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
        const fitByHeight = rect.width >= rect.height
        const nextZoom = fitByHeight
          ? rect.height / imageNaturalSize.height
          : rect.width / imageNaturalSize.width

        setPreviewZoom(clampZoom(nextZoom))
        setPreviewPan({ x: 0, y: 0 })
      })
    })

    observer.observe(frame)
    return () => observer.disconnect()
  }, [activeFileImageSrc, imageNaturalSize.height, imageNaturalSize.width])

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
          selectRelativeLabel(-1, { shouldFocusEditor: isEditable })
          return
        }

        if (event.key === 'ArrowDown') {
          event.preventDefault()
          selectRelativeLabel(1, { shouldFocusEditor: isEditable })
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

  useEffect(() => {
    function handlePointerMove(event: PointerEvent) {
      const session = labelPanelResizeStateRef.current
      if (!session) {
        return
      }

      const nextWidth = Math.min(560, Math.max(280, session.startWidth - (event.clientX - session.startX)))
      setLabelPanelWidth(nextWidth)
    }

    function handlePointerUp() {
      labelPanelResizeStateRef.current = null
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
    }

    window.addEventListener('pointermove', handlePointerMove)
    window.addEventListener('pointerup', handlePointerUp)

    return () => {
      window.removeEventListener('pointermove', handlePointerMove)
      window.removeEventListener('pointerup', handlePointerUp)
    }
  }, [])

  return (
    <div className={isDesktop ? 'shell shell-desktop' : 'shell'}>
      <section
        className={
          isTopbarCollapsed
            ? isDragging
              ? 'top-section top-section-collapsed drag-active'
              : 'top-section top-section-collapsed'
            : isDragging
              ? 'top-section drag-active'
              : 'top-section'
        }
      >
        <div className="top-section-controls">
          <button
            type="button"
            className="ghost-button theme-toggle-button"
            onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
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
            onClick={() => setIsSettingsOpen((current) => !current)}
            aria-label={text.top.openSettings}
            title={text.top.openSettings}
          >
            <Settings className="settings-icon" aria-hidden="true" />
          </button>

          <button
            type="button"
            className={isTopbarCollapsed ? 'top-section-toggle is-collapsed' : 'top-section-toggle'}
            onClick={() => setIsTopbarCollapsed((current) => !current)}
            aria-label={isTopbarCollapsed ? text.top.expandTopbar : text.top.collapseTopbar}
            title={isTopbarCollapsed ? text.top.expandTopbar : text.top.collapseTopbar}
          >
            <ChevronDown className="top-section-toggle-icon" aria-hidden="true" />
          </button>
        </div>

        {isSettingsOpen ? (
          <div className="settings-overlay" onClick={() => setIsSettingsOpen(false)}>
            <div className="settings-popup" onClick={(event) => event.stopPropagation()}>
              <div className="settings-popup-header">
                <div className="brand-banner settings-brand-banner">
                  <div className="settings-brand-meta">
                    <a className="settings-meta-pill" href={projectHomepage} target="_blank" rel="noreferrer">
                      {text.settings.githubHomepage}
                    </a>
                    <span className="settings-meta-pill">v{appVersion}</span>
                  </div>
                  <p className="eyebrow">LabelPlus Modern Client</p>
                  <h1>LabelPlusX</h1>
                  <p className="subtitle">{text.top.subtitle}</p>
                </div>
                <h3>{text.settings.title}</h3>
              </div>

              <div className="settings-section">
                <label className="settings-row">
                  <span>{text.settings.autoSave}</span>
                  <input
                    type="checkbox"
                    checked={settings.autoSave}
                    onChange={(event) => {
                      setSettings((current) => ({ ...current, autoSave: event.target.checked }))
                    }}
                  />
                </label>

                <label className="settings-row settings-row-range">
                  <span>{text.settings.checkFontSize}</span>
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
                  onClick={() => setIsQuickTextSettingsOpen((current) => !current)}
                >
                  <span>{text.settings.quickText}</span>
                  <span>{isQuickTextSettingsOpen ? '−' : '+'}</span>
                </button>
                {isQuickTextSettingsOpen ? (
                  <>
                    <p className="settings-inline-hint">{text.settings.quickTextKeyHint}</p>
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
                                  entryIndex === index ? { ...entry, key: event.target.value.toUpperCase() } : entry,
                                ),
                              }))
                            }}
                          />
                        </div>
                      ))}
                    </div>
                    <button
                      type="button"
                      className="ghost-button settings-collapse-button"
                      onClick={() => {
                        setSettings((current) => ({
                          ...current,
                          quickTexts: [...current.quickTexts, { text: '', key: '' }],
                        }))
                      }}
                    >
                      {text.settings.addQuickText}
                    </button>
                  </>
                ) : null}
              </div>

              <div className="settings-section settings-shortcut-section">
                <button
                  type="button"
                  className="ghost-button settings-collapse-button"
                  onClick={() => setIsShortcutListOpen((current) => !current)}
                >
                  <span>{text.settings.shortcutOverview}</span>
                  <span>{isShortcutListOpen ? '−' : '+'}</span>
                </button>
                {isShortcutListOpen ? (
                  <div className="settings-shortcut-list">
                    <p>{text.preview.shortcutCategory}</p>
                    <p>{text.preview.shortcutDelete}</p>
                    <p>{text.preview.shortcutUndoRedo}</p>
                    <p>{text.preview.shortcutFile}</p>
                    <p>{text.preview.shortcutAdvance}</p>
                    <p>{text.preview.shortcutQuickText}</p>
                    <p>{text.preview.shortcutHide}</p>
                    <p>{text.preview.shortcutFit}</p>
                    <p>{text.preview.shortcutCheck}</p>
                    <p>{text.preview.shortcutReading}</p>
                    <p>{text.preview.shortcutFocusEditor}</p>
                  </div>
                ) : null}
              </div>
            </div>
          </div>
        ) : null}

        <div className="top-section-collapsed-bar" aria-hidden={!isTopbarCollapsed}>
          <span className="top-section-collapsed-badge">
            <span className="top-section-collapsed-dot" aria-hidden="true" />
            <span className="top-section-collapsed-title">LabelPlusX</span>
          </span>
        </div>

        <div className="top-section-body">
          <div className="topbar">
            <div className="brand-banner">
              <p className="eyebrow">LabelPlus Modern Client</p>
              <h1>LabelPlusX</h1>
              <p className="subtitle">{text.top.subtitle}</p>
            </div>
          </div>

          <div className="create-panel">
            <div className="create-dropzone">
              <div className="import-hub-copy">
                <div className="import-hub-topline">
                  <span className="hero-pill">{text.import.createTitle}</span>
                </div>
              </div>

              <div className="action-entry">
                <div className="action-button-wrap">
                  <button type="button" className="secondary-card action-button" onClick={() => void handleCreateWorkspace()} disabled={isBusy}>
                    <span className="action-button-title">{text.import.createWorkspace}</span>
                    <span className="file-picker-cta">{isDesktop ? text.import.chooseFolder : text.import.chooseImages}</span>
                  </button>
                  <div className="action-button-tooltip" role="tooltip">
                    {isDesktop ? text.import.createWorkspaceDesktopHint : text.import.createWorkspaceWebHint}
                  </div>
                </div>
              </div>

              <input
                ref={newWorkspaceImageInputRef}
                className="hidden-file-input"
                type="file"
                accept="image/*"
                multiple
                onChange={handleNewWorkspaceImageFilesChange}
              />
            </div>
          </div>

          <div className="import-panel">
            <div
              className={isDragging ? 'import-dropzone drag-active' : 'import-dropzone'}
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
            >
              <div className="import-hub-copy">
                <div className="import-hub-topline">
                  <span className="hero-pill">{text.import.title}</span>
                </div>
                {hasUnsavedLocalEdits ? (
                  <p className="storage-hint">
                    {settings.autoSave
                      ? isDesktop
                        ? text.import.autoSaveDesktopHint
                        : text.import.autoSaveWebHint
                      : text.import.unsavedHint}
                  </p>
                ) : null}
              </div>

              <div className={isDesktop ? 'action-grid action-grid--wide action-grid--single' : 'action-grid action-grid--wide'}>
                <div className="action-entry">
                  <div className="action-button-wrap">
                    <button
                      type="button"
                      className="primary-button action-button"
                      onClick={() => void handleImportLabelText()}
                      disabled={isBusy}
                    >
                      <span className="action-button-title">{isBusy ? text.import.loading : text.import.importText}</span>
                      <span className="file-picker-cta">{text.import.chooseTxt}</span>
                    </button>
                    <div className="action-button-tooltip" role="tooltip">
                      {isDesktop ? text.import.importTextDesktopSubHint : text.import.importTextWebSubHint}
                    </div>
                  </div>
                </div>

                <input
                  ref={labelFileInputRef}
                  className="hidden-file-input"
                  type="file"
                  accept=".txt,text/plain"
                  onChange={handleLabelFileChange}
                />

                {!isDesktop ? (
                  <div className="action-entry">
                    <div className="action-button-wrap">
                      <label className="secondary-card action-button">
                        <span className="action-button-title">{text.import.linkImages}</span>
                        <span className="file-picker-cta">{text.import.chooseImages}</span>
                        <input type="file" accept="image/*" multiple onChange={handleImageFilesChange} />
                      </label>
                      <div className="action-button-tooltip" role="tooltip">
                        {text.import.linkImagesHint}
                      </div>
                    </div>
                  </div>
                ) : null}
              </div>
            </div>
          </div>
        </div>
      </section>

      <main className="workspace-layout" style={{ '--label-panel-width': `${labelPanelWidth}px` } as CSSProperties}>
        <aside className="panel file-panel">
          <div className="panel-header">
            <h3>{text.workspace.files}</h3>
            <p>{workspace?.source === 'desktop' ? text.workspace.desktopMode : text.workspace.webMode}</p>
          </div>

          <div ref={fileListRef} className="file-list">
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
            <h4>{text.workspace.groups}</h4>
            <div className="chips chips-with-actions">
              {workspace ? (
                getVisibleGroupNames().map((group, index) => (
                  <button
                    key={`${group}-${index}`}
                    type="button"
                    className={index + 1 === selectedCategory ? 'chip chip-selectable active' : 'chip chip-selectable'}
                    style={getCategoryChipStyle(index + 1)}
                    onClick={() => setSelectedCategory(index + 1)}
                  >
                    {`${group || getResolvedGroupName(index + 1)}(${index + 1})`}
                  </button>
                ))
              ) : (
                <span className="chip muted">{text.workspace.noGroups}</span>
              )}
              {workspace && getVisibleGroupNames().length < 9 ? (
                <button type="button" className="chip chip-selectable chip-add" onClick={addGroup}>
                  +
                </button>
              ) : null}
            </div>

            {workspace ? (
              <div className="group-edit-list">
                {getVisibleGroupNames().map((group, index) => (
                  <label key={`group-edit-${index}`} className="group-edit-row">
                    <span>{index + 1}</span>
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
                      -
                    </button>
                  </label>
                ))}
              </div>
            ) : null}

            <h4>{text.workspace.comment}</h4>
            <textarea
              className="comment-box comment-editor"
              value={workspace?.comment ?? ''}
              onFocus={() => {
                if (!commentUndoCapturedRef.current) {
                  pushUndoSnapshot()
                  commentUndoCapturedRef.current = true
                }
              }}
              onBlur={() => {
                commentUndoCapturedRef.current = false
              }}
              onChange={(event) => updateComment(event.target.value, { captureHistory: false })}
              placeholder={text.workspace.commentPlaceholder}
            />
          </div>
        </aside>

        <section className="panel preview-panel">
          <div className="panel-header">
            <div>
              <h3>{text.preview.title}</h3>
               <p>{activeFileImageSrc ? text.preview.imageMatched : status}</p>
            </div>
            <div className="preview-toolbar">
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
                <button type="button" className="ghost-button preview-reset-button" onClick={fitPreview}>
                  {text.preview.fit}
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
              <button
                type="button"
                className={isCheckMode ? 'export-button preview-check-button' : 'ghost-button preview-check-button'}
                onClick={() => setIsCheckMode((current) => !current)}
              >
                {isCheckMode ? text.preview.checkModeOn : text.preview.checkModeOff}
              </button>
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
                    <div className={arePreviewLabelsHidden ? 'marker-layer marker-layer-hidden' : 'marker-layer'}>
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
                    {isQuickTextOpen && quickTextMode === 'preview' && previewQuickTextAnchor ? (
                      null
                    ) : null}
                  </div>
                  </div>
                  {isQuickTextOpen && quickTextMode === 'preview' && previewQuickTextAnchor ? (
                    <div
                      ref={quickTextPanelRef}
                      className="quicktext-panel quicktext-panel-preview"
                      style={{ left: `${previewQuickTextAnchor.x}px`, top: `${previewQuickTextAnchor.y}px` }}
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
          className="label-panel-resizer"
          onPointerDown={(event) => {
            labelPanelResizeStateRef.current = { startX: event.clientX, startWidth: labelPanelWidth }
            document.body.style.cursor = 'col-resize'
            document.body.style.userSelect = 'none'
          }}
          role="separator"
          aria-orientation="vertical"
          aria-label="调整翻译内容宽度"
        />

        <aside className="panel label-panel">
          <div className="panel-header">
            <div>
              <h3>{text.labels.title}</h3>
              <p>{activeFile ? text.labels.lineCount(activeFile.labels.length) : text.labels.selectedFileEmpty}</p>
            </div>
            {isCheckMode ? (
              <button type="button" className="ghost-button" onClick={toggleReadingMode}>
                {readingMode === 'vertical' ? text.labels.readingVertical : text.labels.readingHorizontal}
              </button>
            ) : null}
          </div>

          {activeFile ? (
            <>
              <div className="label-list">
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
                        <span className="label-category" style={{ color: getCategoryColor(label.category) }}>{getGroupDisplayName(label.category)}</span>
                        <span className="label-item-text">{label.text || text.labels.emptyText}</span>
                      </div>
                    </button>
                ))}
              </div>

              <div className="label-detail">
                <div className="label-detail-header">
                  <h4>{text.labels.currentLabel}</h4>
                  {firstUntranslatedLabel ? (
                    <button type="button" className="ghost-button untranslated-jump-button" onClick={() => selectLabel(firstUntranslatedLabel)}>
                      {text.labels.untranslatedCount(untranslatedLabels.length)}
                    </button>
                  ) : null}
                </div>
                {activeLabel ? (
                  <>
                    <div className="detail-grid">
                      <span>X {activeLabel.xPercent.toFixed(3)}</span>
                      <span>Y {activeLabel.yPercent.toFixed(3)}</span>
                    </div>
                    <label className="label-category-select-row">
                      <span>{text.labels.category}</span>
                      <select
                        className="label-category-select"
                        value={activeLabel.category}
                        onChange={(event) => updateActiveLabelCategory(Number(event.target.value))}
                      >
                        {getVisibleGroupNames().map((group, index) => (
                          <option key={`${group}-${index + 1}`} value={index + 1}>
                            {`${group || text.labels.groupFallback(index + 1)}(${index + 1})`}
                          </option>
                        ))}
                      </select>
                    </label>
                    <div className="label-editor-wrap">
                      <textarea
                        ref={labelEditorRef}
                        value={activeLabel.text}
                        onFocus={() => {
                          if (!labelTextUndoCapturedRef.current) {
                            pushUndoSnapshot()
                            labelTextUndoCapturedRef.current = true
                          }
                        }}
                        onBlur={() => {
                          labelTextUndoCapturedRef.current = false
                        }}
                        onChange={(event) => updateActiveLabelText(event.target.value, { captureHistory: false })}
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
                        {isDesktop ? text.labels.saveDesktop : text.labels.saveBrowser}
                      </button>
                      <button type="button" className="export-button" onClick={handleExport}>
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
