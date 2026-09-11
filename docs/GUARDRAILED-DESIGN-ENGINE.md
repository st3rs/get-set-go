# Get Set Go — Guardrailed Design Engine

## Goal

Prevent generic, inconsistent AI-generated interfaces by constraining generation with a crafted design system, while preserving enough flexibility to reconstruct references with high visual fidelity.

The engine should not ask a language model to invent arbitrary CSS from scratch. It should plan a UI, choose from known primitives, apply measured or curated tokens, render the result, then refine visible mismatches.

## Two operating modes

### 1. Reconstruction mode

Used when a public reference URL or screenshot is supplied.

Priority order:

1. Explicit user instructions
2. Measured reference geometry and visual evidence
3. Extracted semantic design tokens
4. Curated component primitives
5. Safe fallback defaults

Reconstruction mode uses guardrails as defaults, not a visual prison. When the reference requires a layout, radius, media ratio, spacing value, or composition that the default component registry cannot express faithfully, the engine may use a controlled escape hatch.

Raw arbitrary styling should still be minimized. Every escape should be traceable to reference evidence or an explicit user instruction.

### 2. Creation mode

Used when the user starts primarily from a prompt rather than a visual reference.

Creation mode is stricter:

- semantic tokens only
- curated typography scales
- 8pt-oriented spacing system
- approved radii, shadows, borders and motion
- component registry first
- no arbitrary colors or one-off styling unless specifically requested

This mode should produce a coherent house quality by default rather than a generic LLM-generated landing page.

## Pipeline

```text
Reference + User Prompt
        ↓
Intent / Instruction Planner
        ↓
Measured Scene + Component Spec
        ↓
Design Token Resolver
        ↓
Curated Component Registry
        ↓
Code Generator
        ↓
Live Runtime / Preview
        ↓
Visual Comparison
        ↓
Correction Passes
```

## Design token contract

Generated UI should prefer semantic tokens instead of arbitrary values.

Example token families:

```text
color.background
color.surface
color.surfaceElevated
color.text
color.textMuted
color.border
color.accent
color.accentForeground

space.1 ... space.12
radius.sm / md / lg / xl
shadow.sm / md
font.body / display / mono
text.xs / sm / base / lg / xl / 2xl / display
```

For Tailwind-based targets these can map to semantic classes such as:

```text
bg-background
bg-card
text-foreground
text-muted-foreground
border-border
bg-primary
text-primary-foreground
```

In reconstruction mode, measured reference values can create scoped token overrides rather than scattering raw values through components.

## Component registry

The preferred generation vocabulary should be curated primitives rather than unrestricted markup.

Candidate foundations:

- Radix primitives for behavior and accessibility
- shadcn/ui-style component contracts
- Tailwind utilities and semantic tokens
- Lucide icons
- motion presets for subtle interaction feedback

Registry categories should include:

- navigation
- hero
- search
- cards
- product cards
- pricing
- tables
- filters
- sidebars
- forms
- dialogs
- tabs
- accordions
- testimonials
- footers

Each component should expose controlled variants for density, alignment, media ratio, border treatment, emphasis and responsive behavior.

## High-end defaults

Defaults should feel finished before the model adds any styling:

- crisp 1px borders
- restrained radii
- strong typography hierarchy
- consistent spacing rhythm
- deliberate hover/focus states
- short subtle transitions
- polished empty/loading states
- no gratuitous gradients, glass effects or giant rounded cards

Reference evidence overrides these defaults when fidelity requires it.

## Product and marketplace media

Cards that visually depend on product media must not degrade into placeholders.

The engine should classify the product medium first:

- physical product → realistic commercial product photography
- digital product → polished software/template/plugin/app preview imagery

Generated media must preserve the reference card's aspect ratio, crop, visual weight and backdrop. Price, labels, badges and interface copy remain HTML.

## Progressive feedback

Long generation should communicate useful work rather than show a generic spinner.

Expose user-facing activity events such as:

```text
Reading the reference
Measuring the responsive layout
Planning page sections
Preparing product imagery
Building the interface
Rendering the preview
Comparing the result
Refining visible mismatches
```

Avoid exposing internal model/provider names in the normal product UI.

Future runtime options:

- Sandpack for lightweight React/Vite previews
- WebContainer for fuller project execution
- incremental file updates rather than full iframe replacement
- component-level skeletons while a region is rebuilding

## Direct manipulation roadmap

After generation becomes reliable, add fast non-prompt edits:

1. Inline text editing
2. Color/token controls
3. Component variant swapping
4. Element selection + inspector overlay
5. Spacing/radius controls
6. Re-run only the selected region

The goal is to reserve AI calls for changes that actually require reasoning.

## Quality gate

A generated page is not complete merely because code compiled.

Quality checks should separately score:

- instruction compliance
- macro layout
- responsive behavior
- typography
- spacing rhythm
- media quality
- component consistency
- reference fidelity when applicable

Reconstruction mode must never 'correct' an intentional user-requested deviation back toward the source reference.

## Implementation sequence

### Phase A — now

- semantic user-facing copy
- prompt + ordered instructions
- measured reference evidence
- visual comparison loop
- realistic media generation

### Phase B — next

- introduce semantic token resolver
- define curated component registry contracts
- make code generation return component specs before source code
- emit structured activity events to the frontend

### Phase C

- Sandpack/WebContainer live runtime
- file-level incremental updates
- selected-component regeneration
- inspector overlays and inline editing

### Phase D

- component swapping
- visual token controls
- persistent project workspace
- version/diff history

## Core principle

The model should make design decisions inside a well-crafted playing field. It should not be responsible for inventing the playing field every time.