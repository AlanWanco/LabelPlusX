import { spawn } from 'node:child_process'

const devUrl = 'http://127.0.0.1:1420'

async function isServerReady() {
  try {
    const response = await fetch(devUrl)
    return response.ok
  } catch {
    return false
  }
}

if (await isServerReady()) {
  console.log(`[tauri-dev-server] Reusing existing Vite server at ${devUrl}`)
  process.exit(0)
}

console.log('[tauri-dev-server] Starting Vite dev server')

const child = spawn('npm', ['run', 'dev'], {
  stdio: 'inherit',
  shell: process.platform === 'win32',
})

child.on('exit', (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal)
    return
  }

  process.exit(code ?? 0)
})
