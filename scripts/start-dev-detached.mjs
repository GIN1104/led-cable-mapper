/**
 * Запуск Vite отдельным процессом — не падает при закрытии терминала.
 * Используется хуком workspaceOpen и командой npm run dev:bg.
 */
import { execSync, spawn } from 'node:child_process'
import { createConnection } from 'node:net'
import { mkdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { platform } from 'node:os'

const DEV_PORT = 5173
const projectRoot = join(dirname(fileURLToPath(import.meta.url)), '..')
const quiet = process.argv.includes('--quiet')

if (process.argv.includes('--hook')) {
  try {
    readFileSync(0, 'utf8')
  } catch {
    // stdin может быть пустым
  }
}

export function isDevServerRunning(port = DEV_PORT) {
  return new Promise((resolve) => {
    const socket = createConnection({ port, host: '127.0.0.1' })
    const done = (value) => {
      socket.removeAllListeners()
      socket.destroy()
      resolve(value)
    }
    socket.setTimeout(800, () => done(false))
    socket.once('connect', () => done(true))
    socket.once('error', () => done(false))
  })
}

/** Отдельный процесс: на Windows через Start-Process, иначе detached spawn. */
export function startDetachedDevServer(cwd = projectRoot) {
  if (platform() === 'win32') {
    const logDir = join(cwd, '.cursor', 'hooks')
    mkdirSync(logDir, { recursive: true })
    const logFile = join(logDir, 'dev-server.log')
    const errFile = join(logDir, 'dev-server.err.log')
    const wd = cwd.replace(/'/g, "''")
    const out = logFile.replace(/'/g, "''")
    const err = errFile.replace(/'/g, "''")

    // execSync — дожидаемся Start-Process, иначе PowerShell может умереть раньше дочернего npm.
    const ps = [
      "Start-Process",
      "-FilePath 'npm.cmd'",
      "-ArgumentList 'run','dev'",
      `-WorkingDirectory '${wd}'`,
      '-WindowStyle Hidden',
      `-RedirectStandardOutput '${out}'`,
      `-RedirectStandardError '${err}'`,
    ].join(' ')

    execSync(`powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "${ps}"`, {
      stdio: 'ignore',
      windowsHide: true,
    })
    return
  }

  const child = spawn('npm', ['run', 'dev'], {
    cwd,
    detached: true,
    stdio: 'ignore',
    windowsHide: true,
  })
  child.unref()
}

const running = await isDevServerRunning()

if (!running) {
  startDetachedDevServer()
}

if (quiet || process.argv.includes('--hook')) {
  console.log(JSON.stringify({}))
} else if (running) {
  console.log(`Dev server already running on http://localhost:${DEV_PORT}/`)
} else {
  console.log(`Dev server starting on http://localhost:${DEV_PORT}/`)
  console.log('Процесс отделён от терминала — закрытие окна его не остановит.')
  console.log(`Логи: ${join(projectRoot, '.cursor', 'hooks', 'dev-server.log')}`)
}
