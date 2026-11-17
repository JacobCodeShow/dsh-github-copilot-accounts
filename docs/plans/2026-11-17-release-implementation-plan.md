# Copilot Accounts 分阶段 Release 方案

## 已批准的发布解耦调整

2026-11-17，用户确认将 GitHub 安装包发布从 npm 发布授权中独立出来。以下规则替代原计划中“先 npm、再 GitHub”的顺序；后面的原始任务保留为历史记录，版本和 tag 不应直接照抄执行。

本次同时准备候选 `0.3.8-dsh-0.2.2-rc.3`，避免合并流程修复后再单独补版本 PR；未推 tag，未自动合并或对外发布。`0.3.6` 的打包失败和 `0.3.7` 的 npm 授权失败保留为历史，旧 tag 不移动。

- `github-release` 独立完成构建、测试、打包和哈希验证，创建带 `.tgz` / `.tgz.sha256` 的 GitHub prerelease；不依赖 npm 查询、Trusted Publisher 或 npm 任务成功。
- npm 发布默认关闭。仅仓库变量 `NPM_PUBLISH_ENABLED=true` 时启用独立 `npm` 任务，使用同一运行交接的已校验 tarball，不重新打包，仅发布到 `next`。
- npm 开启后，其网络、权限和发布失败仍明确报告；已经完成的 GitHub Release 及附件不回滚、不删除。关闭 npm 时，连 npm 的 Actions artifact 交接也不运行。
- 保留原有 tag、版本、包内容、哈希和附件不可覆盖约束；不关闭 npm 安全校验，不引入长期 token，不自动提升任一正式渠道。
- 新流程须经 PR 审阅合并后生效；原 tag 的重跑仍使用原提交，不移动已有 tag。

## 目标与当前状态

本方案已于 2026-11-17 获得确认并开始实施。当前仅实施发布准备：工作流、安全校验、候选清单、说明和本地安装包；未授权推发布 tag、发布 npm 或调整 `latest`。实际发布仍按任务 4 至任务 6 的门槛分别确认。

2026-11-17 已核实：

- PR #14 已合并到 `master`，合并提交为 `9b24c692111f6ad9dffeb0d6c92fd9cc75db1e8c`，PR CI 成功。
- 源码清单版本为 `0.3.5-dsh-0.2.2-rc.1`，npm 仅发布过 `0.1.0`、`0.1.1-dsh-0.1.7-rc.2`、`0.1.2-dsh-0.2.0-rc.1`。
- npm `latest` 指向 `0.1.2-dsh-0.2.0-rc.1`，尚无 `next`。
- 最近本地检查：构建成功；398 项测试中 341 通过、0 失败、57 跳过。跳过不代表原生集成验证通过。
- `.github/workflows/release.yml` 在 `v*` tag 或手工触发时发布，并且固定使用 `--tag latest`；不会自动创建 GitHub Release 或上传本地安装包。

## 推荐发布策略

候选版本：`0.3.6-dsh-0.2.2-rc.3`；Git tag：`v0.3.6-dsh-0.2.2-rc.3`。该版本在本次查询时未占用，执行前必须重新查询。

先在 DSH `0.2.2-rc.3` 验证本地 `.tgz`，再通过 OIDC 发布到 npm `next`，创建 GitHub 预发布；实际验收后，仅把同一 npm 版本提升到 `latest`，并把同一个 GitHub Release 转为正式发布。不重打 tag、不覆盖 npm 版本、不重新打包后再发布同一版本。

SemVer 中的 `-dsh-...` 是预发布后缀；仓库用它表示验证基准。是否默认安装由 npm dist-tag 决定，不从版本字符串判断正式渠道。候选发现问题时，修复并使用新的完整版本，不能复用已发布版本。

注意：npm `next` 只隔离 npm 默认安装，不保证 DSH 市场也隔离候选版。市场索引可能收录所有版本并优先展示最高版本。推 tag 前必须检查实际市场源；无法控制候选收录时，继续使用本地 `.tgz` 试用，不承诺市场用户不会看到候选版。

## 架构与全局约束

- 保留 `Node >=20`、`engines.dsh: ^0.2.2-rc.1`、Cordis `~4.1.0`，不借发布改动扩大或收紧兼容范围。发布 CI 沿用 Node 24。
- rc3 作为本次新增验证基准，不把界面验证描述成全部原生能力验收；保留此前 rc1 目标的兼容声明。发现不兼容时停止，另行审阅兼容范围变更。
- `package.json`、锁文件根版本及 README 的版本示例必须一致。
- 继续使用现有 GitHub Actions Trusted Publishing，不创建长期 npm token，不把认证信息写入仓库。
- 安装、更新、回退后完整退出并重启 DSH；不删除凭据或 Session 文件，不自动迁移固定会话账号路由。
- Windows 维护操作使用 PowerShell、Git、Node/npm、GitHub CLI。工作流内部保持 Ubuntu shell。npm 网络访问使用环境已批准的源或代理，不修改全局配置来绕过失败。
- 仓库没有额外 Release 模板；本方案不引入运行时依赖，不重构账号认证或 Session 逻辑。

## 文件结构与职责

| 路径 | 计划变更 |
|---|---|
| `.github/workflows/release.yml` | tag 校验、仅发布 `next`、构建测试、打包一次、OIDC 发布及 GitHub 预发布附件 |
| `scripts/release.mjs` | 可独立测试的清单与 tarball 校验、npm 查询、GitHub 远端 tag 与附件一致性、工作流命令入口 |
| `test/release.test.mjs` | 网络与权限失败、内容不符、annotated tag、重试安全及工作流形态的合成测试 |
| `package.json` | 候选版本；保留现有 engines / peer 范围 |
| `package-lock.json` | 同步版本，不借机升级依赖 |
| `README.md` | 更新源码分支、版本号和安装说明，区分 next / latest、列出升级风险 |
| `docs/releases/0.3.6-dsh-0.2.2-rc.3.md` | 上传 GitHub Release 的完整候选说明，覆盖 Session 功能、UI 修复和回退限制 |
| `lib/client.js` | 从已验证源码构建，仅在构建结果确有变化时提交 |
| `test/package-content.test.mjs` | 沿用发布包内容与清单一致性检查；若清单断言需要变化，在此收敛 |
| 本文档 | 保存批准后的执行清单与验证边界，不包含账号数据 |

不新增永久产物目录。工作流临时生成并上传 `dsh-github-copilot-accounts-0.3.6-dsh-0.2.2-rc.3.tgz` 及其 SHA-256 校验值，发布附件不入 Git。

## 任务 1：准备发布基线

Consumes：已合并 PR #14。Produces：基于最新 `master` 的 `release/0.3.6-dsh-0.2.2-rc.3` 分支。

确认工作区干净；若有未提交的计划或其他用户修改，先保留并确认，不使用 reset 或强制切换。

```powershell
git status --short --branch
git fetch origin
git switch master
git pull --ff-only origin master
git merge-base --is-ancestor 9b24c692111f6ad9dffeb0d6c92fd9cc75db1e8c HEAD
git switch -c release/0.3.6-dsh-0.2.2-rc.3
```

验证：每条命令退出码为 0，基线包含上述合并提交。不从已合并的旧修复分支直接推发布 tag。

## 任务 2：修正发布入口

Consumes：现有 OIDC 工作流。Produces：经审阅合并的、只会把新候选发布到 `next` 的工作流。

修改 `.github/workflows/release.yml`，在任何推 tag 动作前通过单独 PR 合并：

1. 保留 `push.tags: v*`；删除现有可直接发包的 `workflow_dispatch` 入口。失败重试使用现有 tag 对应的 Actions 运行重试，不从任意分支手工发布。
2. 限制为非删除的 tag push，checkout 使用 `fetch-depth: 0` 并获取 `origin/master`，校验 tag 去掉前缀 `v` 后与包清单、锁文件两个根版本完全一致；校验 tag 指向的提交属于 `origin/master` 历史。
3. 保留安装、构建和测试门槛；增加按工作流与 tag 分组的并发互斥，不取消已进入发布阶段的运行。
4. 查询 npm 精确版本。仅确认 404 时视为未发布；网络、认证、服务错误全部停止，不能把任何查询失败都当成“版本不存在”。
5. 用 `npm pack --json` 生成一个 tarball，解析返回 JSON 的 `filename` 并检查文件清单、生成校验值。本次对应命令为 `npm publish dsh-github-copilot-accounts-0.3.6-dsh-0.2.2-rc.3.tgz --access public --tag next`；工作流从 pack JSON 读取文件名，始终发布同一个已校验文件。
6. 已存在的版本不能仅按“存在”跳过：核对 npm integrity、tag、候选产物；无法确认一致时失败，禁止重新上传或默默调整 dist-tag。
7. 设置 `contents: write` 和现有 `id-token: write` 权限，用 GitHub CLI 基于该 tag 创建非 Latest 的 prerelease，上传 tarball 和 SHA-256 附件；存在同名 Release 时核对后续传，不重建 tag。
8. 发布说明与附件由包文件清单、完整版本和该 tag 的提交生成；不得把本地日志、凭据、用户设置或测试 fixture 打入安装包。

验证：PR 中审查 YAML 与发布路径；CI 构建和测试成功。静态核对候选发布命令只含 `--tag next`，不存在候选流程写入 `latest` 的命令；实际发包仍须等待任务 5 的明确批准。

## 任务 3：准备候选包

Consumes：候选完整版本 `0.3.6-dsh-0.2.2-rc.3`。Produces：经校验的清单、锁文件、说明和本地 tarball。

先查询 npm 渠道和版本，确认候选未占用；网络错误不是未占用的证据：

```powershell
npm view dsh-github-copilot-accounts dist-tags versions --json --registry=https://registry.npmjs.org/
npm version 0.3.6-dsh-0.2.2-rc.3 --no-git-tag-version
npm ci --legacy-peer-deps --no-audit --no-fund
npm run build
npm test
npm pack --dry-run
npm pack
Get-FileHash .\dsh-github-copilot-accounts-0.3.6-dsh-0.2.2-rc.3.tgz -Algorithm SHA256
git diff --check
```

更新 README 中的版本示例和“未发布”说明，但不能提前声称已经 npm 发布。检查只改变所需元数据和构建产物，没有依赖升级。

验证：清单版本和两个锁文件根版本一致；测试无失败并如实列出跳过数；tarball 包含 manifest、全部 Host `.mjs`、Client 产物、patch、README 和 LICENSE，不含本机文件；哈希已记录。

## 任务 4：验收真实安装包

Consumes：任务 3 的 `.tgz`，不是 `link:` 源码安装。Produces：记录宿主版本、插件版本和结果的人工验收结论。

在独立测试环境安装该 tarball，完整重启 DSH `0.2.2-rc.3`。测试 profile 不等于凭据隔离，不能拿正在使用的重要会话做移除账号或回退试验。

- 确认安装来源是候选 `.tgz`，而不是旧 `link:`；插件能启动且没有模块加载或 locale 重复错误。
- 验证账号页、底部全局默认徽标、浅深主题及壁纸引擎青色/紫色配色即时同步。
- 验证齿轮进入“Copilot 账号”，不误点其他“更多”；设置已打开、账号菜单已展开时行为正确。
- 验证登录、切换全局默认、普通 Copilot 请求及用量展示；实际请求会消耗额度，需维护者授权使用测试账号。
- 由于 npm 旧版到本候选包含 Session 功能，额外验证新建测试 Session 的固定账号绑定、全局默认不覆盖已绑定会话、重启续接，以及账号不可用时明确失败、不静默换号。
- GHE、原生集成与回放/压缩等未实测能力必须逐项声明；57 个跳过测试不能替代这些验证。关键账号隔离或续接验证无法完成时，不提升 `latest`。
- 如无法获得可维护的完整原生 fixture，在 Release 中保留验证缺口和支持范围；不把本机离线测试描述成所有维护者可复现的完整覆盖。

验证：维护者明确确认结果；发现账号路由、凭据、会话或权限回归即停止。仅浏览器合成页面通过不满足此门槛。

## 任务 5：发布候选

Consumes：已合并的发布准备 PR、任务 4 验收结论、npm Trusted Publisher 授权、已确认的市场候选可见性。Produces：npm `next` 与 GitHub prerelease 指向同一完整版本。

确认 npm 包的 Trusted Publisher 仍绑定当前 owner/repo、`.github/workflows/release.yml`，且无需通过聊天传递任何密钥。确认市场源不会未经授权把候选当默认版分发；不能确认时停留在本地安装包测试。

在明确批准后，从最新 `master` 执行：

```powershell
git switch master
git pull --ff-only origin master
git status --short
node -p "require('./package.json').version"
git tag -a v0.3.6-dsh-0.2.2-rc.3 -m "Release 0.3.6-dsh-0.2.2-rc.3 candidate"
git push origin refs/tags/v0.3.6-dsh-0.2.2-rc.3
gh run list --workflow release.yml --limit 5
```

只有包版本确为候选、工作区干净且准备提交已合并时才推 tag；tag 创建失败、已存在或指向不符时停止，不强推。

工作流成功后验证：

```powershell
npm view dsh-github-copilot-accounts@0.3.6-dsh-0.2.2-rc.3 version engines dist.integrity --json --registry=https://registry.npmjs.org/
npm view dsh-github-copilot-accounts dist-tags --json --registry=https://registry.npmjs.org/
gh release view v0.3.6-dsh-0.2.2-rc.3 --json tagName,isPrerelease,assets,url
```

预期：`next` 为候选版本，`latest` 仍为发布前记录值；GitHub Release 是 prerelease，附件名和 SHA-256 一致。用发布附件再次安装验证，不用源码链接替代。

## 任务 6：提升正式渠道

Consumes：候选安装验收结论、维护者批准、npm dist-tag 管理权限。Produces：不重新上传的 npm `latest` 与正式 GitHub Release。

Release 内容说明必须覆盖从 npm 旧版以来的全部变化，不能只写 PR #14；特别说明 DSH 兼容范围、Session 账号路由、升级后完整重启、GHE 与测试缺口，以及旧版不识别新增路由的回退风险。

由有 npm 维护权限的操作者执行；OIDC 发包授权不等于本机自动具有 dist-tag 权限：

```powershell
npm dist-tag add dsh-github-copilot-accounts@0.3.6-dsh-0.2.2-rc.3 latest --registry=https://registry.npmjs.org/
gh release edit v0.3.6-dsh-0.2.2-rc.3 --prerelease=false --latest
npm view dsh-github-copilot-accounts dist-tags --json --registry=https://registry.npmjs.org/
```

验证：`latest` 指向已经验收的同一完整版本，`dist.integrity` 与候选阶段一致，GitHub Release 不再是 prerelease；DSH 市场索引更新后显示目标版本和宿主要求。索引更新不等于用户已安装版本自动升级。

## 任务 7：回退处置

Consumes：正式发布前记录的 npm dist-tags、已安装会话的路由兼容状态。Produces：停止默认分发问题版本，不修改用户数据。

若提升后发现严重问题，经维护者批准将 `latest` 指回发布前的旧版：

```powershell
npm dist-tag add dsh-github-copilot-accounts@0.1.2-dsh-0.2.0-rc.1 latest --registry=https://registry.npmjs.org/
npm dist-tag rm dsh-github-copilot-accounts next --registry=https://registry.npmjs.org/
npm deprecate dsh-github-copilot-accounts@0.3.6-dsh-0.2.2-rc.3 "Release withdrawn: account/session regression under investigation. Review upgrade and rollback guidance before changing versions." --registry=https://registry.npmjs.org/
npm view dsh-github-copilot-accounts dist-tags --json --registry=https://registry.npmjs.org/
```

只有 `next` 仍指向问题候选时才移除；如果期间已有更新的候选，不得删除别人的渠道。若发布前 `latest` 已变更，以上旧版命令必须替换为本次正式提升前实际记录的版本，再审阅后执行。

GitHub Release 标记撤回并说明影响，同时更新实际市场索引。不要删除或重打已发布 tag，不使用 `npm unpublish` 作为默认回退方式。调整 dist-tag 不会使已安装实例自动降级，市场也可能不按 dist-tag 选择版本。

旧正式版不认识固定账号路由；已经使用新路由的 Session 不能保证直接降级可用。优先停止问题能力并发布修复版本；确需降级时保留凭据和 Session，逐会话确认可用模型与路由，不自动改绑、不后台重跑请求。

验证：npm 默认渠道回到批准版本；问题版本有明确撤回说明；已安装用户收到操作提示；受影响测试 Session 的恢复方案可用，不把渠道回退描述成会话数据回滚。

## 执行纪律与最终门槛

- 开始实现前批判性复查本计划；缺项、版本冲突、无效命令或流程变化先修计划并取得批准。
- 按任务顺序执行，每步运行本步验证。遇阻塞或重复失败立即说明，不猜测、不绕过门槛。
- 若当前在 `master`，未经明确同意不直接实现；使用发布准备分支和 PR。
- 本方案批准不自动等于批准实际对外发布；推 tag 与提升 `latest` 前分别取得确认。
- 最终核对包清单、lock、tag、npm 版本、integrity、Release 附件、渠道、市场条目、人工验收及回退说明一致。
- 完成后报告实际版本、Git tag、npm 渠道、GitHub Release 链接、测试通过/跳过数和未验证能力。

## 计划自检

已按设计覆盖度、版本与路径一致性、命令可执行性、任务依赖和验证完整性做一轮自检。工作流改造、候选包准备、真实安装验收、候选发布、渠道提升和回退各有独立验证；未执行任何发布操作。

## 发布准备实施记录

- 已从包含 PR #14 的 `origin/master` 创建 `release/0.3.6-dsh-0.2.2-rc.3`，保留原计划文档。
- 已实现 tag-only / npm `next` 工作流，使用完整历史校验 `master` 祖先，校验 GitHub 远端 tag 实际提交；不依赖 Release 的描述性 `target_commitish`。
- 已实现打包一次、npm 内容校验、GitHub 草稿预发布、安装包与 SHA-256 附件上传，以及下载后逐字节核验。附件全部核验成功才公开；已有附件不同则失败，不覆盖。
- 已同步候选版本、锁文件与发布说明；本机 npm 客户端对精确候选版本返回 E404。Node 直连 registry 曾超时，超时没有被当作未发布；工作流部署到 GitHub runner 后仍须重新查询。
- 已生成本地 `.tgz`，32 个分发文件通过严格白名单与 npm hash 校验；真实安装包验收、市场候选可见性确认、OIDC 授权的真实发包与 Release 页面核验尚未执行。
- 对外发布、推 tag、自动合并和提升 `latest` 均未执行。
