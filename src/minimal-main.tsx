import React, { useState } from 'react'
import { createRoot } from 'react-dom/client'
import './minimal.css'

type SmokeResult = {
  ok?: boolean
  proof?: string
  model?: string
  mimeType?: string
  byteLengthEstimate?: number
  imageDataUrl?: string
  elapsedMs?: number
  stage?: string
  error?: string
}

type MinimalResult = {
  ok?: boolean
  version?: string
  target?: string
  elapsedMs?: number
  error?: string
  artifacts?: {
    capture?: {
      title?: string
      viewport?: { width?: number; height?: number }
      page?: { width?: number; height?: number }
      htmlChars?: number
      screenshotBytes?: number
      screenshotDataUrl?: string
    }
    spark?: {
      model?: string
      rawResponseBytes?: number
      structure?: any
      summary?: string
    }
    image?: {
      model?: string
      mimeType?: string
      byteLengthEstimate?: number
      imageDataUrl?: string
    }
    output?: {
      html?: string
      htmlChars?: number
      imageInjected?: boolean
    }
  }
}

async function postJson<T>(url: string, body?: unknown, timeoutMs = 120_000): Promise<T> {
  const controller = new AbortController()
  const timer = window.setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: controller.signal,
    })
    const text = await response.text()
    let data: any
    try { data = JSON.parse(text) } catch { throw new Error(`API returned non-JSON HTTP ${response.status}: ${text.slice(0, 300)}`) }
    if (!response.ok || data?.ok === false) throw new Error(data?.error || `HTTP ${response.status}`)
    return data as T
  } catch (error) {
    if (controller.signal.aborted) throw new Error('Request exceeded the 120 second proof-slice limit')
    throw error
  } finally {
    window.clearTimeout(timer)
  }
}

function App() {
  const [url, setUrl] = useState('https://codecanyon.net')
  const [busy, setBusy] = useState<'smoke' | 'rebuild' | null>(null)
  const [status, setStatus] = useState('No proof has been produced yet.')
  const [smoke, setSmoke] = useState<SmokeResult | null>(null)
  const [result, setResult] = useState<MinimalResult | null>(null)

  async function smokeImage() {
    setBusy('smoke')
    setSmoke(null)
    setStatus('Calling muse-image-1.0 directly…')
    try {
      const data = await postJson<SmokeResult>('/api/smoke-image')
      setSmoke(data)
      setStatus(`Muse Image returned real ${data.mimeType || 'image'} bytes.`)
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Muse Image smoke test failed')
    } finally {
      setBusy(null)
    }
  }

  async function rebuild() {
    try { new URL(url) } catch { setStatus('Enter a valid public URL.'); return }
    setBusy('rebuild')
    setResult(null)
    setStatus('Running one synchronous Browser → Spark → Muse Image → HTML request…')
    try {
      const data = await postJson<MinimalResult>('/api/minimal-rebuild', { url })
      setResult(data)
      setStatus('Minimal slice returned all artifacts in one response.')
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Minimal rebuild failed')
    } finally {
      setBusy(null)
    }
  }

  const outputHtml = result?.artifacts?.output?.html || ''

  return (
    <main className="shell">
      <section className="intro">
        <span className="eyebrow">GET SET GO · MINIMAL SLICE V1</span>
        <h1>Prove the pipeline before rebuilding the platform.</h1>
        <p>This branch has no Durable Object job queue, critic loop, registry, geometry gate, polling, reconnect loop, or localStorage job state in its execution path.</p>
      </section>

      <section className="panel">
        <div>
          <strong>Step 0 · Muse Image entitlement</strong>
          <p>One direct call to <code>muse-image-1.0</code>. Success means actual image bytes came back.</p>
        </div>
        <button onClick={smokeImage} disabled={busy !== null}>{busy === 'smoke' ? 'Testing…' : 'Test Muse Image'}</button>
      </section>

      {smoke?.imageDataUrl && (
        <section className="artifact">
          <div className="artifactHead"><strong>Image artifact</strong><span>{smoke.model} · {smoke.mimeType} · {Math.round((smoke.byteLengthEstimate || 0) / 1024)} KB</span></div>
          <img src={smoke.imageDataUrl} alt="Muse Image smoke-test artifact" />
        </section>
      )}

      <section className="panel stack">
        <div>
          <strong>Minimal rebuild</strong>
          <p>One request: Browser capture → Spark JSON → Muse Image bytes → injected HTML.</p>
        </div>
        <div className="row">
          <input value={url} onChange={(event) => setUrl(event.target.value)} disabled={busy !== null} aria-label="Reference URL" />
          <button onClick={rebuild} disabled={busy !== null}>{busy === 'rebuild' ? 'Running…' : 'Run minimal rebuild'}</button>
        </div>
      </section>

      <section className="status"><strong>Status</strong><span>{status}</span></section>

      {result?.artifacts && (
        <section className="proofGrid">
          <article><strong>Browser</strong><span>{result.artifacts.capture?.title || 'Untitled'}</span><small>{result.artifacts.capture?.htmlChars || 0} HTML chars · {result.artifacts.capture?.screenshotBytes || 0} screenshot bytes</small></article>
          <article><strong>Spark</strong><span>{result.artifacts.spark?.model}</span><small>{result.artifacts.spark?.summary}</small></article>
          <article><strong>Muse Image</strong><span>{result.artifacts.image?.model}</span><small>{result.artifacts.image?.mimeType} · {result.artifacts.image?.byteLengthEstimate || 0} bytes</small></article>
          <article><strong>Output</strong><span>{result.artifacts.output?.imageInjected ? 'Generated image injected' : 'Image injection missing'}</span><small>{result.artifacts.output?.htmlChars || 0} HTML chars</small></article>
        </section>
      )}

      {result?.artifacts?.capture?.screenshotDataUrl && (
        <section className="artifact">
          <div className="artifactHead"><strong>Reference capture artifact</strong><span>Browser Rendering</span></div>
          <img src={result.artifacts.capture.screenshotDataUrl} alt="Reference browser capture" />
        </section>
      )}

      {result?.artifacts?.image?.imageDataUrl && (
        <section className="artifact">
          <div className="artifactHead"><strong>Generated image artifact</strong><span>{result.artifacts.image.mimeType}</span></div>
          <img src={result.artifacts.image.imageDataUrl} alt="Generated replacement visual" />
        </section>
      )}

      {outputHtml && (
        <section className="artifact previewArtifact">
          <div className="artifactHead"><strong>output.html artifact</strong><span>Rendered below from the returned HTML</span></div>
          <iframe title="Minimal rebuild output" sandbox="allow-scripts" srcDoc={outputHtml} />
        </section>
      )}
    </main>
  )
}

createRoot(document.getElementById('root')!).render(<App />)
