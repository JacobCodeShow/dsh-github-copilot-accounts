# dsh-github-copilot-accounts

为 DSH（DeepSeek Harness）**桌面版**提供 GitHub Copilot **多账号管理**：设备码登录、多账号一键切换、额度与用量展示，并预置一条开箱即用的 GitHub Copilot 提供方路由。实测适配 `DSH 0.2.0-rc.1 desktop`（向下兼容 0.1.7-rc.2）。

## 这是什么

用 GitHub 账号（带 Copilot 订阅）登录 DSH 的方式，和其他 Copilot 客户端（VSCode 等）一致：**网页 + 设备码**，全程不填 API Token。支持 **GitHub.com** 与 **GitHub Enterprise Cloud（ghe.com 域名）** 两种账号，**多账号并存、单激活**，界面与交互对齐 GitHub Copilot desktop 的 Accounts 设置页。

本插件**复用 DSH 内置通道**（pi-ai 的 github-copilot provider），不实现任何 GitHub 协议代码——token 自动轮换、模型发现、协议适配全部由内置实现负责。插件本身只做三件事：提供「账号管理」设置页（登录/切换/注销/用量）、维护多账号槽位、预置 `GitHub Copilot` 路由（授权服务由内置组合提供）。

## 特性

- 🔐 **设备码登录/注销**：网页 + user code，免 API Token；SSO 组织授权友好
- 👥 **多账号管理**：「添加账号」下拉支持 GitHub.com 与 GitHub Enterprise Cloud（输入 `company.ghe.com` 域名）两种入口；多账号并存，**Default 徽标**标记当前激活账号，… 菜单一键切换/注销
- 📊 **用量展示**：每张账号卡显示套餐（Plan）与 AI credits 进度条（月度重置），数据来自 `copilot_internal/user`
- 🧩 **预置提供方路由**：安装即出现在 Models 页，无需手动配置
- 📦 **模型目录兜底填充**：登录成功/切换账号时，若 GitHub Copilot 路由还没有模型目录，自动填入账号可用模型（∩ 内置目录）；你已精简/定制过的目录**永不覆盖**（重启、重新登录均不重置）
- 🌐 **中/英双语界面**：跟随 DSH 语言设置自动切换
- 🔑 **凭据安全托管**：全部账号存入 DSH 内置凭据库（文件强制 0600 权限），Copilot 临时 token 到期自动刷新
- 🧪 **测试与 CI**：23 条单元测试；GitHub Actions 构建测试

## 前置要求

- DSH `0.2.0-rc.1` desktop（实测版本；0.1.7-rc.2 亦可）
- 有效的 GitHub Copilot 订阅（个人账号或企业组织账号均可，SSO 登录）
- `pnpm` 可用（`dsh plugin` 是 pnpm 转发器）

## 安装

```bash
dsh plugin add dsh-github-copilot-accounts
```

或从源码路径安装：

```bash
dsh plugin add /path/to/dsh-github-copilot-accounts
```

然后**重启 DSH desktop**。

### 故障排查

- 企业镜像/私有源环境下 pnpm 解析 peer 失败：`export npm_config_auto_install_peers=false` 后重试（profile 自带的 pnpm workspace 默认已关闭 peer 自动安装）。
- registry 的 `latest` dist-tag 可能落后于 `next`：显式按版本号安装/排查时勿被 `latest` 误导。

## 账号管理

1. 打开设置，进入侧栏「**Copilot 账号**」（英文界面为 *Copilot Accounts*，位于 Models 之后）
2. 点右上「**＋ 添加账号 ⌄**」，选择登录方式：
   - **GitHub.com** — 个人与企业组织账号
   - **GitHub Enterprise Cloud** — 贵公司 ghe.com 域名下的账号（填入 `company.ghe.com` 形式的域名后继续）
3. 页面显示一串**代码**（user code，可一键复制）与验证链接（企业账号为 `https://<你的域名>/login/device`）
4. 新标签打开链接，用对应账号输入代码；**SSO 用户必须对组织点 Authorize**（跳过则登录不生效）
5. 成功后账号出现在列表中并带 **Default** 徽标（新登录账号自动成为默认）

> 设备码有时效（约 15 分钟），请拿到代码后尽快完成授权。若超时，页面会显示失败原因，重新添加即可。

**多账号语义**（对齐 GitHub Copilot desktop）：

- 多个账号可同时保持登录，但**同时只有一个激活账号**（Default 徽标）服务于对话
- 卡片右上 **…** 菜单：**设为默认**（切换激活，即刻生效，无需重启）/ **注销**（清除该账号凭据）
- 每张卡片下方展示该账号的**套餐（Plan）**与 **AI credits** 进度条（按月重置）；用量拉取失败不影响登录与切换，仅显示不可用原因
- 注销激活账号后路由回到未配置状态，激活其它账号即可恢复

## 使用

- Models 页选择 `GitHub Copilot` 路由，模型目录已在首次登录时自动填充账号可用模型，无需手动「添加模型」；之后可自由增删精简，重启 / 重新登录都不会重置你的列表
- **配额说明**：base 模型（GPT-4o/4.1 一类）不耗 premium requests；premium 模型（Claude、Gemini、o 系列等）每次调用消耗月度配额。日常建议 base 档，premium 模型按需手动选

## 注销与卸载

- 注销单账号：账号卡 **…** 菜单 →「注销」
- 卸载：`dsh plugin remove dsh-github-copilot-accounts` 后重启 DSH desktop（卸载不影响凭据库中已有记录，重装即恢复）

## 工作原理

- 通过 `cordis.patch.yml` 生效：
  1. 注册本插件（host 侧在 webserver 上开 6 条本地路由：`/copilot-auth/start|state|accounts|activate|logout|cancel`，跨站 Origin 拒绝）
  2. 以 settings base 层预置 `github-copilot` 路由（用户 `settings.yaml` 可逐字段覆盖）
- 登录走 GitHub 设备码流（ghe.com 账号通过 pi-ai 的 Enterprise 域名提问进入对应端点）；**当前激活账号**的凭据存 `~/.dsh/.credentials.yaml`（强制 600 权限）的 `llm-pi-ai/github-copilot` 记录——pi-ai 的请求路径只读它并在请求中自动刷新；**其余账号**由本插件以自有 scope 存槽位记录 `copilot-auth/account-<login>`（同一凭据库）；「设为默认」= 把槽位 payload 原子写入主记录
- 账号身份（login/头像）取自 `api.<域名>/user`，套餐与用量取自 `copilot_internal/user`（access 过期或 401 先用长期 refresh token 刷新一次，结果回写槽位；结果缓存 5 分钟）
- **模型目录兜底填充**：登录成功/切换账号时，取「凭据缓存的账号可用模型 ∩ pi-ai 内置目录」写入该路由的模型目录——仅当该路由尚未配置 `models` 且无 `modelOverrides` 时写入；目录已存在（含空列表）一律让路，插件启动/重启也绝不触碰用户 settings。同步失败经 `/copilot-auth/accounts` 的 `syncError` 字段暴露
- v0.1.0 单账号升级：首次打开账号页或再次登录时，旧凭据自动快照为槽位进入多账号体系

## 已知边界

- **不提供模型目录刷新**：桌面版（0.2.0-rc.1）把 pi-ai 打包进只读的 `app.asar`，数据级目录补丁无法写入，故本插件不实现目录刷新。上游新增模型需随 DSH 升级获得；pi-ai 内置目录已描述的模型可在 Models 页手动添加
- **ghe.com 用量端点未实测**（实测账号为 github.com 组织账号）：企业账号的 `copilot_internal/user` 按 pi-ai token 端点同构推导为 `api.<域名>`；不可用时仅该卡显示「用量不可用」，登录/切换主流程不受影响
- 用量进度条依赖 `copilot_internal/user` 的响应字段（`copilot_plan` / `quota_snapshots.premium_interactions`），字段缺失或上游改名时对应元素自动隐藏
- 登录进行中不能并发发起第二次登录（409）
- 头像为 GitHub 外链，若桌面壳 CSP 拦截则回落为首字母圆标
- Models 页的凭据状态圆点只反映 API Key 引用，OAuth 登录成功后圆点仍可能显示未配置（外观问题，功能不受影响）
- 自行在 `cordis.patch.yml` patch `llm-pi-ai` 整段 config 会覆盖预置路由
- `settings.yaml` 的 `llm-pi-ai:` 节只能稀疏覆盖字段，无法删除预置路由本身（移除须卸载本插件）
- 路由前缀 `/copilot-auth` 两侧硬编码，不可配置
- DSH rc 版本耦合：实测 `0.2.0-rc.1`（0.1.7-rc.2 兼容），peer 仅 `@deepseek-ai/cordis@^4.0.2`
- 模型目录只在「尚不存在」时由登录成功兜底填充一次，填充后归用户所有：账号新增的模型不会自动出现——pi-ai 内置目录已描述的模型在 Models 页手动添加即可
- 模型目录只写入 pi-ai 内置目录已描述的模型：目录快照外的新模型需随 DSH 升级获得

## 开发

```bash
npm install
npm test        # node:test：patch 结构 + host（多账号登录/激活/注销/用量/兜底填充）共 23 条
npm run build   # esbuild 打包 client 到 lib/client.js（__ModuleLoader__ 信封）
npm pack --dry-run
```

| 路径 | 职责 |
|---|---|
| `cordis.patch.yml` | patch（本插件 entry / 预置路由） |
| `src/host.mjs` · `src/shared.mjs` | host 半区：多账号登录状态机、6 条本地路由、槽位/激活/用量、模型目录兜底填充 |
| `src/client.jsx` | client 半区：Accounts 设置页（卡片/下拉/进度条）+ 双语文案 |
| `scripts/build-client.mjs` | client 打包（`__ModuleLoader__` CJS 工厂信封） |
| `lib/client.js` | 构建产物（入库，使 git 安装免构建） |

## 版本号规则

版本号采用 semver 预发布后缀同时表达「插件自身版本」与「实测适配的 DSH 版本」：

```
<插件核心版本>-dsh-<实测适配的 DSH 版本>
   0.1.2            0.2.0-rc.1
```

- 例：`0.1.2-dsh-0.2.0-rc.1` 表示插件 0.1.2，实测适配 DSH desktop `0.2.0-rc.1`（即当前最低支持版本；0.1.7-rc.2 实测亦兼容）；
- **插件功能发版**：bump 核心号（patch/minor），后缀保持当前适配的 DSH 版本；
- **DSH 升级后重新实测适配**：bump 核心号并替换后缀，如 `0.2.0-dsh-0.1.8`；
- git tag 与之一致但带 `v` 前缀：`v0.1.2-dsh-0.2.0-rc.1`；
- 后缀版本号仍是合法 semver 预发布标识（每段仅含字母数字与连字符）。注意 npm 对预发布版本**要求显式 `--tag`**（CI 的 release.yml 与手工发布均带 `--tag latest`），显式挂到 `latest` 后 `dsh plugin add dsh-github-copilot-accounts` 按 dist-tag 安装即可正常获取该版本；仅 `^x.y.z` 形式的版本范围不会匹配预发布号，这不影响插件安装方式。

## 维护者发布

本项目使用 npm **Trusted Publishing（GitHub Actions OIDC）** 发布，不在仓库或 GitHub Secrets 中保存 `NPM_TOKEN`。

- 发布 workflow：`.github/workflows/release.yml`，推送 `v*` tag 或手动触发
- npm Trusted Publisher 配置：GitHub Actions；owner = `JacobCodeShow`，repository = `dsh-github-copilot-accounts`，workflow = `release.yml`，无 environment（见 `release.yml` 尾注）
- **首次发布前**：包尚不存在时 npm 要求先完成一次性 bootstrap（不能用长期 secret），再在 package settings 中配置 Trusted Publisher。详见 [npm Trusted Publishing 文档](https://docs.npmjs.com/trusted-publishers)
- 包名无 scope（`dsh-github-copilot-accounts`），首次发布前在 npm 确认该名称未被占用；fork 者如改名需同步 `package.json` / `cordis.patch.yml` / `scripts/build-client.mjs` 三处

## License

MIT
