/**
 * `dsh-wander-chat` — Client half.
 *
 * Registers two slots that work as a pair, which is the only correct way to
 * occupy `sidebar.panellist`:
 *
 *   `sidebar.panellist` (id `wander-chat`) — the row that renders in the
 *   sidebar's global-panel nav, directly under the New Session button. The
 *   sidebar takes only this registration's `id`/`order`/`label` and draws a
 *   navigation row; the component supplies the glyph alone.
 *
 *   `main` (key `wander-chat`) — the central panel that row selects. The
 *   layout dispatches `main` by `activePanelId`, which the row sets through
 *   `selectPanel(id)`, and `selectPanel` throws when no panel claims the id.
 *   Registering the pair is therefore not a trick: it is the contract. It also
 *   makes mouse and keyboard activation behave identically, which an event
 *   handler on the glyph could not.
 *
 * The panel is a launcher rather than a destination. Mounting it asks the Host
 * to ensure the roaming directory and its Workspace, then starts a Session in
 * that Workspace and lets the shell navigate to the Conversation. A failure
 * stays on the panel with the reason and a retry, instead of failing silently.
 *
 * This file is the browser artifact: a classic script that only registers a
 * lazy factory, so it stays side-effect free until the module is materialized.
 * The module id must equal the package name, which is how the shell's module
 * system addresses the row. React comes from the browser module table.
 *
 * Plain React and theme tokens only: no Harness Client package is imported,
 * because those change without notice and a throwing component would blank
 * these slot entries. The one Host dependency is this package's own route.
 */
window.__ModuleLoader__.load({
  id: 'dsh-wander-chat',
  factory(require) {
    const React = require('react')
    const h = React.createElement

    /**
     * The shared settings-form primitives. `@deepseek-ai/dsh-client-ui-primitives`
     * is a documented baseline external of the browser module table, so a
     * Module Loader package resolves it through `require` rather than bundling a
     * copy. Guarded on purpose: this module is loaded for the sidebar entry
     * first, and a missing primitive must cost the settings page only, never
     * the button.
     */
    let primitives = null
    try {
      primitives = require('@deepseek-ai/dsh-client-ui-primitives')
    } catch {
      primitives = null
    }

    /** Locale namespace owned by this plugin. */
    const NS = 'dsh-wander-chat'
    /**
     * The sidebar row's id, which is also the `main` panel's key. These two
     * must stay equal: `selectPanel` looks up a panel by the row's id.
     */
    const ENTRY_ID = 'wander-chat'
    /** Host route registered by this package's Host half (`index.js`). */
    const ROUTE = '/dsh-wander-chat'
    /**
     * Place among the global-panel rows, ascending. The shipped rows use `0`
     * (Plugins) and `10` (Schedules), so a negative order puts this row first —
     * immediately below the New Session button.
     */
    const ORDER = -10
    /** Style tag owned by this plugin, removed when the plugin unloads. */
    const STYLE_ID = 'dsh-wander-chat-style'
    /** This bundle's own package name, which is the `plugins.bundle.config` key. */
    const BUNDLE_NAME = 'dsh-wander-chat'
    /**
     * Namespaces this page may have to edit. The Host's settings namespace for a
     * row is its loader entry id, and how that id is spelled depends on the
     * composition: rows inserted by a bundle's own patch carry the patch id,
     * while rows inside an `include` group carry the `include:`-prefixed id.
     * Both spellings are offered and the served one is used, so the page works
     * under either composition instead of silently editing nothing.
     */
    const SETTINGS_NS_CANDIDATES = ['dsh-wander-chat', 'include:dsh-wander-chat']

    /** This plugin's own visible text, keyed by locale. */
    const DICTIONARIES = {
      en: {
        entry: 'New roaming session',
        entryAria: 'Create a session in the roaming workspace',
        working: 'Creating a roaming session…',
        done: 'Roaming session created',
        doneHint: 'The session is open under the roaming group in the sidebar.',
        failed: 'Could not create the roaming session',
        retry: 'Retry',
        hint: 'The session opens in one shared roaming workspace, so no local folder has to be picked.',
        settingsSummary: 'The directory every roaming session works in, and the label its sidebar group shows.',
        settingsRoot: 'Roaming directory',
        settingsRootHint:
          'Every roaming session uses this directory as its working directory. A leading ~ is expanded. It is created on demand.',
        settingsTitle: 'Group label',
        settingsTitleHint: 'The name this directory shows as in the sidebar session list.',
        overridden: 'Overridden',
        reset: 'Reset',
        invalid: 'Invalid',
        save: 'Save',
        saving: 'Saving…',
        saveFailed: 'Could not save. Check the values and try again.',
        readOnly: 'This deployment does not store settings changes.',
        unavailable: 'This configuration is not being served right now.',
      },
      zh: {
        entry: '新建漫游会话',
        entryAria: '在漫游工作区中创建会话',
        working: '正在创建漫游会话…',
        done: '漫游会话已创建',
        doneHint: '会话已在侧边栏的漫游分组中打开。',
        failed: '创建漫游会话失败',
        retry: '重试',
        hint: '会话将在一个共享的漫游工作区中打开，无需选择本地目录。',
        settingsSummary: '所有漫游会话共用的工作目录，以及它在侧边栏显示的分组名称。',
        settingsRoot: '漫游目录',
        settingsRootHint: '所有漫游会话都以该目录作为工作目录。支持 ~ 前缀，不存在时会自动创建。',
        settingsTitle: '分组名称',
        settingsTitleHint: '该目录在侧边栏会话列表中显示的名称。',
        overridden: '已覆盖',
        reset: '重置',
        invalid: '无效',
        save: '保存',
        saving: '保存中…',
        saveFailed: '保存失败，请检查填写内容后重试。',
        readOnly: '当前部署不会保存设置更改。',
        unavailable: '该配置当前未被提供。',
      },
    }

    /**
     * The launcher panel's own surface. No color is literal, so light and dark
     * themes both inherit correctly, and every token used here is one the theme
     * registry documents. Radius tokens fall back to literals because the
     * registry does not expose them.
     */
    const CSS = [
      '.dsh-wander-chat-panel{box-sizing:border-box;display:flex;flex-direction:column;align-items:center;',
      'justify-content:center;gap:10px;height:100%;min-height:240px;padding:32px 24px;text-align:center}',
      '.dsh-wander-chat-title{color:var(--dsw-alias-label-primary);font-size:14px;font-weight:500;line-height:22px}',
      '.dsh-wander-chat-detail{color:var(--dsw-alias-label-secondary);font-size:13px;line-height:20px;',
      'max-width:520px;overflow-wrap:anywhere}',
      '.dsh-wander-chat-error{color:var(--dsw-alias-state-error-primary);font-size:12px;line-height:18px;',
      'max-width:520px;overflow-wrap:anywhere;font-family:var(--ds-font-family-code,monospace)}',
      '.dsh-wander-chat-retry{box-sizing:border-box;border:.5px solid var(--dsw-alias-border-l1);',
      'border-radius:var(--dsw-radius-md,8px);background:var(--dsw-alias-bg-layer-1);',
      'color:var(--dsw-alias-label-primary);cursor:pointer;height:32px;padding:0 14px;',
      'font-size:13px;font-weight:500;line-height:20px}',
      '.dsh-wander-chat-retry:hover{background:var(--dsw-alias-interactive-bg-hover)}',
      '.dsh-wander-chat-retry:focus-visible{outline:var(--dsw-focus-ring-width,2px) solid ',
      'var(--dsw-focus-ring-color,var(--dsw-alias-brand-primary));outline-offset:-2px}',
    ].join('')

    /**
     * The row glyph: a compass, so it reads as "roam" rather than repeating the
     * neighbouring New Session chat icon. Drawn in `currentColor` so it follows
     * the row's own color through hover, selection, and both themes. The
     * viewBox is 16 so any `size` the sidebar passes scales cleanly.
     *
     * The sidebar renders this inside its own navigation button, so it must not
     * carry its own click handling — the button owns activation.
     *
     * @param props - the slot's props for `sidebar.panellist` (`size`, `active`).
     */
    function WanderIcon(props) {
      const size = typeof props?.size === 'number' ? props.size : 16
      return h(
        'svg',
        {
          viewBox: '0 0 16 16',
          width: size,
          height: size,
          fill: 'none',
          'aria-hidden': true,
          focusable: false,
        },
        h('circle', { cx: 8, cy: 8, r: 6.1, stroke: 'currentColor', strokeWidth: 1.4 }),
        h('path', { d: 'M10.4 5.6 9.1 9.1 5.6 10.4 6.9 6.9Z', fill: 'currentColor' }),
      )
    }

    return {
      /**
       * `slots` owns the registrations and `locale` carries the row label and
       * the panel copy. The workspace services are read optionally at call time
       * instead of being injected, so a profile that lacks them still activates
       * this plugin and reports the problem on the panel.
       */
      inject: ['slots', 'locale'],

      /**
       * Install the styles, the dictionaries, and the two slot registrations.
       * Every one is an effect on this fiber, so plugin unload and HMR
       * re-activation remove and reinstall them cleanly.
       * @param ctx - Client plugin context (`slots`, `locale`).
       */
      apply(ctx) {
        ctx.effect(() => {
          const previous = document.getElementById(STYLE_ID)
          if (previous !== null) previous.remove()
          const style = document.createElement('style')
          style.id = STYLE_ID
          style.textContent = CSS
          document.head.appendChild(style)
          return () => {
            style.remove()
          }
        }, 'dsh-wander-chat: styles')

        ctx.effect(() => {
          const disposers = Object.entries(DICTIONARIES).map(([locale, dict]) =>
            ctx.locale.register(NS, locale, dict),
          )
          return () => {
            for (const dispose of disposers) dispose()
          }
        }, 'dsh-wander-chat: dictionaries')

        /**
         * Read the active locale id without trusting the snapshot's shape.
         * @returns the locale id, or undefined when the service is unavailable.
         */
        function activeLocale() {
          try {
            return ctx.locale.getLocale()?.active
          } catch {
            return undefined
          }
        }

        /**
         * Resolve one key now. Used for the row label, which the sidebar asks
         * for again on every locale change, so binding per call is what lets a
         * live language switch reach the row.
         * @param key - key in this plugin's namespace.
         * @returns the localized text.
         */
        function translateNow(key) {
          try {
            return ctx.locale.bind(NS)(key)
          } catch {
            // The namespace or the locale service is unavailable. Read this
            // plugin's own dictionary rather than showing a raw key in the
            // sidebar; English is the neutral fallback, matching the locale
            // service's own `resolveText` convention.
            const dict = DICTIONARIES[activeLocale()] ?? DICTIONARIES.en
            return dict[key] ?? key
          }
        }

        /**
         * This plugin's translator for components, re-created when the active
         * locale changes. A locale failure degrades to this plugin's own
         * dictionary: it must never blank the panel.
         * @returns a translate function bound to this plugin's namespace.
         */
        function useTranslate() {
          const [locale, setLocale] = React.useState(() => ctx.locale.getLocale())
          React.useEffect(() => ctx.locale.subscribe(() => setLocale(ctx.locale.getLocale())), [])
          return React.useMemo(() => {
            try {
              return ctx.locale.bind(NS)
            } catch {
              const dict = DICTIONARIES[activeLocale()] ?? DICTIONARIES.en
              return (key) => dict[key] ?? key
            }
          }, [locale])
        }

        /**
         * The launcher panel.
         *
         * Runs once per mount. A successful start navigates the shell to the
         * new Conversation, which unmounts this panel; a failure keeps it, with
         * the Host's own message and a retry. The in-flight request is aborted
         * on unmount and before a retry, so a superseded attempt can never
         * write state or open a Session.
         */
        function WanderLauncher() {
          const t = useTranslate()
          const [phase, setPhase] = React.useState('working')
          const [detail, setDetail] = React.useState('')
          const controllerRef = React.useRef(null)

          const run = React.useCallback(() => {
            controllerRef.current?.abort()
            const controller = new AbortController()
            controllerRef.current = controller

            setPhase('working')
            setDetail('')

            const uiWorkspace = ctx.get('uiWorkspace')
            const workspaces = ctx.get('workspaces')

            const start = async () => {
              if (uiWorkspace === undefined || workspaces === undefined) {
                throw new Error('workspace services are unavailable in this profile')
              }

              const response = await fetch(ROUTE, {
                signal: controller.signal,
                headers: { accept: 'application/json' },
              })
              if (!response.ok) throw new Error(`ensure failed with HTTP ${response.status}`)

              const body = await response.json()
              if (body === null || typeof body !== 'object' || body.ok !== true) {
                const message = body?.error?.message
                throw new Error(typeof message === 'string' && message !== '' ? message : 'ensure failed')
              }

              // The Host already registered the Workspace, but the Client's own
              // projection is fed by the Host's follow stream. This call is
              // idempotent by canonical path, so it both closes that race —
              // `startSession` refuses a Workspace the projection has not seen —
              // and brings the custom display title into the projection.
              const workspace = await workspaces.create({ path: body.path })
              uiWorkspace.startSession(workspace.workspaceId)
            }

            start()
              .then(() => {
                if (!controller.signal.aborted) setPhase('done')
              })
              .catch((error) => {
                if (controller.signal.aborted) return
                setPhase('error')
                setDetail(error instanceof Error ? error.message : String(error))
              })
          }, [])

          React.useEffect(() => {
            run()
            return () => controllerRef.current?.abort()
          }, [run])

          if (phase === 'error') {
            return h(
              'div',
              { className: 'dsh-wander-chat-panel' },
              h('div', { className: 'dsh-wander-chat-title' }, t('failed')),
              h('div', { className: 'dsh-wander-chat-error' }, detail),
              h(
                'button',
                { type: 'button', className: 'dsh-wander-chat-retry', onClick: () => run() },
                t('retry'),
              ),
            )
          }

          if (phase === 'done') {
            return h(
              'div',
              { className: 'dsh-wander-chat-panel' },
              h('div', { className: 'dsh-wander-chat-title' }, t('done')),
              h('div', { className: 'dsh-wander-chat-detail' }, t('doneHint')),
            )
          }

          return h(
            'div',
            { className: 'dsh-wander-chat-panel' },
            h('div', { className: 'dsh-wander-chat-title' }, t('working')),
            h('div', { className: 'dsh-wander-chat-detail' }, t('hint')),
          )
        }

        /**
         * This plugin's configuration page, shown on its own row on the Plugins
         * page. It edits the two fields the Host Config schema declares, using
         * the shared form primitives for staging, validation, and the save.
         *
         * The owner asks twice: `view: 'summary'` supplies the row's one-liner,
         * and `view: 'page'` is the page itself. Only a save writes, so leaving
         * the page drops every staged edit.
         */
        function WanderConfigCard(props) {
          const t = useTranslate()
          // These capabilities are static per slot, so the hook order is
          // stable; the fallbacks only keep a mis-declared slot from throwing.
          const useConfig = typeof props.useWanderConfig === 'function' ? props.useWanderConfig : () => undefined
          const state = useConfig((snapshot) => snapshot)

          if (props.view === 'summary') return t('settingsSummary')
          if (state === undefined) return null

          const disabled = !state.writable
          const labels = {
            save: t('save'),
            saving: t('saving'),
            saveFailed: t('saveFailed'),
            readOnly: t('readOnly'),
            unavailable: t('unavailable'),
          }
          const fieldLabels = {
            overriddenLabel: t('overridden'),
            resetLabel: t('reset'),
            invalidLabel: t('invalid'),
            disabled,
          }

          return h(
            primitives.SettingsForm,
            { labels, state, onSave: props.save, onDiscard: props.discard },
            h(primitives.SettingsValueField, {
              id: 'dsh-wander-chat-root',
              label: t('settingsRoot'),
              hint: t('settingsRootHint'),
              ...fieldLabels,
              ...state.root,
              onEdit: (text) => props.edit('root', text),
              onReset: () => props.resetField('root'),
            }),
            h(primitives.SettingsValueField, {
              id: 'dsh-wander-chat-title',
              label: t('settingsTitle'),
              hint: t('settingsTitleHint'),
              ...fieldLabels,
              ...state.title,
              onEdit: (text) => props.edit('title', text),
              onReset: () => props.resetField('title'),
            }),
          )
        }

        // The sidebar row. `slots.inject` waits for the declaration, which is
        // what lets this bundle activate before the sidebar that owns the slot.
        ctx.slots.inject('sidebar.panellist', () =>
          ctx.slots.register(
            {
              name: 'sidebar.panellist',
              id: ENTRY_ID,
              order: ORDER,
              locale: NS,
              label: () => translateNow('entry'),
            },
            WanderIcon,
          ),
        )

        // The panel that row selects. Its key must equal the row's id, or
        // `selectPanel` throws and the row does nothing.
        ctx.slots.inject('main', () =>
          ctx.slots.register(
            {
              name: 'main',
              key: ENTRY_ID,
              locale: NS,
            },
            WanderLauncher,
          ),
        )

        // This plugin's configuration form, registered onto the bundle's own
        // page on the Plugins page. A Config schema alone draws nothing: DSH
        // publishes `autoGenerate` but no client code consumes it, so the page
        // has to be contributed here.
        const configForms = ctx.get('configForms')
        if (configForms !== undefined && primitives !== null) {
          ctx.effect(
            () =>
              configForms.whileServed(SETTINGS_NS_CANDIDATES, (served) => {
                const namespace = SETTINGS_NS_CANDIDATES.find((candidate) => served.has(candidate))
                if (namespace === undefined) return () => {}

                const scope = configForms.get(namespace)
                const model = new primitives.SettingsFormModel(scope, [
                  primitives.settingsTextField('root'),
                  primitives.settingsTextField('title'),
                ])
                const store = model.bind(() => ({
                  ...model.shell(),
                  root: model.field('root'),
                  title: model.field('title'),
                }))
                const inject = () => ({ hooks: { wanderConfig: store }, ...model.actions() })

                // The bundle's own page, which is where the plugin list leads.
                // The form is that page's own content, so there is no entry to
                // discover and no second surface repeating the same fields.
                const off = ctx.slots.inject('plugins.bundle.config', () =>
                  ctx.slots.register(
                    { name: 'plugins.bundle.config', key: BUNDLE_NAME, locale: NS, inject },
                    WanderConfigCard,
                  ),
                )

                return () => {
                  off()
                  model.dispose()
                }
              }),
            'dsh-wander-chat: settings page',
          )
        }
      },
    }
  },
})
