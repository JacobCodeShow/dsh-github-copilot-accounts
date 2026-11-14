// App-internal credential provenance. Accept only the already validated stored
// OAuth grant, never an access token or a client-supplied identity. The digest is
// safe cache metadata; neither raw long grant nor short access is returned/logged.
import { createHash } from "node:crypto";
import { normalizeDomain } from "./shared.mjs";
export const isAccountCredentialIdentity = (value) => typeof value === "string" && /^sha256:[a-f0-9]{64}$/.test(value);
export function accountCredentialIdentity(payload) {
  if (payload?.type !== "oauth" || typeof payload.refresh !== "string" || payload.refresh.trim() === "") throw new Error("Copilot credential identity is unavailable");
  // Matches native githubCopilotOAuth.copilotEnterpriseDomain: enterpriseUrl is
  // authoritative; account.domain is display metadata, not an auth issuer.
  const issuer = payload.enterpriseUrl === undefined || payload.enterpriseUrl === null || payload.enterpriseUrl === "" ? "github.com" : normalizeDomain(payload.enterpriseUrl);
  if (typeof issuer !== "string" || issuer === "") throw new Error("Copilot credential identity is unavailable");
  return "sha256:" + createHash("sha256").update(JSON.stringify([1, issuer, payload.refresh])).digest("hex");
}
