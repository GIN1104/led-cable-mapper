const DB_NAME = 'led-cable-mapper'
const STORE = 'sketch-pdf'
const KEY = 'last'

interface StoredSketchPdf {
  name: string
  type: string
  bytes: ArrayBuffer
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB недоступен'))
      return
    }
    const request = indexedDB.open(DB_NAME, 1)
    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE)
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error('Не удалось открыть хранилище PDF'))
  })
}

/** Кладёт PDF эскиза в IndexedDB, чтобы он пережил перезагрузку */
export async function saveSketchPdf(file: File): Promise<void> {
  const bytes = await file.arrayBuffer()
  const db = await openDb()
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite')
    tx.objectStore(STORE).put(
      { name: file.name, type: file.type || 'application/pdf', bytes } satisfies StoredSketchPdf,
      KEY,
    )
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error ?? new Error('Не удалось сохранить PDF'))
  })
  db.close()
}

/** Последний PDF эскиза или null */
export async function loadSketchPdf(): Promise<File | null> {
  let db: IDBDatabase
  try {
    db = await openDb()
  } catch {
    return null
  }
  const stored = await new Promise<StoredSketchPdf | null>((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly')
    const request = tx.objectStore(STORE).get(KEY)
    request.onsuccess = () => resolve((request.result as StoredSketchPdf | undefined) ?? null)
    request.onerror = () => reject(request.error ?? new Error('Не удалось прочитать PDF'))
  }).catch(() => null)
  db.close()
  if (!stored?.bytes) return null
  return new File([stored.bytes], stored.name || 'sketch.pdf', {
    type: stored.type || 'application/pdf',
  })
}

/** Удаляет сохранённый PDF. Хард-ресет ждёт этот вызов до перезагрузки. */
export async function clearSketchPdf(): Promise<void> {
  let db: IDBDatabase
  try {
    db = await openDb()
  } catch {
    return
  }
  await new Promise<void>((resolve) => {
    const tx = db.transaction(STORE, 'readwrite')
    tx.objectStore(STORE).delete(KEY)
    tx.oncomplete = () => resolve()
    tx.onerror = () => resolve()
  })
  db.close()
}
