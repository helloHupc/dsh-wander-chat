/**
 * `dsh-wander-chat` — Host half.
 *
 * Owns exactly one fenced HTTP route on the Web carrier plus the Config schema
 * that backs this plugin's settings page. The route answers with the one
 * directory every roaming Session works in, creating it and its Workspace
 * registration on demand.
 *
 * Nothing here touches the session log, the Agent, the model, or DSH's own
 * session storage. The only durable effect is one directory plus one Workspace
 * record; per-Session isolation is DSH's own job, because the persistence layer
 * already buckets Sessions by cwd and gives each one its own
 * `session-<uuid>/` directory.
 *
 * Why the Workspace is registered here rather than by the Client: the Client's
 * `workspaces.create` accepts only a `path`, so it cannot carry a display
 * title. `workspaceRegistry.create(path, title)` can, which is what lets the
 * directory stay `wander-chat` while the sidebar group reads `漫游会话`.
 *
 * @module dsh-wander-chat
 */

import { mkdir } from 'node:fs/promises'
import { homedir } from 'node:os'
import { isAbsolute, join } from 'node:path'
import z from '@deepseek-ai/schemastery'

/** Plugin identity for the Loader row in `cordis.patch.yml`. */
export const name = 'dsh-wander-chat'

/**
 * Hard dependencies: the Web carrier owns the route, and the Workspace registry
 * is what turns a directory into a sidebar group. A profile without either
 * leaves this plugin inactive instead of throwing.
 */
export const inject = ['webServer', 'workspaceRegistry']

/**
 * The plugin's settings schema. DSH auto-generates a settings page from it
 * (`settings` projects active Config schemas, and its `autoGenerate` defaults
 * to `true`), so this plugin ships no settings UI of its own.
 *
 * Both fields are `volatile()`: the route reads them per request, so a change
 * made in Settings takes effect on the next click without reloading the row.
 */
export const Config = z.object({
  root: z
    .string()
    .default('~/.dsh/wander-chat')
    .description('漫游会话共用的工作目录。支持 ~ 前缀，不存在时会自动创建。')
    .volatile(),
  title: z
    .string()
    .default('漫游会话')
    .description('该工作目录在侧边栏显示的分组名称。')
    .volatile(),
})

/** The one path this plugin owns on the Web carrier. */
const ROUTE_PATH = '/dsh-wander-chat'

/** Applied when Config carries no usable value (a disabled field, a blank edit). */
const FALLBACK_ROOT = '~/.dsh/wander-chat'
const FALLBACK_TITLE = '漫游会话'

/**
 * Expand a leading `~` against the Host user's home directory.
 *
 * Implemented locally rather than imported: a `link:`-installed plugin lives
 * outside the profile, and Node resolves its imports from the symlink's real
 * path, so the profile's `@deepseek-ai/*` packages are not reachable from here.
 * Keeping this dependency-free is what lets the plugin be linked from any
 * checkout.
 *
 * @param input - configured path, possibly starting with `~`, `~/`, or `~\`.
 * @returns an absolute path.
 */
function expandHome(input) {
  if (input === '~') return homedir()
  if (input.startsWith('~/') || input.startsWith('~\\')) return join(homedir(), input.slice(2))
  return input
}

/**
 * Read one Config field as a trimmed string.
 *
 * A `volatile()` field arrives as a live reference (`.get()`); a plain field
 * arrives as the value itself. Both shapes are accepted so a schema edit that
 * drops `volatile()` cannot break the route, and a blank or absent value falls
 * back rather than producing an empty path.
 *
 * @param field - the Config field, in either shape.
 * @param fallback - value to use when the field is absent or blank.
 * @returns the effective string.
 */
function readField(field, fallback) {
  const raw =
    typeof field === 'object' && field !== null && typeof field.get === 'function'
      ? field.get()
      : field
  return typeof raw === 'string' && raw.trim() !== '' ? raw.trim() : fallback
}

/** Parse a bare `host[:port]` authority (a Host header value). */
function authorityOf(value) {
  try {
    return new URL(`http://${value}`)
  } catch {
    return undefined
  }
}

/** Parse a full URL's hostname, or `undefined` when it is not a URL (`null` origins included). */
function hostnameOfUrl(value) {
  try {
    return new URL(value).hostname
  } catch {
    return undefined
  }
}

/** Whether a normalized hostname names this machine's loopback authority. */
function isLoopbackHostname(hostname) {
  if (hostname === 'localhost' || hostname === '[::1]' || hostname === '::1') return true
  const parts = hostname.split('.')
  return (
    parts.length === 4 &&
    parts[0] === '127' &&
    parts.every((part) => /^\d{1,3}$/.test(part) && Number(part) <= 255)
  )
}

/** Whether one request authority matches a configured trusted authority (exact, or port-less). */
function isTrustedAuthority(hostname, host, trustedHosts) {
  return (
    Array.isArray(trustedHosts) &&
    trustedHosts.some((entry) => {
      const entryUrl = authorityOf(entry)
      if (entryUrl === undefined) return false
      return entryUrl.port === '' ? entryUrl.hostname === hostname : entryUrl.host === host
    })
  )
}

/**
 * Whether one request may reach this route.
 *
 * Behaviorally the `/api` gateway's fence: the `Host` must name this machine
 * (loopback, or a `trustedHosts` authority a LAN-exposed deployment declared),
 * browser cross-site markers must be absent, and an attached `Origin` must
 * name the same hostname. This is a DNS-rebinding and cross-site defense, not
 * authentication: the route creates a directory and a Workspace record, so a
 * hostile page must not be able to trigger it cross-origin.
 *
 * @param req - the Node HTTP request (headers are all this reads).
 * @param trustedHosts - authorities the Web runtime serves, when it exposes them.
 * @returns true when the request is same-machine and same-origin.
 */
function requestAllowed(req, trustedHosts) {
  const headers = req.headers ?? {}
  const host = headers.host
  if (typeof host !== 'string' || host === '') return false
  const hostUrl = authorityOf(host)
  if (hostUrl === undefined) return false
  if (
    !isLoopbackHostname(hostUrl.hostname) &&
    !isTrustedAuthority(hostUrl.hostname, hostUrl.host, trustedHosts)
  ) {
    return false
  }
  if (headers['sec-fetch-site'] === 'cross-site') return false
  const origin = headers.origin
  if (typeof origin !== 'string' || origin === '') return true
  // The port must not re-decide trust: the Host fence above already bound the
  // authority, and some Chromium builds drop the port from a loopback Origin.
  return hostnameOfUrl(origin) === hostUrl.hostname
}

/**
 * Write one JSON response. The answer is a per-request fact about the local
 * filesystem, so nothing here is cacheable.
 * @param res - the Node HTTP response.
 * @param status - HTTP status code.
 * @param body - JSON-serializable body.
 */
function sendJson(res, status, body) {
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  })
  res.end(JSON.stringify(body))
}

/** Render an unknown thrown value as a message. */
function messageOf(error) {
  return error instanceof Error ? error.message : String(error)
}

/**
 * Register the route for the lifetime of this plugin's fiber.
 *
 * The route is the whole Host half. It is idempotent: every call re-asserts the
 * same directory and the same Workspace registration, so repeated clicks and
 * repeated app starts converge on one group rather than accumulating records.
 *
 * @param ctx - Host plugin context carrying `webServer` and `workspaceRegistry`.
 * @param config - resolved Config (volatile fields arrive as live references).
 */
export function apply(ctx, config) {
  /**
   * GET only: the Client asks once per click, and a read-mostly probe has no
   * other method to offer.
   */
  const handler = async (req, res) => {
    // Read per request: a replaced Web runtime carries a different trust list.
    const trustedHosts = ctx.get('webRuntime')?.trustedHosts
    if (!requestAllowed(req, trustedHosts)) {
      sendJson(res, 403, { ok: false, error: { code: 'forbidden', message: 'forbidden' } })
      return
    }
    if (req.method !== 'GET') {
      sendJson(res, 405, { ok: false, error: { code: 'method-error', message: 'method not allowed' } })
      return
    }

    const root = expandHome(readField(config?.root, FALLBACK_ROOT))
    if (!isAbsolute(root)) {
      sendJson(res, 500, {
        ok: false,
        error: {
          code: 'config-error',
          message: `wander root is not an absolute path: '${root}'`,
        },
      })
      return
    }
    const title = readField(config?.title, FALLBACK_TITLE)

    try {
      // The registry refuses a path that is not an existing directory, so the
      // directory comes first. `recursive` also covers a missing parent (for a
      // root such as `~/DSH/漫游会话`) and stays silent when it already exists.
      await mkdir(root, { recursive: true })

      const workspace = await ctx.workspaceRegistry.create(root, title)
      // `create` uses the title only when it writes a new record. A record that
      // already exists — including one the startup reconciliation rebuilt from
      // session headers, which titles it after the directory basename — would
      // otherwise keep the stale label.
      if (workspace.title !== title) await workspace.setTitle(title)

      sendJson(res, 200, {
        ok: true,
        // `workspace.path` is the canonical spelling; the Client registers the
        // Workspace with this exact string so both sides agree on identity.
        path: workspace.path,
        title: workspace.title,
        workspaceId: workspace.id,
      })
    } catch (error) {
      sendJson(res, 500, {
        ok: false,
        error: { code: 'wander-error', message: messageOf(error) },
      })
    }
  }

  ctx.effect(
    () => ctx.webServer.register({ kind: 'prefix', path: ROUTE_PATH, handler }),
    'dsh-wander-chat: /dsh-wander-chat route',
  )
}
