import React, { useMemo, useState } from 'react'
import { createRoot } from 'react-dom/client'
import './styles.css'

type Analysis = {
  target?: string
  generatedAt?: string
  policy?: Record<string, unknown>
  breakpoints?: Record<string, any>
  error?: string
}

const DEFAULT_API_BASE = 'https://get-set-go-api.pdflow6223.workers.dev'

function App() {
  const [url, setUrl] = useState('')
  const [status, setStatus] = useState('Ready for a reference')
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<Analysis | null>(null)

  const apiBase = useMemo(() => {
    const env = (import.meta as any).env || {}
    return String(env.VITE_API_BASE_URL || DEFAULT_API_BASE).replace(/\/$/, '')
  }, [])

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setResult(null)

    try {
      new URL(url)
    } catch {
      setStatus('Enter a valid public URL.')
      return
    }

    setBusy(true)
    setStatus('Cloud browser is analyzing the reference…')

    try {
      const response = await fetch(`${apiBase}/analyze`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ url }),
      })
      const data = await response.json() as Analysis
      if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`)
      setResult(data)
      setStatus('Analysis complete')
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Analysis failed')
    } finally {
      setBusy(false)
    }
  }

  const desktop = result?.breakpoints?.desktop

  return (
    <main className="shell">
      <nav className="nav">
        <div className="brand"><span className="mark">G</span><span>Get Set Go</span></div>
        <span className="pill">Visual Architect</span>
      </nav>

      <section className="hero">
        <p className="eyebrow">REFERENCE → DESIGN INTELLIGENCE → CODE</p>
        <h1>Build from the web without making the model eat the web.</h1>
        <p className="lede">Browser-first interface reconstruction from URLs, screenshots and intent. Capture structure in the browser layer, then use AI only where judgement matters.</p>
        <form onSubmit={submit} className="urlbox">
          <input type="url" placeholder="https://linear.app" value={url} onChange={(e) => setUrl(e.target.value)} disabled={busy} />
          <button type="submit" disabled={busy}>{busy ? 'Analyzing…' : 'Analyze'}</button>
        </form>
        <div className="subline"><span>Desktop · Tablet · Mobile</span><span>Vision off by default</span><span>Token-aware</span></div>
      </section>

      <section className="grid">
        <article className="card wide">
          <p className="label">CURRENT RUN</p>
          <h2>{status}</h2>
          <div className="steps">
            {['Browser capture','DOM + geometry','Design signals','Design IR','Generate UI'].map((x, i) => <div className="step" key={x}><span>0{i + 1}</span><b>{x}</b></div>)}
          </div>
          {desktop && (
            <div className="result">
              <div><span>Title</span><strong>{desktop.title || 'Untitled'}</strong></div>
              <div><span>Visible elements</span><strong>{desktop.visibleElementCount ?? '—'}</strong></div>
              <div><span>Page size</span><strong>{desktop.page ? `${desktop.page.width} × ${desktop.page.height}` : '—'}</strong></div>
              <div><span>Primary font</span><strong>{desktop.tokens?.fonts?.[0]?.value || '—'}</strong></div>
            </div>
          )}
        </article>
        <article className="card">
          <p className="label">BROWSER LAYER</p>
          <h3>Cloudflare Browser Run</h3>
          <p>Capture geometry and compact design signals before any model call.</p>
        </article>
        <article className="card">
          <p className="label">OUTPUT</p>
          <h3>Design IR</h3>
          <p>Framework-neutral layout, tokens, components and responsive behavior.</p>
          <code>{result ? 'browser evidence ready' : 'design-ir.json'}</code>
        </article>
      </section>
    </main>
  )
}

createRoot(document.getElementById('root')!).render(<React.StrictMode><App /></React.StrictMode>)
