// 两半区共享的 HTTP API 契约。路由前缀固定、不做配置项：
// client 侧 fetch 硬编码同一路径，配置一旦漂移 client 即 404（见计划附录 B）。
// 多账号模型（参考 GitHub Copilot desktop Accounts 页）：
//   - 主凭据 llm-pi-ai/github-copilot 恒等于「当前激活账号」的 grant 镜像，
//     pi-ai 的请求路径只读它（llm-pi-ai/adapter 的 credentialStore 按
//     providerId 寻址），登录也只写它。
//   - 其余账号由本插件以自有 scope 存槽位记录 copilot-auth/account-<login>，
//     payload = pi-ai grant + account 元数据；「激活」= 槽位 payload 写主 key。
export const CREDENTIAL_KEY = "llm-pi-ai/github-copilot";
export const ACCOUNT_SCOPE = "copilot-auth";
export const ROUTE_PREFIX = "/copilot-auth";

export const routes = () => ({
  start: `${ROUTE_PREFIX}/start`,
  state: `${ROUTE_PREFIX}/state`,
  accounts: `${ROUTE_PREFIX}/accounts`,
  activate: `${ROUTE_PREFIX}/activate`,
  logout: `${ROUTE_PREFIX}/logout`,
  cancel: `${ROUTE_PREFIX}/cancel`,
  open: `${ROUTE_PREFIX}/open`,
  whoami: `${ROUTE_PREFIX}/whoami`,
});

export const emptyState = () => ({
  status: "idle",
  notices: [],
  error: undefined,
  kind: undefined,
  domain: undefined,
});

// 与 pi-ai 同构的域名归一：接受裸域名或带协议 URL，回主机名；空/非法 → null。
// ghe.com 登录由此把用户输入折叠成设备码流可用的 host（getUrls 同款语义）。
export function normalizeDomain(input) {
  if (typeof input !== "string") return null;
  const trimmed = input.trim();
  if (trimmed === "") return null;
  try {
    return new URL(trimmed.includes("://") ? trimmed : `https://${trimmed}`).hostname;
  } catch {
    return null;
  }
}

// 槽位地址：copilot-auth/account-<login>。两段都必须满足凭据 key 语法
// [a-z][a-z0-9-]*：login 统一小写、非法字符折叠为 -（GitHub login 本身
// 只含字母数字连字符，实际不会触发）；空串落 recovered 占位（host 侧用
// recovered-<n> 探测空闲位，此处只兜底防空段）。
export function accountSlotId(login) {
  const clean = String(login).toLowerCase().replace(/[^a-z0-9-]/g, "-");
  return `account-${clean === "" ? "recovered" : clean}`;
}

export const accountKey = (login) => `${ACCOUNT_SCOPE}/${accountSlotId(login)}`;

// 身份/用量/token 刷新三端点同构于 api.<domain>（对齐 pi-ai getUrls：
// copilot_internal/v2/token 就在 api.<domain> 下；ghe.com 租户的 REST
// 基址同为 api.<域名>）。
export const apiBase = (domain) => `https://api.${domain}`;
