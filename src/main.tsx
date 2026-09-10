import React, { useState } from 'react'
import { createRoot } from 'react-dom/client'
import './styles.css'

type Analysis = {
  target?: string
  generatedAt?: string
  policy?: Record<string, unknown>
  breakpoints?: Record<string, any>
  designIR?: any
  error?: string
  action?: string
}

function App() {
  const [url, setUrl] = useState('')
  const [status, setStatus] = useState('Ready for a reference')
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<Analysis | null>(null)

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
      const response = await fetch('/api/analyze', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ url }),
      })

      const contentType = response.headers.get('content-type') || ''
      const text = await response.text()

      if (!contentType.includes('application/json')) {
        throw new Error(`API route returned ${contentType || 'non-JSON'} (HTTP ${response.status}).`)
      }

      let data: Analysis
      try {
        data = JSON.parse(text) as Analysis
      } catch {
        throw new Error(`API returned invalid JSON (HTTP ${response.status}).`)
      }

      if (!response.ok) throw new Error(data.action ? `${data.error} ${data.action}` : data.error || `HTTP ${response.status}`)
      setResult(data)
      setStatus(data.designIR ? 'Design IR ready' : 'Analysis complete')
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Analysis failed')
    } finally {
      setBusy(false)
    }
  }

  const desktop = result?.breakpoints?.desktop
  const ir = result?.designIR

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
        <div className="subline"><span>Desktop · Tablet · Mobile</span><span>Vision off by default</span><span>0 AI calls for Design IR</span></div>
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

          {ir && (
            <div className="irpanel">
              <div className="irhead">
                <div><p className="label">DETERMINISTIC DESIGN IR</p><h3>{ir.siteType} · {ir.layout?.density} density</h3></div>
                <span className="pill">v{ir.version}</span>
              </div>
              <div className="irmetrics">
                <div><span>Regions</span><strong>{ir.layout?.regionCount ?? '—'}</strong></div>
                <div><span>Content ratio</span><strong>{ir.layout?.maxContentRatio ?? '—'}</strong></div>
                <div><span>Mobile reflow</span><strong>{ir.responsive?.likelyResponsiveReflow ? 'Detected' : 'Minimal'}</strong></div>
                <div><span>AI calls</span><strong>0</strong></div>
              </div>
              <div className="tokenrow">
                {(ir.tokens?.fontSizes || []).slice(0, 7).map((token: string) => <code key={token}>{token}</code>)}
              </div>
              <div className="componentrow">
                {(ir.components || []).map((component: string) => <span className="component" key={component}>{component}</span>)}
              </div>
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
          <p>{ir ? 'Framework-neutral design structure is ready for component planning and code generation.' : 'Framework-neutral layout, tokens, components and responsive behavior.'}</p>
          <code>{ir ? `${ir.siteType} · ${ir.layout?.regionCount ?? 0} regions` : 'design-ir.json'}</code>
        </article>
      </section>
    </main>
  )
}

createRoot(document.getElementById('root')!).render(<React.StrictMode><App /></React.StrictMode>)
