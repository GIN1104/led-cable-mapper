import { toPng } from 'html-to-image'

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

/** Рендер узла панели (SVG-сетка) в PNG data URL */
export async function capturePanelPng(element: HTMLElement): Promise<string> {
  return toPng(element, {
    backgroundColor: '#ffffff',
    pixelRatio: 2,
    cacheBust: true,
  })
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

/** Открыть окно печати только с изображением схемы */
export async function printPanelPng(
  dataUrl: string,
  title: string,
  filename: string,
): Promise<void> {
  const printWindow = window.open('', '_blank')
  if (!printWindow) {
    downloadDataUrl(dataUrl, filename)
    return
  }

  printWindow.document.write(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>${escapeHtml(title)}</title>
  <style>
    @page { margin: 8mm; }
    html, body {
      margin: 0;
      padding: 0;
      background: #fff;
      height: 100%;
    }
    body {
      display: flex;
      align-items: center;
      justify-content: center;
    }
    img {
      max-width: 100%;
      max-height: 100vh;
      object-fit: contain;
    }
  </style>
</head>
<body>
  <img src="${dataUrl}" alt="${escapeHtml(title)}" />
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
