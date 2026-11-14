import { normalizeDomain } from "./shared.mjs";

export class AccountRefreshHttpError extends Error {
  constructor(message, status) { super(message); this.name = "AccountRefreshHttpError"; this.code = "ACCOUNT_REFRESH_HTTP"; if (status !== undefined) this.status = status; }
}
const fail = () => new AccountRefreshHttpError("Copilot account refresh integration is unavailable");
const HEADERS = Object.freeze({
  accept: "application/json", "User-Agent": "GitHubCopilotChat/0.35.0",
  "Editor-Version": "vscode/1.107.0", "Editor-Plugin-Version": "copilot-chat/0.35.0", "Copilot-Integration-Id": "vscode-chat",
});

// Match native pi-ai 1.3.0's available-model policy, without enabling models or
// changing subscription policy. Individual's all-picker-false fallback is NOT
// applied to enterprise endpoints. Unknown/new ids remain harmless metadata:
// the account adapter intersects them with its configured native catalog.
export function parseAccountModelIds(raw, individual = false) {
  if (!Array.isArray(raw?.data)) throw new AccountRefreshHttpError("Invalid Copilot account model catalog");
  const models = raw.data.filter((item) => item && typeof item === "object" && typeof item.id === "string"
    && item.id !== "" && item.capabilities?.supports?.tool_calls !== false);
  let available = models.filter((item) => item.model_picker_enabled === true && item.policy?.state !== "disabled");
  if (individual && available.length === 0) available = models.filter((item) => item.policy?.state === "enabled");
  return [...new Set(available.map((item) => item.id))];
}
function modelEndpoint(baseUrl, domain) {
  let url;
  try { url = new URL(baseUrl); } catch { throw fail(); }
  const host = url.hostname;
  if (url.protocol !== "https:" || url.username || url.password || url.port || url.search || url.hash
    || !["", "/"].includes(url.pathname)
    || !(host === "api.githubcopilot.com" || host.endsWith(".githubcopilot.com")
      || domain !== "github.com" && host === `copilot-api.${domain}`)) {
    throw new AccountRefreshHttpError("Unsupported native Copilot account endpoint");
  }
  return { url: `${url.origin}/models`, individual: url.origin === "https://api.individual.githubcopilot.com" };
}

// Internal server-side callback ONLY. It accepts a stored grant, not a client URL;
// it returns to the locked credential helper, never to an HTTP/UI response.
// deriveAuth is the installed native OAuth.toAuth, used only to derive the
// credential-specific endpoint. Its apiKey output is NEVER used as an override.
export function createAccountRefreshHttp({ fetchImpl = (...args) => fetch(...args), deriveAuth } = {}) {
  if (typeof fetchImpl !== "function" || typeof deriveAuth !== "function") throw fail();
  return async ({ payload, domain, signal } = {}) => {
    const stored = normalizeDomain(payload?.enterpriseUrl) ?? normalizeDomain(payload?.account?.domain) ?? "github.com";
    if (typeof domain !== "string" || domain !== stored || normalizeDomain(domain) !== domain
      || !(domain === "github.com" || domain.endsWith(".ghe.com"))) {
      throw new AccountRefreshHttpError("Session account routes support github.com and GitHub Enterprise Cloud domains only");
    }
    if (payload?.type !== "oauth" || typeof payload.refresh !== "string" || payload.refresh.trim() === ""
      || /[\u0000-\u001f\u007f]/.test(payload.refresh)) throw fail();
    let headers;
    try { headers = new Headers({ ...HEADERS, authorization: `Bearer ${payload.refresh}` }); }
    catch { throw fail(); }
    const request = async (url, init) => {
      let response;
      try { response = await fetchImpl(url, { ...init, signal, redirect: "error" }); }
      catch { throw new AccountRefreshHttpError("Copilot account refresh request failed"); }
      if (!response?.ok) throw new AccountRefreshHttpError("Copilot account refresh was refused", Number.isInteger(response?.status) ? response.status : undefined);
      try { return await response.json(); }
      catch { throw new AccountRefreshHttpError("Invalid Copilot account refresh response"); }
    };
    const data = await request(`https://api.${domain}/copilot_internal/v2/token`, { headers });
    const expires = typeof data?.expires_at === "number" ? data.expires_at * 1000 - 5 * 60 * 1000 : NaN;
    if (typeof data?.token !== "string" || data.token.trim() === "" || /[\u0000-\u001f\u007f]/.test(data.token)
      || !Number.isFinite(expires)
      || (data.refresh_in !== undefined && (typeof data.refresh_in !== "number" || !Number.isFinite(data.refresh_in)))) {
      throw new AccountRefreshHttpError("Invalid Copilot account refresh response");
    }
    let modelHeaders, auth;
    try { modelHeaders = new Headers({ ...HEADERS, authorization: `Bearer ${data.token}`, "X-GitHub-Api-Version": "2026-06-01" }); }
    catch { throw new AccountRefreshHttpError("Invalid Copilot account refresh response"); }
    try { auth = await deriveAuth({ ...payload, access: data.token, expires,
      enterpriseUrl: domain === "github.com" ? undefined : domain }); }
    catch { throw new AccountRefreshHttpError("Copilot account endpoint resolution failed"); }
    const endpoint = modelEndpoint(auth?.baseUrl, domain);
    const availableModelIds = parseAccountModelIds(await request(endpoint.url, { headers: modelHeaders }), endpoint.individual);
    // Updating expiry alone would otherwise starve the native OAuth refresh that
    // updates availableModelIds. Persist both atomically under the same slot lock.
    return { access: data.token, expires, availableModelIds,
      ...(data.refresh_in === undefined ? {} : { refreshIn: data.refresh_in }) };
  };
}
