# Dashboard UI Specification (`public/index.html`)

## Product and Interaction Model

- Operator console for a single Cloudflare Email Worker (`worker-mail`).
- Reads live configuration from `GET /api/console` and queries the latest stored message per recipient via `GET /api/mail/latest?to=<email>`.
- Three focused views switched via `[data-view]`:
  1. **Tổng quan (`#view-overview`):** Shows active route summary (`#route-preview-list`), capability status (`#notifications-status`, `#lookup-status`), and conditional warning/error notices (`#domain-notice`, `#api-notice`).
  2. **Luồng email (`#view-routes`):** Read-only table of routes defined in [`src/config/routes.ts`](file:///d:/Coding/worker-mail/src/config/routes.ts) (`#route-table-body`) plus copyable sample recipient addresses (`#addresses-list`).
  3. **Tra cứu email (`#view-lookup`):** Explicit recipient lookup form (`#lookup-form`), live status feedback (`#lookup-feedback`), and latest email inspector (`#email-result`) with one-click OTP copy (`#copy-otp`) and sanitized `http:`/`https:` activation links (`#result-links`).
- Session-scoped bearer token modal (`#api-dialog`) stores `API_AUTH_TOKEN` in `sessionStorage` (`worker-mail-api-token`) for the active tab only.

## Anti-Slop Guardrails

- No fabricated metrics, fake sparklines, or simulated inbox polling.
- No `innerHTML` with untrusted data; all dynamic DOM nodes are built with `document.createElement` and `textContent`.
- No dark-mode neon glows, gradients, or low-contrast muted text; all text tokens meet WCAG AA (`>= 4.5:1`) on both `--surface` (`#ffffff`) and `--surface-raised` (`#f5f7f4`).
