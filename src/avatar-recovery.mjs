// Client-only recovery: avatar URLs remain opaque and are never logged/modified.
export function createProfileRequester(fetchImpl = (...args) => fetch(...args)) {
  const pending = new Map();
  return (id) => {
    if (typeof id !== "string" || id === "") return Promise.reject(new Error("Account id required"));
    if (pending.has(id)) return pending.get(id);
    const request = Promise.resolve().then(async () => {
      const response = await fetchImpl("/copilot-auth/profile", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id }),
      });
      if (!response.ok) throw new Error("Avatar profile refresh failed");
      const data = await response.json();
      if (data?.ok !== true) throw new Error("Avatar profile refresh failed");
      return typeof data.avatarUrl === "string" && data.avatarUrl !== "" ? data.avatarUrl : undefined;
    }).finally(() => { if (pending.get(id) === request) pending.delete(id); });
    pending.set(id, request);
    return request;
  };
}

export const requestAvatarProfile = createProfileRequester();

// Framework-independent state machine. configure() is safe during rendering: it
// never publishes. generation invalidates promises; revision invalidates events
// from the previous <img> and forces one remount even if the URL is unchanged.
export function createAvatarRecovery(requestProfile = requestAvatarProfile) {
  let id, inputSource, source, scopeKey, requester = requestProfile, failed = false, attempted = false;
  let generation = 0, revision = 0, mounted = true;
  let recoveredSource, scopeIsCurrent = () => true;
  const validScope = () => { try { return scopeIsCurrent() === true; } catch { return false; } };
  const listeners = new Set();
  const publish = () => { for (const listener of listeners) listener(); };
  const snapshot = () => ({ source, failed, revision });
  return {
    configure(nextId, nextSource, options) {
      const nextScope = options?.scopeKey;
      scopeIsCurrent = typeof options?.isCurrent === "function" ? options.isCurrent : () => true;
      requester = options !== undefined && Object.hasOwn(options, "requestProfile") ? options.requestProfile : requestProfile;
      if (scopeKey === nextScope && id === nextId && inputSource === nextSource) return;
      // Parent GET catches up within this exact Host/Session scope: keep budget.
      if (scopeKey === nextScope && id === nextId && attempted && recoveredSource !== undefined && nextSource === recoveredSource) {
        inputSource = nextSource;
        return;
      }
      id = nextId;
      scopeKey = nextScope;
      inputSource = source = nextSource;
      recoveredSource = undefined;
      failed = attempted = false;
      generation++;
      revision++;
    },
    snapshot,
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    mount() { if (!mounted) { mounted = true; publish(); } },
    unmount() { mounted = false; generation++; revision++; },
    async fail(imageRevision, onRecovered) {
      if (!mounted || imageRevision !== revision || !validScope()) return;
      failed = true;
      publish();
      if (attempted || typeof id !== "string" || id === "" || !source || typeof requester !== "function") return;
      attempted = true;
      const currentGeneration = generation;
      const request = requester;
      try {
        const nextSource = await request(id);
        if (!mounted || generation !== currentGeneration || !validScope()) return;
        if (nextSource !== undefined) {
          source = recoveredSource = nextSource;
          revision++;
          failed = false;
          publish();
        }
        // Parent synchronization must not itself start another image recovery.
        // It can be async; absorb failures without logging URLs or response text.
        try { Promise.resolve(onRecovered?.(nextSource)).catch(() => {}); } catch { /* fallback is already safe */ }
      } catch {
        // Leave the initial-letter fallback; errors may contain sensitive URLs.
      }
    },
  };
}
