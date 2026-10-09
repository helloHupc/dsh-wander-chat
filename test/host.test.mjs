/**
 * Host-half tests for `dsh-wander-chat`.
 *
 * These exercise the route directly against a mock Cordis context and a mock
 * Workspace registry, so they need neither a running DSH nor a real profile.
 * Every filesystem effect happens under one `mkdtemp` sandbox that is removed
 * at the end, so the suite never touches the user's home directory.
 *
 * Run with `npm test` (`node --test test/`).
 */

import { after, before, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { Config, apply, inject, name } from '../index.js'

/** One sandbox root for the whole suite. */
let sandbox

before(async () => {
  sandbox = await mkdtemp(join(tmpdir(), 'dsh-wander-chat-test-'))
})

after(async () => {
  await rm(sandbox, { recursive: true, force: true })
})

/**
 * Build a mock Workspace entity that behaves like the real one in the one way
 * this route depends on: `setTitle` swaps the record, so `title` reflects the
 * write afterwards (`@deepseek-ai/dsh-workspace` `WorkspaceEntity.mutate` does
 * `this.record = next`). A mock that only recorded the call would let a real
 * regression in the route's re-read pass unnoticed.
 *
 * @param id - workspace id to report.
 * @param path - workspace path to report.
 * @param title - initial display title.
 * @param calls - recorder for the title writes.
 * @returns the fake entity.
 */
function fakeWorkspace(id, path, title, calls) {
  const entity = {
    id,
    path,
    title,
    setTitle: async (next) => {
      calls.setTitle.push(next)
      entity.title = next
    },
  }
  return entity
}

/**
 * Build a mock Host context and apply the plugin to it.
 *
 * @param options - overrides for the mock services.
 * @returns the captured route handler, the registration labels, and the mock registry's calls.
 */
function mount(options = {}) {
  const calls = { create: [], setTitle: [] }
  let handler
  const labels = []

  const workspaceRegistry = options.workspaceRegistry ?? {
    create: async (path, title) => {
      calls.create.push({ path, title })
      return fakeWorkspace('ws-test', path, title, calls)
    },
  }

  const ctx = {
    get: (key) => (key === 'webRuntime' ? { trustedHosts: options.trustedHosts ?? [] } : undefined),
    effect: (fn, label) => {
      labels.push(label)
      return fn()
    },
    webServer: {
      register: (route) => {
        labels.push(`${route.kind}:${route.path}`)
        handler = route.handler
        return () => {}
      },
    },
    workspaceRegistry,
  }

  apply(ctx, Config(options.config ?? {}))
  assert.equal(typeof handler, 'function', 'apply must register a route handler')
  return { handler, labels, calls }
}

/**
 * Invoke a captured handler with one synthetic request.
 *
 * @param handler - the route handler.
 * @param overrides - request fields to override.
 * @returns the status and parsed JSON body.
 */
async function request(handler, overrides = {}) {
  const { method = 'GET', headers = {}, ...rest } = overrides
  return await new Promise((resolve) => {
    const res = {
      status: 0,
      writeHead(status) {
        this.status = status
      },
      end(body) {
        resolve({ status: this.status, body: JSON.parse(body) })
      },
    }
    handler(
      {
        method,
        url: '/dsh-wander-chat',
        headers: { host: '127.0.0.1:19387', ...headers },
        ...rest,
      },
      res,
    )
  })
}

describe('module shape', () => {
  it('exports the Loader row identity and its hard dependencies', () => {
    assert.equal(name, 'dsh-wander-chat')
    assert.deepEqual(inject, ['webServer', 'workspaceRegistry'])
  })

  it('declares both settings fields with defaults', () => {
    const resolved = Config({})
    assert.equal(resolved.root.get(), '~/.dsh/wander-chat')
    assert.equal(resolved.title.get(), '漫游会话')
  })
})

describe('ensure route', () => {
  it('registers exactly one prefix route and one effect', () => {
    const { labels } = mount()
    assert.deepEqual(labels, [
      'dsh-wander-chat: /dsh-wander-chat route',
      'prefix:/dsh-wander-chat',
    ])
  })

  it('creates the directory and answers with the canonical path, title, and id', async () => {
    const root = join(sandbox, 'plain')
    const { handler, calls } = mount({ config: { root, title: '漫游会话' } })

    const result = await request(handler)

    assert.equal(result.status, 200)
    assert.equal(result.body.ok, true)
    assert.equal(result.body.path, root)
    assert.equal(result.body.title, '漫游会话')
    assert.equal(result.body.workspaceId, 'ws-test')
    assert.ok((await stat(root)).isDirectory(), 'the root directory must exist')
    assert.deepEqual(calls.create, [{ path: root, title: '漫游会话' }])
  })

  it('creates a missing parent chain, so a nested root works', async () => {
    const root = join(sandbox, 'deep', 'deeper', 'wander-chat')
    const { handler } = mount({ config: { root, title: '漫游会话' } })

    const result = await request(handler)

    assert.equal(result.status, 200)
    assert.ok((await stat(root)).isDirectory())
  })

  it('is idempotent across repeated calls', async () => {
    const root = join(sandbox, 'repeat')
    const { handler, calls } = mount({ config: { root, title: '漫游会话' } })

    const first = await request(handler)
    const second = await request(handler)

    assert.equal(first.status, 200)
    assert.equal(second.status, 200)
    assert.equal(first.body.path, second.body.path)
    assert.equal(calls.create.length, 2, 'each call re-asserts the same registration')
  })

  it('corrects a stale display title on an existing registration', async () => {
    const root = join(sandbox, 'stale')
    const { handler, calls } = mount({
      config: { root, title: '漫游会话' },
      workspaceRegistry: {
        // Simulates a record the startup reconciliation rebuilt, which titles
        // a Workspace after its directory basename instead of the configured name.
        create: async (path) => fakeWorkspace('ws-stale', path, 'wander-chat', calls),
      },
    })

    const result = await request(handler)

    assert.equal(result.status, 200)
    assert.deepEqual(calls.setTitle, ['漫游会话'])
    assert.equal(result.body.title, '漫游会话')
  })

  it('leaves a matching title untouched', async () => {
    const root = join(sandbox, 'matching')
    const { handler, calls } = mount({
      config: { root, title: '漫游会话' },
      workspaceRegistry: {
        create: async (path) => fakeWorkspace('ws-ok', path, '漫游会话', calls),
      },
    })

    await request(handler)

    assert.deepEqual(calls.setTitle, [])
  })

  it('falls back when a config field is blank', async () => {
    const root = join(sandbox, 'blank-title')
    const { handler, calls } = mount({ config: { root, title: '   ' } })

    const result = await request(handler)

    assert.equal(result.status, 200)
    assert.equal(calls.create[0].title, '漫游会话')
  })

  it('refuses a relative root instead of creating it', async () => {
    const { handler, calls } = mount({ config: { root: 'relative/wander', title: '漫游会话' } })

    const result = await request(handler)

    assert.equal(result.status, 500)
    assert.equal(result.body.ok, false)
    assert.equal(result.body.error.code, 'config-error')
    assert.deepEqual(calls.create, [])
  })

  it('reports a registry failure as a wander error', async () => {
    const root = join(sandbox, 'registry-fail')
    const { handler } = mount({
      config: { root, title: '漫游会话' },
      workspaceRegistry: {
        create: async () => {
          throw new Error('registry exploded')
        },
      },
    })

    const result = await request(handler)

    assert.equal(result.status, 500)
    assert.equal(result.body.error.code, 'wander-error')
    assert.match(result.body.error.message, /registry exploded/)
  })
})

describe('request fence', () => {
  it('answers a loopback Host', async () => {
    const { handler } = mount({ config: { root: join(sandbox, 'fence-loopback') } })
    assert.equal((await request(handler)).status, 200)
  })

  it('answers localhost and ::1', async () => {
    const { handler } = mount({ config: { root: join(sandbox, 'fence-names') } })
    assert.equal((await request(handler, { headers: { host: 'localhost:19387' } })).status, 200)
    assert.equal((await request(handler, { headers: { host: '[::1]:19387' } })).status, 200)
  })

  it('rejects a cross-site fetch marker', async () => {
    const { handler } = mount({ config: { root: join(sandbox, 'fence-cross') } })
    const result = await request(handler, { headers: { 'sec-fetch-site': 'cross-site' } })
    assert.equal(result.status, 403)
  })

  it('rejects a non-loopback Host', async () => {
    const { handler } = mount({ config: { root: join(sandbox, 'fence-foreign') } })
    const result = await request(handler, { headers: { host: 'evil.example.com' } })
    assert.equal(result.status, 403)
  })

  it('rejects a mismatched Origin', async () => {
    const { handler } = mount({ config: { root: join(sandbox, 'fence-origin') } })
    const result = await request(handler, {
      headers: { host: '127.0.0.1:19387', origin: 'http://evil.example.com' },
    })
    assert.equal(result.status, 403)
  })

  it('accepts a same-host Origin', async () => {
    const { handler } = mount({ config: { root: join(sandbox, 'fence-origin-ok') } })
    const result = await request(handler, {
      headers: { host: '127.0.0.1:19387', origin: 'http://127.0.0.1:19387' },
    })
    assert.equal(result.status, 200)
  })

  it('rejects a method other than GET', async () => {
    const { handler } = mount({ config: { root: join(sandbox, 'fence-method') } })
    const result = await request(handler, { method: 'POST' })
    assert.equal(result.status, 405)
  })
})
