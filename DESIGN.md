# dsh-wander-chat 插件设计方案

> 状态：设计定稿，尚未实现
> 目标 DSH 版本：`0.2.0-rc.2-5e9e301`（本机 desktop profile）

---

## 1. 目标

1. 在 DSH 客户端侧边栏「新会话」按钮**正下方**新增一行按钮，名称为「新建漫游会话」。
2. 点击后**直接创建会话，完全不弹出本地目录选择器**。
3. 所有漫游会话在侧边栏归入同一个固定工作区分组，分组显示名为「漫游会话」。
4. 该工作区的实际目录可配置，默认 `~/.dsh/wander-chat`。目录对用户基本隐形，但真实存在于本地。
5. 对 DSH 官方的侵入降到最低。

---

## 2. 可行性结论

**可以实现。** 所需能力全部是 DSH 官方现成的，插件不需要自己实现会话创建、会话存储或工作区归属逻辑。

### 2.1 三个官方 API 就够

| 步骤 | API | 签名 | 关键性质 |
| --- | --- | --- | --- |
| 保证目录存在 | Host 半边 `node:fs` | `mkdir(path, { recursive: true })` | 幂等，不抛 EEXIST |
| 注册工作区 | 客户端 `workspaces.create` | `create(input: { path: string }): Promise<WorkspaceView>` | **按 canonical path 幂等**；返回后立即 upsert 进客户端投影 |
| 开会话 | 客户端 `uiWorkspace.startSession` | `startSession(workspaceId?: WorkspaceId): void` | 指定工作区建空白会话并跳转，**不弹选择器** |

`startSession(workspaceId)` 正是侧边栏「新会话」按钮自己调用的那个 API（`@deepseek-ai/dsh-client-ui-sidebar` `lib/client.js:359-361` 调用的是无参形式），只是我们显式传入工作区 id。

### 2.2 DSH 原生已经提供「每会话独立目录」

`~/.dsh/sessions/` 的真实布局：

```
~/.dsh/sessions/--Users-hupc-AgentTest-dsh-git-branch--/
    session-4a3bc471-33e8-4046-97a2-3b5ba7dc3389/
        session.lock
        session.v4.jsonl.zstd
```

DSH 把会话按 **cwd 编码成桶目录名**，每个会话在自己的 `session-<uuid>/` 子目录里存日志。也就是说：

- 同一 cwd 的会话自动归入同一个桶 → 恰好是我们要的「统一到一个目录下」
- 每个会话自动获得独立的 UUID 目录 → 恰好是「每会话一个目录」的诉求

**结论：插件零存储代码。** 不需要自建 sessions 目录，不需要碰会话日志格式。

---

## 3. 被否决的方案

记录在这里，避免后续重新踩坑。

### 3.1 每会话一个 UUID 工作区 —— 不可行

曾考虑：工作区固定为 `wander-chat`，每个会话的 cwd 设为 `wander-chat/<uuid>`。

**被硬约束否决。** `@deepseek-ai/dsh-workspace` 的 `attachSession` 要求会话 cwd 与工作区路径**严格相等**（`lib/index.js:111-127`）：

```js
cwd = await realpathNormalize(header.cwd)
if (cwd !== this.record.path)
  throw new Error(`cannot attach session '${sessionId}' to workspace '${this.record.path}': its cwd resolves to '${cwd}'`)
```

同一文件 `lib/index.js:102-103` 的 `sessionIds` getter 还会二次过滤：

```js
return this.record.sessionIds.filter((id) => this.host.sessionPath(id) === this.record.path)
```

更麻烦的是启动对账逻辑（`lib/index.js:779-807`）：DSH 扫描所有会话 header，**按 cwd 分组自动补建工作区记录**。所以只要 cwd 是 UUID 子目录，DSH 就会给每个 UUID 目录各建一个独立工作区 —— 与「统一到一个目录下」完全相反。

附带三个事实：

- `WorkspaceCreateRequest` 只有 `path` 一个字段，**没有 title**（`@deepseek-ai/dsh-api-workspace-controller` `lib/typert.host.js:673-674`），所以客户端建的工作区标题只能等于路径末段。
- DSH 确实有父子工作区嵌套（`owningParentFolder`，`@deepseek-ai/dsh-client-ui-workspace` `lib/client.js:626-638`），但只在分组方式切到「按工作区树」时生效（同文件 `:3288`，`nestWorkspaces: groupBy === "workspace-tree"`），默认是「按工作区」（`:661`，`groupBy: "workspace"`）。插件没有可靠途径替用户改这个浏览器本地视图状态。
- 即使嵌套成功，子分组标题仍是裸 UUID。

### 3.2 插件自建一套 sessions 目录 —— 多余

见 §2.2，DSH 已原生提供。

---

## 4. 最终架构

### 4.1 职责划分

```
┌─ Host 半边 (index.js) ─────────────────────────────┐
│ · Config schema：root 路径 + 分组显示名            │
│ · 路由 GET /dsh-wander-chat/ensure                 │
│     - mkdir -p root                                │
│     - workspaceRegistry.create(root, title)        │
│     - 返回 { ok, path, title }                     │
└────────────────────────────────────────────────────┘
                     ▲ fetch
┌─ Client 半边 (client.js) ──────────────────────────┐
│ · sidebar.panellist 注册 id=wander-chat → 按钮行   │
│ · main 注册 key=wander-chat → 启动面板             │
│ · 启动面板挂载时执行三步流程并跳转                 │
└────────────────────────────────────────────────────┘
```

**侵入面**：一个目录 + 一个侧边栏条目 + 一条只读路由。

**明确不碰**：会话存储、会话格式、Agent 循环、工作区归属规则、`~/.dsh/sessions/` 下任何内容、官方 UI 的既有插槽占用。

### 4.2 按钮落点：为什么是 `sidebar.panellist` + `main` 配对

侧边栏 DOM 顺序（`@deepseek-ai/dsh-client-ui-sidebar` `lib/client.js:346-408`）：

```
logoRow(品牌) → 【新会话按钮】 → panelList(全局面板) → regionArea(sidebar.workspaces) → footArea(sidebar.footer.action + sidebar.settings)
```

**「新会话」按钮正下方没有任何专用插槽**，唯一的空位就是 `panelList` 这一块，而它的内容由 `sidebar.panellist` 插槽填充。

`sidebar.panellist` 的语义（`lib/client.js:173-200`、`:452-469`）：

- 侧边栏只从注册项读取 `id` / `order` / `label`，**渲染成一个导航行**
- 行内只放你返回的**图标组件**（`renderSlot("sidebar.panellist", {size, active}, {only: id})`）
- 行的可见标题和 tooltip 来自注册项的 `label`，不是来自组件
- 点击行为被固定为 `selectPanel(id)`

关键约束：`layout.selectPanel` 在找不到同 key 的 `main` 面板时**会直接抛错**（`@deepseek-ai/dsh-client-ui-layout` `lib/client.js:462-465`）：

```js
selectPanel(panelId) {
  if (panelId !== null && !this.hasMainPanel(panelId)) throw new Error(`layout.selectPanel: main panel "${panelId}" is not registered`)
  ...
}
```

而 `main` 插槽的定义就是「**Central panel selected by sidebar entry id**」，派发方式为（同文件 `:118`）：

```js
renderSlot("main", {}, { entryKey: usePanelInfo((info) => info.activePanelId) ?? "conversation" })
```

**所以正解是配对注册**：`sidebar.panellist` 的 `id` 与 `main` 的 `key` 都取 `wander-chat`。这样：

- 行出现在「新会话」正下方 ✓
- 鼠标点击与键盘 Enter **行为完全一致** ✓
- 不需要 `stopPropagation` 之类的事件劫持 hack ✓
- `main` 的 keyDomain 是开放的（`already taken: conversation`），新增 key 不会遮蔽官方 `conversation` 面板 ✓

---

## 5. 目录结构

参照现有的 `dsh-git-branch`（`link:` 方式装入 profile）：

```
dsh-wander-chat/
├── package.json          # dsh.bundle + dsh.client 声明
├── cordis.patch.yml      # insert 一行 Host 插件，含默认 config
├── index.js              # Host 半边
├── client.js             # Client 半边（手写浏览器 bundle，无构建步骤）
├── locale/
│   ├── zh.json
│   └── en.json
├── icon.svg
├── README.md
└── DESIGN.md             # 本文档
```

无构建步骤：`client.js` 是手写的 classic script，只注册一个惰性工厂，形态与 `dsh-git-branch/client.js` 一致。

---

## 6. 关键流程

点击「新建漫游会话」→ 打开 `main` 面板 `wander-chat` → 挂载 `WanderLauncher`：

```
WanderLauncher 挂载
  │
  ├─ 1. fetch GET /dsh-wander-chat/ensure
  │       Host: mkdir -p <root>
  │       Host: workspaceRegistry.create(<root>, "漫游会话")   ← 幂等，仅新建时使用 title
  │       ← { ok: true, path, title }
  │
  ├─ 2. ws = await ctx.workspaces.create({ path })
  │       幂等；按 canonical path 命中已有记录，保留自定义 title
  │       返回后立即 upsert 进客户端投影
  │
  ├─ 3. ctx.uiWorkspace.startSession(ws.workspaceId)
  │       shell 切到 conversation 面板，本组件卸载
  │
  └─ 失败 → 保持在本面板，渲染错误信息 + 「重试」按钮
```

### 6.1 为什么第 1 步之后还要第 2 步

看起来 Host 已经建好工作区了，客户端为何还要再 `create` 一次？两个原因：

1. **竞态**：`uiWorkspace.connectWorkspace` 在客户端投影里找不到工作区时**会抛错**（`@deepseek-ai/dsh-client-ui-workspace` `lib/client.js:790-791`）：

   ```js
   const workspace = this.workspaces.list.getSnapshot().items.find((item) => item.workspaceId === workspaceId)
   if (workspace === undefined) throw new Error(`uiWorkspace.connectWorkspace: unknown workspace ${workspaceId}`)
   ```

   客户端投影由 Host 的 `follow()` 流异步推送，只依赖 Host 创建会有竞态。

2. **标题**：`workspaces.create` 按 canonical path 幂等命中已有记录，会把**带自定义 title 的权威行**同步 upsert 进投影（`@deepseek-ai/dsh-api-workspace-controller` `lib/client.js:51-55`、`:393-397`）。

所以第 2 步既消除竞态，又把「漫游会话」这个显示名带进客户端。

---

## 7. 实现要点

### 7.1 `package.json`

```jsonc
{
  "name": "dsh-wander-chat",
  "type": "module",
  "main": "./index.js",
  "exports": {
    ".": "./index.js",
    "./client": "./client.js",
    "./package.json": "./package.json",
    "./cordis.patch.yml": "./cordis.patch.yml",
    "./locale/*.json": "./locale/*.json"
  },
  "dsh": {
    "manifestVersion": 1,
    "bundle": { "patch": "./cordis.patch.yml" },
    "client": {
      "platform": "web",
      "immediately": true,
      "inject": ["@deepseek-ai/dsh-client-ui-workspace"]
    }
  }
}
```

`dsh.client.inject` 声明该浏览器 bundle 依赖的模块 id，进入 boot graph 决定加载顺序。`ui-workspace` 是硬依赖（我们要调它的服务）。`sidebar.panellist` 与 `main` 两个插槽通过 `ctx.slots.inject()` 注册，会等待插槽声明，所以不必额外声明 `ui-sidebar` / `ui-layout`。

### 7.2 `cordis.patch.yml`

```yaml
- insert:
    - id: dsh-wander-chat
      name: 'dsh-wander-chat'
      config:
        root: ~/.dsh/wander-chat
        title: 漫游会话
```

### 7.3 `index.js`（Host 半边）

```js
export const name = 'dsh-wander-chat'
export const inject = ['webServer', 'workspaceRegistry']
export const Config = Schema.object({
  root: Schema.string().default('~/.dsh/wander-chat'),
  title: Schema.string().default('漫游会话'),
})
```

`apply(ctx)` 要点：

- 用 `@deepseek-ai/dsh-home-paths` 的 `expandHomePath()` 展开 `~`（该包导出 `expandHomePath` / `dshHomePath` / `defaultDshHome`）。
- `mkdir(root, { recursive: true })` —— 用 `recursive: true` 而不是客户端那个 `createDirectory`，因为后者在目录已存在时抛 `directory-exists`（`@deepseek-ai/dsh-host-directory-picker-browse` `lib/index.js:219-231`），每次点击都要额外处理。
- `ctx.workspaceRegistry.create(root, title)` —— Host 侧 `create(path, title)` **接受 title**（`@deepseek-ai/dsh-workspace` `lib/index.js:406-410`），且只在新建记录时使用；已存在时返回原记录并保留其 title。返回的 `Workspace` 实体有 `.id` / `.path` / `.title`（同文件 `:85-100`）。
- 注意 `workspaceRegistry.create` 要求目录**必须已存在**（同文件 `:407-408`，会 `stat` 校验并抛「path is not a directory」），所以必须先 mkdir。
- 路由 `/dsh-wander-chat/ensure` 只做 GET，安全栅栏直接复用 `dsh-git-branch/index.js` 的 `requestAllowed()`：校验 `Host` 为本机 loopback（或 `webRuntime.trustedHosts` 中声明的权威）、拒绝 `sec-fetch-site: cross-site`、`Origin` 主机名一致。这是 DNS rebinding 与跨站防护。
- 用 `ctx.effect(() => ctx.webServer.register({ kind: 'prefix', path: '/dsh-wander-chat', handler }), ...)` 注册，插件卸载时自动摘除。
- 响应 `cache-control: no-store`。

### 7.4 `client.js`（Client 半边）

工厂返回：

```js
return {
  inject: ['slots', 'locale', 'uiWorkspace', 'workspaces'],
  apply(ctx) { /* ... */ },
}
```

**a. 样式与词典**：与 `dsh-git-branch` 一致，用 `ctx.effect` 安装 `<style>` 和 `ctx.locale.register(NS, { zh, en })`，卸载时清理。

**b. 侧边栏条目**

```js
ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({
  name: 'sidebar.panellist',
  id: 'wander-chat',
  order: -10,                      // 排在「新会话」正下方第一位
  locale: NS,
  label: () => t('entry'),
}, WanderIcon))
```

- `order` 决定行在 `panelList` 中的位置，侧边栏按 `order` 升序排（`ui-sidebar` `lib/client.js:461`）。内置的插件面板是 `0`、计划面板是 `10`，所以取负数可确保排第一。
- `label` 是行标题与 tooltip 的来源，必须是函数或已本地化的字符串；它经由 `resolveSlotLabel` 解析（同文件 `:459`）。
- `WanderIcon` 只负责画图标，会收到 `{ size, active }`，应按 `size`（16 或 18）渲染。

**c. 主面板**

```js
ctx.slots.inject('main', () => ctx.slots.register({
  name: 'main',
  key: 'wander-chat',
  locale: NS,
  inject: () => ({ ensure: ensureWanderWorkspace, start: startWanderSession }),
}, WanderLauncher))
```

`WanderLauncher` 状态机：`idle → working → (卸载 | error)`。

- 挂载时执行三步流程（§6）。
- 成功后 `startSession` 会让 shell 切到 conversation 面板，本组件随之卸载。
- 失败时留在面板内渲染错误信息 + 「重试」按钮 —— 比静默失败好。
- 再次点击同一行时，若面板已因成功跳转而卸载，会重新挂载并重新执行；若停在错误态，则由「重试」按钮兜底。

**d. 不使用事件劫持**：不要把动作挂在图标组件上做 `stopPropagation`。那样鼠标能用但键盘 Enter 会绕过，反而要走 `selectPanel` 抛错。配对 `main` 面板才是官方设计的用法。

### 7.5 本地化

命名空间 `dsh-wander-chat`。至少需要：

| key | zh | en |
| --- | --- | --- |
| `entry` | 新建漫游会话 | New roaming session |
| `working` | 正在创建漫游会话… | Creating roaming session… |
| `error` | 创建漫游会话失败 | Failed to create roaming session |
| `retry` | 重试 | Retry |

---

## 8. 配置与设置页

> **本节已在实现阶段修正。** 初稿判断「声明 Config schema 就会自动生成配置页」是**错的**，
> 下面记录更正后的结论与实际做法。

### 8.1 更正：`autoGenerate` 不会生成 UI

`settings` 服务的 `autoGenerate` 确实默认为 `true`（`@deepseek-ai/dsh-settings` `lib/index.js:426`）：

```js
const autoGenerate = this.presentations.get(entry.fiber)?.auto ?? true
```

但它只是随 `SettingsDescriptor` 发布出去的一个**标志位** —— 在整个客户端包中搜索 `autoGenerate`，
**零命中**。没有任何代码消费它来渲染表单。所以：

**声明 `Config` schema 只让 Host 侧能校验与持久化配置，不会自动长出任何界面。**

### 8.2 配置页必须由客户端半边注册

真正的前提在 `ui-plugin-manager`：

```js
const configure = (pkg) => ({
  has: (row) => ledger.rows.has(rowConfigKey(pkg.name, row.rowId)),
  ...
})
```

以及 `PackageDetail` 中：

```jsx
{configured ? (
  <section data-plugin-config>
    {renderSlot("plugins.bundle.config", { view: "page" }, { entryKey: pkg.name })}
  </section>
) : null}
```

即：**没有注册对应插槽，就没有任何配置入口。**

### 8.3 实际采用的做法

只注册 `plugins.bundle.config`（key 为包名 `dsh-wander-chat`），表单直接渲染在
**插件详情页**（描述下方、插件行上方）—— 也就是从插件列表点进去的那一页，因此不存在
「入口在哪」的问题。

- 表单用 `@deepseek-ai/dsh-client-ui-primitives` 的 `SettingsFormModel` / `SettingsForm` /
  `SettingsValueField`，经 `ctx.configForms` 读写 Host 配置
- namespace 做了双拼写兼容：官方配置页用的是 patchId（如 `agent-loop`、`web-search-deepseek`），
  而 Host `settings.describe()` 发布的 `ns` 是 loader entry id。两种拼写都作为候选传给
  `whileServed`，用实际被服务的那一个
- **不**注册 `plugins.row.config`：它会让插件行再多一个 `›` 入口，而详情页已直接展示同一份
  表单，重复入口只会让人犹豫该点哪个

### 8.4 其他

`root` 默认值在 config 里写 `~/.dsh/wander-chat`，运行时自行展开 `~`（见 §7.3，未使用
`expandHomePath`，因为 `link:` 插件解析不到 profile 的包）。两个字段都是 `volatile()`，
路由按请求读取，因此保存后**下一次点击即生效**，不需要重载插件。

---

## 9. 风险与边界

| # | 风险 | 影响 | 缓解 |
| --- | --- | --- | --- |
| 1 | `sidebar.panellist` 语义是「全局面板图标」，我们借它当动作入口 | 官方若改变该插槽语义会失效 | 属于官方文档化用法（`main` 明确按 sidebar entry id 派发）；行为可观测，失效时是显式报错而非静默错误 |
| 2 | 内置插件面板 `order` 为 0、计划面板为 10 | 用负数排第一；若官方新增负 order 会挤位 | 可接受，最多位置变动 |
| 3 | 启动面板是一次性「命令」而非真实面板 | 成功时一闪而过 | 失败态保留错误 + 重试，反而比静默失败好 |
| 4 | 工作区记录被删除后由启动对账重建 | 自定义 title「漫游会话」会退回 `wander-chat` | 每次点击都会经 `workspaceRegistry.create(root, title)` 重新断言 title（仅新建时生效）；可在 ensure 里顺带 `setTitle` 纠正 |
| 5 | 目录名 `wander-chat` 与显示名「漫游会话」不一致 | 用户可能困惑 | 设置页可改；文档说明 |
| 6 | `~/.dsh/` 是 DSH 自己的家目录 | 用户可能不希望工作区混在 DSH 数据里 | 默认值可配置；`~/.dsh/wander-chat` 与 `sessions/`、`profiles/` 平级，互不干扰 |
| 7 | 客户端投影竞态 | `connectWorkspace` 抛 unknown workspace | 已由第 2 步的幂等 `workspaces.create` 消除（§6.1） |
| 8 | 插件卸载时残留 | 插槽条目、样式、词典残留 | 全部经 `ctx.effect` / `ctx.slots.inject` 注册，卸载自动清理 |

### 关于风险 4 的补充

`createCanonical` 只在新建记录时使用传入的 title。若记录已存在但 title 被改过（例如被对账重建为 `wander-chat`），`create` 不会纠正。如果希望显示名始终为「漫游会话」，可以在 ensure 路由里比较 `workspace.title !== title` 后调用 `workspace.setTitle(title)`（`@deepseek-ai/dsh-workspace` `lib/index.js:104-109` 提供 `setTitle`）。**建议实现时加上这一步**，代价很小。

---

## 10. 验证方式

1. **安装**：在 `/Users/hupc/.dsh/profiles/desktop/package.json` 的 `dependencies` 加 `"dsh-wander-chat": "link:/Users/hupc/AgentTest/dsh-wander-chat"`，并加入 `dsh.profile.bundles`；然后安装依赖。
2. **Host 半边**：`curl` 路由确认返回 `{ ok: true, path, title }`，并确认目录已创建、`~/.dsh/storages/` 下出现工作区记录。
3. **客户端半边**：刷新页面（客户端插件改动需要重建 Web 产物；只有 `pnpm run dev:web` 在跑时才能免刷新热更），确认侧边栏「新会话」正下方出现「新建漫游会话」。
4. **端到端**：点击 → 确认不弹目录选择器、会话创建成功、`~/.dsh/sessions/--<root编码>--/session-<uuid>/` 出现、侧边栏分组显示「漫游会话」。
5. **键盘可达性**：Tab 到该行按 Enter，行为应与鼠标点击一致。
6. **幂等性**：连续点击多次，确认只产生一个工作区记录、每次产生一个新会话。
7. **配置**：在设置页改 `root`，确认新会话落到新目录。
8. **卸载**：禁用插件，确认按钮行、样式、词典全部消失，无残留报错。

---

## 11. 后续可扩展点

- 把「漫游会话」做成可折叠的独立分组，与常规工作区视觉区分。
- 支持多个漫游工作区（如「漫游会话 A / B」），每个有独立根目录。
- 会话结束时自动归档漫游会话，避免侧边栏堆积。
- 一键清空漫游目录下的临时产物。

---

## 附录：本文引用的官方源码位置

均位于 `/Applications/DeepSeek Harness.app/Contents/Resources/app.asar` 内。

| 包 | 位置 | 内容 |
| --- | --- | --- |
| `@deepseek-ai/dsh-workspace` | `lib/index.js:85-100` | `Workspace` 实体，`.id` / `.path` / `.title` |
| `@deepseek-ai/dsh-workspace` | `lib/index.js:102-103` | `sessionIds` 按 cwd 严格过滤 |
| `@deepseek-ai/dsh-workspace` | `lib/index.js:104-109` | `setTitle` |
| `@deepseek-ai/dsh-workspace` | `lib/index.js:111-127` | `attachSession` 严格 cwd 校验 |
| `@deepseek-ai/dsh-workspace` | `lib/index.js:406-410` | `create(path, title)`，要求目录已存在 |
| `@deepseek-ai/dsh-workspace` | `lib/index.js:779-807` | 启动按 cwd 对账补建工作区 |
| `@deepseek-ai/dsh-client-ui-sidebar` | `lib/client.js:173-200` | `PanelRow`：图标来自插槽，点击 `selectPanel(id)` |
| `@deepseek-ai/dsh-client-ui-sidebar` | `lib/client.js:346-408` | 侧边栏 DOM 顺序 |
| `@deepseek-ai/dsh-client-ui-sidebar` | `lib/client.js:452-469` | `sidebar.panellist` 收集与按 `order` 排序 |
| `@deepseek-ai/dsh-client-ui-layout` | `lib/client.js:118` | `main` 按 `activePanelId` 派发 |
| `@deepseek-ai/dsh-client-ui-layout` | `lib/client.js:462-465` | `selectPanel` 无对应 `main` 面板时抛错 |
| `@deepseek-ai/dsh-client-ui-workspace` | `lib/client.js:626-638` | `owningParentFolder` 嵌套规则 |
| `@deepseek-ai/dsh-client-ui-workspace` | `lib/client.js:661` | 默认 `groupBy: "workspace"` |
| `@deepseek-ai/dsh-client-ui-workspace` | `lib/client.js:790-791` | `connectWorkspace` 未知工作区抛错 |
| `@deepseek-ai/dsh-client-ui-workspace` | `lib/client.js:3288` | `nestWorkspaces` 仅工作区树模式 |
| `@deepseek-ai/dsh-api-workspace-controller` | `lib/client.js:51-55` | `create` 立即 upsert 投影 |
| `@deepseek-ai/dsh-api-workspace-controller` | `lib/client.js:393-397` | 客户端 `workspaces.create` 抛错语义 |
| `@deepseek-ai/dsh-api-workspace-controller` | `lib/typert.host.js:673-674` | `WorkspaceCreateRequest` 仅 `path` |
| `@deepseek-ai/dsh-host-directory-picker-browse` | `lib/index.js:219-231` | `createDirectory` 遇 EEXIST 抛错 |
| `@deepseek-ai/dsh-settings` | `lib/index.js:426` | `autoGenerate` 默认 `true` |
| `@deepseek-ai/dsh-home-paths` | `lib/index.js` | `expandHomePath` / `dshHomePath` / `defaultDshHome` |
