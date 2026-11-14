# Copilot “Usage billed to” 分账用量只读调查

调查日期：2026-11-11。仅访问公开 GitHub Docs /公开 VS Code 源码；未读取任何真实凭据、token、cookie、私有账号页面或调用真实账号 API；无生产代码改动。

## 结论

**同一个账号可以在具备相应权限时读取按不同组织/企业计费的 AI credit 用量报告，但当前插件的 Copilot 用户用量接口不能据已知公开证据直接枚举网页 “Usage billed to” 的各个选项或读出每项独立余量。**

公开计费 REST API 与普通 Copilot OAuth 用户接口是两套不同的数据/权限边界。网页下拉选项的确切 list/usage 请求、账号当前是否有权限、以及选项是显示过滤还是会修改未来模型请求的计费实体，仍未验证。不能猜测 `org`、`billing_entity_id` 等参数添加到 `/copilot_internal/user`，也不能假设选一次网页选项就改变 DSH 模型路由或计费。

## 当前实现/官方客户端证据

- [当前插件](../src/host.mjs#L347-L392) 仅 GET `api.<issuer>/copilot_internal/user`，读取 `quota_snapshots.premium_interactions`，形成一个 account 级 snapshot；无 billing-context 参数。
- [VS Code CopilotToken 类型](https://raw.githubusercontent.com/microsoft/vscode-copilot-chat/main/src/platform/authentication/common/copilotToken.ts) 的 `CopilotUserInfo` 有 `organization_login_list`、`organization_list`，注释是提供 Copilot access 的组织。其 `ExtendedTokenInfo` 仍只携带一个 `quota_snapshots`。
- [VS Code quota 类型](https://raw.githubusercontent.com/microsoft/vscode-copilot-chat/main/src/platform/chat/common/chatQuotaService.ts) 说明此 quota 来自 `copilot_internal/user`，包含 chat/completions/premium_interactions，但没有按 billing entity 分组的列表。
- [VS Code user info 请求实现](https://raw.githubusercontent.com/microsoft/vscode-copilot-chat/main/src/platform/authentication/node/copilotTokenManager.ts) 的 `fetchCopilotUserInfo` 请求 `RequestType.CopilotUserInfo`，读取上述一个用户 snapshot。没有发现由它实现网页账单下拉选项枚举。

这些源文件证据不构成“所有内部 API 都不存在”的证明，只能说明不能从已见接口推导分账选项。

## 实际已公开的只读 API

来源：[GitHub Docs Billing usage](https://docs.github.com/en/rest/billing/usage)；完整 article body [普通用户/组织版](https://docs.github.com/api/article/body?pathname=/en/rest/billing/usage)、[Enterprise Cloud 版](https://docs.github.com/api/article/body?pathname=/en/enterprise-cloud@latest/rest/billing/usage)。当前文档 API 版本 `2026-03-10`。

| 数据层级 | 文档明确路径 | 权限与限制 |
|---|---|---|
| 组织 AI credits | `GET /organizations/{org}/settings/billing/ai_credit/usage` | 组织 administrator；支持 year/month/day/user/model/product。不是普通成员权限保证。 |
| 企业 AI credits | `GET /enterprises/{enterprise}/settings/billing/ai_credit/usage` | 企业管理员、billing manager、企业中的组织 owner、具备细粒度 enterprise billing read 的自定义角色；企业安装 GitHub App 的 billing read 也可用。支持 organization/user/model/product/cost_center_id。 |
| 个人 AI credits | `GET /users/{username}/settings/billing/ai_credit/usage` | **仅计费到个人自己购买的 Copilot plan 的用量。组织/企业管理并计费的 usage 不包含在用户端点中。** |
| 旧 PRU 报告 | 同层级 `/settings/billing/premium_request/usage` | 与 AI credit 路径分开；不能自动认作新 AI credits。 |

这些用量报告包含 `usageItems` 的 product/sku/model/unitType/pricePerUnit、grossQuantity/discountQuantity/netQuantity、grossAmount/discountAmount/netAmount 等。**没有**可直接替代当前菜单的 entitlement/remaining 百分比，也没有网页下拉 billing-options 列表。

文档可以读过去 24 个月。组织/企业端点可按 user 筛个人消耗，但它是组织/企业账单下的用户消耗，不是这个用户的个人账单。未对用户的 GHE tenant、已有 Copilot OAuth token 对这些新端点的权限/可用性做真实验证。

## 新 AI credits 与旧 premium requests

- [Monitoring AI credit usage](https://raw.githubusercontent.com/github/docs/main/content/copilot/how-tos/manage-and-track-spending/monitor-ai-usage.md)：Business/Enterprise 用户可在自己的 Copilot settings 看 individual consumption；有 user-level budget 显示 used / budget，没有预算只显示 consumed credits，不能据此制造一个个人剩余额度分母。
- [Usage-based billing](https://raw.githubusercontent.com/github/docs/main/content/copilot/concepts/billing-and-usage/organizations-and-enterprises/billing.md)：Business/Enterprise 的 included credits **按 billing entity 共享池化**。例如 100 个 Business 用户是一个 shared pool，不是 100 个独立余额桶。其他 Copilot access 可能没有 included allowance，第一笔即计费。
- [Manage company spending](https://raw.githubusercontent.com/github/docs/main/content/copilot/how-tos/manage-and-track-spending/manage-company-spending.md)：企业 AI usage 可以按 user/model/organization/cost center 过滤。不同组织视图可能属于同一个企业池，不能盲目相加或把组织 seat 视为独立 credit bucket。
- [Seat assignment](https://raw.githubusercontent.com/github/docs/main/content/copilot/reference/copilot-billing/seat-assignment.md)：同一企业下多个组织给同一用户分配 seat，seat 只按 unique user 计费一次；这也不能证明每项 dropdown 独立额度。
- [Legacy premium monitoring](https://raw.githubusercontent.com/github/docs/main/content/copilot/reference/copilot-billing/request-based-billing-legacy/monitor-premium-requests.md) 当前已被 GitHub 标为 legacy。旧字段名 premium_interactions 不能单靠 UI 标签强行认作新 credit 数据；需与真实 tenant 返回值/账单体系校准。

## 网页 “Usage billed to” 含义：未确认点

公开资料支持“选择/过滤计费实体以查看该实体账单数据”这类概念，但本次没有得到该 exact dropdown 的公开 frontend 实现/API contract。

不能据当前资料确认：

1. 每个选项对应 org、enterprise、个人 billing account，还是别的 cost-center/user-budget 视图。
2. 普通 Copilot 成员怎样通过个人 endpoint 枚举并读取每个选项。
3. 每项是否 independent allowance/budget，抑或同一共享池的分组/过滤视图。
4. 下拉是否仅切换展示，或具有“未来 inference billing target”副作用。
5. 网页会话 cookie/private CSRF endpoint 的字段是否可用于 Copilot OAuth/native provider 请求。

## 下一步最小安全验证

如用户需要精确复现其网页每个选项：先让用户提供**去敏的网络请求 metadata**（切换前后 endpoint 路径、HTTP 方法、非秘密参数名、返回字段结构；不要 HAR 原件、cookies、Authorization、token）。先确认是只读 GET、验证每个选项的实体类型与单位，再评估公开 REST 或已发布原生接口能否读取。

真实账号 API 实验必须单独由父 agent 在用户允许范围内进行，使用 Bash composition/gh 内部认证，过滤输出，绝不获取或打印 token/凭据。不能为普通成员冒充管理员或绕过网页 cookie 权限。

实现中保持 account id 与 billing-context id 两个不同维度；只读报表不能悄悄修改模型发送账号或计费目标。若只提供用于参考的各账号百分比平均/合计，应明确它不是真实 credit 金额加权、不是新账单池余额；本调查不授权加入或合计未验证的 billing dropdown 选项。

## 调查边界

一次 GitHub public contents API 返回 unauthenticated rate limit 403，之后没有用账号/token 提升权限；已用公开 raw 文件和 GitHub Docs article body完成关键证据。网页具体 selector 未访问、未登录、未调用内部计费端点。没有生产改动。
