# Temp mail interface

Reference pages inspected on 2026-11-07:
- https://temp-mail.org/en/ — prominent address, Copy / Refresh / Change controls, sender / subject inbox, empty state.
- https://temp-mail.io/en — compact header, address above inbox, inline controls, message reader.

The interface follows this task order: copy address, change address if needed, receive the latest email directly, copy verification code if present. Multiple messages have a compact selector above the content.

The previous overview, routing table, and manual latest-message lookup are replaced by one mailbox page. Connection settings live in a dialog. Address state is persisted in URL and browser storage. HTML mail is sanitized and isolated; text mail is displayed directly.

Sample mode has been removed from the delivered app. Old preview links open the actual remembered mailbox. SQLite Durable Objects provide authoritative incoming-mail storage; KV is used only to import unexpired legacy mail once.

Frontend configuration: public/assets/mailbox-config.js.
Regression coverage: tests/frontend.test.mjs, tests/repository.test.mjs, tests/mailbox-e2e.py.
