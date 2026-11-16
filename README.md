# dsh-github-copilot-accounts

为 DSH（DeepSeek Harness）**桌面版**提供 GitHub Copilot **多账号与会话账号绑定**：设备码登录、全局默认、多账号切换、按 Session 固定账号路由、套餐与当前用量展示。当前分支使用 `DSH 0.2.2-rc.1` 的 Settings/ConfigEditor 接口；以前版本的兼容记录不适用于这次接口改动。

## 此分支的范围

PR #4 在原有账号管理基础上添加 **按原生 DSH Session 独立选择 Copilot 账号的路由和 Remote 基础能力**：

- 每个账号使用独立凭据映射，内部仍复用 DSH 的原生 `github-copilot` provider 和协议实现。
- 固定账号路由与受管理的全局默认路由分离；会话选择不覆盖全局模型偏好。
- 请求准备后固定账号；缺失、删除、禁用或不支持当前模型的账号明确失败，不换用其他账号。
- provider replay、推理签名和传输 affinity 按实际账号隔离；切号不删除聊天或工具结果，也不静默重跑整轮/工具。
- 恢复、普通 fork 和新原生子代理保留对应的会话选择边界；已有子代理不随父会话后续选择重绑。

**此 PR 不包含新的会话账号菜单、紧凑用量布局、合计、UTC 游标、原生头像资源池或手动刷新模型按钮。** 当前客户端仍以原有账号管理界面为主；底部徽标明确标为“全局默认”，其账号切换动作改变的是全局默认，不是专属 Session 绑定。专用会话 UI 将由后续 PR 提供。

相关讨论：

- [#3：Session 账号路由与切换](https://github.com/JacobCodeShow/dsh-github-copilot-accounts/issues/3)
- [#5：GHE 头像资料刷新和失败恢复](https://github.com/JacobCodeShow/dsh-github-copilot-accounts/issues/5)
- [#7：会话账号 UI、当前用量和头像复用](https://github.com/JacobCodeShow/dsh-github-copilot-accounts/issues/7)
- [#8：手动模型刷新](https://github.com/JacobCodeShow/dsh-github-copilot-accounts/issues/8)

- 同名跨域账号隔离已由上游 PR #2 合入；本分支沿用该行为。

## 前置要求

- 接口验证目标：DSH desktop `0.2.2-rc.1`、Cordis `4.1.x`；其他版本需要额外验证。
- 有效的 GitHub Copilot 订阅。
- DSH 的原生 OAuth、credentials 和普通原生 Session 服务。

只支持 GitHub.com 与 GitHub Enterprise Cloud 的 `*.ghe.com` 域名。外部 ACP/Codex 会话、显式 API-key/认证覆盖和非原生端点不应被猜作某个 OAuth 账号。

## 安装和更新

这是待审阅的源码分支，不代表 npm 已发布新版本。用 DSH 插件管理器安装本地构建包或源码路径；安装、更新、移除后完整退出并重启 DSH。

客户端语言注册随插件生命周期释放。若旧版本已经遗留同名 locale 导致入口消失，需重新加载整个页面或重启；新版本不会删除其他活跃实例的语言资源或吞掉冲突异常。

原生组合已经提供 authorization 服务，不能重复挂载。受管理默认策略使用标准 composition 消费者隔离，不替换原始全局服务。若运行中修改或撤回该隔离出现 `COPILOT_RESTART_REQUIRED`，正常退出后重启，不能热回退为其他账号。

出站代理和网络策略由 DSH 启动器负责；插件使用普通 `fetch`，不修改进程全局 fetch/dispatcher，也不记录代理 URL。

## 账号管理

1. 设置侧栏打开「Copilot 账号」。
2. 添加 GitHub.com 或 GitHub Enterprise Cloud 账号；企业域名应为 `company.ghe.com`。
3. 使用页面给出的设备码和验证链接完成授权。
4. 登录成功后新账号成为全局默认，旧槽位保留。

账号按归一化域名与用户名区分，id 由 Host 返回；客户端不拼接凭据 key。同域重新授权复用原槽位，跨域同名账号并存。恢复账号同样按 id 操作。已经因旧版本覆盖丢失的授权不能凭空恢复，需要重新登录。

上游设置页的「设为默认」仍是全局动作。新会话功能另外提供受保护的账号路由和 `copilotAccounts` Remote；使用专属路由的 Session 不会被全局默认变更改写。

## Session 路由和 Remote

- `copilot-default`：请求准备时捕获实际匹配到的默认 OAuth 账号。
- `copilot-account-…`：固定账号的公开路由，id 为账号槽位的不可逆摘要。
- `copilotAccounts`：所属 Host 的原生 Remote，包含目录查询、Session 绑定及受限账号操作；只允许 owner，并验证实际 Session 资源权限。

普通原生模型选择器可见受管理路由。Remote 绑定使用现有模型/推理档位，目标账号不支持时拒绝，不替换模型。会话忙碌或只读时不接受新绑定；已经准备的请求不被随后选择改写。

原始 `github-copilot` replay、外来账号 replay 或无法证明 provenance 的状态按 provider-neutral 历史处理。有效同账号的必要推理签名不能因为临时网络错误而一概清除。身份校验包含实际 issuer 和长期授权的摘要，短期 access 更新不改变身份。

长上下文自动压缩使用本步已捕获的账号，而不是上一条已记录请求的账号；用户显式指定的摘要 provider/model 仍优先。条件压缩角色只通过原生 BasicCompaction 的 `summarize` 扩展点调整摘要路由，保留原始配置条目和 Surface 事务。原生压缩被禁用时保持禁用；压缩角色不是账号 Remote 的启动依赖。启用状态下若保护未就绪，相关请求明确失败，不能悄悄用旧账号摘要。压缩控制变更或新增账号需要未展开的精确模型策略时，须完整重启。

具体继承边界见 [Session 继承说明](docs/session-inheritance.md)。这些记录来自原生接口的离线合成测试，不代表真实账户端到端测试已完成。

## 运行原理

- 通过 `cordis.patch.yml` 生效：
  1. 注册本插件（host 侧提供 `/copilot-auth` 本地登录、账号、资料与用量接口，跨站 Origin 拒绝）
  2. 以 settings base 层预置 `github-copilot` 路由（用户 `settings.yaml` 可逐字段覆盖）
- 登录走 GitHub 设备码流（ghe.com 账号通过 pi-ai 的 Enterprise 域名提问进入对应端点）；**当前激活账号**的凭据存 `~/.dsh/.credentials.yaml`（强制 600 权限）的 `llm-pi-ai/github-copilot` 记录——pi-ai 的请求路径只读它并在请求中自动刷新；插件在同一凭据库的 `copilot-auth` scope 中维护各账号槽位，新槽位按归一化的域名与用户名隔离；「设为默认」= 把槽位 payload 原子写入主记录
- `/copilot-auth/accounts` 为每个账号返回 `id`（实际凭据槽位 key，不含 token 的不透明标识）；前端仅将它用于列表/菜单定位与 `activate`、`logout` 的 `{id}` 请求，用户名仅用于显示，不从用户名或域名自行拼装 id。旧客户端的 `{login}` 请求仅在用户名唯一匹配时兼容；多个域名下有同名账号时返回 `409`，客户端应重新读取账号列表并使用对应 `id`
- 账号身份（login/姓名/头像）取自 `api.<域名>/user`。`accounts` / `whoami` 查询按 5 分钟资料 TTL 刷新并合并同账号的并发请求，失败后缓存 1 分钟并保留原资料；该 TTL 是客户端策略，不代表头像签名有效期。刷新仅更新槽位的 `account` 元数据，不改主授权或 token 字段
- **头像加载恢复**：GHE 自定义头像可能返回带签名的完整 URL，前端原样加载，不提取签名或附带 OAuth token。图片失败时通过 `POST /copilot-auth/profile {id}` 请求新资料并仅重试一次（强制刷新有 30 秒冷却）；URL / 账号改变时重置失败状态。接口不接收任意 URL，不代理图片；重复失败保留首字母圆标，不无限重试
- 套餐与用量取自 `copilot_internal/user`，直接使用长期 refresh token 认证，结果按 grant 绑定缓存 5 分钟；Copilot 短期 token 刷新独立进行
- **模型目录兜底填充**：登录成功/切换账号时，取「凭据缓存的账号可用模型 ∩ pi-ai 内置目录」写入该路由的模型目录——仅当该路由尚未配置 `models` 且无 `modelOverrides` 时写入；目录已存在（含空列表）一律让路，插件启动/重启也绝不触碰用户 settings。同步失败经 `/copilot-auth/accounts` 的 `syncError` 字段暴露
- **存储兼容**：已有 `copilot-auth/account-<login>` 与 `recovered-*` 槽位保留原 key，不要求迁移或重新登录；同一归一化域名与用户名重新授权会复用已有槽位及其 id。v0.1.0 单账号升级时，首次打开账号页或再次登录会将旧主凭据自动快照为槽位。旧版本已经因跨域同名覆盖而丢失的授权无法凭空恢复，需要重新添加该账号

## 模型目录与用量

每账号的实际模型列表取 **账号可用模型 id ∩ 原生描述目录 ∩ 用户配置**，可能彼此不同；同一模型 id 不意味着相同账号权限。

## 已知边界

- **不提供模型目录刷新**：桌面版（0.2.2-rc.1）把 pi-ai 打包进只读的 `app.asar`，数据级目录补丁无法写入，故本插件不实现目录刷新。上游新增模型需随 DSH 升级获得；pi-ai 内置目录已描述的模型可在 Models 页手动添加
- **ghe.com 用量端点未实测**（实测账号为 github.com 组织账号）：企业账号的 `copilot_internal/user` 按 pi-ai token 端点同构推导为 `api.<域名>`；不可用时仅该卡显示「用量不可用」，登录/切换主流程不受影响
- 用量进度条依赖 `copilot_internal/user` 的响应字段（`copilot_plan` / `quota_snapshots.premium_interactions`），字段缺失或上游改名时对应元素自动隐藏
- 登录进行中不能并发发起第二次登录（409）
- 头像仍为 GitHub 外链；资料刷新与单次重试不能绕过桌面壳 CSP、网络或服务器拒绝访问，持续失败时回落为首字母圆标。不能仅凭图片响应的缓存时间判断 GHE 签名 URL 何时失效
- Models 页的凭据状态圆点只反映 API Key 引用，OAuth 登录成功后圆点仍可能显示未配置（外观问题，功能不受影响）
- 自行在 `cordis.patch.yml` patch `llm-pi-ai` 整段 config 会覆盖预置路由
- `settings.yaml` 的 `llm-pi-ai:` 节只能稀疏覆盖字段，无法删除预置路由本身（移除须卸载本插件）
- 路由前缀 `/copilot-auth` 两侧硬编码，不可配置
- DSH rc 版本耦合：当前验证基准为 `0.2.2-rc.1`，另有 `0.2.0-rc.1`、`0.1.7-rc.2` 兼容验证记录；peer 仅 `@deepseek-ai/cordis@^4.0.2`
- 模型目录只在「尚不存在」时由登录成功兜底填充一次，填充后归用户所有：账号新增的模型不会自动出现——pi-ai 内置目录已描述的模型在 Models 页手动添加即可
- 模型目录只写入 pi-ai 内置目录已描述的模型：目录快照外的新模型需随 DSH 升级获得

登录/设默认时，仅当 `github-copilot` 未配置 `models` 且无 `modelOverrides` 时填充空目录。配置通过公开 Settings/ConfigEditor 读取；区分用户明确设置与原生默认值，并以版本校验阻止覆盖并发编辑。已有目录（包括空列表）归用户所有，不能覆盖；配置读取失败不能按空目录处理。无法确认整体动态表达式的配置来源时明确拒绝而不猜测。新模型的 wire 描述仍需随 DSH 内置目录获得；插件不改写安装包。

全局短期 access 按原有建议间隔刷新；账号请求路径在未知、到期或建议刷新边界检查/更新授权与模型元数据。**这不是固定周期覆盖 Models 设置。** 显式手动模型刷新属于 #8 后续功能。

当前套餐和用量来自 `copilot_internal/user` 的 `quota_snapshots.premium_interactions`；返回字段缺失时显示未知，不能当成 0。旧字段名不能证明它一定等同于网页新 AI-credit 计费报告。插件没有用量历史、趋势或月底预测。

网页 `Usage billed to` 是付款主体选择。此 PR 不读取或修改它，不将组织 access 列表视作计费池，也不汇总未验证的付款方余额。

## 卸载和回退

卸载不删除 DSH 凭据记录或 Session 文件，但旧版本不认识新增的受管理/固定账号路由。这类会话回退后可能显示模型不可用；重新安装此功能恢复，或由用户显式选择旧版原生模型使用全局默认。插件不会后台把固定绑定转换成另一个账号。

## 开发与验证

使用环境已批准的 npm 源安装依赖，不在公开仓库记录本机私有源配置。

```sh
npm test
npm run build
npm pack --dry-run
```

| 路径 | 职责 |
|---|---|
| `cordis.patch.yml` | patch（本插件 entry / 预置路由） |
| `src/host.mjs` · `src/shared.mjs` | host 半区：登录状态机、本地账号/资料/用量接口、槽位/激活、模型目录兜底填充 |
| `src/client.jsx` | client 半区：Accounts 设置页（卡片/下拉/进度条）+ 双语文案 |
| `src/avatar-recovery.mjs` | client 单次头像恢复状态机与同账号请求去重（编入客户端产物） |
| `scripts/build-client.mjs` | client 打包（`__ModuleLoader__` CJS 工厂信封） |
| `lib/client.js` | 构建产物（入库，使 git 安装免构建） |

普通 Node 测试可直接运行。`*-native.test.mjs` 等原生集成测试需要测试代码指定的本地提取 DSH fixture；未提供时会跳过。它目前不是可随此仓库自动安装的 CI fixture，必须报告跳过数量，不能把本机通过结果当作维护者可直接复现的全部覆盖。

测试使用合成 grant、Session、协议或 RPC，不读取用户 credentials 文件，不请求真实账号/模型。JSONL 覆盖 codec/backend read/restore，不证明 writer/fsync/Windows 锁或崩溃恢复。

浏览器验证和新的会话 UI 留在 #7 后续 PR。这里没有 `test:ui` 命令。

## 发布

版本后缀标记 DSH 接口目标，不代表真实 GHE 验收或已发布 npm 版本。维护者确认后沿用原项目 GitHub Actions Trusted Publishing 流程；本分支不自动推送 release tag 或改变 registry dist-tag。

## 版本号规则

版本采用 `<插件核心版本>-dsh-<最近一次验证所基于的 DSH 版本>`，例如 `0.3.5-dsh-0.2.2-rc.1`。`-dsh-` 后缀只表示验证基准，不代表最低支持版本；实际安装兼容范围由 `package.json` 的 `engines.dsh` 声明。该版本尚未发布 npm；发版 tag 应使用 `v0.3.5-dsh-0.2.2-rc.1`。

MIT
