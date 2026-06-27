# Commercial UI Prototype Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a commercial-grade, high-tech frontend prototype for the Douyin viral video copy replication tool.

**Architecture:** Create a self-contained local frontend prototype in `prototype/`. Use the selected visual direction: short-video operations war room as the main layout, neon command-center motion for processing states, and a clean CPA settings panel.

**Tech Stack:** Product Design prototype starter, Vite, React, CSS, local mock data, local visual reference assets.

---

### Task 1: Bootstrap Prototype

**Files:**
- Create: `prototype/`
- Read: `docs/design-directions/README.md`
- Read: `docs/superpowers/specs/2026-06-26-douyin-video-copy-tool-design.md`

- [ ] **Step 1: Create the prototype app**

Run:

```powershell
node "C:\Users\CM1165\.codex\plugins\cache\openai-curated-remote\product-design\0.1.47\scripts\bootstrap-prototype.mjs" --dest "D:\9005_IDEauthorized\Codex Project\抖音爆款视频复刻\prototype"
```

Expected: `prototype/` exists with Vite/React starter files.

- [ ] **Step 2: Install dependencies**

Run:

```powershell
npm install
```

Expected: dependencies install successfully.

### Task 2: Implement War Room UI

**Files:**
- Modify: `prototype/src/App.jsx`
- Modify: `prototype/src/App.css`
- Copy/read reference: `docs/design-directions/assets/03-short-video-operations-war-room.png`

- [ ] **Step 1: Replace starter screen**

Build one full-screen app surface containing:

- Header with product name, Douyin URL input, extract button, CPA model selector, API key saved indicator.
- Left video card with viral metrics, player frame, online play and download buttons.
- Center replication workflow with six steps.
- Bottom timeline with waveform, subtitles, OCR text chips, keyframe strip, hook/turning/conversion markers.
- Right intelligence board with original copy, selling point tags, rewrite variants, copy buttons.
- CPA settings panel with API Key status, model dropdown, creativity slider, output length segmented control.

- [ ] **Step 2: Add interactions**

Implement local interactions:

- Extract button starts a simulated progress animation.
- Workflow steps update from waiting to running to success.
- Rewrite variant tabs/cards can be selected.
- Copy buttons show copied state.
- API model can be changed.
- Creativity slider changes numeric display.

### Task 3: Commercial Visual Polish

**Files:**
- Modify: `prototype/src/App.css`

- [ ] **Step 1: Apply high-tech art direction**

Use:

- Deep neutral background.
- Cyan signal glow.
- Green success accents.
- Orange/red heat markers.
- Subtle grid/noise atmosphere.
- Premium panel borders.
- Real button, input, select, slider, tab, and status states.

Avoid:

- Generic admin dashboard.
- Cheap purple gradients.
- Overcrowded text.
- Cards inside cards.
- Plain HTML form styling.

- [ ] **Step 2: Responsive layout**

Ensure:

- Desktop `1440 x 1024` matches commercial app feel.
- Mobile `390px` stacks cleanly with no horizontal overflow.
- Text does not overlap or clip.

### Task 4: Verify

**Files:**
- Create: `design-qa.md`

- [ ] **Step 1: Build**

Run:

```powershell
npm run build
```

Expected: build succeeds.

- [ ] **Step 2: Start local server**

Run:

```powershell
npm run dev -- --host 127.0.0.1
```

Expected: local URL opens.

- [ ] **Step 3: Capture screenshots**

Capture:

- Desktop `1440 x 1024`
- Mobile `390 x 844`

- [ ] **Step 4: Compare against source visual**

Use source:

```text
docs/design-directions/assets/03-short-video-operations-war-room.png
```

QA must explicitly check:

- Typography.
- Layout rhythm.
- Color tokens.
- Image/visual fidelity.
- Copy/content.
- Responsiveness.

Write `design-qa.md` with `final result: passed` only if no P0/P1/P2 findings remain.

### Task 5: Handoff

**Files:**
- Final app: `prototype/`
- QA: `design-qa.md`

- [ ] **Step 1: Report outcome**

Return:

- Local URL.
- What was built.
- What was verified.
- Any remaining risk.

No git commit is required because this workspace is not currently a Git repository.
