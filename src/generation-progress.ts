import './generation-progress.css'

const MAX_WAIT_MS = 6 * 60 * 1000
const nativeFetch = window.fetch.bind(window)

window.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
  const target = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
  const isReconstruction = target.includes('/api/analyze')
  if (!isReconstruction || init?.signal) return nativeFetch(input, init)

  const controller = new AbortController()
  const timeout = window.setTimeout(() => controller.abort(), MAX_WAIT_MS)

  return nativeFetch(input, { ...init, signal: controller.signal })
    .catch((error) => {
      if (controller.signal.aborted) {
        throw new Error('Reconstruction exceeded 6 minutes. The generation service may be stalled; please retry the run.')
      }
      throw error
    })
    .finally(() => window.clearTimeout(timeout))
}) as typeof window.fetch

const stages = [
  [0, 'Reading the reference'],
  [12, 'Measuring responsive layout'],
  [28, 'Planning the interface'],
  [48, 'Preparing media and components'],
  [78, 'Building the interface'],
  [112, 'Rendering the preview'],
  [138, 'Comparing visible differences'],
  [170, 'Refining the result'],
] as const

function formatElapsed(seconds: number) {
  const min = Math.floor(seconds / 60)
  const sec = seconds % 60
  return `${String(min).padStart(2, '0')}:${String(sec).padStart(2, '0')}`
}

function stageFor(seconds: number) {
  let current = stages[0][1]
  for (const [threshold, label] of stages) {
    if (seconds >= threshold) current = label
  }
  return current
}

function installProgress() {
  const form = document.querySelector<HTMLFormElement>('#reconstruct')
  if (!form || form.querySelector('.generationProgress')) return Boolean(form)

  const panel = document.createElement('div')
  panel.className = 'generationProgress'
  panel.setAttribute('role', 'status')
  panel.setAttribute('aria-live', 'polite')
  panel.innerHTML = `
    <div class="generationProgressTop">
      <span class="generationProgressStage">Reading the reference</span>
      <span class="generationProgressTime">00:00</span>
    </div>
    <div class="generationProgressTrack" aria-hidden="true"></div>
    <div class="generationProgressNote">Image-heavy references can take a few minutes while the result is generated and visually checked.</div>
  `
  form.appendChild(panel)

  let timer: number | null = null
  let startedAt = 0

  const stop = () => {
    if (timer !== null) window.clearInterval(timer)
    timer = null
    panel.classList.remove('visible')
  }

  const start = () => {
    stop()
    startedAt = Date.now()
    panel.classList.add('visible')
    const stage = panel.querySelector<HTMLElement>('.generationProgressStage')!
    const time = panel.querySelector<HTMLElement>('.generationProgressTime')!
    stage.textContent = stages[0][1]
    time.textContent = '00:00'

    timer = window.setInterval(() => {
      const seconds = Math.floor((Date.now() - startedAt) / 1000)
      stage.textContent = stageFor(seconds)
      time.textContent = formatElapsed(seconds)

      const button = form.querySelector<HTMLButtonElement>('.reconstructButton')
      if (seconds > 1 && button && !button.disabled) stop()
    }, 500)
  }

  form.addEventListener('submit', () => window.setTimeout(start, 40))
  return true
}

if (!installProgress()) {
  const observer = new MutationObserver(() => {
    if (installProgress()) observer.disconnect()
  })
  observer.observe(document.documentElement, { childList: true, subtree: true })
}
