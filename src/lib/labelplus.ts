import type { LabelEntry, WorkspaceData, WorkspaceFile } from '../types'

const fileHeadPattern = /^>>>>>>>>\[(.+?)\]<<<<<<<<$/
const labelHeadPattern = /^----------------\[(\d+)\]----------------(?:\[(.+?)\])?$/
const imageNamePattern = /\.(avif|bmp|gif|jpe?g|png|webp)$/i

export function readTextFile(file: File): Promise<string> {
  return file.text()
}

export function parseLabelPlusText(text: string, labelPath?: string): WorkspaceData {
  const normalized = text.replace(/\r\n/g, '\n')
  const lines = normalized.split('\n')
  const startLines: string[] = []
  const files: WorkspaceFile[] = []
  let currentFile: WorkspaceFile | null = null
  let currentHeader: { id: number; x: number; y: number; category: number } | null = null
  let currentTextLines: string[] = []
  let startParsed = false

  function ensureStartParsed() {
    if (startParsed) {
      return
    }

    startParsed = true
  }

  function finalizeLabel() {
    if (!currentFile || !currentHeader) {
      return
    }

    const label: LabelEntry = {
      id: currentHeader.id,
      xPercent: currentHeader.x,
      yPercent: currentHeader.y,
      category: currentHeader.category,
      text: currentTextLines.join('\n').trim(),
    }

    currentFile.labels.push(label)
    currentHeader = null
    currentTextLines = []
  }

  function finalizeFile() {
    finalizeLabel()
    if (currentFile) {
      files.push(currentFile)
      currentFile = null
    }
  }

  for (const rawLine of lines) {
    const line = rawLine.trim()
    const fileMatch = line.match(fileHeadPattern)
    if (fileMatch) {
      ensureStartParsed()
      finalizeFile()
      currentFile = { name: fileMatch[1], labels: [] }
      continue
    }

    if (!startParsed) {
      startLines.push(line)
      continue
    }

    const labelMatch = line.match(labelHeadPattern)
    if (labelMatch) {
      finalizeLabel()
      const parts = (labelMatch[2] ?? '').split(',').map((part) => part.trim())
      const xPercent = Number(parts[0] ?? '0')
      const yPercent = Number(parts[1] ?? '0')
      const category = Number(parts[2] ?? '1') || 1
      currentHeader = {
        id: Number(labelMatch[1]),
        x: Number.isFinite(xPercent) ? xPercent : 0,
        y: Number.isFinite(yPercent) ? yPercent : 0,
        category,
      }
      currentTextLines = []
      continue
    }

    if (currentHeader) {
      currentTextLines.push(rawLine)
    }
  }

  finalizeFile()

  const startBlocks = parseStartBlocks(startLines)
  return {
    source: 'web',
    labelPath,
    groups: startBlocks.groups,
    comment: startBlocks.comment,
    files,
  }
}

export function attachBrowserImages(workspace: WorkspaceData, files: File[]): WorkspaceData {
  const imageMap = new Map<string, string>()

  for (const file of files) {
    if (!imageNamePattern.test(file.name)) {
      continue
    }

    imageMap.set(file.name, URL.createObjectURL(file))
  }

  return {
    ...workspace,
    files: workspace.files.map((file) => ({
      ...file,
      imageSrc: imageMap.get(file.name) ?? file.imageSrc,
    })),
  }
}

export function serializeLabelPlusText(workspace: WorkspaceData): string {
  const lines: string[] = ['1,0', '-', ...workspace.groups, '-', workspace.comment]

  for (const file of workspace.files) {
    lines.push('')
    lines.push(`>>>>>>>>[${file.name}]<<<<<<<<`)

    for (const label of file.labels) {
      lines.push(
        `----------------[${label.id}]----------------[${label.xPercent.toFixed(3)},${label.yPercent.toFixed(3)},${label.category}]`,
      )

      if (label.text) {
        lines.push(...label.text.split('\n'))
      }

      lines.push('')
    }
  }

  return `${lines.join('\r\n')}\r\n`
}

export function applyStoredLabelTexts(
  workspace: WorkspaceData,
  storedTexts: Record<string, string>,
): WorkspaceData {
  return {
    ...workspace,
    files: workspace.files.map((file) => ({
      ...file,
      labels: file.labels.map((label) => ({
        ...label,
        text: storedTexts[getLabelStorageId(file.name, label.id)] ?? label.text,
      })),
    })),
  }
}

export function buildStoredLabelTexts(workspace: WorkspaceData): Record<string, string> {
  const entries: Array<[string, string]> = []

  for (const file of workspace.files) {
    for (const label of file.labels) {
      entries.push([getLabelStorageId(file.name, label.id), label.text])
    }
  }

  return Object.fromEntries(entries)
}

export function getWorkspaceStorageKey(workspace: WorkspaceData): string {
  const identity = workspace.labelPath || workspace.files.map((file) => file.name).join('|')
  return `labelplusx-workspace:${identity}`
}

function getLabelStorageId(fileName: string, labelId: number): string {
  return `${fileName}::${labelId}`
}

function parseStartBlocks(lines: string[]) {
  const filtered = lines.map((line) => line.trimEnd())
  const separators: number[] = []

  filtered.forEach((line, index) => {
    if (line.trim() === '-') {
      separators.push(index)
    }
  })

  if (separators.length < 2) {
    return { groups: [], comment: '' }
  }

  const groupLines = filtered
    .slice(separators[0] + 1, separators[1])
    .map((line) => line.trim())
    .filter(Boolean)

  const comment = filtered.slice(separators[1] + 1).join('\n').trim()
  return { groups: groupLines, comment }
}
