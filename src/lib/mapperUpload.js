/** Официальный bridge от Apps Script / бота. PNG остаются в памяти браузера. */

export function getTripUploadContext() {
  const q = new URLSearchParams(location.search)
  return {
    trip_id: q.get('trip_id'),
    upload_token: q.get('upload_token'),
    upload_url: q.get('upload_url'),
    return_trip_url: q.get('return_trip_url'),
    title: q.get('title') || '',
  }
}

const asBase64 = (blob) =>
  new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result).split(',')[1])
    reader.onerror = reject
    reader.readAsDataURL(blob)
  })

export async function sendSchemesToTrip(images) {
  const c = getTripUploadContext()
  if (!c.trip_id || !c.upload_token || !/^https:\/\//.test(c.upload_url || '')) {
    throw new Error('Открой mapper по ссылке из бота.')
  }
  if (!images.length || images.length > 5) {
    throw new Error('Можно отправить 1–5 PNG за один раз.')
  }
  if (
    images.some((x) => x.blob.type !== 'image/png' || x.blob.size > 5 * 1024 * 1024) ||
    images.reduce((n, x) => n + x.blob.size, 0) > 10 * 1024 * 1024
  ) {
    throw new Error('PNG до 5 МБ, сумма до 10 МБ.')
  }
  const files = await Promise.all(
    images.map(async ({ name, blob }) => ({
      name,
      mimeType: 'image/png',
      base64: await asBase64(blob),
    })),
  )
  const payload = {
    action: 'uploadSchemeImages',
    trip_id: c.trip_id,
    upload_token: c.upload_token,
    files,
    meta: { source: 'led-cable-mapper', title: c.title },
  }
  let result
  if (/^https:\/\/script\.google\.com\/macros\/s\/[\w-]+\/exec$/.test(c.upload_url)) {
    result = await postSchemeForm(c.upload_url, payload)
  } else {
    // Совместимость со старыми ссылками до direct-GAS.
    const response = await fetch(c.upload_url, {
      method: 'POST',
      credentials: 'omit',
      referrerPolicy: 'no-referrer',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
    result = await response.json()
  }
  if (!result.ok) {
    throw new Error(
      (result.error || 'upload_failed') + (result.detail ? ': ' + result.detail : ''),
    )
  }
  return result
}

/** exportPngs returns [{name, blob}]; reuse mapper's existing PNG renderer. */
export function mountTripUploadButton(container, exportPngs) {
  if (!getTripUploadContext().trip_id) return
  const button = document.createElement('button')
  const status = document.createElement('span')
  button.type = 'button'
  button.textContent = 'Отправить схемы в выезд'
  button.onclick = async () => {
    button.disabled = true
    status.textContent = ' Отправляю…'
    try {
      const r = await sendSchemesToTrip(await exportPngs())
      status.textContent = ' Сохранено PNG: ' + r.uploaded
    } catch (error) {
      status.textContent = ' ' + error.message
    } finally {
      button.disabled = false
    }
  }
  container.append(button, status)
}

/** Optional adapter when exported schematics already exist as <canvas>. */
export async function canvasPngs(canvases) {
  return Promise.all(
    Array.from(canvases).map(async (canvas, i) => ({
      name: 'schema-screen' + (i + 1) + '.png',
      blob: await new Promise((resolve, reject) =>
        canvas.toBlob(
          (blob) => (blob ? resolve(blob) : reject(new Error('PNG export failed'))),
          'image/png',
        ),
      ),
    })),
  )
}

/**
 * Без fetch/OPTIONS: form POST в iframe, ответ через postMessage.
 * Контракт GAS: scheme_nonce + scheme_payload; внутри payload — transportNonce и clientOrigin.
 * Ответ: { channel:'crew-scheme-response', nonce:<тот же>, result:{ok,...} }
 */
export function postSchemeForm(url, payload) {
  return new Promise((resolve, reject) => {
    const nonce = Array.from(crypto.getRandomValues(new Uint8Array(32)), (b) =>
      b.toString(16).padStart(2, '0'),
    ).join('')
    const iframe = document.createElement('iframe')
    const form = document.createElement('form')
    iframe.name = 'scheme_' + nonce
    iframe.hidden = true
    form.method = 'POST'
    form.action = url
    form.target = iframe.name
    form.hidden = true
    form.acceptCharset = 'UTF-8'
    for (const [name, value] of Object.entries({
      scheme_nonce: nonce,
      scheme_payload: JSON.stringify({
        ...payload,
        transportNonce: nonce,
        clientOrigin: location.origin,
      }),
    })) {
      const input = document.createElement('input')
      input.type = 'hidden'
      input.name = name
      input.value = value
      form.append(input)
    }
    let timer
    const cleanup = () => {
      clearTimeout(timer)
      window.removeEventListener('message', onMessage)
      form.remove()
      iframe.remove()
    }
    const onMessage = (event) => {
      if (!/^https:\/\/(?:[a-z0-9-]+\.)*googleusercontent\.com$/.test(event.origin)) {
        return
      }
      const packet = event.data
      if (
        !packet ||
        packet.channel !== 'crew-scheme-response' ||
        packet.nonce !== nonce
      ) {
        return
      }
      cleanup()
      resolve(packet.result)
    }
    window.addEventListener('message', onMessage)
    timer = setTimeout(() => {
      cleanup()
      reject(
        new Error(
          'Нет ответа. Проверь карточку выезда перед повторной отправкой.',
        ),
      )
    }, 120000)
    try {
      document.body.append(iframe, form)
      form.submit()
    } catch (error) {
      cleanup()
      reject(error)
    }
  })
}
