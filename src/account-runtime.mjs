import { createAccountAdapter } from "./account-adapter.mjs";
import { compileAccountProfile } from "./account-profile.mjs";
import { createProfiledAccountAdapter } from "./account-profiled-adapter.mjs";

export class AccountRuntimeError extends Error {
  constructor(message) { super(message); this.name = "AccountRuntimeError"; this.code = "ACCOUNT_RUNTIME_UNAVAILABLE"; }
}

/**
 * Import through the running Host's public Loader, not hardcoded app.asar paths
 * or a guessed profile/node_modules tree. Importing modules does not access any
 * user account. Callers must gate registration on the live default-policy marker.
 */
export async function loadAccountRuntime({ loader, importModule } = {}) {
  const load = importModule ?? (typeof loader?.import === "function" ? loader.import.bind(loader) : undefined);
  if (typeof load !== "function") throw new AccountRuntimeError("DSH plugin module loader is unavailable");
  let llm, pi, cordis, protocol, native, schema;
  try {
    [llm, pi, cordis, protocol, native, schema] = await Promise.all([
      load("@deepseek-ai/dsh-llm"),
      load("@deepseek-ai/dsh-llm-pi-ai"),
      load("@deepseek-ai/cordis"),
      load("@deepseek-ai/dsh-typert-protocol"),
      load("@earendil-works/pi-ai/providers/github-copilot"),
      load("@deepseek-ai/schemastery"),
    ]);
  } catch {
    // Do not leak loader diagnostics, local paths or credential-bearing URLs.
    throw new AccountRuntimeError("This DSH runtime cannot load the native Copilot account adapter");
  }
  if (typeof llm?.LlmAdapter !== "function" || typeof llm?.LlmError !== "function"
    || typeof pi?.PiAiAdapter !== "function" || typeof pi.PiAiAdapter.prototype.prepareCall !== "function"
    || typeof pi.PiAiAdapter.prototype.current !== "function" || typeof pi.Config !== "function" || typeof pi.apply !== "function"
    || typeof cordis?.Context !== "function" || typeof protocol?.Remote !== "function"
    || typeof protocol.TypertRemoteService !== "function" || typeof protocol.RemoteError !== "function" || typeof protocol.principalOf !== "function"
    || typeof native?.githubCopilotProvider !== "function" || typeof schema?.default?.object !== "function"
    || typeof llm.lastAssistantStreamChunk !== "function") {
    throw new AccountRuntimeError("This DSH runtime does not expose the required Copilot adapter capabilities");
  }
  return Object.freeze({
    async createAdapter(options) {
      const { profile = {}, onPublish, ...owned } = options;
      const createDelegate = async (raw) => {
        const compiled = await compileAccountProfile({ Context: cordis.Context, Config: pi.Config,
          applyPiAi: pi.apply, createNativeProvider: native.githubCopilotProvider, profile: raw, LlmError: llm.LlmError });
        return createAccountAdapter({ ...owned, ...compiled,
          LlmAdapter: llm.LlmAdapter, LlmError: llm.LlmError, PiAiAdapter: pi.PiAiAdapter });
      };
      return createProfiledAccountAdapter({ LlmAdapter: llm.LlmAdapter, LlmError: llm.LlmError,
        createDelegate, initialProfile: profile, accountId: owned.accountId, routeId: owned.routeId, onPublish });
    },
    deriveAuth: (grant) => native.githubCopilotProvider().auth.oauth.toAuth(grant),
    remoteProtocol: Object.freeze({ Remote: protocol.Remote, RemoteError: protocol.RemoteError,
      TypertRemoteService: protocol.TypertRemoteService, principalOf: protocol.principalOf }),
    Context: cordis.Context,
    LlmError: llm.LlmError,
    LlmAdapter: llm.LlmAdapter,
    symbols: cordis.symbols,
    Schema: schema.default,
    lastAssistantStreamChunk: llm.lastAssistantStreamChunk,
    resolveImageAccess: llm.resolveImageAttachmentAccess,
    resolveRetryPolicy: llm.resolveRetryPolicy,
  });
}
