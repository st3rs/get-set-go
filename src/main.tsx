import React, { useMemo, useState } from 'react'
import { createRoot } from 'react-dom/client'
import './styles.css'
import './prompt.css'

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

const features = [
  ['01', 'Rendered evidence', 'Captures the page the way a visitor sees it, not just the DOM tree.'],
  ['02', 'Responsive geometry', 'Measures desktop, tablet and mobile structure before generating code.'],
  ['03', 'Design IR', 'Turns spacing, type, color and layout evidence into a reusable design model.'],
  ['04', 'Visual architect', 'Muse Spark interprets composition and implementation intent from the evidence.'],
  ['05', 'Product media', 'Muse Image can create realistic neutral media when a reconstruction needs it.'],
  ['06', 'React + CSS', 'Produces editable interface code instead of a flattened screenshot.'],
  ['07', 'Visual critic', 'Renders the result, compares it with the reference and corrects weak passes.'],
  ['08', 'Quality gate', 'A reconstruction must earn the score instead of being declared finished by default.'],
]

const audiences = [
  ['Builders', 'Study an interface and turn the useful design logic into editable code.'],
  ['Designers', 'Explore layout systems without redrawing every section from scratch.'],
  ['Agencies', 'Move from a client reference to a working first implementation faster.'],
  ['Founders', 'Prototype the shape of a product before committing a full engineering cycle.'],
]

const faqs = [
  ['Does Get Set Go copy the source code?', 'No. It reconstructs from rendered browser evidence, measured geometry and design reasoning.'],
  ['Can I tell it what to change from the reference?', 'Yes. Use the main prompt for the goal and add instruction steps when the work needs an explicit sequence.'],
  ['Is the result just an image?', 'No. The target output is editable React and CSS, with a live generated preview.'],
  ['What happens when the first result is weak?', 'The visual critic renders the draft, compares it against the reference and can revise it across multiple passes.'],
  ['Can it handle product cards and media?', 'Yes. Product-heavy interfaces can use generated neutral mock media so cards do not collapse into empty placeholders.'],
]

function App() {
  const [url, setUrl] = useState('https://codecanyon.net')
  const [prompt, setPrompt] = useState('')
  const [steps, setSteps] = useState<string[]>([])
  const [status, setStatus] = useState('Ready for a reference')
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<Analysis | null>(null)

  function addInstructionStep() {
    setSteps((current) => [...current, ''])
  }

  function updateInstructionStep(index: number, value: string) {
    setSteps((current) => current.map((step, stepIndex) => stepIndex === index ? value : step))
  }

  function removeInstructionStep(index: number) {
    setSteps((current) => current.filter((_, stepIndex) => stepIndex !== index))
  }

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
    setStatus('Reading the reference and following your instructions…')

    try {
      const response = await fetch('/api/analyze', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          url,
          quality: true,
          prompt: prompt.trim(),
          steps: steps.map((step) => step.trim()).filter(Boolean),
        }),
      })
      const contentType = response.headers.get('content-type') || ''
      const text = await response.text()
      if (!contentType.includes('application/json')) throw new Error(`API returned ${contentType || 'non-JSON'} (HTTP ${response.status}).`)

      const data = JSON.parse(text) as Analysis
      if (!response.ok) throw new Error(data.action ? `${data.error} ${data.action}` : data.error || `HTTP ${response.status}`)
      setResult(data)

      if (data.policy?.qualityMode === 'ai-quality-first') setStatus('Reconstruction ready')
      else if (!data.policy?.aiConfigured) setStatus('Browser analysis ready · AI quality pass unavailable')
      else if (data.qualityError) setStatus('Fallback reconstruction ready')
      else setStatus('Reconstruction ready')
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Analysis failed')
    } finally {
      setBusy(false)
    }
  }

  const desktop = result?.breakpoints?.desktop
  const ir = result?.designIR
  const preview = result?.generatedPreview
  const score = result?.visualCritic?.score

  const metrics = useMemo(() => [
    [desktop?.visibleElementCount ? desktop.visibleElementCount.toLocaleString() : '3 views', 'rendered evidence'],
    [typeof score === 'number' ? `${score}/100` : '92+', 'quality target'],
    [result?.policy?.aiCalls ? `${result.policy.aiCalls}` : '3×', 'critic loop'],
  ], [desktop, score, result])

  return (
    <div className="page">
      <div className="announcement">Visual reconstruction is live · Browser Run + Muse Spark + Muse Image</div>

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
            <p className="kicker">VISUAL ARCHITECT FOR THE WEB</p>
            <h1>Turn a reference website into working interface code.</h1>
            <p className="heroCopy">Give Get Set Go a reference, then tell it what you actually want. Use one main prompt or break a complex build into ordered instruction steps.</p>

            <form id="reconstruct" onSubmit={submit} className="instructionComposer">
              <section className="urlPanel">
                <div className="composerTopline">
                  <div><span className="composerLabel">Reference URL</span><small>What should Get Set Go study?</small></div>
                  <span className="inputState">{busy ? 'Reading reference' : 'Public http/https'}</span>
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
                <div className="promptMeta"><span>Main instruction</span><span>{prompt.length.toLocaleString()} characters</span></div>
              </section>

              {steps.map((step, index) => (
                <section className="promptPanel stepPromptPanel" key={`step-${index}`}>
                  <div className="composerTopline">
                    <div><span className="composerLabel">Instruction step {index + 1}</span><small>Executed as an ordered instruction after the main prompt.</small></div>
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
                <button type="button" className="addStepButton" onClick={addInstructionStep} disabled={busy}><span>+</span> Add instruction step</button>
                <button type="submit" className="reconstructButton" disabled={busy}>{busy ? 'Reconstructing…' : 'Reconstruct'}</button>
              </div>
              <div className="composerHints"><span>Reference evidence</span><b>→</b><span>Main prompt</span>{steps.length > 0 && <><b>→</b><span>{steps.length} instruction {steps.length === 1 ? 'step' : 'steps'}</span></>}<b>→</b><span>React + visual QA</span></div>
            </form>

            <div className="statusLine"><span className={busy ? 'pulseDot active' : 'pulseDot'} />{status}</div>
          </div>
        </section>

        <section className="metricsBand">
          <div className="metricGrid wrap">
            {metrics.map(([value, label]) => <div className="metric" key={label}><strong>{value}</strong><span>{label}</span></div>)}
          </div>
        </section>

        <section id="workflow" className="section wrap centerSection">
          <p className="kicker">REFERENCE + INSTRUCTIONS</p>
          <h2>Study the reference. Follow the brief. Prove the result.</h2>
          <p className="sectionCopy">The reference supplies visual evidence. Your prompt supplies intent. Ordered steps let you turn a complicated redesign into a build plan instead of one giant ambiguous request.</p>
          <div className="modeTabs"><span className="active">1 · Capture</span><span>2 · Instruct</span><span>3 · Reconstruct</span><span>4 · Critique</span></div>

          <div className="productDemo">
            <div className="demoBar"><i /><i /><i /><span>get-set-go.pages.dev</span><b>Quality mode</b></div>
            <div className="demoBody">
              <aside className="demoAside">
                <small>REFERENCE</small>
                <strong>{result?.target || 'https://codecanyon.net'}</strong>
                {['Browser capture', 'User instructions', 'Design scene graph', 'Visual architect', 'React generation', 'Visual critic'].map((item, index) => (
                  <div className="demoStep" key={item}><span>{String(index + 1).padStart(2, '0')}</span><p>{item}</p><em>{index < 3 || result ? 'done' : 'ready'}</em></div>
                ))}
              </aside>
              <div className="demoCanvas">
                {preview?.html ? (
                  <iframe title="Generated reconstruction" sandbox="" srcDoc={preview.html} />
                ) : (
                  <div className="emptyPreview">
                    <div className="fakeNav"><span /><span /><span /></div>
                    <div className="fakeHero"><small>Generated preview</small><h3>Your reconstruction appears here.</h3><p>Add a reference and optional instructions above to run the full quality pipeline.</p><button type="button" onClick={() => document.getElementById('reconstruct')?.scrollIntoView({ behavior: 'smooth' })}>Start a reconstruction</button></div>
                    <div className="fakeCards"><i /><i /><i /></div>
                  </div>
                )}
              </div>
            </div>
          </div>
        </section>

        {result && (
          <section className="runSection wrap">
            <div className="runHeader"><div><p className="kicker">CURRENT RUN</p><h2>{status}</h2></div><div className="scoreChip">{typeof score === 'number' ? `Critic ${score}/100` : result.policy?.qualityGate || 'Processed'}</div></div>
            <div className="runMetrics">
              <div><span>Title</span><strong>{desktop?.title || 'Untitled'}</strong></div>
              <div><span>Scene</span><strong>{ir ? `${ir.siteType} · ${ir.layout?.density}` : 'Analyzed'}</strong></div>
              <div><span>AI calls</span><strong>{result.policy?.aiCalls ?? 0}</strong></div>
              <div><span>Generated media</span><strong>{result.policy?.imageAssetsGenerated ?? 0}</strong></div>
            </div>
            {(result.qualityError || result.criticError) && <div className="warningBox">{result.qualityError || result.criticError}</div>}
            {result.visualCritic?.issues?.length ? <div className="issueRow">{result.visualCritic.issues.slice(0, 5).map(issue => <span key={issue}>{issue}</span>)}</div> : null}
          </section>
        )}

        <section id="quality" className="section wrap splitIntro">
          <div><p className="kicker">EVIDENCE FIRST</p><h2>Less guessing. More measured interface structure.</h2><p className="sectionCopy left">The browser layer extracts what the model should not have to invent: geometry, responsive behavior, typography, media footprint and layout relationships.</p></div>
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
            <p className="kicker">QUALITY OVER THEATER</p>
            <h2>The engine is allowed to say “not good enough yet.”</h2>
            <div className="proofGrid">
              <article><strong>92+</strong><h3>Visual quality gate</h3><p>The critic should not pass a reconstruction simply because generation completed.</p></article>
              <article><strong>3</strong><h3>Correction passes</h3><p>Weak output can be rendered and corrected again instead of stopping at the first draft.</p></article>
              <article><strong>3</strong><h3>Viewport classes</h3><p>Desktop, tablet and mobile evidence are considered before the interface is generated.</p></article>
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

      <footer className="footer wrap"><a className="brand" href="#top"><span className="logoMark">G</span><span>Get Set Go</span></a><p>Reference evidence → Instructions → Design IR → React → Critic</p><span>Built for editable output.</span></footer>
    </div>
  )
}

createRoot(document.getElementById('root')!).render(<React.StrictMode><App /></React.StrictMode>)
