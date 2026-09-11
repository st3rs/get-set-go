import './theme.css'

type Theme = 'light' | 'dark'

const STORAGE_KEY = 'get-set-go-theme'

function readSavedTheme(): Theme {
  try {
    const saved = localStorage.getItem(STORAGE_KEY)
    if (saved === 'light' || saved === 'dark') return saved
  } catch {
    // Storage may be unavailable in privacy-restricted contexts.
  }
  return 'dark'
}

function applyTheme(theme: Theme) {
  document.documentElement.dataset.theme = theme
  document.documentElement.style.colorScheme = theme

  const meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]')
  if (meta) meta.content = theme === 'dark' ? '#101214' : '#ffffff'

  const button = document.querySelector<HTMLButtonElement>('.themeToggle')
  if (button) {
    const nextTheme: Theme = theme === 'dark' ? 'light' : 'dark'
    button.dataset.currentTheme = theme
    button.setAttribute('aria-label', `Switch to ${nextTheme} mode`)
    button.setAttribute('title', `Switch to ${nextTheme} mode`)
    button.innerHTML = theme === 'dark'
      ? '<span class="themeToggleIcon" aria-hidden="true">☀</span><span class="themeToggleLabel">Light</span>'
      : '<span class="themeToggleIcon" aria-hidden="true">☾</span><span class="themeToggleLabel">Dark</span>'
  }
}

function saveTheme(theme: Theme) {
  try {
    localStorage.setItem(STORAGE_KEY, theme)
  } catch {
    // Keep the toggle functional even when persistence is blocked.
  }
}

function installToggle() {
  const nav = document.querySelector<HTMLElement>('.siteNav')
  if (!nav || nav.querySelector('.themeToggle')) return Boolean(nav)

  const button = document.createElement('button')
  button.type = 'button'
  button.className = 'themeToggle'
  button.addEventListener('click', () => {
    const current = document.documentElement.dataset.theme === 'light' ? 'light' : 'dark'
    const next: Theme = current === 'dark' ? 'light' : 'dark'
    saveTheme(next)
    applyTheme(next)
  })

  const cta = nav.querySelector('.navCta')
  if (cta) nav.insertBefore(button, cta)
  else nav.appendChild(button)

  applyTheme(document.documentElement.dataset.theme === 'light' ? 'light' : 'dark')
  return true
}

applyTheme(readSavedTheme())

if (!installToggle()) {
  const observer = new MutationObserver(() => {
    if (installToggle()) observer.disconnect()
  })
  observer.observe(document.documentElement, { childList: true, subtree: true })
}
