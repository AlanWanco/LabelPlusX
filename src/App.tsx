import { useCallback, useEffect, useRef, useState } from 'react'
import type { ChangeEvent, CSSProperties } from 'react'
import { ChevronDown, Moon, Settings, SunMedium } from 'lucide-react'
import './App.css'
import {
  isTauriRuntime,
  loadDesktopWorkspace,
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
const appVersion = '0.1.0'
const projectHomepage = 'https://github.com/AlanWanco/LabelPlusX'

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
    }
  }

  try {
    const raw = window.localStorage.getItem(settingsStorageKey)
    if (!raw) {
      return {
        autoSave: true,
        checkFontSize: 16,
      }
    }

    const parsed = JSON.parse(raw) as { autoSave?: boolean; checkFontSize?: number }
    return {
      autoSave: parsed.autoSave ?? true,
      checkFontSize: Math.min(24, Math.max(12, parsed.checkFontSize ?? 16)),
    }
  } catch {
    return {
      autoSave: true,
      checkFontSize: 16,
    }
  }
}

function App() {
  const isDesktop = isTauriRuntime()
  const [theme, setTheme] = useState<ThemeMode>(getInitialTheme)
  const [settings, setSettings] = useState(getInitialSettings)
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
  const objectUrlsRef = useRef<string[]>([])
  const importDroppedFilesRef = useRef<(fileList: FileList | File[]) => Promise<void>>(async () => {})
  const importDesktopDroppedPathsRef = useRef<(paths: string[]) => Promise<void>>(async () => {})
  const labelFileInputRef = useRef<HTMLInputElement | null>(null)
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
  const activeLabel = activeFile?.labels.find((label) => label.id === activeLabelId) ?? null
  const untranslatedLabels = activeFile?.labels.filter((label) => label.text.trim().length === 0) ?? []
  const firstUntranslatedLabel = untranslatedLabels[0] ?? null

  useEffect(() => {
    document.documentElement.dataset.theme = theme
    window.localStorage.setItem(themeStorageKey, theme)
  }, [theme])

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
    setActiveFileName(hydratedWorkspace.files[0]?.name ?? '')
    setActiveLabelId(hydratedWorkspace.files[0]?.labels[0]?.id ?? null)
    setSelectedCategory(1)
    setPreviewZoom(1)
    setPreviewPan({ x: 0, y: 0 })
    setImageNaturalSize({ width: 0, height: 0 })
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

  function selectLabel(label: LabelEntry) {
    setActiveLabelId(label.id)
    focusLabelInPreview(label)
  }

  function updateActiveLabelText(nextText: string) {
    if (!workspace || !activeFileName || activeLabelId === null) {
      return
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

  function updateComment(comment: string) {
    if (!workspace) {
      return
    }

    setWorkspace({
      ...workspace,
      comment,
    })
    setHasUnsavedLocalEdits(true)
    setStatus(text.status.commentSaved)
  }

  function addLabelAtPosition(xPercent: number, yPercent: number) {
    if (!workspace || !activeFileName) {
      return
    }

    const activeLabels = activeFile?.labels ?? []
    const nextId = activeLabels.reduce((maxId, label) => Math.max(maxId, label.id), 0) + 1
    const nextLabel: LabelEntry = {
      id: nextId,
      xPercent: Math.min(1, Math.max(0, xPercent)),
      yPercent: Math.min(1, Math.max(0, yPercent)),
      category: selectedCategory,
      text: '',
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
  }

  function zoomPreview(delta: number) {
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
    interactionRef.current = {
      type: 'label',
      pointerId: event.pointerId,
      labelId,
    }
    event.currentTarget.setPointerCapture(event.pointerId)
  }

  function handleFramePointerMove(event: React.PointerEvent<HTMLDivElement>) {
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
    updateLabelPosition(session.labelId, xPercent, yPercent)
  }

  function handleFramePointerUp(event: React.PointerEvent<HTMLDivElement>) {
    const session = interactionRef.current
    if (!session || session.pointerId !== event.pointerId) {
      return
    }

    interactionRef.current = null
    if (session.type === 'label') {
      setStatus(text.status.labelMoved(session.labelId))
    }
    event.currentTarget.releasePointerCapture(event.pointerId)
  }

  useEffect(() => {
    const frame = imageFrameRef.current
    if (!frame || imageNaturalSize.width <= 0 || imageNaturalSize.height <= 0 || !activeFile?.imageSrc) {
      return
    }

    const observer = new ResizeObserver(() => {
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
  }, [activeFile?.imageSrc, imageNaturalSize.height, imageNaturalSize.width])

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

              <div className="settings-section settings-placeholder">
                <h4>{text.settings.moreOptions}</h4>
                <p>{text.settings.moreOptionsHint}</p>
              </div>

              <div className="settings-footer">
                <a href={projectHomepage} target="_blank" rel="noreferrer">{text.settings.githubHomepage}</a>
                <span>v{appVersion}</span>
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
                <h2>{isDragging ? text.import.draggingTitle : text.import.idleTitle}</h2>
                <p>{text.import.description}</p>
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
                <button type="button" className="primary-button action-button" onClick={() => void handleImportLabelText()} disabled={isBusy}>
                  <span>{isBusy ? text.import.loading : text.import.importText}</span>
                  <small>{isDesktop ? text.import.importTextDesktopHint : text.import.importTextWebHint}</small>
                  <span className="file-picker-cta">{text.import.chooseTxt}</span>
                </button>

                <input
                  ref={labelFileInputRef}
                  className="hidden-file-input"
                  type="file"
                  accept=".txt,text/plain"
                  onChange={handleLabelFileChange}
                />

                {!isDesktop ? (
                  <label className="secondary-card action-button">
                    <span>{text.import.linkImages}</span>
                    <small>{text.import.linkImagesHint}</small>
                    <span className="file-picker-cta">{text.import.chooseImages}</span>
                    <input type="file" accept="image/*" multiple onChange={handleImageFilesChange} />
                  </label>
                ) : null}
              </div>
            </div>
          </div>
        </div>
      </section>

      <main className="workspace-layout">
        <aside className="panel file-panel">
          <div className="panel-header">
            <h3>{text.workspace.files}</h3>
            <p>{workspace?.source === 'desktop' ? text.workspace.desktopMode : text.workspace.webMode}</p>
          </div>

          <div className="file-list">
            {workspace?.files.length ? (
              workspace.files.map((file) => (
                <button
                  key={file.name}
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
                      {file.imageSrc ? (
                        <img src={file.imageSrc} alt={file.name} className="file-item-thumb-image" />
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
            <div className="chips">
              {workspace?.groups.length ? (
                workspace.groups.map((group, index) => (
                  <button
                    key={`${group}-${index}`}
                    type="button"
                    className={index + 1 === selectedCategory ? 'chip chip-selectable active' : 'chip chip-selectable'}
                    style={getCategoryChipStyle(index + 1)}
                    onClick={() => setSelectedCategory(index + 1)}
                  >
                    {index + 1}. {group}
                  </button>
                ))
              ) : (
                <span className="chip muted">{text.workspace.noGroups}</span>
              )}
            </div>

            <h4>{text.workspace.comment}</h4>
            <textarea
              className="comment-box comment-editor"
              value={workspace?.comment ?? ''}
              onChange={(event) => updateComment(event.target.value)}
              placeholder={text.workspace.commentPlaceholder}
            />
          </div>
        </aside>

        <section className="panel preview-panel">
          <div className="panel-header">
            <div>
              <h3>{text.preview.title}</h3>
              <p>{activeFile?.imageSrc ? text.preview.imageMatched : status}</p>
            </div>
            <div className="preview-toolbar">
              <button type="button" className="ghost-button preview-reset-button" onClick={fitPreview}>
                {text.preview.fit}
              </button>
              <button type="button" className="ghost-button preview-zoom-button" onClick={() => zoomPreview(-0.1)}>
                -
              </button>
              <span className="preview-zoom-value">{Math.round(previewZoom * 100)}%</span>
              <button type="button" className="ghost-button preview-zoom-button" onClick={() => zoomPreview(0.1)}>
                +
              </button>
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
              {activeFile.imageSrc ? (
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
                >
                  <div className="preview-pan-layer" style={{ transform: `translate(${previewPan.x}px, ${previewPan.y}px)` }}>
                    <div className="preview-scale-layer" style={{ transform: `scale(${previewZoom})` }}>
                    <img
                      ref={previewImageRef}
                      src={activeFile.imageSrc}
                      alt={activeFile.name}
                      className="preview-image"
                      onLoad={handlePreviewImageLoad}
                      onError={() => setStatus(text.status.imageLoadFailed(activeFile.name))}
                      style={{
                        width: imageNaturalSize.width > 0 ? `${imageNaturalSize.width}px` : undefined,
                        height: imageNaturalSize.height > 0 ? `${imageNaturalSize.height}px` : undefined,
                      }}
                    />
                    <div className="marker-layer">
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
                </div>
              ) : (
                <div className="empty-state">{text.preview.emptyWithDesktop}</div>
              )}
            </div>
          ) : (
            <div className="empty-state">{text.preview.emptyBeforeWorkspace}</div>
          )}
        </section>

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
                  >
                    <div className="label-item-top">
                      <span className="label-index">#{label.id}</span>
                      <span className="label-category" style={{ color: getCategoryColor(label.category) }}>{text.labels.group(label.category)}</span>
                    </div>
                    <p>{label.text || text.labels.emptyText}</p>
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
                        {(workspace?.groups.length ? workspace.groups : Array.from({ length: 9 }, (_, index) => text.labels.groupFallback(index + 1))).map((group, index) => (
                          <option key={`${group}-${index + 1}`} value={index + 1}>
                            {index + 1}. {group || text.labels.groupFallback(index + 1)}
                          </option>
                        ))}
                      </select>
                    </label>
                    <textarea
                      value={activeLabel.text}
                      onChange={(event) => updateActiveLabelText(event.target.value)}
                      placeholder={text.labels.textPlaceholder}
                    />
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
