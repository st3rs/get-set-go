import React, { useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import './styles.css'
import './prompt.css'
import './job-progress.css'

type Analysis = {
  target?: string
  generatedAt?: string
  policy?: {
    qualityRequested?: boolean
    qualityMode?: string
    aiConfigured?: boolean
    aiCalls?: number
    model?: string
    qualityGate?: string
    imageAssetsGenerated?: number
  }
  breakpoints?: Record<string, any>
  designIR?: any
  componentPlan?: any
  generatedPreview?: { html?: string; mode?: string; aiCalls?: number; note?: string }
  generatedFiles?: { appTsx?: string; stylesCss?: string } | null
  visualCritic?: { score?: number; verdict?: string; issues?: string[] } | null
  qualityNotes?: string[]
  qualityError?: string | null
  criticError?: string | null
  error?: string
  action?: string
}

type JobStatus = {
  id: string
  status: 'queued' | 'running' | 'succeeded' | 'failed'
  stage: string
  progress: number
  message?: string
  error?: string
  createdAt?: string
  startedAt?: string
  finishedAt?: string
}

type JobEnvelope = {
  ok?: boolean
  jobId?: string
  job?: JobStatus
  result?: Analysis | null
  error?: string
}

const ACTIVE_JOB_KEY = 'get-set-go-active-job'

const features = [
  ['01', 'Rendered page capture', 'Studies the page the way a visitor sees it, including visual hierarchy and media.'],
  ['02', 'Responsive layout', 'Measures desktop, tablet and mobile structure before rebuilding the interface.'],
  ['03', 'Design rules', 'Extracts reusable spacing, typography, color and layout patterns from the reference.'],
  ['04', 'Layout planning', 'Turns the reference and your instructions into a concrete implementation plan.'],
  ['05', 'Product imagery', 'Creates believable neutral mock media when product-heavy layouts need strong visuals.'],
  ['06', 'Editable code', 'Produces React and CSS you can keep working with instead of flattening the result into an image.'],
  ['07', 'Visual comparison', 'Renders the result and compares it with the reference to find visible mismatches.'],
  ['08', 'Quality checks', 'Weak drafts can be corrected again instead of being declared finished automatically.'],
]

const promptSuggestions = [
  ['Match closely', 'Match the reference layout, hierarchy, spacing, typography scale, and responsive behavior as closely as possible. Preserve its overall visual character.'],
  ['Modernize the style', 'Keep the information architecture and content density, but modernize the visual styling with cleaner spacing, stronger hierarchy, and more polished interaction details.'],
  ['Improve product cards', 'Keep the marketplace structure, but make the product cards feel more premium. Use strong realistic product or digital-product imagery, clearer hierarchy, and more consistent card spacing.'],
  ['Simplify the header', 'Simplify the header and navigation while keeping the important actions easy to find. Reduce clutter without losing useful information.'],
  ['Mobile-first cleanup', 'Prioritize mobile usability. Improve stacking, tap targets, spacing, typography, and responsive card behavior while keeping the desktop layout strong.'],
  ['Premium SaaS look', 'Rework the visual language toward a mature premium SaaS product: restrained color, crisp typography, subtle borders, purposeful spacing, and polished interaction states.'],
]

const audiences = [
  ['Builders', 'Study an interface and turn the useful design logic into editable code.'],
  ['Designers', 'Explore layout systems without redrawing every section from scratch.'],
  ['Agencies', 'Move from a client reference to a working first implementation faster.'],
  ['Founders', 'Prototype the shape of a product before committing a full engineering cycle.'],
]

const faqs = [
  ['Does Get Set Go copy the source code?', 'No. It rebuilds from the rendered page, measured layout and your instructions rather than copying the original source code.'],
  ['Can I tell it what to change from the reference?', 'Yes. Use the main prompt for the goal and add instruction steps when the work needs an explicit sequence.'],
  ['Is the result just an image?', 'No. The target output is editable React and CSS, with a live generated preview.'],
  ['What happens when the first result is weak?', 'Get Set Go renders the draft, compares it with the reference and can revise visible problems across multiple passes.'],
  ['Can it handle product cards and media?', 'Yes. Product-heavy interfaces can use realistic neutral mock media so cards do not collapse into empty placeholders.'],
]

const sleep = (ms: number) => new Promise((resolve) => window.setTimeout(resolve, ms))

async function readJson(response: Response) {
  const contentType = response.headers.get('content-type') || ''
  const text = await response.text()
  if (!contentType.includes('application/json')) throw new Error(`API returned ${contentType || 'non-JSON'} (HTTP ${response.status}).`)
  const data = JSON.parse(text) as JobEnvelope
  if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`)
  return data
}

function App() {
  const [url, setUrl] = useState('https://codecanyon.net')
  const [prompt, setPrompt] = useState('')
  const [steps, setSteps] = useState<string[]>([])
  const [status, setStatus] = useState('Ready for a reference')
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<Analysis | null>(null)
  const [jobProgress, setJobProgress] = useState<JobStatus | null>(null)

  function addInstructionStep() {
    setSteps((current) => current.length >= 8 ? current : [...current, ''])
  }

  function updateInstructionStep(index: number, value: string) {
    setSteps((current) => current.map((step, stepIndex) => stepIndex === index ? value : step))
  }

  function removeInstructionStep(index: number) {
    setSteps((current) => current.filter((_, stepIndex) => stepIndex !== index))
  }

  function applyPromptSuggestion(suggestion: string) {
    setPrompt((current) => current.trim() ? `${current.trim()}\n\n${suggestion}` : suggestion)
  }

  function finishWithResult(data: Analysis) {
    setResult(data)
    if (data.policy?.qualityMode === 'guardrailed-reconstruction') setStatus('Reconstruction ready')
    else if (!data.policy?.aiConfigured) setStatus('Page analysis ready · Advanced rebuild unavailable')
    else if (data.qualityError) setStatus('Fallback reconstruction ready')
    else setStatus('Reconstruction ready')
  }

  async function pollJob(jobId: string, isCancelled: () => boolean = () => false) {
    let transientFailures = 0

    while (!isCancelled()) {
      try {
        const statusData = await readJson(await fetch(`/api/jobs/${jobId}`, { cache: 'no-store' }))
        const job = statusData.job
        if (!job) throw new Error('Background job returned no status')

        transientFailures = 0
        setJobProgress(job)
        setStatus(job.message ? `${job.stage} · ${job.message}` : job.stage)

        if (job.status === 'failed') {
          try { localStorage.removeItem(ACTIVE_JOB_KEY) } catch {}
          throw new Error(job.error || 'Background reconstruction failed')
        }

        if (job.status === 'succeeded') {
          const finalData = await readJson(await fetch(`/api/jobs/${jobId}?includeResult=1`, { cache: 'no-store' }))
          if (!finalData.result) throw new Error('The job completed but its result could not be loaded')
          try { localStorage.removeItem(ACTIVE_JOB_KEY) } catch {}
          setJobProgress(finalData.job || job)
          finishWithResult(finalData.result)
          return
        }
      } catch (error) {
        transientFailures += 1
        if (transientFailures >= 5) throw error
        setStatus('Background job is still running · reconnecting…')
      }

      await sleep(1500)
    }
  }

  useEffect(() => {
    let cancelled = false
    let savedJobId = ''
    try { savedJobId = localStorage.getItem(ACTIVE_JOB_KEY) || '' } catch {}
    if (!savedJobId) return () => { cancelled = true }

    setBusy(true)
    setStatus('Resuming background reconstruction…')
    pollJob(savedJobId, () => cancelled)
      .catch((error) => {
        if (!cancelled) setStatus(error instanceof Error ? error.message : 'Could not resume background job')
      })
      .finally(() => {
        if (!cancelled) setBusy(false)
      })

    return () => { cancelled = true }
  }, [])

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setResult(null)
    setJobProgress(null)
    try {
      new URL(url)
    } catch {
      setStatus('Enter a valid public URL.')
      return
    }

    setBusy(true)
    setStatus('Creating background reconstruction job…')

    try {
      const created = await readJson(await fetch('/api/jobs', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          url,
          quality: true,
          prompt: prompt.trim(),
          steps: steps.map((step) => step.trim()).filter(Boolean),
        }),
      }))

      if (!created.jobId) throw new Error('Background service did not return a job id')
      try { localStorage.setItem(ACTIVE_JOB_KEY, created.jobId) } catch {}
      setJobProgress({ id: created.jobId, status: 'queued', stage: 'Queued', progress: 0, message: 'Waiting for the background runner' })
      await pollJob(created.jobId)
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Reconstruction failed')
    } finally {
      setBusy(false)
    }
  }

  const desktop = result?.breakpoints?.desktop
  const ir = result?.designIR
  const preview = result?.generatedPreview
  const score = result?.visualCritic?.score

  return (
    <div className="page">
      <div className="announcement">Build from a reference · Guide it with prompts · Refine the result</div>

      <header className="siteNav wrap">
        <a className="brand" href="#top"><span className="logoMark">G</span><span>Get Set Go</span></a>
        <nav className="navLinks">
          <a href="#workflow">Workflow</a>
          <a href="#quality">Quality</a>
          <a href="#faq">FAQ</a>
        </nav>
        <a className="navCta" href="#reconstruct">Try it now</a>
      </header>

      <main id="top">
        <section className="heroSection">
          <div className="heroGlow" />
          <div className="heroInner wrap">
            <p className="kicker">AI WEBSITE RECONSTRUCTION</p>
            <h1>Turn a reference website into working interface code.</h1>
            <p className="heroCopy">Give Get Set Go a reference, then tell it what you actually want. Use one main prompt or break a complex build into ordered instruction steps.</p>

            <form id="reconstruct" onSubmit={submit} className="instructionComposer">
              <section className="urlPanel">
                <div className="composerTopline">
                  <div><span className="composerLabel">Reference URL</span><small>What should Get Set Go study?</small></div>
                  <span className="inputState">{busy ? 'Background job active' : 'Public http/https'}</span>
                </div>
                <div className="referenceRow">
                  <input type="url" value={url} onChange={(e) => setUrl(e.target.value)} disabled={busy} aria-label="Reference URL" />
                </div>
              </section>

              <section className="promptPanel mainPromptPanel">
                <div className="composerTopline">
                  <div><span className="composerLabel">Main prompt</span><small>Describe the result you want, including changes from the reference.</small></div>
                  <span className="optionalTag">Optional</span>
                </div>
                <textarea
                  value={prompt}
                  onChange={(e) => setPrompt(e.target.value)}
                  disabled={busy}
                  aria-label="Main prompt"
                  placeholder="Example: Rebuild this marketplace with a cleaner premium layout. Keep the information density and category structure, but make product cards more modern, use realistic digital-product thumbnails, and simplify the header."
                />
                <div className="suggestionBlock">
                  <span className="suggestionLabel">Prompt suggestions</span>
                  <div className="suggestionChips">
                    {promptSuggestions.map(([label, suggestion]) => (
                      <button type="button" key={label} onClick={() => applyPromptSuggestion(suggestion)} disabled={busy}>{label}</button>
                    ))}
                  </div>
                </div>
                <div className="promptMeta"><span>Main instruction</span><span>{prompt.length.toLocaleString()} characters</span></div>
              </section>

              {steps.map((step, index) => (
                <section className="promptPanel stepPromptPanel" key={`step-${index}`}>
                  <div className="composerTopline">
                    <div><span className="composerLabel">Instruction step {index + 1}</span><small>Applied in order after the main prompt.</small></div>
                    <button type="button" className="removeStep" onClick={() => removeInstructionStep(index)} disabled={busy} aria-label={`Remove instruction step ${index + 1}`}>Remove</button>
                  </div>
                  <textarea
                    value={step}
                    onChange={(e) => updateInstructionStep(index, e.target.value)}
                    disabled={busy}
                    aria-label={`Instruction step ${index + 1}`}
                    placeholder={`Step ${index + 1}: Describe the next concrete change or constraint…`}
                  />
                  <div className="promptMeta"><span>Step {index + 1}</span><span>{step.length.toLocaleString()} characters</span></div>
                </section>
              ))}

              <div className="composerActions">
                <button type="button" className="addStepButton" onClick={addInstructionStep} disabled={busy || steps.length >= 8}><span>+</span> {steps.length >= 8 ? '8 steps added' : 'Add instruction step'}</button>
                <button type="submit" className="reconstructButton" disabled={busy}>{busy ? 'Running in background…' : 'Reconstruct'}</button>
              </div>
              <div className="composerHints"><span>Reference</span><b>→</b><span>Your prompt</span>{steps.length > 0 && <><b>→</b><span>{steps.length} ordered {steps.length === 1 ? 'step' : 'steps'}</span></>}<b>→</b><span>Editable result</span></div>

              {jobProgress && busy && (
                <div className="jobProgress" role="status" aria-live="polite">
                  <div className="jobProgressTop"><strong>{jobProgress.stage}</strong><span>{Math.max(0, Math.min(100, jobProgress.progress))}%</span></div>
                  <div className="jobProgressTrack"><i style={{ width: `${Math.max(0, Math.min(100, jobProgress.progress))}%` }} /></div>
                  <p>{jobProgress.message || 'The job continues even if you refresh this page.'}</p>
                </div>
              )}
            </form>

            <div className="statusLine"><span className={busy ? 'pulseDot active' : 'pulseDot'} />{status}</div>
          </div>
        </section>

        <section id="workflow" className="section wrap centerSection">
          <p className="kicker">REFERENCE + INSTRUCTIONS</p>
          <h2>Study the reference. Follow the brief. Prove the result.</h2>
          <p className="sectionCopy">The reference supplies visual evidence. Your prompt supplies intent. Ordered steps let you turn a complicated redesign into a build plan instead of one giant ambiguous request.</p>
          <div className="modeTabs"><span className="active">1 · Capture</span><span>2 · Instruct</span><span>3 · Rebuild</span><span>4 · Refine</span></div>

          <div className="productDemo">
            <div className="demoBar"><i /><i /><i /><span>get-set-go.pages.dev</span><b>Quality mode</b></div>
            <div className="demoBody">
              <aside className="demoAside">
                <small>REFERENCE</small>
                <strong>{result?.target || 'https://codecanyon.net'}</strong>
                {['Capture reference', 'Read instructions', 'Map the layout', 'Build interface', 'Render preview', 'Compare & refine'].map((item, index) => (
                  <div className="demoStep" key={item}><span>{String(index + 1).padStart(2, '0')}</span><p>{item}</p><em>{index < 3 || result ? 'done' : 'ready'}</em></div>
                ))}
              </aside>
              <div className="demoCanvas">
                {preview?.html ? (
                  <iframe title="Generated reconstruction" sandbox="" srcDoc={preview.html} />
                ) : (
                  <div className="emptyPreview">
                    <div className="fakeNav"><span /><span /><span /></div>
                    <div className="fakeHero"><small>Generated preview</small><h3>Your reconstruction appears here.</h3><p>Add a reference and optional instructions above to run the full rebuild.</p><button type="button" onClick={() => document.getElementById('reconstruct')?.scrollIntoView({ behavior: 'smooth' })}>Start a reconstruction</button></div>
                    <div className="fakeCards"><i /><i /><i /></div>
                  </div>
                )}
              </div>
            </div>
          </div>
        </section>

        {result && (
          <section className="runSection wrap">
            <div className="runHeader"><div><p className="kicker">CURRENT RUN</p><h2>{status}</h2></div><div className="scoreChip">{typeof score === 'number' ? `Quality ${score}/100` : result.policy?.qualityGate || 'Processed'}</div></div>
            <div className="runMetrics">
              <div><span>Page</span><strong>{desktop?.title || 'Untitled'}</strong></div>
              <div><span>Layout type</span><strong>{ir ? `${ir.siteType} · ${ir.layout?.density}` : 'Analyzed'}</strong></div>
              <div><span>Quality status</span><strong>{result.policy?.qualityGate || 'Processed'}</strong></div>
              <div><span>Generated media</span><strong>{result.policy?.imageAssetsGenerated ?? 0}</strong></div>
            </div>
            {(result.qualityError || result.criticError) && <div className="warningBox">{result.qualityError || result.criticError}</div>}
            {result.visualCritic?.issues?.length ? <div className="issueRow">{result.visualCritic.issues.slice(0, 5).map(issue => <span key={issue}>{issue}</span>)}</div> : null}
          </section>
        )}

        <section id="quality" className="section wrap splitIntro">
          <div><p className="kicker">MEASURE BEFORE BUILDING</p><h2>Less guessing. More measured interface structure.</h2><p className="sectionCopy left">Get Set Go measures the rendered page first, so layout, typography, media and responsive behavior do not have to be invented from scratch.</p></div>
          <div className="featureGrid">
            {features.map(([num, title, copy]) => <article className="featureCard" key={title}><span>{num}</span><h3>{title}</h3><p>{copy}</p></article>)}
          </div>
        </section>

        <section className="softSection">
          <div className="section wrap centerSection compact">
            <p className="kicker">BUILT FOR PEOPLE WHO SHIP</p>
            <h2>One reconstruction engine, different starting points.</h2>
            <div className="audienceGrid">{audiences.map(([title, copy], i) => <article key={title}><span>{String(i + 1).padStart(2, '0')}</span><h3>{title}</h3><p>{copy}</p></article>)}</div>
          </div>
        </section>

        <section className="section wrap centerSection compact">
          <p className="kicker">WHAT WILL YOU REBUILD?</p>
          <h2>From landing pages to dense product marketplaces.</h2>
          <div className="typeRow">{['Landing pages', 'SaaS', 'Marketplaces', 'Dashboards', 'Commerce', 'Content sites'].map((x, i) => <span key={x}><b>{String(i + 1).padStart(2, '0')}</b>{x}</span>)}</div>
        </section>

        <section className="softSection proofSection">
          <div className="section wrap centerSection compact">
            <p className="kicker">QUALITY WITH CONTEXT</p>
            <h2>The engine is allowed to say “not good enough yet.”</h2>
            <div className="proofGrid">
              <article><strong>92+</strong><h3>Quality target</h3><p>A draft should meet a high visual bar before it is treated as complete.</p></article>
              <article><strong>3</strong><h3>Correction passes</h3><p>Weak output can be rendered and corrected again instead of stopping at the first draft.</p></article>
              <article><strong>3</strong><h3>Screen sizes checked</h3><p>Desktop, tablet and mobile layouts are considered before the interface is generated.</p></article>
            </div>
          </div>
        </section>

        <section id="faq" className="section wrap faqSection">
          <div className="faqTitle"><p className="kicker">QUESTIONS</p><h2>What Get Set Go actually does.</h2></div>
          <div className="faqList">{faqs.map(([q, a]) => <details key={q}><summary>{q}<span>+</span></summary><p>{a}</p></details>)}</div>
        </section>

        <section className="finalCta wrap">
          <p className="kicker">READY WHEN YOU ARE</p>
          <h2>Give it a reference. Tell it what to change.</h2>
          <p>Use one prompt for a simple reconstruction or add ordered instruction steps for a more deliberate build.</p>
          <button onClick={() => document.getElementById('reconstruct')?.scrollIntoView({ behavior: 'smooth' })}>Start with a reference</button>
        </section>
      </main>

      <footer className="footer wrap"><a className="brand" href="#top"><span className="logoMark">G</span><span>Get Set Go</span></a><p>Reference → Instructions → Rebuild → Refine</p><span>Built for editable output.</span></footer>
    </div>
  )
}

createRoot(document.getElementById('root')!).render(<React.StrictMode><App /></React.StrictMode>)