# Changelog

Notable changes to this project. It follows [Semantic Versioning](https://semver.org/).

## 0.1.0 — 2026-10-09

Initial release.

- A **New roaming session** row in the sidebar, directly under New Session
  (`sidebar.panellist`, order `-10`), paired with its own `main` panel.
- One click starts a Session without any directory picking, because the Workspace is passed
  explicitly to `uiWorkspace.startSession` — the same call the shipped New Session button
  makes with no argument.
- Every roaming Session lands in one fixed Workspace, so the sidebar shows a single group
  instead of one group per Session. Per-Session isolation is left to DSH, which already
  buckets Session storage by cwd and gives each Session its own `session-<uuid>/` directory.
- Host half: one fenced route (`/dsh-wander-chat`) that creates the directory and re-asserts
  the Workspace registration, plus a Schemastery `Config` schema.
- Configuration form rendered directly on the plugin's own page under Settings → Plugins
  (`plugins.bundle.config`), with no separate entry to discover.
- Both settings are live: the route reads them per request, so a saved change applies to the
  next click without reloading the plugin.
- No build step, no runtime dependency beyond `@deepseek-ai/schemastery`.
- 18 host-half checks in `test/host.test.mjs`.
