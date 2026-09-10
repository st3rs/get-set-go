import React, { useState } from 'react'
import { createRoot } from 'react-dom/client'
import './styles.css'

type Analysis = {
  target?: string
  generatedAt?: string
  policy?: {
    qualityRequested?: boolean
    qualityMode?: string
    aiConfigured?: boolean
    aiCalls?: number
    model?: string
  }
  breakpoints?: Record<string, any>
  designIR?: any
  componentPlan?: any
  generatedPreview?: { html?: string; mode?: string; aiCalls?: number; note?: string }
  generatedFiles?: { appTsx?: string; stylesCss?: string } | null
  visualSpec?: any
  qualityNotes?: string[]
  qualityError?: string | null
  error?: string
  action?: string
}

function App() {
  const [url, setUrl] = useState('https://linear.app')
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
    setStatus('Reconstructing the interface…')

    try {
      const response = await fetch('/api/analyze', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ url, quality: true }),
      })

      const contentType = response.headers.get('content-type') || ''
      const text = await response.text()
      if (!contentType.includes('application/json')) throw new Error(`API route returned ${contentType || 'non-JSON'} (HTTP ${response.status}).`)

      let data: Analysis
      try {
        data = JSON.parse(text) as Analysis
      } catch {
        throw new Error(`API returned invalid JSON (HTTP ${response.status}).`)
      }

      if (!response.ok) throw new Error(data.action ? `${data.error} ${data.action}` : data.error || `HTTP ${response.status}`)
      setResult(data)

      if (data.policy?.qualityMode === 'ai-quality-first') {
        setStatus('High-fidelity reconstruction ready')
      } else if (!data.policy?.aiConfigured) {
        setStatus('Browser reconstruction ready · AI quality pass needs one API secret')
      } else if (data.qualityError) {
        setStatus('Fallback reconstruction ready · AI quality pass failed')
      } else {
        setStatus('Reconstruction ready')
      }
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Analysis failed')
    } finally {
      setBusy(false)
    }
  }

  const desktop = result?.breakpoints?.desktop
  const ir = result?.designIR
  const plan = result?.componentPlan
  const preview = result?.generatedPreview
  const quality = result?.policy

  return (
    <main className="shell">
      <nav className="nav">
        <div className="brand"><span className="mark">G</span><span>Get Set Go</span></div>
        <div className="navmeta"><span className="pill">Visual Architect</span><span className="qualityBadge">QUALITY FIRST</span></div>
      </nav>

      <section className="hero">
        <p className="eyebrow">URL → BROWSER EVIDENCE → VISUAL REASONING → CODE</p>
        <h1>Rebuild the interface, not just the DOM.</h1>
        <p className="lede">Visual reconstruction from rendered evidence, responsive geometry and design reasoning. Browser work stays deterministic; AI is spent where it improves the result.</p>
        <form onSubmit={submit} className="urlbox">
          <input type="url" value={url} onChange={(e) => setUrl(e.target.value)} disabled={busy} />
          <button type="submit" disabled={busy}>{busy ? 'Reconstructing…' : 'Reconstruct'}</button>
        </form>
        <div className="subline"><span>Desktop · Tablet · Mobile</span><span>Visual reasoning</span><span>Production code</span><span>Rate-limit backoff</span></div>
      </section>

      <section className="grid">
        <article className="card wide">
          <p className="label">CURRENT RUN</p>
          <h2>{status}</h2>
          <div className="steps">
            {['Browser capture','Design signals','Design IR','Visual architect','Generate UI'].map((x, i) => <div className="step" key={x}><span>0{i + 1}</span><b>{x}</b></div>)}
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
                <div><p className="label">DESIGN INTELLIGENCE</p><h3>{ir.siteType} · {ir.layout?.density} density</h3></div>
                <span className="pill">IR v{ir.version}</span>
              </div>
              <div className="irmetrics">
                <div><span>Regions</span><strong>{ir.layout?.regionCount ?? '—'}</strong></div>
                <div><span>Content ratio</span><strong>{ir.layout?.maxContentRatio ?? '—'}</strong></div>
                <div><span>Mobile reflow</span><strong>{ir.responsive?.likelyResponsiveReflow ? 'Detected' : 'Minimal'}</strong></div>
                <div><span>AI pass</span><strong>{quality?.qualityMode === 'ai-quality-first' ? `${quality.aiCalls} calls` : 'Fallback'}</strong></div>
              </div>
              <div className="componentrow">
                {(plan?.components || []).map((item: any) => <span className="component" key={item.id}>{item.component}</span>)}
              </div>
            </div>
          )}
        </article>

        <article className="card">
          <p className="label">QUALITY ENGINE</p>
          <h3>{quality?.qualityMode === 'ai-quality-first' ? 'AI Visual Director active' : 'Deterministic fallback'}</h3>
          <p>{quality?.qualityMode === 'ai-quality-first' ? `Model: ${quality.model}. Screenshots and measured design evidence are used together.` : 'Browser evidence and Design IR still run normally. Add the server-side OpenAI secret to enable the high-fidelity pass.'}</p>
          {result?.qualityError && <code className="errorCode">{result.qualityError.slice(0, 260)}</code>}
        </article>

        <article className="card">
          <p className="label">OUTPUT</p>
          <h3>{result?.generatedFiles ? 'React source generated' : 'Preview generated'}</h3>
          <p>{preview?.note || 'The reconstructed output appears below in a sandboxed preview.'}</p>
          <code>{preview?.mode || 'waiting'}</code>
        </article>
      </section>

      {preview?.html && (
        <section className="previewSection">
          <div className="previewHeader">
            <div><p className="label">GENERATED RESULT</p><h2>Live reconstruction preview</h2></div>
            <div className="previewMeta"><span>{quality?.model || 'deterministic'}</span><span>{quality?.aiCalls || 0} AI calls</span></div>
          </div>
          <div className="browserFrame">
            <div className="browserBar"><i></i><i></i><i></i><span>{result?.target}</span></div>
            <iframe title="Generated reconstruction" sandbox="" srcDoc={preview.html} />
          </div>
          {result?.qualityNotes && result.qualityNotes.length > 0 && (
            <div className="qualityNotes">{result.qualityNotes.slice(0, 5).map((note) => <span key={note}>{note}</span>)}</div>
          )}
        </section>
      )}

      {result?.generatedFiles && (
        <section className="sourceSection">
          <details>
            <summary>Generated React source</summary>
            <h3>App.tsx</h3>
            <pre>{result.generatedFiles.appTsx}</pre>
            <h3>styles.css</h3>
            <pre>{result.generatedFiles.stylesCss}</pre>
          </details>
        </section>
      )}
    </main>
  )
}

createRoot(document.getElementById('root')!).render(<React.StrictMode><App /></React.StrictMode>)
