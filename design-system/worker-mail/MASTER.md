# Worker Mail — Design System Master Specification

> **Status:** active · **Scope:** Light operator console (`public/index.html`, `public/assets/app.css`, `public/assets/app.js`)

---

## 1. Direction & Principles

- **Archetype:** Single-Worker operator console for Cloudflare Email Routing (`worker-mail`).
- **Tone:** Calm, utilitarian paper-and-ink light mode (`#f5f6f3` canvas, `#ffffff` panels, `#202923` ink, `#23734d` forest-green primary action). Zero decorative bloat, zero gradients, zero fake telemetry.
- **Data Integrity (Anti-Slop Rule):**
  1. Show only real values returned by `/api/console` and `/api/mail/latest`.
  2. Never invent inbox streams, unread counters, latency readouts, or CRUD controls for routes that are managed in [`src/config/routes.ts`](file:///d:/Coding/worker-mail/src/config/routes.ts).
  3. Never rely on color alone for status: pair status dots and capability states with explicit Vietnamese labels (`Đã khai báo` / `Chưa khai báo`, `Đang bật` / `Chưa bật`).

---

## 2. Tokens (`public/assets/app.css`)

### 2.1 Color Palette & Verified Contrast (WCAG 2.2 AA)

| Token | Value | Usage | Contrast Verification |
|---|---|---|---|
| `--canvas` | `#f5f6f3` | Page background | — |
| `--sidebar` / `--surface` | `#ffffff` | Sidebar, panels, inputs, dialogs | — |
| `--surface-raised` | `#f5f7f4` | Sub-cards, table header, route rows, workspace card | — |
| `--surface-hover` | `#edf1ed` | Interactive hover surface | — |
| `--border` | `#e0e5df` | Hairline structural borders | — |
| `--border-strong` | `#cbd3cb` | Control borders, dialog border | — |
| `--text` | `#202923` | Primary ink (headings, body, values) | `14.8:1` on `#ffffff`, `13.8:1` on `#f5f7f4` (AAA) |
| `--text-muted` | `#4a554e` | Secondary copy, descriptions, table cells | `7.18:1` on `#ffffff`, `6.67:1` on `#f5f7f4` (AAA) |
| `--text-dim` | `#5c6760` | Metadata labels, helper text, table headers | `5.46:1` on `#ffffff`, `5.07:1` on `#f5f7f4` (AA) |
| `--accent` | `#23734d` | Primary buttons, active icon, enabled state, OTP label | `5.75:1` on `#ffffff`, `5.10:1` on `#eaf3ed` (AA) |
| `--accent-soft` | `#eaf3ed` | Active nav background, success feedback background | — |
| `--blue` | `#2b5f8c` | Focus ring, links | `6.70:1` on `#ffffff` (AA) |
| `--blue-soft` | `#edf3f8` | Focus ring halo, link hover | — |
| `--amber` | `#7d5b08` | Unconfigured domain dot, no-OTP notice | `6.14:1` on `#ffffff` (AA) |
| `--amber-soft` | `#f7f3e8` | Domain warning banner background | — |
| `--danger` | `#9e3b3b` | Error text, error notice dot | `6.45:1` on `#ffffff`, `5.65:1` on `#faeeee` (AA) |
| `--danger-soft` | `#faeeee` | Error banner & feedback card background | — |

### 2.2 Typography Scale

- **Sans (`--font-sans`):** `Inter, "Segoe UI", ui-sans-serif, system-ui, -apple-system, sans-serif`
- **Mono (`--font-mono`):** `"JetBrains Mono", Consolas, ui-monospace, SFMono-Regular, monospace` (`font-variant-ligatures: none`)
- **Base Body:** `16px / 1.6` (`html { font-size: 16px; }`)
- **Page Heading (`h1`):** `clamp(27px, 3vw, 34px)`, `line-height: 1.2`, `letter-spacing: -0.035em`
- **Panel Heading (`h2`):** `19px–20px`, `letter-spacing: -0.02em`
- **Controls & Inputs:** `14.5px` (`min-height: 44px–46px`)
- **Table & Route Rows:** `14px` primary, `13px` summary
- **Metadata & Helper Copy:** `12.5px–13.5px` (minimum allowed font size is `12.5px`)
- **OTP Readout (`.otp-value`):** `clamp(26px, 4.5vw, 34px)`, `letter-spacing: 0.08em`, `.tabular` (`font-variant-numeric: tabular-nums`)

### 2.3 Layout, Radii & Motion

- **Desktop (`> 1120px`):** `268px` sticky sidebar + fluid `1fr` main column (`max-width: 1320px`).
- **Tablet (`721px–1120px`):** `230px` sidebar + single-column `.content-grid`.
- **Mobile (`<= 720px`):** Top horizontal scrollable nav bar (`min-height: 42px` items), compact topbar with icon-only refresh button, stacked form controls.
- **Radii:** `--radius-sm: 7px` (controls/inputs), `--radius-md: 10px` (sub-cards/notices), `--radius-lg: 12px` (panels/dialog).
- **Motion:** Explicit property transitions only (`background-color`, `border-color`, `color`, `box-shadow`, `transform`, `opacity` at `120ms–150ms ease-out`). `transition: all` is forbidden. Full `@media (prefers-reduced-motion: reduce)` support.
