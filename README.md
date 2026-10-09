# dsh-wander-chat

[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![DSH plugin](https://img.shields.io/badge/DSH-plugin-4c8dff.svg)](#安装)

[English](README.en.md) | 中文

DSH 插件：在侧边栏「新会话」按钮**正下方**新增一行「新建漫游会话」，一键在**不选择本地目录**的情况下开启会话。

所有漫游会话统一归入一个固定的工作区分组（默认显示名「漫游会话」，目录 `~/.dsh/wander-chat`），目录与分组名都可以在设置里改。

## 效果

- 侧边栏「新会话」下方多出一行「新建漫游会话」
- 点击后直接创建会话并跳转，**不弹目录选择器**
- 所有漫游会话在侧边栏归入同一个分组，而不是散成多个工作区
- 每个会话的内容仍然各自独立存放在 DSH 官方的 `~/.dsh/sessions/--<目录编码>--/session-<uuid>/` 下

## 安装

```bash
cd ~/.dsh/profiles/desktop
# package.json 的 dependencies 加：
#   "dsh-wander-chat": "link:/path/to/dsh-wander-chat"
# dsh.profile.bundles 加：
#   "dsh-wander-chat"
pnpm install
```

然后重启 DSH 或重载 profile。

## 配置

**设置 → 插件 → 漫游会话**

配置表单**直接渲染在这个插件详情页里**（描述下方、插件行上方），点进插件就能看到，不需要再找入口。

| 字段 | 默认值 | 说明 |
| --- | --- | --- |
| `root` | `~/.dsh/wander-chat` | 漫游会话共用的工作目录，支持 `~` 前缀，不存在时自动创建 |
| `title` | `漫游会话` | 该目录在侧边栏显示的分组名称 |

也可以直接写在 profile 的 `cordis.patch.yml` 里：

```yaml
- id: dsh-wander-chat
  config:
    root: '~/.dsh/wander-chat'
    title: '漫游会话'
```

### 关于配置页的实现

DSH 的 `settings` 服务虽然会给带 Config schema 的插件发布 `autoGenerate` 标志，但**不会自动生成 UI** —— 配置页必须由客户端半边自己注册。本插件的做法是：

1. Host 半边声明 Schemastery `Config`（字段与描述即上面的表格）
2. Client 半边注册 `plugins.bundle.config`（key 为包名 `dsh-wander-chat`），表单就出现在插件详情页里
3. 表单用 `@deepseek-ai/dsh-client-ui-primitives` 的 `SettingsFormModel` / `SettingsForm` / `SettingsValueField`，通过 `ctx.configForms` 读写 Host 配置

只有点「保存」才会写入；离开页面会丢弃未保存的修改。

只注册这一个插槽是刻意的：`plugins.row.config` 会让插件行再多出一个 `›` 配置入口，而详情页已经直接展示同一个表单，重复入口只会让人犹豫该点哪个。

## 工作原理

```
点击「新建漫游会话」
  → main 面板 wander-chat 挂载
  → GET /dsh-wander-chat            Host：mkdir -p + workspaceRegistry.create(path, title)
  → ctx.workspaces.create({ path }) 客户端：幂等，把工作区同步进本地投影
  → ctx.uiWorkspace.startSession(workspaceId)
```

`startSession(workspaceId)` 就是侧边栏「新会话」按钮自己调用的那个 API，只是显式传入了工作区，所以不会弹出目录选择器。

**侵入面**：一个目录 + 一条 Workspace 注册 + 一条只读路由。不碰会话存储、会话格式、Agent 循环或工作区归属规则。

## 为什么每会话不单独用一个目录当 cwd

DSH 要求会话的 `cwd` 与工作区路径**严格相等**（`@deepseek-ai/dsh-workspace` 的 `attachSession` 会校验，启动时还会按 cwd 对账补建工作区）。如果让每个会话的 cwd 是 `wander-chat/<uuid>`，DSH 会为每个 UUID 各建一个独立工作区，侧边栏反而散成 N 个分组。

而「每会话独立目录」这个需求，DSH 在存储层已经原生实现 —— 见上文 `~/.dsh/sessions/` 的结构。所以插件只需要一个固定工作区，其余交给 DSH。

## 注意

`link:` 方式安装的插件位于 profile 之外，Node 会按软链接的真实路径解析依赖，因此**无法**引用 profile 里的 `@deepseek-ai/*` 包。本插件为此：

- `~` 展开自行实现（只用 `node:os`），不依赖 `@deepseek-ai/dsh-home-paths`
- 只在 Host 半边依赖 `@deepseek-ai/schemastery`（用于 Config schema），并把它作为本地依赖安装

## 开发

无构建步骤：`client.js` 是手写的浏览器 bundle，只注册一个惰性工厂。

客户端改动需要重建 Web 产物后刷新页面；只有 `pnpm run dev:web` 在跑时才能免刷新热更。

```bash
npm test    # Host 半边测试（18 项，跑在临时目录里，不碰你的 home）
```

设计取舍与调研依据（含被否决的方案和 DSH 内部约束的源码定位）记录在 [DESIGN.md](DESIGN.md)。

## 许可

MIT
