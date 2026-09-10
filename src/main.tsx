import React, { useState } from 'react'
import { createRoot } from 'react-dom/client'
import './styles.css'

function App() {
  const [url, setUrl] = useState('')
  const [status, setStatus] = useState('Ready for a reference')

  function submit(e: React.FormEvent) {
    e.preventDefault()
    try {
      new URL(url)
      setStatus('Frontend ready. Cloud browser worker connects next.')
    } catch {
      setStatus('Enter a valid public URL.')
    }
  }

  return (
    <main className="shell">
      <nav className="nav">
        <div className="brand"><span className="mark">G</span><span>Get Set Go</span></div>
        <span className="pill">Visual Architect</span>
      </nav>

      <section className="hero">
        <p className="eyebrow">REFERENCE → DESIGN INTELLIGENCE → CODE</p>
        <h1>Build from the web without making the model eat the web.</h1>
        <p className="lede">Browser-first interface reconstruction from URLs, screenshots and intent. Capture structure locally, then use AI only where judgement matters.</p>
        <form onSubmit={submit} className="urlbox">
          <input type="url" placeholder="https://linear.app" value={url} onChange={(e) => setUrl(e.target.value)} />
          <button type="submit">Analyze</button>
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
        </article>
        <article className="card">
          <p className="label">BROWSER LAYER</p>
          <h3>Cloudflare Browser Run</h3>
          <p>Capture screenshots, geometry and shallow structure before any model call.</p>
        </article>
        <article className="card">
          <p className="label">OUTPUT</p>
          <h3>Design IR</h3>
          <p>Framework-neutral layout, tokens, components and responsive behavior.</p>
          <code>design-ir.json</code>
        </article>
      </section>
    </main>
  )
}

createRoot(document.getElementById('root')!).render(<React.StrictMode><App /></React.StrictMode>)
