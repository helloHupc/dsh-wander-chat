# dsh-wander-chat

[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![DSH plugin](https://img.shields.io/badge/DSH-plugin-4c8dff.svg)](#install)

[中文](README.md) | English

A [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) (DSH) plugin that adds a
**New roaming session** row to the sidebar, directly under **New Session**. One click starts a
Session **without picking a local folder**.

Every roaming Session is grouped under one fixed Workspace (labelled **漫游会话** by default,
directory `~/.dsh/wander-chat`). Both the directory and the group label are configurable.

## What it does

- A **New roaming session** row in the sidebar, right below New Session
- One click creates the Session and navigates to it — **no directory picker**
- All roaming Sessions land in the same sidebar group instead of scattering into many Workspaces
- Each Session's own content still lives in DSH's official per-Session directory,
  `~/.dsh/sessions/--<encoded-directory>--/session-<uuid>/`

## Install

```bash
cd ~/.dsh/profiles/desktop
# add to package.json dependencies:
#   "dsh-wander-chat": "link:/path/to/dsh-wander-chat"
# add to dsh.profile.bundles:
#   "dsh-wander-chat"
pnpm install
```

Then restart DSH or reload the profile.

## Configuration

**Settings → Plugins → 漫游会话**

The form renders **directly on the plugin's own page** (below its description, above its rows),
so opening the plugin is all it takes — there is no separate entry to discover.

| Field | Default | Meaning |
| --- | --- | --- |
| `root` | `~/.dsh/wander-chat` | The working directory every roaming Session shares. A leading `~` is expanded; the directory is created on demand. |
| `title` | `漫游会话` | The name this directory shows as in the sidebar session list. |

You can also set them in the profile's `cordis.patch.yml`:

```yaml
- id: dsh-wander-chat
  config:
    root: '~/.dsh/wander-chat'
    title: '漫游会话'
```

### How the settings page is wired

DSH's `settings` service publishes an `autoGenerate` flag for any plugin carrying a Config
schema, but it does **not** generate UI from it — the page has to be contributed by the client
half. This plugin:

1. Declares a Schemastery `Config` on the Host half (the fields above).
2. Registers `plugins.bundle.config` (keyed by the package name `dsh-wander-chat`) from the
   client half, which places the form on the plugin's own page.
3. Builds the form from `@deepseek-ai/dsh-client-ui-primitives`
   (`SettingsFormModel` / `SettingsForm` / `SettingsValueField`), reading and writing the Host
   configuration through `ctx.configForms`.

Only **Save** writes; leaving the page discards unsaved edits.

Registering that one slot is deliberate: `plugins.row.config` would add a second `›` configure
entry on the plugin row, and since the page already shows the same form, a duplicate entry only
makes people wonder which one to click.

## How it works

```
click "New roaming session"
  → the main panel for key `wander-chat` mounts
  → GET /dsh-wander-chat             Host: mkdir -p + workspaceRegistry.create(path, title)
  → ctx.workspaces.create({ path })  Client: idempotent, syncs the Workspace into its projection
  → ctx.uiWorkspace.startSession(workspaceId)
```

`startSession(workspaceId)` is the very call the shipped New Session button makes — with no
argument. Passing the Workspace explicitly is what removes the directory picker.

**Footprint**: one directory, one Workspace registration, one read-only route. It touches no
Session storage, no Session format, no Agent loop, and none of the Workspace membership rules.

## Why each Session does not get its own cwd directory

DSH requires a Session's `cwd` to be **exactly equal** to the Workspace path
(`@deepseek-ai/dsh-workspace`'s `attachSession` validates it, and startup reconciles stored
Sessions by cwd, creating a Workspace per distinct cwd). Making each Session's cwd
`wander-chat/<uuid>` would therefore give DSH one Workspace per UUID — the sidebar would
scatter into N groups, the opposite of the goal.

The underlying need — a directory per Session — is already provided natively by DSH's storage
layer, as the `~/.dsh/sessions/` layout above shows. So the plugin needs exactly one fixed
Workspace and lets DSH do the rest.

## Caveat

A `link:`-installed plugin lives outside the profile, and Node resolves its imports from the
symlink's real path, so it **cannot** reach the profile's `@deepseek-ai/*` packages. This plugin
works around that by:

- expanding `~` itself (with `node:os` only), instead of depending on `@deepseek-ai/dsh-home-paths`
- depending on `@deepseek-ai/schemastery` (needed for the Config schema) **only** on the Host
  half, installed as a local dependency

## Development

No build step: `client.js` is a hand-written browser bundle that registers one lazy factory.

Client-side changes need the Web artifacts rebuilt and the page refreshed; they hot-reload
without a refresh only while `pnpm run dev:web` is running.

```bash
npm test    # host-half checks (18 of them, all under a temp directory — your home is untouched)
```

The design rationale and the research behind it — including the approaches that were ruled out
and the exact DSH source locations of the constraints — are recorded in
[DESIGN.md](DESIGN.md) (Chinese).

## License

MIT
