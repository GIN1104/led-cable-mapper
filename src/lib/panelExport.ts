import { toPng } from 'html-to-image'

/** Краткая сводка экрана для Print screen (блок сверху слева) */
export interface PanelPrintInfo {
  screenName: string
  wallWidthM: number
  wallHeightM: number
  cabinetsWide: number
  cabinetsHigh: number
  pitchLabel: string
  controllerModel: string
  /** Data Ports / Тикшорет или Power Lines / Электричество */
  panelType: string
  refreshRate?: number
  lineDirection?: string
  /** Локализованная дата; если не задана — подставляется при форматировании */
  date?: string
}

/** Безопасный фрагмент имени экрана для файла */
export function sanitizeScreenSlug(name: string): string {
  const slug = name
    .trim()
    .replace(/[<>:"/\\|?*]+/g, '-')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 80)
  return slug || 'screen'
}

export function panelExportFilename(
  mode: 'data' | 'power',
  screenName: string,
): string {
  const slug = sanitizeScreenSlug(screenName)
  return mode === 'data'
    ? `data-ports-${slug}.png`
    : `power-lines-${slug}.png`
}

export function panelWhatsAppCaption(mode: 'data' | 'power'): string {
  return mode === 'data'
    ? 'LED scheme Data Ports / Схема Data / תכנית תקשורת — see attached / см. вложение / ראה מצורף'
    : 'LED scheme Power Lines / Схема Power / תכנית חשמל — see attached / см. вложение / ראה מצורף'
}

/** Строки инфо-блока для печати / PNG (верхний левый угол) */
export function formatPanelPrintInfoLines(info: PanelPrintInfo): string[] {
  const date = info.date ?? new Date().toLocaleDateString()
  const lines: string[] = [
    info.screenName,
    `Wall ${info.wallWidthM} × ${info.wallHeightM} m (${info.cabinetsWide}×${info.cabinetsHigh})`,
    `Pitch: ${info.pitchLabel} · ${info.controllerModel}`,
    info.panelType,
  ]

  const extras: string[] = []
  if (info.refreshRate != null) extras.push(`${info.refreshRate} Hz`)
  if (info.lineDirection) extras.push(info.lineDirection.toUpperCase())
  if (extras.length > 0) lines.push(extras.join(' · '))
  lines.push(date)

  return lines
}

/** Рендер узла панели (SVG-сетка) в PNG data URL */
export async function capturePanelPng(element: HTMLElement): Promise<string> {
  return toPng(element, {
    backgroundColor: '#ffffff',
    pixelRatio: 2,
    cacheBust: true,
  })
}

/**
 * Накладывает инфо-блок сверху слева на PNG сетки
 * (для скачивания, если окно печати заблокировано).
 */
export async function composePngWithPrintInfo(
  gridDataUrl: string,
  info: PanelPrintInfo,
): Promise<string> {
  const lines = formatPanelPrintInfoLines(info)
  const img = await loadImage(gridDataUrl)
  const padX = 28
  const padY = 22
  const lineHeight = 26
  const headerH = padY * 2 + lines.length * lineHeight
  const canvas = document.createElement('canvas')
  canvas.width = img.width
  canvas.height = img.height + headerH
  const ctx = canvas.getContext('2d')
  if (!ctx) return gridDataUrl

  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, canvas.width, canvas.height)

  ctx.fillStyle = '#0f172a'
  ctx.font = '600 20px system-ui, Segoe UI, sans-serif'
  ctx.textBaseline = 'top'
  lines.forEach((line, i) => {
    const size = i === 0 ? 22 : 18
    const weight = i === 0 ? 700 : 500
    ctx.font = `${weight} ${size}px system-ui, Segoe UI, sans-serif`
    ctx.fillStyle = i === 0 ? '#0f172a' : '#334155'
    ctx.fillText(line, padX, padY + i * lineHeight, canvas.width - padX * 2)
  })

  ctx.drawImage(img, 0, headerH)
  return canvas.toDataURL('image/png')
}

export function downloadDataUrl(dataUrl: string, filename: string): void {
  const anchor = document.createElement('a')
  anchor.href = dataUrl
  anchor.download = filename
  anchor.rel = 'noopener'
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
}

function dataUrlToFile(dataUrl: string, filename: string): File {
  const [header, base64] = dataUrl.split(',')
  const mimeMatch = /data:([^;]+)/.exec(header ?? '')
  const mime = mimeMatch?.[1] ?? 'image/png'
  const binary = atob(base64 ?? '')
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return new File([bytes], filename, { type: mime })
}

function loadImage(dataUrl: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('Не удалось загрузить PNG схемы'))
    img.src = dataUrl
  })
}

/** Открыть окно печати: инфо сверху слева + схема ниже / на всю ширину */
export async function printPanelPng(
  dataUrl: string,
  title: string,
  filename: string,
  info?: PanelPrintInfo,
): Promise<void> {
  const infoLines = info ? formatPanelPrintInfoLines(info) : []

  const printWindow = window.open('', '_blank')
  if (!printWindow) {
    const fallback =
      info && infoLines.length > 0
        ? await composePngWithPrintInfo(dataUrl, info)
        : dataUrl
    downloadDataUrl(fallback, filename)
    return
  }

  const infoHtml =
    infoLines.length > 0
      ? `<header class="info">${infoLines
          .map((line, i) =>
            i === 0
              ? `<div class="info-title">${escapeHtml(line)}</div>`
              : `<div>${escapeHtml(line)}</div>`,
          )
          .join('')}</header>`
      : ''

  printWindow.document.write(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>${escapeHtml(title)}</title>
  <style>
    @page { margin: 8mm; }
    * { box-sizing: border-box; }
    html, body {
      margin: 0;
      padding: 0;
      background: #fff;
      color: #0f172a;
      font-family: system-ui, "Segoe UI", sans-serif;
    }
    .page {
      display: flex;
      flex-direction: column;
      align-items: stretch;
      min-height: 100vh;
      padding: 6mm;
      gap: 4mm;
    }
    .info {
      align-self: flex-start;
      max-width: 100%;
      font-size: 11pt;
      line-height: 1.35;
      color: #334155;
    }
    .info-title {
      font-size: 13pt;
      font-weight: 700;
      color: #0f172a;
      margin-bottom: 2pt;
    }
    .diagram {
      flex: 1 1 auto;
      display: flex;
      align-items: flex-start;
      justify-content: stretch;
      min-height: 0;
    }
    .diagram img {
      width: 100%;
      max-height: calc(100vh - 28mm);
      object-fit: contain;
      object-position: top left;
    }
  </style>
</head>
<body>
  <div class="page">
    ${infoHtml}
    <div class="diagram">
      <img src="${dataUrl}" alt="${escapeHtml(title)}" />
    </div>
  </div>
</body>
</html>`)
  printWindow.document.close()

  await new Promise<void>((resolve) => {
    const img = printWindow.document.querySelector('img')
    if (!img) {
      resolve()
      return
    }
    if (img.complete) {
      resolve()
      return
    }
    img.onload = () => resolve()
    img.onerror = () => resolve()
  })

  try {
    printWindow.focus()
    printWindow.print()
  } finally {
    // Не закрываем сразу — на мобильных диалог печати асинхронный
    printWindow.setTimeout?.(() => {
      try {
        printWindow.close()
      } catch {
        /* ignore */
      }
    }, 500)
  }
}

/** Шаринг PNG через Web Share API или скачивание + WhatsApp Web/app */
export async function sharePanelViaWhatsApp(options: {
  dataUrl: string
  filename: string
  mode: 'data' | 'power'
}): Promise<void> {
  const { dataUrl, filename, mode } = options
  const text = panelWhatsAppCaption(mode)
  const file = dataUrlToFile(dataUrl, filename)
  const shareData: ShareData = {
    files: [file],
    title: mode === 'data' ? 'LED Data Ports' : 'LED Power Lines',
    text,
  }

  if (
    typeof navigator !== 'undefined' &&
    typeof navigator.share === 'function' &&
    (!navigator.canShare || navigator.canShare(shareData))
  ) {
    try {
      await navigator.share(shareData)
      return
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return
      // Fallback ниже
    }
  }

  downloadDataUrl(dataUrl, filename)
  const waUrl = `https://wa.me/?text=${encodeURIComponent(text)}`
  window.open(waUrl, '_blank', 'noopener,noreferrer')
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}
