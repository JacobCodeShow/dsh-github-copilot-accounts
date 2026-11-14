window.__ModuleLoader__.load({
	id: "dsh-github-copilot-accounts",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name2 in all)
    __defProp(target, name2, { get: all[name2], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/client.jsx
var client_exports = {};
__export(client_exports, {
  apply: () => apply,
  inject: () => inject,
  name: () => name
});
module.exports = __toCommonJS(client_exports);
var import_react = require("react");
var import_react_dom = require("react-dom");
var import_dsh_client_ui_primitives = require("@deepseek-ai/dsh-client-ui-primitives");

// src/avatar-recovery.mjs
function createProfileRequester(fetchImpl = (...args) => fetch(...args)) {
  const pending = /* @__PURE__ */ new Map();
  return (id) => {
    if (typeof id !== "string" || id === "") return Promise.reject(new Error("Account id required"));
    if (pending.has(id)) return pending.get(id);
    const request = Promise.resolve().then(async () => {
      const response = await fetchImpl("/copilot-auth/profile", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id })
      });
      if (!response.ok) throw new Error("Avatar profile refresh failed");
      const data = await response.json();
      if (data?.ok !== true) throw new Error("Avatar profile refresh failed");
      return typeof data.avatarUrl === "string" && data.avatarUrl !== "" ? data.avatarUrl : void 0;
    }).finally(() => {
      if (pending.get(id) === request) pending.delete(id);
    });
    pending.set(id, request);
    return request;
  };
}
var requestAvatarProfile = createProfileRequester();
function createAvatarRecovery(requestProfile = requestAvatarProfile) {
  let id, inputSource, source, scopeKey, requester = requestProfile, failed = false, attempted = false;
  let generation = 0, revision = 0, mounted = true;
  let recoveredSource, scopeIsCurrent = () => true;
  const validScope = () => {
    try {
      return scopeIsCurrent() === true;
    } catch {
      return false;
    }
  };
  const listeners = /* @__PURE__ */ new Set();
  const publish = () => {
    for (const listener of listeners) listener();
  };
  const snapshot = () => ({ source, failed, revision });
  return {
    configure(nextId, nextSource, options) {
      const nextScope = options?.scopeKey;
      scopeIsCurrent = typeof options?.isCurrent === "function" ? options.isCurrent : () => true;
      requester = options !== void 0 && Object.hasOwn(options, "requestProfile") ? options.requestProfile : requestProfile;
      if (scopeKey === nextScope && id === nextId && inputSource === nextSource) return;
      if (scopeKey === nextScope && id === nextId && attempted && recoveredSource !== void 0 && nextSource === recoveredSource) {
        inputSource = nextSource;
        return;
      }
      id = nextId;
      scopeKey = nextScope;
      inputSource = source = nextSource;
      recoveredSource = void 0;
      failed = attempted = false;
      generation++;
      revision++;
    },
    snapshot,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    mount() {
      if (!mounted) {
        mounted = true;
        publish();
      }
    },
    unmount() {
      mounted = false;
      generation++;
      revision++;
    },
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
        if (nextSource !== void 0) {
          source = recoveredSource = nextSource;
          revision++;
          failed = false;
          publish();
        }
        try {
          Promise.resolve(onRecovered?.(nextSource)).catch(() => {
          });
        } catch {
        }
      } catch {
      }
    }
  };
}

// src/avatar-image-cache.mjs
var AvatarImageCacheError = class extends Error {
  constructor() {
    super("Avatar image cache is unavailable");
    this.name = "AvatarImageCacheError";
  }
};
var text = (value) => typeof value === "string" && value.length > 0;
var positive = (value) => Number.isSafeInteger(value) && value > 0;
var INVALID = Object.freeze({ status: "invalid", hasImage: false, refreshing: false, stale: false, revision: 0 });
var inert = (reason) => {
  const state = Object.freeze({ status: "fallback", hasImage: false, refreshing: false, stale: false, reason, revision: 0 });
  return Object.freeze({ snapshot: () => state, subscribe: () => () => {
  }, attach: () => () => {
  }, updateSource() {
  }, refresh: () => Promise.resolve(false), settled: () => Promise.resolve(false), release() {
  } });
};
function createAvatarImageCache({
  createImage = () => new Image(),
  now = () => globalThis.performance?.now?.() ?? Date.now(),
  schedule = (fn, delay) => setTimeout(fn, delay),
  cancel = (timer) => clearTimeout(timer),
  ttlMs = 5 * 6e4,
  hardTtlMs = 30 * 6e4,
  retryMs = 6e4,
  loadTimeoutMs = 15e3,
  maxEntries = 32,
  maxSlots = 2,
  maxPending = 4,
  maxPixels = 4 * 1024 * 1024,
  maxImagePixels = 1024 * 1024
} = {}) {
  if (![createImage, now, schedule, cancel].every((value) => typeof value === "function") || ![ttlMs, hardTtlMs, retryMs, loadTimeoutMs, maxEntries, maxSlots, maxPending, maxPixels, maxImagePixels].every(positive) || hardTtlMs < ttlMs || maxSlots > 2 || maxImagePixels > maxPixels) throw new AvatarImageCacheError();
  const scopes = /* @__PURE__ */ new Map(), lru = /* @__PURE__ */ new Map(), queue = /* @__PURE__ */ new Set(), owners = /* @__PURE__ */ new WeakMap(), retiredScopes = /* @__PURE__ */ new WeakSet();
  let closed = false, closing = false, pixels = 0, inflight = 0, pumping = false;
  const liveEntry = (entry) => !closed && !entry.removed && scopes.get(entry.scope)?.get(entry.key) === entry;
  const live = (slot) => liveEntry(slot.entry) && !slot.removed && slot.entry.slots.get(slot.key) === slot;
  const stop = (timer) => {
    if (timer !== void 0) cancel(timer);
  };
  const touch = (entry) => {
    if (liveEntry(entry)) {
      entry.touched = now();
      lru.delete(entry);
      lru.set(entry, true);
    }
  };
  const detachNode = (node, container) => {
    try {
      if (node?.parentNode === container) container.removeChild(node);
    } catch {
    }
  };
  const discard = (image) => {
    if (!image) return;
    image.onload = image.onerror = null;
    try {
      image.removeAttribute?.("src");
    } catch {
    }
  };
  const detach = (lease) => {
    const binding = lease.binding;
    if (!binding) return;
    if (owners.get(binding.container) === binding) {
      detachNode(lease.shown, binding.container);
      owners.delete(binding.container);
    }
    lease.shown = lease.binding = void 0;
  };
  const present = (slot) => {
    const lease = slot.lease, binding = lease?.binding;
    if (!binding || owners.get(binding.container) !== binding) return;
    const node = live(slot) && lease.current() ? slot.good?.image : void 0;
    if (lease.shown === node) return;
    detachNode(lease.shown, binding.container);
    lease.shown = void 0;
    if (node) {
      try {
        binding.container.appendChild(node);
        lease.shown = node;
      } catch {
      }
    }
  };
  const publish = (slot) => {
    slot.state = Object.freeze({
      status: !live(slot) ? "invalid" : slot.good ? "ready" : slot.pending ? "loading" : "fallback",
      hasImage: live(slot) && slot.good !== void 0,
      refreshing: live(slot) && slot.good !== void 0 && slot.pending !== void 0,
      stale: live(slot) && slot.good !== void 0 && now() >= slot.good.at + ttlMs,
      reason: slot.reason,
      failureRevision: slot.failureRevision,
      revision: slot.revision
    });
    present(slot);
    for (const listener of [...slot.lease?.listeners ?? []]) {
      try {
        listener();
      } catch {
      }
    }
  };
  const dropGood = (slot) => {
    const previous = slot.good;
    if (!previous) return;
    slot.good = void 0;
    pixels -= previous.pixels;
    present(slot);
    discard(previous.image);
  };
  const removeSlot = (slot) => {
    if (slot.removed) return;
    slot.removed = true;
    stop(slot.timer);
    slot.timer = void 0;
    slot.pending?.finish(false, true);
    dropGood(slot);
    slot.revision++;
    publish(slot);
    if (slot.lease) detach(slot.lease);
    slot.entry.slots.delete(slot.key);
  };
  const removeEntry = (entry) => {
    if (!liveEntry(entry)) return;
    entry.removed = true;
    for (const slot of [...entry.slots.values()]) removeSlot(slot);
    scopes.get(entry.scope).delete(entry.key);
    if (!scopes.get(entry.scope).size) scopes.delete(entry.scope);
    lru.delete(entry);
  };
  const inactiveEntry = () => [...lru.keys()].find((entry) => [...entry.slots.values()].every((slot) => !slot.lease));
  const reserve = (slot, area) => {
    const oldArea = slot.good?.pixels ?? 0;
    while (pixels - oldArea + area > maxPixels) {
      let victim;
      for (const entry of lru.keys()) {
        victim = [...entry.slots.values()].find((candidate) => candidate !== slot && !candidate.lease && candidate.good);
        if (victim) break;
      }
      if (!victim) return false;
      removeSlot(victim);
      if (!victim.entry.slots.size) removeEntry(victim.entry);
    }
    return true;
  };
  const plan = (slot) => {
    stop(slot.timer);
    slot.timer = void 0;
    if (!live(slot)) return;
    const at = now(), hard = slot.good ? slot.good.at + hardTtlMs : Infinity;
    const retry = slot.lease && !slot.pending ? Math.max(slot.retryAt, slot.good ? slot.good.at + ttlMs : at + retryMs) : Infinity;
    const idle = slot.lease ? Infinity : slot.touched + hardTtlMs;
    const due2 = Math.min(hard, retry, idle);
    if (!Number.isFinite(due2)) return;
    slot.timer = schedule(() => {
      slot.timer = void 0;
      if (!live(slot)) return;
      if (!slot.lease && (now() >= slot.touched + hardTtlMs || slot.good && now() >= slot.good.at + hardTtlMs)) {
        const entry = slot.entry;
        removeSlot(slot);
        if (!entry.slots.size) removeEntry(entry);
        return;
      }
      if (slot.good && now() >= slot.good.at + hardTtlMs) {
        dropGood(slot);
        slot.revision++;
        publish(slot);
      }
      if (slot.lease && !slot.pending && now() >= slot.retryAt) void load(slot);
      else plan(slot);
    }, Math.max(1, due2 - at));
  };
  const pump = () => {
    if (pumping || closed || closing) return;
    pumping = true;
    try {
      while (inflight < maxPending && queue.size) {
        const slot = queue.values().next().value;
        queue.delete(slot);
        const task = slot.pending;
        if (!task || task.phase !== "queued") continue;
        if (!live(slot) || !slot.lease || !slot.lease.current()) {
          task.finish(false, true);
          continue;
        }
        let image;
        try {
          image = createImage();
        } catch {
          task.finish(false);
          continue;
        }
        task.phase = "inflight";
        task.image = image;
        task.source = slot.entry.source;
        inflight++;
        image.onload = () => task.finish(true);
        image.onerror = () => task.finish(false);
        task.timeout = schedule(() => task.finish(false), loadTimeoutMs);
        try {
          image.alt = "";
          image.referrerPolicy = "no-referrer";
          if (image.style) Object.assign(image.style, { width: "100%", height: "100%", objectFit: "cover", display: "block", borderRadius: "50%" });
          image.src = task.source;
        } catch {
          task.finish(false);
        }
      }
    } finally {
      pumping = false;
    }
  };
  const load = (slot, force = false) => {
    if (!live(slot) || closed || closing) return Promise.resolve(false);
    if (slot.pending) return slot.pending.promise;
    if (!force && now() < slot.retryAt) {
      plan(slot);
      return Promise.resolve(false);
    }
    slot.retryAt = 0;
    let resolve;
    const promise = new Promise((done) => {
      resolve = done;
    });
    const task = { phase: "queued", promise, timeout: void 0, image: void 0, source: void 0, done: false, finish: void 0 };
    task.finish = (ok, cancelled = false) => {
      if (task.done) return;
      task.done = true;
      stop(task.timeout);
      queue.delete(slot);
      if (task.phase === "inflight") inflight--;
      const image = task.image;
      if (image) image.onload = image.onerror = null;
      if (slot.pending === task) slot.pending = void 0;
      if (ok && live(slot)) {
        const area = image.naturalWidth * image.naturalHeight;
        if (!positive(image.naturalWidth) || !positive(image.naturalHeight) || !positive(area) || area > maxImagePixels) {
          ok = false;
          slot.reason = "oversized";
        } else if (!reserve(slot, area)) {
          ok = false;
          slot.reason = "capacity";
        } else {
          const previous = slot.good;
          slot.good = { image, pixels: area, at: now() };
          pixels += area - (previous?.pixels ?? 0);
          slot.retryAt = 0;
          slot.failedSource = void 0;
          slot.reason = void 0;
          slot.revision++;
          present(slot);
          if (previous) discard(previous.image);
        }
      } else ok = false;
      const superseded = !ok && !cancelled && task.source !== void 0 && task.source !== slot.entry.source;
      if (!ok) {
        discard(image);
        if (live(slot) && !cancelled && !superseded) {
          slot.reason ??= "load-failed";
          slot.failedSource = task.source;
          slot.retryAt = now() + retryMs;
          slot.failureRevision++;
          slot.revision++;
        }
      }
      if (live(slot)) {
        publish(slot);
        if (superseded && slot.lease?.current()) void load(slot, true);
        else plan(slot);
      }
      resolve(ok && live(slot));
      pump();
    };
    slot.pending = task;
    slot.reason = void 0;
    queue.add(slot);
    publish(slot);
    plan(slot);
    pump();
    return promise;
  };
  const due = (slot) => {
    if (slot.good && now() >= slot.good.at + hardTtlMs) {
      dropGood(slot);
      slot.revision++;
      publish(slot);
    }
    if (!slot.good && slot.reason === "load-failed" && text(slot.failedSource) && slot.failedSource !== slot.entry.source) slot.retryAt = 0;
    if (!slot.good || now() >= slot.good.at + ttlMs) void load(slot);
    else publish(slot);
    plan(slot);
  };
  return Object.freeze({
    acquire({ scope, issuer, accountId, slot: key = "row", source, isCurrent = () => true } = {}) {
      if (closed || closing || scope === null || typeof scope !== "object" || !text(issuer) || !text(accountId) || !text(key) || !text(source) || typeof isCurrent !== "function") throw new AvatarImageCacheError();
      if (retiredScopes.has(scope)) return inert("invalid");
      const identity = JSON.stringify([issuer, accountId]);
      let map = scopes.get(scope), entry = map?.get(identity);
      if (entry && !liveEntry(entry)) return inert("invalid");
      if (!entry) {
        if (lru.size >= maxEntries) {
          const victim = inactiveEntry();
          if (!victim) return inert("capacity");
          removeEntry(victim);
        }
        map = scopes.get(scope);
        if (!map) scopes.set(scope, map = /* @__PURE__ */ new Map());
        entry = { scope, key: identity, source, slots: /* @__PURE__ */ new Map(), touched: now(), removed: false };
        map.set(identity, entry);
        touch(entry);
      }
      entry.source = source;
      touch(entry);
      let slot = entry.slots.get(key);
      if (slot?.lease) return inert("slot-in-use");
      if (!slot) {
        if (entry.slots.size >= maxSlots) {
          const victim = [...entry.slots.values()].filter((value) => !value.lease).sort((a, b) => a.touched - b.touched)[0];
          if (!victim) return inert("capacity");
          removeSlot(victim);
        }
        slot = { entry, key, good: void 0, pending: void 0, timer: void 0, lease: void 0, reason: void 0, retryAt: 0, touched: now(), revision: 0, failureRevision: 0, removed: false, state: INVALID };
        entry.slots.set(key, slot);
      }
      let released = false;
      const lease = { listeners: /* @__PURE__ */ new Set(), binding: void 0, shown: void 0, current: () => {
        try {
          return !released && isCurrent() === true;
        } catch {
          return false;
        }
      } };
      slot.lease = lease;
      slot.touched = now();
      due(slot);
      return Object.freeze({
        snapshot: () => released || !lease.current() ? INVALID : slot.state,
        subscribe(listener) {
          if (released) return () => {
          };
          lease.listeners.add(listener);
          return () => lease.listeners.delete(listener);
        },
        attach(container) {
          if (released || !live(slot) || typeof container?.appendChild !== "function" || typeof container?.removeChild !== "function") throw new AvatarImageCacheError();
          detach(lease);
          const previous = owners.get(container);
          if (previous) detach(previous.lease);
          const binding = { container, lease };
          lease.binding = binding;
          owners.set(container, binding);
          due(slot);
          present(slot);
          return () => {
            if (lease.binding === binding) detach(lease);
          };
        },
        updateSource(next) {
          if (released || !live(slot) || !text(next)) return;
          entry.source = next;
          due(slot);
        },
        refresh(next) {
          if (released || !live(slot)) return Promise.resolve(false);
          if (next !== void 0) {
            if (!text(next)) throw new AvatarImageCacheError();
            entry.source = next;
            if (slot.pending && slot.pending.source !== next) slot.pending.finish(false, true);
          }
          return load(slot, true);
        },
        settled: () => slot.pending?.promise ?? Promise.resolve(slot.good !== void 0),
        release() {
          if (released) return;
          released = true;
          detach(lease);
          lease.listeners.clear();
          if (slot.lease === lease) slot.lease = void 0;
          slot.touched = now();
          touch(entry);
          if (slot.pending?.phase === "queued") slot.pending.finish(false, true);
          plan(slot);
        }
      });
    },
    invalidateAccount(scope, issuer, accountId) {
      const entry = scopes.get(scope)?.get(JSON.stringify([issuer, accountId]));
      if (entry) removeEntry(entry);
    },
    disposeScope(scope) {
      if (scope !== null && typeof scope === "object") retiredScopes.add(scope);
      for (const entry of [...scopes.get(scope)?.values() ?? []]) removeEntry(entry);
    },
    stats: () => ({ entries: lru.size, slots: [...lru.keys()].reduce((sum, entry) => sum + entry.slots.size, 0), retainedPixels: pixels, estimatedRgbaBytes: pixels * 4, inflight, queued: queue.size }),
    dispose() {
      if (closed || closing) return;
      closing = true;
      for (const entry of [...lru.keys()]) removeEntry(entry);
      closed = true;
      scopes.clear();
      lru.clear();
      queue.clear();
    }
  });
}

// src/avatar-cache-scope.mjs
var avatarImageCache = createAvatarImageCache();

// src/session-client.mjs
var NAMESPACE = "copilotAccounts";
var ERRORS = Object.freeze({
  INVALID_ARGUMENT: [400, "Invalid Session account request"],
  OWNER_REQUIRED: [403, "Only the Host owner may manage Copilot accounts"],
  SESSION_FORBIDDEN: [403, "Session access denied"],
  SESSION_UNAVAILABLE: [404, "Session is unavailable"],
  POLICY_UNAVAILABLE: [503, "Session account policy is unavailable"],
  SESSION_BUSY: [409, "Wait for the Session to become idle before changing account"],
  NOT_COPILOT_SESSION: [409, "Select a Copilot model before binding an account"],
  STALE_SELECTION: [409, "Session model changed; reload account choices"],
  ACCOUNT_UNAVAILABLE: [404, "Selected account is unavailable"],
  ACCOUNT_MODEL_UNAVAILABLE: [409, "Selected account does not support the current model controls"],
  ACCOUNT_COMPACTION_RESTART_REQUIRED: [409, "Restart DSH to apply compaction policy for this account"],
  SELECTION_FAILED: [502, "Session account selection failed"],
  ACCOUNT_PROFILE_FAILED: [502, "Account profile refresh failed"],
  DEFAULT_ACCOUNT_FAILED: [502, "Global default account update failed"],
  REQUEST_CANCELLED: [499, "Session account request was cancelled"],
  INTERNAL_ERROR: [500, "Session account operation failed"],
  STALE_SESSION: [409, "Session or Host connection changed; reload account choices"],
  TRANSPORT_UNAVAILABLE: [503, "Session Host connection is unavailable"]
});
var SessionAccountClientError = class extends Error {
  constructor(code) {
    if (typeof code !== "string" || !Object.hasOwn(ERRORS, code)) code = "INTERNAL_ERROR";
    const [status, message] = ERRORS[code];
    super(message);
    this.name = "SessionAccountClientError";
    this.code = code;
    this.status = status;
  }
};
var bad = () => new SessionAccountClientError("INVALID_ARGUMENT");
var plain = (value) => value !== null && typeof value === "object" && !Array.isArray(value) && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
function createSessionAccountClient({ sessionId, connection, isCurrent }) {
  if (typeof sessionId !== "string" || sessionId.length === 0 || sessionId.length > 256 || typeof connection?.rpc?.call !== "function" || typeof connection?.generation?.getSnapshot !== "function" || typeof isCurrent !== "function") throw bad();
  const generation = connection.generation.getSnapshot();
  const lifetime = new AbortController();
  let disposed = false;
  const assertCurrent = (signal) => {
    let current = false;
    try {
      current = isCurrent() === true && connection.generation.getSnapshot() === generation;
    } catch {
    }
    if (disposed || !current) throw new SessionAccountClientError("STALE_SESSION");
    if (generation === void 0) throw new SessionAccountClientError("TRANSPORT_UNAVAILABLE");
    if (signal?.aborted) throw new SessionAccountClientError("REQUEST_CANCELLED");
  };
  const request = async (method, value = {}, signal) => {
    assertCurrent(signal);
    if (!plain(value) || Object.hasOwn(value, "sessionId") || signal !== void 0 && !(signal instanceof AbortSignal)) throw bad();
    const payload = { sessionId };
    if (method !== "catalog") {
      if (value.accountId !== null && (typeof value.accountId !== "string" || value.accountId.length === 0) || method !== "bind" && value.accountId === null) throw bad();
      payload.accountId = value.accountId;
    }
    if (method === "bind" && value.expected !== void 0) {
      if (!plain(value.expected) || typeof value.expected.provider !== "string" || typeof value.expected.model !== "string" || value.expected.reasoningEffort !== void 0 && typeof value.expected.reasoningEffort !== "string") throw bad();
      payload.expected = {
        provider: value.expected.provider,
        model: value.expected.model,
        ...value.expected.reasoningEffort === void 0 ? {} : { reasoningEffort: value.expected.reasoningEffort }
      };
    }
    const combined = signal === void 0 ? lifetime.signal : AbortSignal.any([lifetime.signal, signal]);
    let result;
    try {
      result = await connection.rpc.call("/api", `${NAMESPACE}/${method}`, { args: { request: payload } }, combined);
    } catch {
      assertCurrent(combined);
      throw new SessionAccountClientError("TRANSPORT_UNAVAILABLE");
    }
    assertCurrent(combined);
    if (result?.ok !== true) {
      let code = "INTERNAL_ERROR";
      try {
        if (typeof result?.error?.code === "string" && Object.hasOwn(ERRORS, result.error.code)) code = result.error.code;
      } catch {
      }
      throw new SessionAccountClientError(code);
    }
    if (!plain(result.value)) throw new SessionAccountClientError("INTERNAL_ERROR");
    return result.value;
  };
  return Object.freeze({
    catalog(signal) {
      return request("catalog", {}, signal);
    },
    bind(value, signal) {
      return request("bind", value, signal);
    },
    profile(value, signal) {
      return request("profile", value, signal);
    },
    setDefault(value, signal) {
      return request("setDefault", value, signal);
    },
    dispose() {
      if (!disposed) {
        disposed = true;
        lifetime.abort();
      }
    }
  });
}

// src/session-badge-state.mjs
var ACCOUNT_ROUTE = /^copilot-account-[a-f0-9]{64}$/;
var selection = (value) => typeof value?.provider === "string" && typeof value?.model === "string" ? {
  provider: value.provider,
  model: value.model,
  ...typeof value.reasoningEffort === "string" ? { reasoningEffort: value.reasoningEffort } : {}
} : void 0;
var accountLabel = (account, fallback = "Recovered account") => `${account.domain}/${account.login ?? account.name ?? fallback}`;
function accountQuotaRemaining(account) {
  const usage = account?.usage;
  if (account?.available === false || account?.usageError !== void 0 || !usage || typeof usage !== "object") return { text: "\u2014", kind: "unknown" };
  if (usage.unlimited === true) return { text: "\u221E", kind: "unlimited" };
  const percent = Number.isFinite(usage.percentUsed) ? 100 - usage.percentUsed : Number.isFinite(usage.remaining) && Number.isFinite(usage.entitlement) && usage.entitlement > 0 ? 100 * usage.remaining / usage.entitlement : null;
  if (percent !== null) {
    const remaining = Math.round(Math.max(0, Math.min(100, percent)));
    return { text: `${remaining}%`, kind: "percent", remaining };
  }
  if (Number.isFinite(usage.remaining)) return { text: String(Math.max(0, usage.remaining)), kind: "count" };
  return { text: "\u2014", kind: "unknown" };
}
function combinedAccountUsage(accounts) {
  const unique = /* @__PURE__ */ new Map();
  for (const account of Array.isArray(accounts) ? accounts : []) {
    if (typeof account?.id === "string" && account.id !== "" && !unique.has(account.id)) unique.set(account.id, account);
  }
  let used = 0, unknown = 0, unlimited = 0;
  for (const account of unique.values()) {
    const quota = accountQuotaRemaining(account);
    if (quota.kind === "unlimited") {
      unlimited++;
      continue;
    }
    if (quota.kind !== "percent") {
      unknown++;
      continue;
    }
    const usage = account.usage;
    const percentUsed = Number.isFinite(usage.percentUsed) ? usage.percentUsed : 100 * (1 - usage.remaining / usage.entitlement);
    used += Math.max(0, Math.min(100, percentUsed));
  }
  const count = unique.size;
  return {
    visible: count > 1,
    count,
    used: unknown === 0 && unlimited === 0 ? Math.round(used) : null,
    capacity: unlimited > 0 ? null : count * 100,
    unknown,
    unlimited
  };
}
function deriveSessionBadgeState(catalog, { busy = false, running = false } = {}) {
  const accounts = Array.isArray(catalog?.accounts) ? catalog.accounts : [];
  const next = catalog?.next;
  const expected = selection(next);
  const mode = next?.mode === "global" && (expected?.provider === "github-copilot" || expected?.provider === "copilot-default") ? "global" : next?.mode === "bound" && ACCOUNT_ROUTE.test(expected?.provider ?? "") ? "bound" : "inactive";
  const globals = accounts.filter((account2) => account2.globalActive === true || account2.active === true);
  const globalAccount = globals.length === 1 ? globals[0] : null;
  const bound = mode === "bound" ? accounts.find((account2) => account2.id === next.accountId && (account2.routeId === void 0 || account2.routeId === expected.provider)) : void 0;
  const unmanaged = mode === "global" && expected.provider === "github-copilot";
  const unavailable = mode === "bound" && (next.available !== true || bound === void 0 || bound.available === false || bound.routeAvailable === false) || mode === "global" && globalAccount?.available === false;
  const account = unavailable || unmanaged ? null : mode === "bound" ? bound : mode === "global" ? globalAccount : null;
  const used = account?.usageError === void 0 && Number.isFinite(account?.usage?.percentUsed) ? Math.max(0, Math.min(100, account.usage.percentUsed)) : null;
  return {
    mode,
    accounts,
    account,
    globalAccountId: globalAccount?.id ?? null,
    selectedAccountId: mode === "bound" ? next.accountId : null,
    followsGlobal: mode === "global" && !unmanaged,
    unavailable,
    unmanaged,
    running: running || catalog?.running === true,
    canBind: !busy && !running && catalog?.running !== true && mode !== "inactive" && expected !== void 0,
    canSetDefault: !busy,
    expected,
    used,
    remaining: used === null ? null : Math.round(100 - used),
    unlimited: account?.usageError === void 0 && account?.usage?.unlimited === true,
    plan: account?.plan,
    resets: account?.usage?.resets,
    usageUnavailable: account?.usageError !== void 0
  };
}
function matchingSessionFailureNotice(catalog, notice) {
  const view = deriveSessionBadgeState(catalog);
  if (notice?.code !== "ACCOUNT_REQUEST_FAILED" || notice.sessionId !== catalog?.sessionId || typeof notice.id !== "string" || notice.accountId !== view.account?.id || notice.logicalProvider !== catalog?.next?.provider || notice.model !== void 0 && notice.model !== catalog?.next?.model) return null;
  return {
    id: notice.id,
    sessionId: notice.sessionId,
    code: "ACCOUNT_REQUEST_FAILED",
    accountId: notice.accountId,
    logicalProvider: notice.logicalProvider,
    ...notice.model === void 0 ? {} : { model: notice.model }
  };
}
var safeCode = (error) => {
  try {
    return typeof error?.code === "string" && Object.hasOwn(SESSION_BADGE_ERROR_KEYS, error.code) ? error.code : "INTERNAL_ERROR";
  } catch {
    return "INTERNAL_ERROR";
  }
};
var stale = () => new SessionAccountClientError("STALE_SESSION");
var unavailableProfile = () => Promise.reject(stale());
function createSessionBadgeController({ sessionId, sessions, clientFactory = createSessionAccountClient, imageCache = avatarImageCache }) {
  if (typeof sessionId !== "string" || typeof sessions?.binding !== "function" || typeof sessions?.scope !== "function") throw new TypeError("Session badge requires retained Session services");
  let closed = false, transport, readSequence = 0, mutationSequence = 0, pendingRead;
  let snapshot = {
    status: "loading",
    catalog: null,
    errorCode: null,
    busy: false,
    running: false,
    failureNotice: null,
    scopeKey: {},
    requestProfile: unavailableProfile,
    isCurrent: () => false
  };
  const listeners = /* @__PURE__ */ new Set();
  const notify = () => {
    for (const listener of listeners) {
      try {
        listener();
      } catch {
      }
    }
  };
  const publish = (next) => {
    if (!closed) {
      snapshot = { ...snapshot, ...next };
      notify();
    }
  };
  const current = (value) => {
    try {
      return !closed && transport === value && sessions.binding(sessionId) === value.binding && sessions.scope(sessionId) === value.scope && value.connection.generation.getSnapshot() === value.generation;
    } catch {
      return false;
    }
  };
  const retire = () => {
    readSequence++;
    mutationSequence++;
    pendingRead = void 0;
    if (transport !== void 0) {
      const previous = transport;
      transport = void 0;
      if (previous.scopeKey !== void 0) imageCache.disposeScope(previous.scopeKey);
      for (const dispose of previous.cleanups) {
        try {
          dispose();
        } catch {
        }
      }
      previous.client?.dispose?.();
    }
  };
  const resolve = () => {
    if (closed) return void 0;
    let binding, scope, connection, generation;
    try {
      binding = sessions.binding(sessionId);
      scope = sessions.scope(sessionId);
      connection = scope?.get("connection");
      generation = connection?.generation?.getSnapshot();
    } catch {
    }
    if (binding === void 0 || scope === void 0 || typeof connection?.rpc?.call !== "function" || typeof connection?.generation?.subscribe !== "function" || typeof connection?.generation?.getSnapshot !== "function") {
      retire();
      publish({
        status: "unavailable",
        catalog: null,
        errorCode: "STALE_SESSION",
        busy: false,
        running: false,
        failureNotice: null,
        scopeKey: {},
        requestProfile: unavailableProfile,
        isCurrent: () => false
      });
      return void 0;
    }
    if (transport?.binding === binding && transport.scope === scope && transport.store === connection.generation && transport.generation === generation) return transport;
    retire();
    const value = {
      binding,
      scope,
      connection,
      store: connection.generation,
      generation,
      cleanups: [],
      profileRequests: /* @__PURE__ */ new Map(),
      seenNotices: /* @__PURE__ */ new Set(),
      noticeSeeded: false,
      pendingFailure: false,
      avatarAccounts: /* @__PURE__ */ new Map()
    };
    transport = value;
    value.client = clientFactory({ sessionId, connection, isCurrent: () => current(value) });
    value.scopeKey = {};
    value.requestProfile = (id) => {
      if (!current(value)) return Promise.reject(stale());
      if (value.profileRequests.has(id)) return value.profileRequests.get(id);
      const request = value.client.profile({ accountId: id }).then((result) => {
        if (!current(value)) throw stale();
        return result.avatarUrl;
      }).finally(() => {
        if (value.profileRequests.get(id) === request) value.profileRequests.delete(id);
      });
      value.profileRequests.set(id, request);
      return request;
    };
    try {
      const remote = scope.get("remote");
      if (typeof remote?.$on === "function") value.cleanups.push(remote.$on("api-session/error", (failedSessionId) => {
        if (failedSessionId !== sessionId || !current(value)) return;
        value.pendingFailure = true;
        void refresh(true);
      }));
    } catch {
    }
    const running = binding.session?.getSnapshot?.().running === true;
    publish({
      status: "loading",
      catalog: null,
      errorCode: null,
      busy: false,
      running,
      failureNotice: null,
      scopeKey: value.scopeKey,
      requestProfile: value.requestProfile,
      isCurrent: () => current(value)
    });
    value.cleanups.push(connection.generation.subscribe(() => {
      if (transport === value) void refresh(true);
    }));
    if (typeof binding.session?.subscribe === "function") value.cleanups.push(binding.session.subscribe(() => {
      if (!current(value)) {
        void refresh(true);
        return;
      }
      const nextRunning = binding.session.getSnapshot().running === true;
      if (nextRunning !== snapshot.running) publish({ running: nextRunning });
    }));
    const projected = binding.session?.projections?.faceOf?.("modelSelection");
    if (typeof projected?.subscribe === "function") value.cleanups.push(projected.subscribe(() => {
      if (transport !== value) return;
      value.pendingFailure = false;
      value.noticeSeeded = false;
      publish({ status: "loading", catalog: null, failureNotice: null });
      void refresh(true);
    }));
    return value;
  };
  const refresh = (invalidate = false) => {
    let value;
    try {
      value = resolve();
    } catch (error) {
      retire();
      publish({ status: "unavailable", catalog: null, failureNotice: null, busy: false, errorCode: safeCode(error), requestProfile: unavailableProfile });
      return Promise.resolve(void 0);
    }
    if (value === void 0) return Promise.resolve(void 0);
    if (!invalidate && pendingRead?.transport === value) return pendingRead.promise;
    const sequence = ++readSequence;
    const promise = value.client.catalog().then((catalog) => {
      if (!current(value) || sequence !== readSequence) return void 0;
      if (catalog.sessionId !== sessionId) throw stale();
      const accounts = new Map((Array.isArray(catalog.accounts) ? catalog.accounts : []).filter((account) => typeof account.id === "string" && typeof account.domain === "string" && account.available !== false).map((account) => [account.id, account.domain]));
      for (const [id, issuer] of value.avatarAccounts) if (accounts.get(id) !== issuer) imageCache.invalidateAccount(value.scopeKey, issuer, id);
      value.avatarAccounts = accounts;
      publish({
        status: "ready",
        catalog,
        errorCode: null,
        failureNotice: matchingSessionFailureNotice(catalog, snapshot.failureNotice),
        running: value.binding.session?.getSnapshot?.().running === true || catalog.running === true
      });
      const notice = matchingSessionFailureNotice(catalog, catalog.notice);
      if (notice === null && typeof catalog.notice?.id === "string") value.seenNotices.add(catalog.notice.id);
      if (!value.noticeSeeded) {
        value.noticeSeeded = true;
        if (!value.pendingFailure && notice !== null) value.seenNotices.add(notice.id);
      }
      if (value.pendingFailure) {
        value.pendingFailure = false;
        if (notice !== null && !value.seenNotices.has(notice.id)) {
          value.seenNotices.add(notice.id);
          while (value.seenNotices.size > 32) value.seenNotices.delete(value.seenNotices.values().next().value);
          publish({ failureNotice: notice });
        }
      }
      return catalog;
    }).catch((error) => {
      if (current(value) && sequence === readSequence) {
        value.pendingFailure = false;
        publish({ status: "unavailable", catalog: null, failureNotice: null, errorCode: safeCode(error) });
      }
      return void 0;
    }).finally(() => {
      if (pendingRead?.promise === promise) pendingRead = void 0;
    });
    pendingRead = { transport: value, promise };
    return promise;
  };
  const mutate = async (method, accountId) => {
    const value = transport;
    if (value === void 0 || !current(value) || snapshot.status !== "ready" || snapshot.busy) return false;
    const view = deriveSessionBadgeState(snapshot.catalog, { busy: snapshot.busy, running: snapshot.running });
    if (method === "bind" && !view.canBind) return false;
    if (accountId !== null) {
      const target = view.accounts.find((account) => account.id === accountId);
      if (target === void 0 || target.available === false || method === "bind" && target.routeAvailable === false) return false;
    }
    const sequence = ++mutationSequence;
    value.pendingFailure = false;
    publish({ busy: true, errorCode: null, failureNotice: null });
    try {
      await value.client[method]({ accountId, ...method === "bind" ? { expected: view.expected } : {} });
      if (!current(value) || sequence !== mutationSequence) return false;
      await refresh(true);
      return current(value) && sequence === mutationSequence;
    } catch (error) {
      if (current(value) && sequence === mutationSequence) publish({ status: "unavailable", catalog: null, errorCode: safeCode(error) });
      return false;
    } finally {
      if (current(value) && sequence === mutationSequence) publish({ busy: false });
    }
  };
  let listCleanup;
  if (typeof sessions.list?.subscribe === "function") listCleanup = sessions.list.subscribe(() => {
    if (!closed && (transport === void 0 || sessions.binding(sessionId) !== transport.binding || sessions.scope(sessionId) !== transport.scope)) void refresh(true);
  });
  return Object.freeze({
    getSnapshot: () => snapshot,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    refresh,
    dismissFailure() {
      if (transport !== void 0) transport.pendingFailure = false;
      publish({ failureNotice: null });
    },
    bind(accountId) {
      return mutate("bind", accountId);
    },
    setDefault(accountId) {
      return mutate("setDefault", accountId);
    },
    dispose() {
      if (!closed) {
        closed = true;
        retire();
        listCleanup?.();
        listeners.clear();
      }
    }
  });
}
var SESSION_BADGE_ERROR_KEYS = Object.freeze({
  OWNER_REQUIRED: "badgeErrorOwner",
  SESSION_FORBIDDEN: "badgeErrorForbidden",
  SESSION_BUSY: "badgeErrorBusy",
  NOT_COPILOT_SESSION: "badgeErrorInactive",
  STALE_SELECTION: "badgeErrorStale",
  STALE_SESSION: "badgeErrorStale",
  ACCOUNT_UNAVAILABLE: "badgeErrorAccount",
  ACCOUNT_MODEL_UNAVAILABLE: "badgeErrorModel",
  ACCOUNT_COMPACTION_RESTART_REQUIRED: "badgeErrorRestart",
  POLICY_UNAVAILABLE: "badgeErrorUnavailable",
  SESSION_UNAVAILABLE: "badgeErrorUnavailable",
  TRANSPORT_UNAVAILABLE: "badgeErrorUnavailable",
  REQUEST_CANCELLED: "badgeErrorCancelled",
  INVALID_ARGUMENT: "badgeErrorRequest",
  SELECTION_FAILED: "badgeErrorRequest",
  ACCOUNT_PROFILE_FAILED: "badgeErrorRequest",
  DEFAULT_ACCOUNT_FAILED: "badgeErrorRequest",
  INTERNAL_ERROR: "badgeErrorRequest"
});
var sessionBadgeErrorKey = (code) => typeof code === "string" && Object.hasOwn(SESSION_BADGE_ERROR_KEYS, code) ? SESSION_BADGE_ERROR_KEYS[code] : "badgeErrorRequest";

// src/usage-month.mjs
var DAY = 864e5;
var finite = (value) => typeof value === "number" && Number.isFinite(value);
function time(value) {
  if (value instanceof Date) value = value.getTime();
  if (finite(value)) return Number.isSafeInteger(value) && Math.abs(value) <= 864e13 ? value : void 0;
  if (typeof value !== "string") return void 0;
  const parts = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.exec(value);
  if (!parts) return void 0;
  const [, yearRaw, monthRaw, dayRaw, hourRaw, minuteRaw, secondRaw] = parts;
  const year = Number(yearRaw), month = Number(monthRaw), date = Number(dayRaw);
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1];
  if (!days || date < 1 || date > days || Number(hourRaw) > 23 || Number(minuteRaw) > 59 || Number(secondRaw) > 59) return void 0;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : void 0;
}
function utcMonthProgress(now = Date.now()) {
  const at = time(now);
  if (at === void 0) throw new TypeError("Usage month requires a valid timestamp");
  const date = new Date(at), year = date.getUTCFullYear(), month = date.getUTCMonth();
  const beginning = /* @__PURE__ */ new Date(0), ending = /* @__PURE__ */ new Date(0);
  beginning.setUTCFullYear(year, month, 1);
  ending.setUTCFullYear(year, month + 1, 1);
  beginning.setUTCHours(0, 0, 0, 0);
  ending.setUTCHours(0, 0, 0, 0);
  const start = beginning.getTime(), end = ending.getTime();
  if (!finite(start) || !finite(end) || end <= start) throw new TypeError("Usage month is outside the supported range");
  const totalDays = (end - start) / DAY, elapsedDays = (at - start) / DAY;
  return {
    key: `${year}-${String(month + 1).padStart(2, "0")}`,
    start: new Date(start).toISOString(),
    end: new Date(end).toISOString(),
    totalDays,
    dayIndex: date.getUTCDate(),
    completedDays: Math.floor(elapsedDays),
    daysAfterToday: totalDays - date.getUTCDate(),
    elapsedDays,
    remainingDays: (end - at) / DAY,
    elapsedPercent: elapsedDays / totalDays * 100
  };
}

// src/client.jsx
var import_jsx_runtime = require("react/jsx-runtime");
var name = "copilot-auth-ui";
var inject = ["slots", "locale"];
var DICTS = {
  en: {
    nav: "Copilot Accounts",
    title: "Accounts",
    intro: "Projects use the default account for GitHub Copilot unless changed here.",
    addAccount: "Add account",
    optGithub: "GitHub.com",
    optGithubDesc: "Personal and enterprise accounts",
    optGhe: "GitHub Enterprise Cloud",
    optGheDesc: "Accounts on your company's ghe.com domain",
    domainLabel: "Company ghe.com domain",
    domainPlaceholder: "company.ghe.com",
    continue: "Continue",
    cancel: "Cancel",
    defaultBadge: "Default",
    setDefault: "Set as default",
    signOut: "Remove account",
    updateAuth: "Update authorization",
    refreshModels: "Refresh models",
    refreshModelsFailed: "Model refresh failed. Try again later.",
    managePlan: "Manage plan",
    plan: "Plan",
    credits: "AI credits (resets monthly)",
    creditsWithReset: "AI credits (resets monthly, next reset {date})",
    creditsNote: "AI credits are consumed based on model and token usage.",
    combinedUsed: "Combined used",
    combinedUsageHint: "Sum of account percentages, not a weighted credit balance. Organization accounts may share a billing pool.",
    usageMonth: "{month} UTC \xB7 {elapsed} days elapsed \xB7 {remaining} days left",
    usageCursor: "Used {used}% \xB7 UTC month elapsed {time}%",
    usageValue: "Used {used}%",
    resetsOn: "Resets on",
    unlimited: "Unlimited quota",
    noAccounts: "No connected accounts yet. Use \u201CAdd account\u201D to sign in.",
    loading: "\u2026",
    signingIn: "Signing in to",
    signingInDone: "Signed in",
    codeHint: "Open the link below and enter this code to finish signing in:",
    copy: "Copy",
    copied: "Copied \u2713",
    unknown: "Unknown error",
    usageFailed: "Usage unavailable",
    legacyAccount: "GitHub Copilot account",
    menu: "More actions",
    authFailed: "Authorization failed",
    authFailedDesc: "Sign in to {target} using a device code.",
    tryAgain: "Try again",
    errorNetwork: "Network connection failed. Please check your network settings and try again.",
    errorTimeout: "The request timed out. Please try again.",
    errorCancelled: "Sign-in was cancelled.",
    errorDomainMismatch: "The device code link did not match the enterprise domain. Please verify the domain and try again.",
    errorDefault: "Sign-in failed. Please try again.",
    cancelSignIn: "Cancel sign-in",
    signInTimeout: "Sign-in timed out after 5 minutes of inactivity. Please try again.",
    addGithubTitle: "Add GitHub account",
    addGithubDesc: "Authorize with GitHub.com using a device code.",
    addGheDesc: "Authorize with {domain} using a device code.",
    stepCopied: "Code copied to clipboard",
    stepOpened: "Opened {target}",
    stepWaiting: "Waiting for authorization\u2026",
    openSite: "Open {target}",
    copyLink: "Copy link",
    badgeNotSignedIn: "Not signed in",
    badgeClickToSignIn: "Click to sign in",
    badgeSwitchAccount: "Switch account",
    badgeSwitching: "Switching\u2026",
    badgeUsage: "Usage",
    badgeUsed: "used",
    badgeResets: "resets",
    badgeQuotaRemaining: "Quota left",
    badgeQuotaPrefix: "Left",
    badgeSessionAccounts: "Accounts for this Session",
    badgeFollowingGlobal: "Following global default",
    badgeSessionBound: "Bound to this Session",
    badgeNotInUse: "Copilot not in use",
    badgeUnavailable: "Accounts unavailable",
    badgeBoundUnavailable: "Bound account unavailable",
    badgeNoDefault: "No global default account",
    badgeUnknownQuota: "Quota unavailable",
    badgeUnmanaged: "Unmanaged credentials; account identity is unknown",
    badgeUseSession: "Use for this Session",
    badgeFollowGlobal: "Follow global default",
    badgeSetGlobalDefault: "Set global default",
    badgeGlobalDefault: "Global default",
    badgeGlobalHint: "Affects Sessions following the global default, not independently bound Sessions",
    badgeRefresh: "Refresh",
    badgeRunningHint: "Session running. Wait until it is idle to change its account.",
    badgeHistoryHint: "Subsequent requests, including this conversation's existing history, are sent through the selected account and service.",
    badgeRowUnavailable: "Unavailable",
    badgeRouteUnavailable: "Session route unavailable",
    badgeFailureTitle: "Request continuation failed",
    badgeFailureBody: "Rebuildable request state was reset; chat history is preserved. Review the error before trying again.",
    badgeClose: "Close",
    badgeErrorOwner: "Only the Host owner can manage Copilot accounts.",
    badgeErrorForbidden: "Access to this Session was denied.",
    badgeErrorBusy: "Wait until this Session is idle before changing its account.",
    badgeErrorRestart: "Restart DSH to apply compaction policy for this account.",
    badgeErrorInactive: "Select a Copilot model before binding an account.",
    badgeErrorStale: "The Session, model or Host changed. Refresh account choices.",
    badgeErrorAccount: "The selected account is no longer available.",
    badgeErrorModel: "This account does not support the current model or reasoning controls.",
    badgeErrorUnavailable: "The Session account service is unavailable on this Host.",
    badgeErrorCancelled: "The account request was cancelled.",
    badgeErrorRequest: "The account operation failed. Refresh choices before trying again."
  },
  zh: {
    nav: "Copilot \u8D26\u53F7",
    title: "\u8D26\u53F7",
    intro: "\u5BF9\u8BDD\u9ED8\u8BA4\u4F7F\u7528\u6807\u8BB0\u4E3A\u9ED8\u8BA4\u7684 GitHub Copilot \u8D26\u53F7\uFF0C\u53EF\u5728\u6B64\u5207\u6362\u3002",
    addAccount: "\u6DFB\u52A0\u8D26\u53F7",
    optGithub: "GitHub.com",
    optGithubDesc: "\u4E2A\u4EBA\u4E0E\u4F01\u4E1A\u7EC4\u7EC7\u8D26\u53F7",
    optGhe: "GitHub Enterprise Cloud",
    optGheDesc: "\u8D35\u516C\u53F8 ghe.com \u57DF\u540D\u4E0B\u7684\u8D26\u53F7",
    domainLabel: "\u516C\u53F8 ghe.com \u57DF\u540D",
    domainPlaceholder: "company.ghe.com",
    continue: "\u7EE7\u7EED",
    cancel: "\u53D6\u6D88",
    defaultBadge: "\u9ED8\u8BA4",
    setDefault: "\u8BBE\u4E3A\u9ED8\u8BA4",
    signOut: "\u79FB\u9664\u8D26\u53F7",
    updateAuth: "\u66F4\u65B0\u6388\u6743",
    refreshModels: "\u5237\u65B0\u6A21\u578B",
    refreshModelsFailed: "\u6A21\u578B\u5237\u65B0\u5931\u8D25\uFF0C\u8BF7\u7A0D\u540E\u91CD\u8BD5\u3002",
    managePlan: "\u7BA1\u7406\u5957\u9910",
    plan: "\u5957\u9910",
    credits: "AI \u989D\u5EA6\uFF08\u6309\u6708\u91CD\u7F6E\uFF09",
    creditsWithReset: "AI \u989D\u5EA6\uFF08\u6309\u6708\u91CD\u7F6E\uFF0C\u4E0B\u6B21\u91CD\u7F6E\u65E5\u671F {date}\uFF09",
    creditsNote: "AI \u989D\u5EA6\u6D88\u8017\u53D6\u51B3\u4E8E\u6A21\u578B\u4E0E token \u7528\u91CF\u3002",
    combinedUsed: "\u5408\u8BA1\u5DF2\u7528",
    combinedUsageHint: "\u6309\u5404\u8D26\u53F7\u767E\u5206\u6BD4\u76F8\u52A0\uFF0C\u5E76\u975E\u989D\u5EA6\u52A0\u6743\u503C\uFF1B\u7EC4\u7EC7\u8D26\u53F7\u53EF\u80FD\u5171\u7528\u8BA1\u8D39\u6C60\u3002",
    usageMonth: "UTC {month} \xB7 \u5DF2\u8FC7 {elapsed} \u5929 \xB7 \u8FD8\u5269 {remaining} \u5929",
    usageCursor: "\u989D\u5EA6\u5DF2\u7528 {used}% \xB7 UTC \u672C\u6708\u5DF2\u8FC7 {time}%",
    usageValue: "\u989D\u5EA6\u5DF2\u7528 {used}%",
    resetsOn: "\u91CD\u7F6E\u65E5\u671F",
    unlimited: "\u4E0D\u9650\u91CF",
    noAccounts: "\u8FD8\u6CA1\u6709\u5DF2\u767B\u5F55\u8D26\u53F7\u3002\u70B9\u300C\u6DFB\u52A0\u8D26\u53F7\u300D\u5F00\u59CB\u767B\u5F55\u3002",
    loading: "\u2026",
    signingIn: "\u6B63\u5728\u767B\u5F55",
    signingInDone: "\u5DF2\u767B\u5F55",
    codeHint: "\u5728\u6D4F\u89C8\u5668\u6253\u5F00\u4E0B\u9762\u7684\u94FE\u63A5\uFF0C\u8F93\u5165\u8FD9\u4E32\u4EE3\u7801\u5B8C\u6210\u6388\u6743\uFF1A",
    copy: "\u590D\u5236",
    copied: "\u5DF2\u590D\u5236 \u2713",
    unknown: "\u672A\u77E5\u9519\u8BEF",
    usageFailed: "\u7528\u91CF\u4E0D\u53EF\u7528",
    legacyAccount: "GitHub Copilot \u8D26\u53F7",
    menu: "\u66F4\u591A\u64CD\u4F5C",
    authFailed: "\u6388\u6743\u5931\u8D25",
    authFailedDesc: "\u4F7F\u7528\u8BBE\u5907\u7801\u6388\u6743\u767B\u5F55 {target}\u3002",
    tryAgain: "\u91CD\u8BD5",
    errorNetwork: "\u7F51\u7EDC\u8FDE\u63A5\u5931\u8D25\uFF0C\u8BF7\u68C0\u67E5\u7F51\u7EDC\u8BBE\u7F6E\u540E\u91CD\u8BD5\u3002",
    errorTimeout: "\u8BF7\u6C42\u8D85\u65F6\uFF0C\u8BF7\u91CD\u8BD5\u3002",
    errorCancelled: "\u767B\u5F55\u5DF2\u53D6\u6D88\u3002",
    errorDomainMismatch: "\u8BBE\u5907\u7801\u94FE\u63A5\u4E0E\u4F01\u4E1A\u57DF\u540D\u4E0D\u5339\u914D\uFF0C\u8BF7\u68C0\u67E5\u57DF\u540D\u540E\u91CD\u8BD5\u3002",
    errorDefault: "\u767B\u5F55\u5931\u8D25\uFF0C\u8BF7\u91CD\u8BD5\u3002",
    cancelSignIn: "\u53D6\u6D88\u767B\u5F55",
    signInTimeout: "\u767B\u5F55\u8D85\u65F6\uFF085 \u5206\u949F\u65E0\u64CD\u4F5C\uFF09\uFF0C\u8BF7\u91CD\u8BD5\u3002",
    addGithubTitle: "\u6DFB\u52A0 GitHub \u8D26\u53F7",
    addGithubDesc: "\u4F7F\u7528\u8BBE\u5907\u7801\u6388\u6743\u767B\u5F55 GitHub.com\u3002",
    addGheDesc: "\u4F7F\u7528\u8BBE\u5907\u7801\u6388\u6743\u767B\u5F55 {domain}\u3002",
    stepCopied: "\u4EE3\u7801\u5DF2\u590D\u5236\u5230\u526A\u8D34\u677F",
    stepOpened: "\u5DF2\u6253\u5F00 {target}",
    stepWaiting: "\u7B49\u5F85\u6388\u6743\u4E2D\u2026",
    openSite: "\u6253\u5F00 {target}",
    copyLink: "\u590D\u5236\u94FE\u63A5",
    badgeNotSignedIn: "\u672A\u767B\u5F55",
    badgeClickToSignIn: "\u70B9\u51FB\u767B\u5F55",
    badgeSwitchAccount: "\u5207\u6362\u8D26\u53F7",
    badgeSwitching: "\u5207\u6362\u4E2D\u2026",
    badgeUsage: "\u989D\u5EA6",
    badgeUsed: "\u5DF2\u4F7F\u7528",
    badgeResets: "\u91CD\u7F6E",
    badgeQuotaRemaining: "\u5269\u4F59\u989D\u5EA6",
    badgeQuotaPrefix: "\u4F59",
    badgeSessionAccounts: "\u5F53\u524D\u4F1A\u8BDD\u7684\u8D26\u53F7",
    badgeFollowingGlobal: "\u8DDF\u968F\u5168\u5C40\u9ED8\u8BA4",
    badgeSessionBound: "\u5DF2\u7ED1\u5B9A\u5F53\u524D\u4F1A\u8BDD",
    badgeNotInUse: "\u5F53\u524D\u672A\u4F7F\u7528 Copilot",
    badgeUnavailable: "\u8D26\u53F7\u670D\u52A1\u4E0D\u53EF\u7528",
    badgeBoundUnavailable: "\u7ED1\u5B9A\u8D26\u53F7\u4E0D\u53EF\u7528",
    badgeNoDefault: "\u5C1A\u65E0\u5168\u5C40\u9ED8\u8BA4\u8D26\u53F7",
    badgeUnknownQuota: "\u989D\u5EA6\u4E0D\u53EF\u7528",
    badgeUnmanaged: "\u672A\u6258\u7BA1\u51ED\u636E\uFF0C\u8D26\u53F7\u8EAB\u4EFD\u672A\u77E5",
    badgeUseSession: "\u7528\u4E8E\u5F53\u524D\u4F1A\u8BDD",
    badgeFollowGlobal: "\u8DDF\u968F\u5168\u5C40\u9ED8\u8BA4",
    badgeSetGlobalDefault: "\u8BBE\u4E3A\u5168\u5C40\u9ED8\u8BA4",
    badgeGlobalDefault: "\u5168\u5C40\u9ED8\u8BA4",
    badgeGlobalHint: "\u5F71\u54CD\u8DDF\u968F\u5168\u5C40\u9ED8\u8BA4\u7684\u4F1A\u8BDD\uFF0C\u4E0D\u6539\u53D8\u5DF2\u72EC\u7ACB\u7ED1\u5B9A\u7684\u4F1A\u8BDD",
    badgeRefresh: "\u5237\u65B0",
    badgeRunningHint: "\u4F1A\u8BDD\u6B63\u5728\u8FD0\u884C\uFF0C\u8BF7\u7B49\u5F85\u7A7A\u95F2\u540E\u518D\u66F4\u6539\u7ED1\u5B9A\u8D26\u53F7\u3002",
    badgeHistoryHint: "\u5207\u6362\u540E\uFF0C\u540E\u7EED\u8BF7\u6C42\uFF08\u5305\u62EC\u5F53\u524D\u5BF9\u8BDD\u7684\u5DF2\u6709\u5386\u53F2\uFF09\u4F1A\u901A\u8FC7\u6240\u9009\u8D26\u53F7\u53CA\u5176\u670D\u52A1\u53D1\u9001\u3002",
    badgeRowUnavailable: "\u4E0D\u53EF\u7528",
    badgeRouteUnavailable: "\u4F1A\u8BDD\u8DEF\u7531\u4E0D\u53EF\u7528",
    badgeFailureTitle: "\u8BF7\u6C42\u7EED\u63A5\u5931\u8D25",
    badgeFailureBody: "\u5DF2\u91CD\u7F6E\u53EF\u91CD\u5EFA\u7684\u8BF7\u6C42\u72B6\u6001\uFF0C\u804A\u5929\u8BB0\u5F55\u4FDD\u7559\u3002\u8BF7\u67E5\u770B\u9519\u8BEF\u540E\u91CD\u8BD5\u3002",
    badgeClose: "\u5173\u95ED",
    badgeErrorOwner: "\u53EA\u6709\u6B64 Host \u7684\u6240\u6709\u8005\u53EF\u4EE5\u7BA1\u7406 Copilot \u8D26\u53F7\u3002",
    badgeErrorForbidden: "\u65E0\u6743\u8BBF\u95EE\u5F53\u524D\u4F1A\u8BDD\u3002",
    badgeErrorBusy: "\u8BF7\u7B49\u5F85\u5F53\u524D\u4F1A\u8BDD\u7A7A\u95F2\u540E\u518D\u66F4\u6539\u8D26\u53F7\u3002",
    badgeErrorRestart: "\u8BF7\u91CD\u542F DSH\uFF0C\u4EE5\u52A0\u8F7D\u6B64\u8D26\u53F7\u7684\u538B\u7F29\u7B56\u7565\u3002",
    badgeErrorInactive: "\u8BF7\u5148\u9009\u62E9 Copilot \u6A21\u578B\uFF0C\u518D\u7ED1\u5B9A\u8D26\u53F7\u3002",
    badgeErrorStale: "\u4F1A\u8BDD\u3001\u6A21\u578B\u6216 Host \u5DF2\u53D8\u5316\uFF0C\u8BF7\u5237\u65B0\u8D26\u53F7\u5217\u8868\u3002",
    badgeErrorAccount: "\u6240\u9009\u8D26\u53F7\u5DF2\u4E0D\u53EF\u7528\u3002",
    badgeErrorModel: "\u8BE5\u8D26\u53F7\u4E0D\u652F\u6301\u5F53\u524D\u6A21\u578B\u6216\u63A8\u7406\u8BBE\u7F6E\u3002",
    badgeErrorUnavailable: "\u6B64 Host \u7684\u4F1A\u8BDD\u8D26\u53F7\u670D\u52A1\u4E0D\u53EF\u7528\u3002",
    badgeErrorCancelled: "\u8D26\u53F7\u8BF7\u6C42\u5DF2\u53D6\u6D88\u3002",
    badgeErrorRequest: "\u8D26\u53F7\u64CD\u4F5C\u5931\u8D25\uFF0C\u8BF7\u5237\u65B0\u5217\u8868\u540E\u518D\u91CD\u8BD5\u3002"
  }
};
var NAV_TEXTS = Object.keys(DICTS).map((locale) => DICTS[locale].nav);
function friendlyError(raw, t) {
  const msg = String(raw ?? "");
  const lower = msg.toLowerCase();
  if (lower.includes("fetch failed") || lower.includes("econnrefused") || lower.includes("network")) {
    return t("errorNetwork");
  }
  if (lower.includes("unexpected token") || lower.includes("is not valid json")) {
    return t("errorNetwork");
  }
  if (lower.includes("timeout") || lower.includes("abort")) {
    return t("errorTimeout");
  }
  if (lower.includes("\u53D6\u6D88")) {
    return t("errorCancelled");
  }
  if (lower.includes("\u4F01\u4E1A\u57DF\u540D\u672A\u751F\u6548") || lower.includes("domain")) {
    return t("errorDomainMismatch");
  }
  return `${t("errorDefault")} (${msg})`;
}
var PLUS_SVG = '<svg aria-hidden="true" width="12" height="12" viewBox="0 0 16 16" fill="currentColor" style="flex:none;margin-right:6px;vertical-align:middle"><path d="M7.75 2a.75.75 0 0 1 .75.75V7h4.25a.75.75 0 0 1 0 1.5H8.5v4.25a.75.75 0 0 1-1.5 0V8.5H2.75a.75.75 0 0 1 0-1.5H7V2.75A.75.75 0 0 1 7.75 2Z"/></svg>';
var CHECK_SVG = '<svg aria-hidden="true" width="14" height="14" viewBox="0 0 16 16" fill="currentColor" style="flex:none;color:#2ea44f"><path d="M13.78 4.22a.75.75 0 0 1 0 1.06l-7.25 7.25a.75.75 0 0 1-1.06 0L2.22 9.28a.751.751 0 0 1 .018-1.042.751.751 0 0 1 1.042-.018L6 10.94l6.72-6.72a.75.75 0 0 1 1.06 0Z"/></svg>';
var GLOBE_SVG = '<svg aria-hidden="true" width="14" height="14" viewBox="0 0 16 16" fill="currentColor" style="flex:none;opacity:0.6"><path d="M8 0a8 8 0 1 1 0 16A8 8 0 0 1 8 0ZM1.5 8a6.5 6.5 0 1 0 13 0 6.5 6.5 0 0 0-13 0Zm5.93-4.26a7.3 7.3 0 0 0-.52.8c-.35.65-.66 1.44-.85 2.34h2.4l.7-2.51a4.53 4.53 0 0 0-1.73-.63Zm2.8-.31-.52 1.87h2.15A6.52 6.52 0 0 0 8 1.55c-.61 0-1.2.09-1.77.25l.7 2.51h2.4c.16-.66.27-1.34.32-2.04a6.53 6.53 0 0 0-1.42-.25Zm-4.86 8.32c.19.9.5 1.69.85 2.34.16.3.34.56.52.8a4.53 4.53 0 0 0 1.73-.63l-.7-2.51h-2.4Zm5.66 2.51c.35-.65.66-1.44.85-2.34.17-.86.26-1.77.26-2.71h-2.4l-.7 2.51c.61.36 1.27.61 1.99.74.01.6.01 1.2 0 1.8Z"/></svg>';
var SPINNER_SVG = '<svg aria-hidden="true" width="14" height="14" viewBox="0 0 16 16" fill="none" style="flex:none;animation:copilot-spin 0.8s linear infinite"><circle cx="8" cy="8" r="6" stroke="currentColor" stroke-width="2" stroke-dasharray="28 12" stroke-linecap="round" opacity="0.6"/></svg>';
var SPINNER_STYLE = "<style>@keyframes copilot-spin{to{transform:rotate(360deg)}}</style>";
var CHEVRON_DOWN_SVG = '<svg aria-hidden="true" width="12" height="12" viewBox="0 0 16 16" fill="currentColor" style="flex:none;margin-left:4px;vertical-align:middle"><path d="M12.78 5.22a.749.749 0 0 1 0 1.06l-4.25 4.25a.749.749 0 0 1-1.06 0L3.22 6.28a.749.749 0 1 1 1.06-1.06L8 8.939l3.72-3.719a.749.749 0 0 1 1.06 0Z"/></svg>';
var styles = {
  section: { maxWidth: 720, display: "flex", flexDirection: "column", gap: 12, fontFamily: "inherit" },
  headerRow: { display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 },
  title: { margin: 0, fontSize: 16, fontWeight: 500, lineHeight: "24px" },
  intro: { margin: 0, fontSize: 14, lineHeight: "22px", opacity: 0.75 },
  button: {
    height: 32,
    padding: "0 14px",
    fontSize: 14,
    borderRadius: 16,
    border: "none",
    cursor: "pointer",
    fontFamily: "inherit"
  },
  primary: { background: "#4c6ef5", color: "#fff" },
  secondary: { background: "transparent", color: "inherit", border: "1px solid currentColor", opacity: 0.8 },
  addButton: {
    height: 32,
    padding: "0 14px",
    fontSize: 14,
    borderRadius: 16,
    cursor: "pointer",
    fontFamily: "inherit",
    background: "transparent",
    color: "inherit",
    border: "1px solid rgba(128,128,128,0.45)"
  },
  card: {
    border: "1px solid rgba(128,128,128,0.35)",
    borderRadius: 12,
    padding: "12px 14px",
    display: "flex",
    flexDirection: "column",
    gap: 10
  },
  cardTop: { display: "flex", alignItems: "center", gap: 12 },
  avatar: { borderRadius: "50%", flex: "none", objectFit: "cover", background: "rgba(128,128,128,0.25)" },
  avatarFallback: {
    borderRadius: "50%",
    flex: "none",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    background: "rgba(128,128,128,0.25)",
    color: "inherit",
    fontWeight: 600
  },
  who: { flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 2 },
  nameRow: { display: "flex", alignItems: "center", gap: 8, minWidth: 0 },
  name: { fontSize: 14, fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
  badge: {
    flex: "none",
    fontSize: 12,
    lineHeight: "18px",
    padding: "0 8px",
    borderRadius: 9,
    background: "rgba(128,128,128,0.18)"
  },
  sub: { margin: 0, fontSize: 13, lineHeight: "20px", opacity: 0.7 },
  dots: {
    flex: "none",
    width: 32,
    height: 32,
    borderRadius: "50%",
    border: "none",
    background: "transparent",
    color: "inherit",
    fontSize: 16,
    cursor: "pointer",
    opacity: 0.75
  },
  menu: {
    position: "absolute",
    right: 0,
    top: 36,
    zIndex: 10,
    minWidth: 200,
    padding: 4,
    background: "var(--background, #fff)",
    color: "var(--foreground, #1a1a1a)",
    border: "1px solid rgba(128,128,128,0.4)",
    borderRadius: 10,
    boxShadow: "0 8px 24px rgba(0,0,0,0.18)",
    display: "flex",
    flexDirection: "column",
    gap: 2
  },
  menuItem: {
    display: "block",
    width: "100%",
    textAlign: "left",
    padding: "8px 10px",
    fontSize: 14,
    border: "none",
    borderRadius: 8,
    background: "transparent",
    color: "inherit",
    cursor: "pointer",
    fontFamily: "inherit"
  },
  menuItemDisabled: { opacity: 0.45, cursor: "default" },
  menuItemDanger: { color: "#e03131" },
  backdrop: { position: "fixed", inset: 0, zIndex: 9, background: "transparent" },
  menuDesc: { fontSize: 12, lineHeight: "18px", opacity: 0.7, marginTop: 2 },
  planBlock: {
    display: "flex",
    flexDirection: "column",
    gap: 6,
    paddingTop: 4,
    borderTop: "1px solid rgba(128,128,128,0.25)"
  },
  planTitle: { fontSize: 13, lineHeight: "20px", opacity: 0.7 },
  planValue: { fontSize: 14, lineHeight: "22px", fontWeight: 500 },
  creditsRow: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    fontSize: 13,
    lineHeight: "20px"
  },
  barTrack: { height: 6, borderRadius: 3, background: "rgba(128,128,128,0.25)", overflow: "hidden" },
  barFill: { height: "100%", borderRadius: 3, background: "#4c6ef5" },
  muted: { margin: 0, fontSize: 12, lineHeight: "18px", opacity: 0.6 },
  codeHint: { margin: 0, fontSize: 13, lineHeight: "20px", opacity: 0.85 },
  codeRow: { display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" },
  code: { fontSize: 24, fontWeight: 700, letterSpacing: 2, fontVariantNumeric: "tabular-nums" },
  link: { fontSize: 13, color: "#4c6ef5" },
  error: { margin: 0, fontSize: 13, lineHeight: "20px", color: "#e03131" },
  // 错误卡片（参考 GitHub Copilot desktop Authorization failed 样式）
  errorCard: {
    border: "1px solid rgba(128,128,128,0.35)",
    borderRadius: 12,
    padding: "16px 18px",
    display: "flex",
    flexDirection: "column",
    gap: 14
  },
  errorCardTitle: { margin: 0, fontSize: 16, fontWeight: 600, lineHeight: "24px" },
  errorCardDesc: { margin: 0, fontSize: 14, lineHeight: "22px", opacity: 0.7 },
  alertBox: {
    display: "flex",
    alignItems: "flex-start",
    gap: 10,
    padding: "10px 14px",
    borderRadius: 8,
    background: "#FEF2F2",
    border: "1px solid #FECACA",
    color: "#991B1B",
    fontSize: 13,
    lineHeight: "20px"
  },
  alertIcon: {
    flex: "none",
    width: 16,
    height: 16,
    borderRadius: "50%",
    background: "#DC2626",
    color: "#fff",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontSize: 11,
    fontWeight: 700,
    marginTop: 2
  },
  errorActions: { display: "flex", alignItems: "center", gap: 10 },
  input: {
    flex: 1,
    minWidth: 180,
    height: 32,
    padding: "0 10px",
    fontSize: 14,
    borderRadius: 8,
    border: "1px solid rgba(128,128,128,0.45)",
    background: "transparent",
    color: "inherit",
    fontFamily: "inherit"
  }
};
function useAvatarRecovery(id, src, onRecovered, requestProfile, scopeKey, isCurrent) {
  const controllerRef = (0, import_react.useRef)(null);
  if (controllerRef.current === null) controllerRef.current = createAvatarRecovery();
  const controller = controllerRef.current;
  controller.configure(id, src, scopeKey !== void 0 || requestProfile !== void 0 ? { scopeKey, requestProfile, isCurrent } : void 0);
  const callbackRef = (0, import_react.useRef)(onRecovered);
  callbackRef.current = onRecovered;
  const [, rerender] = (0, import_react.useState)(0);
  (0, import_react.useEffect)(() => {
    const unsubscribe = controller.subscribe(() => rerender((value) => value + 1));
    controller.mount();
    rerender((value) => value + 1);
    return () => {
      unsubscribe();
      controller.unmount();
    };
  }, [controller]);
  const state = controller.snapshot();
  return { ...state, onError: () => {
    void controller.fail(state.revision, (nextSource) => callbackRef.current?.(nextSource));
  } };
}
function Avatar({ id, src, name: name2, size = 36, onRecovered }) {
  const image = useAvatarRecovery(id, src, onRecovered);
  const initial = (name2 ?? "?").trim().charAt(0).toUpperCase() || "?";
  if (!image.source || image.failed) {
    return /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { style: { ...styles.avatarFallback, width: size, height: size, fontSize: Math.round(size * 0.45) }, children: initial });
  }
  return /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
    "img",
    {
      src: image.source,
      alt: "",
      width: size,
      height: size,
      style: styles.avatar,
      referrerPolicy: "no-referrer",
      onError: image.onError
    },
    image.revision
  );
}
function useUsageClock() {
  const [now, setNow] = (0, import_react.useState)(() => Date.now());
  (0, import_react.useEffect)(() => {
    const timer = setInterval(() => setNow(Date.now()), 6e4);
    return () => clearInterval(timer);
  }, []);
  return now;
}
function UsageMonthSummary({ now, t, menu = false }) {
  const month = utcMonthProgress(now), fraction = Math.min(100, Math.max(0, month.elapsedPercent));
  const label = t("usageMonth").replace("{month}", month.key).replace("{elapsed}", month.elapsedDays.toFixed(1)).replace("{remaining}", month.remainingDays.toFixed(1));
  return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { "data-usage-month": true, title: `${month.start} \u2014 ${month.end}`, style: { ...styles.muted, padding: menu ? "4px 12px 8px" : "0 0 10px" }, children: [
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { children: label }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { "data-usage-legend": true, style: { display: "flex", alignItems: "center", gap: 8, marginTop: 4 }, children: [
      /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { style: { display: "inline-flex", alignItems: "center", gap: 4 }, children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("i", { "aria-hidden": "true", style: { width: 7, height: 7, borderRadius: "50%", background: "#4c6ef5" } }),
        t("badgeUsed")
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { style: { display: "inline-flex", alignItems: "center", gap: 4 }, children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("i", { "aria-hidden": "true", style: { width: 7, height: 7, background: "#d9a441", transform: "rotate(45deg)" } }),
        "UTC"
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { "data-month-track": true, role: "img", "aria-label": `UTC ${month.elapsedPercent.toFixed(1)}%`, style: { position: "relative", flex: 1, maxWidth: 120, height: 4, borderRadius: 2, background: "rgba(128,128,128,0.25)" }, children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { "data-month-marker": true, style: { position: "absolute", top: "50%", left: `${fraction}%`, width: 8, height: 8, background: "#d9a441", border: "1px solid var(--dsh-bg, #fff)", transform: "translate(-50%, -50%) rotate(45deg)" } }) })
    ] })
  ] });
}
function UsageProgress({ percent, now, t }) {
  const month = utcMonthProgress(now);
  const used = Number.isFinite(percent) ? percent : null;
  const bounded = (value) => Math.min(100, Math.max(0, value));
  const title = t("usageCursor").replace("{used}", used === null ? "\u2014" : used.toFixed(1)).replace("{time}", month.elapsedPercent.toFixed(1));
  const base = { position: "absolute", top: "50%", border: "1px solid var(--dsh-bg, #fff)", transform: "translate(-50%, -50%)" };
  return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { "data-usage-track": true, role: "img", "aria-label": title, title, style: { ...styles.barTrack, position: "relative", overflow: "visible" }, children: [
    used !== null && /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(import_jsx_runtime.Fragment, { children: [
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { style: { ...styles.barFill, width: `${bounded(used)}%`, borderRadius: "inherit", opacity: 0.55 } }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { "data-usage-marker": true, style: { ...base, left: `${bounded(used)}%`, width: 9, height: 9, borderRadius: "50%", background: "#4c6ef5", zIndex: 3 } })
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
      "span",
      {
        "data-month-marker": true,
        title: `UTC ${new Date(now).toISOString().slice(0, 10)} \xB7 ${month.elapsedPercent.toFixed(1)}%`,
        style: { ...base, left: `${bounded(month.elapsedPercent)}%`, width: 8, height: 8, borderRadius: 0, background: "#d9a441", transform: "translate(-50%, -50%) rotate(45deg)", zIndex: 2 }
      }
    )
  ] });
}
function UsageBlock({ t, plan, usage, usageError, now }) {
  if (usageError) {
    return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("p", { style: styles.muted, children: [
      t("usageFailed"),
      "\uFF1A",
      usageError
    ] });
  }
  if (!plan && !usage) return null;
  const percent = usage?.unlimited ? void 0 : usage?.percentUsed;
  const knownPercent = Number.isFinite(percent);
  const hasReset = typeof usage?.resets === "string" && usage.resets !== "";
  const creditTitle = hasReset ? t("creditsWithReset").replace("{date}", usage.resets) : t("credits");
  return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: styles.planBlock, children: [
    plan !== void 0 && /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: { display: "flex", alignItems: "baseline", gap: 8 }, children: [
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { style: styles.planTitle, children: t("plan") }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { style: styles.planValue, children: plan })
    ] }),
    (knownPercent || usage?.unlimited === true || hasReset) && /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: { ...styles.creditsRow, gap: 12 }, children: [
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: creditTitle }),
      usage?.unlimited === true ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { title: t("unlimited"), style: { flex: "none" }, children: "\u221E" }) : knownPercent && /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { style: { flex: "none", fontVariantNumeric: "tabular-nums" }, children: [
        Math.round(Math.max(0, Math.min(100, percent))),
        "%"
      ] })
    ] }),
    knownPercent && /* @__PURE__ */ (0, import_jsx_runtime.jsx)(UsageProgress, { percent, now, t })
  ] });
}
function CombinedUsage({ accounts, t, menu = false }) {
  const combined = combinedAccountUsage(accounts);
  if (!combined.visible) return null;
  const used = combined.used === null ? "\u2014" : `${combined.used}%`;
  const capacity = combined.capacity === null ? "\u221E" : `${combined.capacity}%`;
  return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(
    "div",
    {
      "data-combined-usage": true,
      title: t("combinedUsageHint"),
      "aria-description": t("combinedUsageHint"),
      style: {
        padding: menu ? "8px 12px" : "0 0 10px",
        fontSize: 13,
        fontWeight: 500,
        fontVariantNumeric: "tabular-nums",
        borderBottom: menu ? "1px solid rgba(128,128,128,0.15)" : void 0
      },
      children: [
        t("combinedUsed"),
        " ",
        used,
        " / ",
        capacity
      ]
    }
  );
}
function AccountCard({ t, account, now, busy, menuOpen, onToggleMenu, onActivate, onLogout, onUpdateAuth, onRefreshModels, onManagePlan, onAvatarRecovered }) {
  const title = account.name ?? account.login ?? t("legacyAccount");
  return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: styles.card, children: [
    /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: styles.cardTop, children: [
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Avatar, { id: account.id, src: account.avatarUrl, name: account.name ?? account.login, onRecovered: onAvatarRecovered }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: styles.who, children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: styles.nameRow, children: [
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { style: styles.name, children: title }),
          account.active && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { style: styles.badge, children: t("defaultBadge") })
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { style: styles.sub, children: [account.login, account.domain].filter(Boolean).join(" \xB7 ") })
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: { position: "relative", flex: "none" }, children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", { type: "button", style: styles.dots, "aria-label": t("menu"), onClick: onToggleMenu, children: "\u2026" }),
        menuOpen && /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: styles.menu, children: [
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
            "button",
            {
              type: "button",
              style: { ...styles.menuItem, ...account.active || busy ? styles.menuItemDisabled : null },
              disabled: account.active || busy,
              onClick: onActivate,
              children: t("setDefault")
            }
          ),
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
            "button",
            {
              type: "button",
              style: { ...styles.menuItem, ...busy ? styles.menuItemDisabled : null },
              disabled: busy,
              onClick: onUpdateAuth,
              children: t("updateAuth")
            }
          ),
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
            "button",
            {
              type: "button",
              style: { ...styles.menuItem, ...busy ? styles.menuItemDisabled : null },
              disabled: busy,
              onClick: onRefreshModels,
              children: t("refreshModels")
            }
          ),
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
            "button",
            {
              type: "button",
              style: { ...styles.menuItem, ...busy ? styles.menuItemDisabled : null },
              disabled: busy,
              onClick: onManagePlan,
              children: t("managePlan")
            }
          ),
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
            "button",
            {
              type: "button",
              style: { ...styles.menuItem, ...styles.menuItemDanger, ...busy ? styles.menuItemDisabled : null },
              disabled: busy,
              onClick: onLogout,
              children: t("signOut")
            }
          )
        ] })
      ] })
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)(UsageBlock, { t, now, plan: account.plan, usage: account.usage, usageError: account.usageError })
  ] });
}
function CopilotSection({ t = (key) => DICTS.en[key] ?? key }) {
  const now = useUsageClock();
  const [accounts, setAccounts] = (0, import_react.useState)(null);
  const [signing, setSigning] = (0, import_react.useState)(null);
  const [error, setError] = (0, import_react.useState)(void 0);
  const [syncError, setSyncError] = (0, import_react.useState)(void 0);
  const [copied, setCopied] = (0, import_react.useState)(false);
  const [linkCopied, setLinkCopied] = (0, import_react.useState)(false);
  const [linkOpened, setLinkOpened] = (0, import_react.useState)(false);
  const [addOpen, setAddOpen] = (0, import_react.useState)(false);
  const [enterpriseStep, setEnterpriseStep] = (0, import_react.useState)(false);
  const [domain, setDomain] = (0, import_react.useState)("");
  const [menuFor, setMenuFor] = (0, import_react.useState)(null);
  const [busy, setBusy] = (0, import_react.useState)(false);
  const [lastStart, setLastStart] = (0, import_react.useState)(null);
  const [countdown, setCountdown] = (0, import_react.useState)(0);
  const timer = (0, import_react.useRef)(null);
  const timeoutTimer = (0, import_react.useRef)(null);
  const stopTimers = () => {
    if (timer.current) {
      clearInterval(timer.current);
      timer.current = null;
    }
    if (timeoutTimer.current) {
      clearInterval(timeoutTimer.current);
      timeoutTimer.current = null;
    }
  };
  const startTimeout = () => {
    if (timeoutTimer.current) clearInterval(timeoutTimer.current);
    setCountdown(300);
    timeoutTimer.current = setInterval(() => {
      setCountdown((n) => {
        if (n <= 1) {
          if (timeoutTimer.current) {
            clearInterval(timeoutTimer.current);
            timeoutTimer.current = null;
          }
          if (timer.current) {
            clearInterval(timer.current);
            timer.current = null;
          }
          fetch("/copilot-auth/cancel", { method: "POST" }).catch(() => {
          });
          setSigning(null);
          setError(t("signInTimeout"));
          return 0;
        }
        return n - 1;
      });
    }, 1e3);
  };
  const cancelSignIn = () => {
    stopTimers();
    fetch("/copilot-auth/cancel", { method: "POST" }).catch(() => {
    });
    setSigning(null);
    setLastStart(null);
    setCountdown(0);
    setError(void 0);
  };
  const refreshAccounts = async () => {
    try {
      const d = await fetch("/copilot-auth/accounts").then((r) => r.json());
      setAccounts(Array.isArray(d.accounts) ? d.accounts : []);
      setSyncError(d.syncError);
    } catch {
      if (accounts === null) setAccounts([]);
    }
  };
  (0, import_react.useEffect)(() => {
    let alive = true;
    fetch("/copilot-auth/state").then((r) => r.json()).then((s) => {
      if (!alive) return;
      if (s.status === "running") {
        setSigning(s);
        poll();
      } else if (s.status === "failed") {
        setError(s.error ?? t("unknown"));
      }
    }).catch(() => {
    });
    refreshAccounts();
    return () => {
      alive = false;
      stopTimers();
    };
  }, []);
  const poll = () => {
    if (timer.current) clearInterval(timer.current);
    startTimeout();
    const tick = () => {
      fetch("/copilot-auth/state").then((r) => r.json()).then((s) => {
        if (s.status === "running") {
          setSigning(s);
          return;
        }
        stopTimers();
        setSigning(null);
        if (s.status === "authorized") {
          setCopied(false);
          setLastStart(null);
          setError(void 0);
          setCountdown(0);
          refreshAccounts();
        } else {
          setError(s.error ?? t("unknown"));
        }
      }).catch(() => {
      });
    };
    tick();
    timer.current = setInterval(tick, 1e3);
  };
  const start = async (kind, domainValue) => {
    setAddOpen(false);
    setEnterpriseStep(false);
    setError(void 0);
    setCopied(false);
    setLinkCopied(false);
    setLinkOpened(false);
    setLastStart({ kind, domain: domainValue });
    try {
      const res = await fetch("/copilot-auth/start", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ kind, domain: domainValue })
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        setError(d.error ?? `HTTP ${res.status}`);
        return;
      }
      setSigning({ status: "running", notices: [], kind, domain: domainValue });
      poll();
    } catch (err) {
      setError(String(err?.message ?? err));
    }
  };
  const retry = () => {
    if (lastStart === null) return;
    start(lastStart.kind, lastStart.domain);
  };
  const cancelError = () => {
    setError(void 0);
    setLastStart(null);
  };
  const activate = async (id) => {
    if (typeof id !== "string" || id === "") return;
    setMenuFor(null);
    setBusy(true);
    try {
      const res = await fetch("/copilot-auth/activate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id })
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        setError(d.error ?? `HTTP ${res.status}`);
      }
    } catch (err) {
      setError(String(err?.message ?? err));
    }
    await refreshAccounts();
    setBusy(false);
  };
  const logout = async (id) => {
    if (typeof id !== "string" || id === "") return;
    setMenuFor(null);
    setBusy(true);
    try {
      const res = await fetch("/copilot-auth/logout", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id })
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        setError(d.error ?? `HTTP ${res.status}`);
      }
    } catch (err) {
      setError(String(err?.message ?? err));
    }
    await refreshAccounts();
    setBusy(false);
  };
  const updateAuth = async (account) => {
    setMenuFor(null);
    const kind = account.domain === "github.com" ? "github.com" : "ghe.com";
    const domainValue = account.domain === "github.com" ? void 0 : account.domain;
    await start(kind, domainValue);
  };
  const refreshModels = async (id) => {
    if (typeof id !== "string" || id === "") return;
    setMenuFor(null);
    setBusy(true);
    try {
      const res = await fetch("/copilot-auth/models", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ id }) });
      if (!res.ok) setError(t("refreshModelsFailed"));
    } catch {
      setError(t("refreshModelsFailed"));
    }
    await refreshAccounts();
    setBusy(false);
  };
  const managePlan = (account) => {
    setMenuFor(null);
    const base = account.domain === "github.com" ? "https://github.com" : `https://${account.domain}`;
    window.open(`${base}/settings/copilot`, "_blank", "noopener");
  };
  const copyCode = async (code) => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 2e3);
    } catch {
    }
  };
  const openSite = async (url) => {
    if (!url) return;
    try {
      const r = await fetch("/copilot-auth/open", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ url })
      });
      if (r.ok) setLinkOpened(true);
    } catch {
    }
  };
  const copyLinkUrl = async (url) => {
    try {
      await navigator.clipboard.writeText(url);
      setLinkCopied(true);
      setTimeout(() => setLinkCopied(false), 2e3);
    } catch {
    }
  };
  const closeMenus = () => {
    setAddOpen(false);
    setMenuFor(null);
  };
  const codeNotice = signing ? [...signing.notices ?? []].reverse().find((n) => n && typeof n.code === "string" && n.code !== "") : void 0;
  const codeUrl = codeNotice?.url;
  const autoOpenedRef = (0, import_react.useRef)(null);
  (0, import_react.useEffect)(() => {
    if (!codeUrl || !codeNotice?.code || autoOpenedRef.current === codeNotice.code) return;
    autoOpenedRef.current = codeNotice.code;
    setLinkOpened(false);
    void openSite(codeUrl);
  }, [codeUrl, codeNotice?.code]);
  const signInTarget = signing?.kind === "ghe.com" && signing?.domain ? `${t("optGhe")}\uFF08${signing.domain}\uFF09` : t("optGithub");
  return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: styles.section, children: [
    (addOpen || menuFor !== null) && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { style: styles.backdrop, onClick: closeMenus }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: styles.headerRow, children: [
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("h3", { style: styles.title, children: t("title") }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: { position: "relative", flex: "none" }, children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("button", { type: "button", style: styles.addButton, onClick: () => {
          setMenuFor(null);
          setAddOpen((v) => !v);
        }, children: [
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { dangerouslySetInnerHTML: { __html: PLUS_SVG } }),
          t("addAccount"),
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { dangerouslySetInnerHTML: { __html: CHEVRON_DOWN_SVG } })
        ] }),
        addOpen && /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: styles.menu, children: [
          /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("button", { type: "button", style: styles.menuItem, onClick: () => start("github.com"), children: [
            t("optGithub"),
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { style: styles.menuDesc, children: t("optGithubDesc") })
          ] }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(
            "button",
            {
              type: "button",
              style: styles.menuItem,
              onClick: () => {
                setAddOpen(false);
                setEnterpriseStep(true);
              },
              children: [
                t("optGhe"),
                /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { style: styles.menuDesc, children: t("optGheDesc") })
              ]
            }
          )
        ] })
      ] })
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { style: styles.intro, children: t("intro") }),
    enterpriseStep && /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: styles.card, children: [
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("label", { style: styles.sub, htmlFor: "ghc-domain", children: t("domainLabel") }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: styles.codeRow, children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
          "input",
          {
            id: "ghc-domain",
            style: styles.input,
            placeholder: t("domainPlaceholder"),
            value: domain,
            onChange: (e) => setDomain(e.target.value)
          }
        ),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
          "button",
          {
            type: "button",
            style: { ...styles.button, ...styles.primary },
            disabled: domain.trim() === "",
            onClick: () => start("ghe.com", domain.trim()),
            children: t("continue")
          }
        ),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", { type: "button", style: { ...styles.button, ...styles.secondary }, onClick: () => setEnterpriseStep(false), children: t("cancel") })
      ] })
    ] }),
    signing?.status === "running" && /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: styles.card, children: [
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { dangerouslySetInnerHTML: { __html: SPINNER_STYLE } }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("h4", { style: { ...styles.title, fontSize: 16 }, children: t("addGithubTitle") }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { style: { ...styles.intro, marginTop: 4 }, children: (signing.domain && signing.domain !== "github.com" ? t("addGheDesc") : t("addGithubDesc")).replace("{domain}", signing.domain).replace("{target}", signing.domain ?? t("optGithub")) })
      ] }),
      codeNotice && /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: { ...styles.codeRow, cursor: "pointer" }, onClick: () => copyCode(codeNotice.code), role: "button", tabIndex: 0, children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { style: styles.code, children: codeNotice.code }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { dangerouslySetInnerHTML: { __html: copied ? CHECK_SVG : '<svg aria-hidden="true" width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" style="flex:none;opacity:0.5"><rect x="5" y="5" width="9" height="9" rx="2"/><rect x="2" y="2" width="9" height="9" rx="2"/></svg>' } })
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: { display: "flex", flexDirection: "column", gap: 8, marginTop: 4 }, children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: { display: "flex", alignItems: "center", gap: 8, fontSize: 13, lineHeight: "20px", opacity: copied ? 1 : 0.5 }, children: [
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { dangerouslySetInnerHTML: { __html: copied ? CHECK_SVG : '<svg aria-hidden="true" width="14" height="14" viewBox="0 0 16 16" fill="currentColor" style="flex:none;opacity:0.4"><circle cx="8" cy="8" r="6" stroke="currentColor" stroke-width="1.5" fill="none"/></svg>' } }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: t("stepCopied") })
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: { display: "flex", alignItems: "center", gap: 8, fontSize: 13, lineHeight: "20px", opacity: linkOpened ? 1 : 0.5 }, children: [
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { dangerouslySetInnerHTML: { __html: linkOpened ? CHECK_SVG : GLOBE_SVG } }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: t("stepOpened").replace("{target}", signing.domain ?? t("optGithub")) })
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: { display: "flex", alignItems: "center", gap: 8, fontSize: 13, lineHeight: "20px" }, children: [
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { dangerouslySetInnerHTML: { __html: SPINNER_SVG } }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: t("stepWaiting") }),
          countdown > 0 && /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { style: { opacity: 0.4, fontSize: 12 }, children: [
            "(",
            Math.floor(countdown / 60),
            ":",
            String(countdown % 60).padStart(2, "0"),
            ")"
          ] })
        ] })
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: { display: "flex", alignItems: "center", gap: 10 }, children: [
        codeUrl && /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
          "button",
          {
            type: "button",
            style: { ...styles.button, background: "#2ea44f", color: "#fff", border: "none" },
            onClick: () => openSite(codeUrl),
            children: t("openSite").replace("{target}", signing.domain ?? t("optGithub"))
          }
        ),
        codeUrl && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", { type: "button", style: { ...styles.button, ...styles.secondary }, onClick: () => copyLinkUrl(codeUrl), children: linkCopied ? t("copied") : t("copyLink") })
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", { type: "button", style: { ...styles.button, ...styles.secondary, opacity: 0.7 }, onClick: cancelSignIn, children: t("cancelSignIn") }) })
    ] }),
    error && lastStart !== null && /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: styles.errorCard, children: [
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("h4", { style: styles.errorCardTitle, children: t("authFailed") }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { style: styles.errorCardDesc, children: t("authFailedDesc").replace(
        "{target}",
        lastStart.kind === "ghe.com" && lastStart.domain ? lastStart.domain : t("optGithub")
      ) }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: styles.alertBox, children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { style: styles.alertIcon, children: "!" }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: friendlyError(error, t) })
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: styles.errorActions, children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", { type: "button", style: { ...styles.button, ...styles.secondary }, onClick: cancelError, children: t("cancel") }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", { type: "button", style: { ...styles.button, ...styles.primary }, onClick: retry, children: t("tryAgain") })
      ] })
    ] }),
    error && lastStart === null && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { style: styles.error, children: error }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)(CombinedUsage, { accounts, t }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)(UsageMonthSummary, { now, t }),
    accounts === null ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { style: styles.sub, children: t("loading") }) : accounts.length === 0 && signing === null ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { style: styles.sub, children: t("noAccounts") }) : accounts.map((account) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
      AccountCard,
      {
        t,
        account,
        now,
        busy,
        menuOpen: menuFor !== null && menuFor === account.id,
        onToggleMenu: () => setMenuFor((v) => v === account.id ? null : account.id),
        onActivate: () => activate(account.id),
        onLogout: () => logout(account.id),
        onUpdateAuth: () => updateAuth(account),
        onRefreshModels: () => refreshModels(account.id),
        onManagePlan: () => managePlan(account),
        onAvatarRecovered: refreshAccounts
      },
      account.id
    )),
    accounts?.length > 0 && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { style: { ...styles.muted, marginTop: 4 }, children: t("creditsNote") }),
    syncError && /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("p", { style: styles.muted, children: [
      "sync: ",
      syncError
    ] })
  ] });
}
var BADGE_COPILOT_SVG = '<svg aria-hidden="true" width="14" height="14" viewBox="0 0 16 16" fill="currentColor" style="flex:none"><path d="M7.998 15.035c-4.562 0-7.873-2.914-7.998-3.749V9.338c.085-.628.677-1.686 1.588-2.065.013-.07.024-.143.036-.218.029-.183.06-.384.126-.612-.201-.508-.254-1.084-.254-1.656 0-.87.128-1.769.693-2.484.579-.733 1.494-1.124 2.724-1.261 1.206-.134 2.262.034 2.944.765.05.053.096.108.139.165.044-.057.094-.112.143-.165.682-.731 1.738-.899 2.944-.765 1.23.137 2.145.528 2.724 1.261.566.715.693 1.614.693 2.484 0 .572-.053 1.148-.254 1.656.066.228.098.429.126.612.924.385 1.522 1.471 1.591 2.095v1.872c0 .766-3.351 3.795-8.002 3.795Zm0-1.485c2.28 0 4.584-1.11 5.002-1.433V7.862l-.023-.116c-.49.21-1.075.291-1.727.291-1.146 0-2.059-.327-2.71-.991A3.222 3.222 0 0 1 8 6.303a3.24 3.24 0 0 1-.544.743c-.65.664-1.563.991-2.71.991-.652 0-1.236-.081-1.727-.291l-.023.116v4.255c.419.323 2.722 1.433 5.002 1.433ZM6.762 2.83c-.193-.206-.637-.413-1.682-.297-1.019.113-1.479.404-1.713.7-.247.312-.369.789-.369 1.554 0 .793.129 1.171.308 1.371.162.181.519.379 1.442.379.853 0 1.339-.235 1.638-.54.315-.322.527-.827.617-1.553.117-.935-.037-1.395-.241-1.614Zm4.155-.297c-1.044-.116-1.488.091-1.681.297-.204.219-.358.679-.242 1.614.091.726.303 1.231.618 1.553.299.305.784.54 1.638.54.922 0 1.28-.198 1.442-.379.179-.2.308-.578.308-1.371 0-.765-.123-1.242-.37-1.554-.233-.296-.693-.587-1.713-.7Z"/><path d="M6.25 9.037a.75.75 0 0 1 .75.75v1.501a.75.75 0 0 1-1.5 0V9.787a.75.75 0 0 1 .75-.75Zm4.25.75v1.501a.75.75 0 0 1-1.5 0V9.787a.75.75 0 0 1 1.5 0Z"/></svg>';
var EMPTY_AVATAR_IMAGE = Object.freeze({ status: "invalid", hasImage: false, failureRevision: 0 });
function AccountAvatar({ id, issuer, slot = "row", url, login, size = 18, onRecovered, requestProfile, scopeKey, isCurrent }) {
  const containerRef = (0, import_react.useRef)(null), leaseRef = (0, import_react.useRef)(null), ownerRef = (0, import_react.useRef)(null), guardRef = (0, import_react.useRef)(isCurrent), errorRef = (0, import_react.useRef)(null);
  guardRef.current = isCurrent;
  if (ownerRef.current === null || ownerRef.current.scopeKey !== scopeKey || ownerRef.current.id !== id || ownerRef.current.issuer !== issuer || ownerRef.current.slot !== slot) {
    const owner2 = { scopeKey, id, issuer, slot, recoveryScope: {} };
    owner2.current = () => {
      try {
        return ownerRef.current === owner2 && typeof guardRef.current === "function" && guardRef.current() === true;
      } catch {
        return false;
      }
    };
    ownerRef.current = owner2;
  }
  const owner = ownerRef.current;
  const image = useAvatarRecovery(id, url, (nextSource) => {
    const held = leaseRef.current;
    if (!owner.current() || held?.owner !== owner) return;
    if (typeof nextSource === "string" && nextSource !== "") void held.lease.refresh(nextSource).catch(() => {
    });
    return onRecovered?.(nextSource);
  }, requestProfile, owner.recoveryScope, owner.current);
  errorRef.current = image.onError;
  const [cached, setCached] = (0, import_react.useState)({ owner: null, value: EMPTY_AVATAR_IMAGE });
  const enabled = scopeKey !== null && typeof scopeKey === "object" && typeof issuer === "string" && issuer !== "" && typeof id === "string" && id !== "" && typeof image.source === "string" && image.source !== "";
  (0, import_react.useLayoutEffect)(() => {
    if (!enabled || !owner.current()) return;
    let lease;
    try {
      lease = avatarImageCache.acquire({ scope: scopeKey, issuer, accountId: id, slot, source: image.source, isCurrent: owner.current });
    } catch {
      setCached({ owner, value: EMPTY_AVATAR_IMAGE });
      return;
    }
    const held = { owner, lease };
    leaseRef.current = held;
    let live = true, seenFailure = lease.snapshot().failureRevision ?? 0;
    const sync = () => {
      if (!live || !owner.current()) return;
      const value = lease.snapshot();
      setCached({ owner, value });
      if (value.reason === "load-failed" && value.failureRevision > seenFailure) {
        seenFailure = value.failureRevision;
        queueMicrotask(() => {
          if (live && owner.current()) errorRef.current?.();
        });
      }
    };
    const unsubscribe = lease.subscribe(sync), detach = lease.attach(containerRef.current);
    sync();
    return () => {
      live = false;
      unsubscribe();
      detach();
      lease.release();
      if (leaseRef.current === held) leaseRef.current = null;
    };
  }, [owner, enabled]);
  (0, import_react.useLayoutEffect)(() => {
    const held = leaseRef.current;
    if (held?.owner === owner && owner.current() && image.source) held.lease.updateSource(image.source);
  }, [owner, image.source]);
  const state = enabled && cached.owner === owner ? cached.value : EMPTY_AVATAR_IMAGE;
  const direct = state.status === "fallback" && ["capacity", "slot-in-use", "oversized"].includes(state.reason) && image.source && !image.failed;
  const box = { width: size, height: size, borderRadius: "50%", flex: "none", display: "inline-flex", alignItems: "center", justifyContent: "center", overflow: "hidden", background: "#adb5bd" };
  return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { style: box, children: [
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { ref: containerRef, style: { width: "100%", height: "100%", display: state.hasImage ? "block" : "none" } }),
    direct ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
      "img",
      {
        src: image.source,
        alt: "",
        referrerPolicy: "no-referrer",
        onError: image.onError,
        style: { width: "100%", height: "100%", objectFit: "cover", display: "block", borderRadius: "50%" }
      },
      image.revision
    ) : !state.hasImage && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { style: { fontSize: Math.round(size * 0.55), color: "#fff", fontWeight: 600 }, children: (login ?? "?")[0]?.toUpperCase() ?? "?" })
  ] });
}
var EMPTY_SESSION_BADGE = { status: "loading", catalog: null, errorCode: null, busy: false, running: false, scopeKey: {}, requestProfile: void 0 };
function useSessionBadge(sessionId, sessions) {
  const [state, setState] = (0, import_react.useState)(EMPTY_SESSION_BADGE);
  (0, import_react.useEffect)(() => {
    let live = true, controller;
    try {
      controller = createSessionBadgeController({ sessionId, sessions });
    } catch {
      setState({ ...EMPTY_SESSION_BADGE, status: "unavailable", errorCode: "SESSION_UNAVAILABLE", sessionId, sessions });
      return;
    }
    const publish = () => {
      if (live) setState({ ...controller.getSnapshot(), controller, sessionId, sessions });
    };
    const unsubscribe = controller.subscribe(publish);
    publish();
    void controller.refresh();
    const timer = setInterval(() => {
      void controller.refresh();
    }, 3e4);
    return () => {
      live = false;
      clearInterval(timer);
      unsubscribe();
      controller.dispose();
    };
  }, [sessionId, sessions]);
  return state.sessionId === sessionId && state.sessions === sessions ? state : EMPTY_SESSION_BADGE;
}
function CopilotBadge({ sessionId, sessions, t = (k) => DICTS.en[k] ?? k }) {
  const now = useUsageClock();
  const runtime = useSessionBadge(sessionId, sessions);
  const [open, setOpen] = (0, import_react.useState)(false);
  const badgeRef = (0, import_react.useRef)(null);
  const ready = runtime.status === "ready";
  const view = deriveSessionBadgeState(runtime.catalog, { busy: runtime.busy || !ready, running: runtime.running });
  (0, import_react.useEffect)(() => {
    setOpen(false);
  }, [sessionId, runtime.scopeKey]);
  (0, import_react.useEffect)(() => {
    if (runtime.failureNotice != null) setOpen(false);
  }, [runtime.failureNotice?.id]);
  const refresh = () => runtime.controller?.refresh(true);
  const mutate = async (method, accountId) => {
    const accepted = await runtime.controller?.[method](accountId);
    if (accepted && method === "bind") setOpen(false);
  };
  const selectedLabel = view.account ? accountLabel(view.account, t("legacyAccount")) : void 0;
  const selectedBound = view.mode === "bound" ? view.accounts.find((account) => account.id === view.selectedAccountId) : void 0;
  const canOfferGlobal = selectedBound !== void 0 && selectedBound.available !== false && selectedBound.id !== view.globalAccountId;
  const statusLabel = !ready ? runtime.status === "loading" ? t("loading") : t("badgeUnavailable") : view.mode === "inactive" ? t("badgeNotInUse") : view.unavailable ? t(view.mode === "bound" ? "badgeBoundUnavailable" : "badgeUnavailable") : view.unmanaged ? "\u2014" : !view.account ? t("badgeNoDefault") : view.remaining !== null ? `${t("badgeQuotaPrefix")} ${view.remaining}%` : view.unlimited ? "\u221E" : t("badgeUnknownQuota");
  const title = [
    selectedLabel,
    view.unmanaged ? t("badgeUnmanaged") : view.mode === "bound" ? t("badgeSessionBound") : view.mode === "global" ? t("badgeFollowingGlobal") : void 0,
    view.remaining !== null ? `${t("badgeQuotaRemaining")} ${view.remaining}%` : statusLabel,
    view.running ? t("badgeRunningHint") : void 0,
    t("badgeHistoryHint")
  ].filter(Boolean).join(" \xB7 ");
  const rect = badgeRef.current?.getBoundingClientRect();
  const popupStyle = rect ? {
    position: "fixed",
    left: Math.max(8, Math.min(rect.left, window.innerWidth - 320)),
    bottom: window.innerHeight - rect.top + 4,
    minWidth: Math.min(320, window.innerWidth - 16),
    maxWidth: "calc(100vw - 16px)",
    maxHeight: "70vh",
    overflowY: "auto",
    background: "var(--dsh-bg, #fff)",
    color: "var(--dsh-fg, inherit)",
    border: "1px solid rgba(128,128,128,0.3)",
    borderRadius: 8,
    boxShadow: "0 4px 12px rgba(0,0,0,0.15)",
    zIndex: 100001
  } : null;
  const actionStyle = { border: "none", borderRadius: 4, background: "transparent", color: "inherit", fontFamily: "inherit", cursor: "pointer" };
  const avatarProps = { requestProfile: runtime.requestProfile, scopeKey: runtime.scopeKey, isCurrent: runtime.isCurrent, onRecovered: refresh };
  return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: { position: "relative", flex: "none" }, ref: badgeRef, children: [
    /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(
      "button",
      {
        type: "button",
        className: "copilot-badge",
        title,
        "aria-description": t("badgeHistoryHint"),
        "aria-expanded": open,
        style: { opacity: view.account ? 1 : 0.55 },
        onClick: () => {
          setOpen((value) => !value);
          if (!open) void refresh();
        },
        children: [
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { dangerouslySetInnerHTML: { __html: BADGE_COPILOT_SVG } }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "copilot-badge-label", style: view.remaining !== null && view.remaining < 20 ? { color: "#e03131" } : void 0, children: statusLabel })
        ]
      }
    ),
    open && runtime.failureNotice == null && popupStyle && (0, import_react_dom.createPortal)(/* @__PURE__ */ (0, import_jsx_runtime.jsxs)(import_jsx_runtime.Fragment, { children: [
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { style: { position: "fixed", inset: 0, zIndex: 1e5 }, onClick: () => setOpen(false) }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { role: "dialog", "aria-label": t("badgeSessionAccounts"), "aria-description": t("badgeHistoryHint"), "aria-busy": runtime.busy, style: popupStyle, children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)(CombinedUsage, { accounts: view.accounts, t, menu: true }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)(UsageMonthSummary, { now, t, menu: true }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: { display: "flex", alignItems: "center", gap: 8, padding: "8px 12px", borderBottom: "1px solid rgba(128,128,128,0.15)" }, children: [
          view.account && /* @__PURE__ */ (0, import_jsx_runtime.jsx)(AccountAvatar, { id: view.account.id, issuer: view.account.domain, slot: "header", url: view.account.avatarUrl, login: view.account.login, ...avatarProps }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { title: selectedLabel, style: { minWidth: 0, flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: 13, fontWeight: 600 }, children: selectedLabel ?? "GitHub Copilot" }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", { type: "button", style: { ...actionStyle, padding: "2px 6px" }, "aria-label": t("cancel"), onClick: () => setOpen(false), children: "\xD7" })
        ] }),
        view.used !== null && /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: { padding: "8px 12px" }, children: [
          /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: { display: "flex", justifyContent: "space-between", gap: 12, fontSize: 12, marginBottom: 6 }, children: [
            /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { children: [
              Math.round(view.used),
              "% ",
              t("badgeUsed")
            ] }),
            view.resets && /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { style: { opacity: 0.6 }, children: [
              t("badgeResets"),
              " ",
              view.resets
            ] })
          ] }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)(UsageProgress, { percent: view.used, now, t })
        ] }),
        runtime.errorCode && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { role: "alert", style: { padding: "4px 12px 8px", fontSize: 12, color: "#e03131" }, children: t(sessionBadgeErrorKey(runtime.errorCode)) }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(
          "button",
          {
            type: "button",
            title: view.running ? t("badgeRunningHint") : t("badgeFollowGlobal"),
            disabled: !view.canBind || view.followsGlobal,
            onClick: () => {
              void mutate("bind", null);
            },
            style: { ...actionStyle, display: "flex", gap: 8, alignItems: "center", width: "100%", padding: "8px 12px", textAlign: "left", fontSize: 13, opacity: view.canBind ? 1 : 0.5 },
            children: [
              /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { style: { flex: 1 }, children: t("badgeFollowGlobal") }),
              view.followsGlobal && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: "\u2713" })
            ]
          }
        ),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { style: { borderTop: "1px solid rgba(128,128,128,0.15)", padding: "4px 0" }, children: view.accounts.map((account) => {
          const selected = view.mode === "bound" && view.selectedAccountId === account.id;
          const accountUnavailable = account.available === false;
          const rowUnavailable = accountUnavailable || account.routeAvailable === false;
          const label = accountLabel(account, t("legacyAccount"));
          const quota = accountQuotaRemaining(account);
          const quotaTitle = quota.kind === "unknown" ? t("badgeUnknownQuota") : quota.kind === "unlimited" ? t("unlimited") : `${t("badgeQuotaRemaining")} ${quota.text}`;
          const hint = view.running ? t("badgeRunningHint") : rowUnavailable ? t(accountUnavailable ? "badgeRowUnavailable" : "badgeRouteUnavailable") : t("badgeHistoryHint");
          return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(
            "button",
            {
              type: "button",
              title: `${label} \xB7 ${hint}`,
              "aria-label": `${t("badgeUseSession")}: ${label}`,
              "aria-description": quotaTitle,
              disabled: !view.canBind || selected || rowUnavailable,
              onClick: () => {
                void mutate("bind", account.id);
              },
              style: {
                ...actionStyle,
                display: "flex",
                alignItems: "center",
                gap: 8,
                width: "100%",
                padding: "7px 12px",
                textAlign: "left",
                fontSize: 13,
                background: selected ? "rgba(76,109,245,0.08)" : "transparent",
                opacity: !view.canBind || rowUnavailable ? 0.5 : 1
              },
              children: [
                /* @__PURE__ */ (0, import_jsx_runtime.jsx)(AccountAvatar, { id: account.id, issuer: account.domain, slot: "row", url: account.avatarUrl, login: account.login, ...avatarProps }),
                /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { title: label, style: { minWidth: 0, flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }, children: label }),
                /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
                  "span",
                  {
                    "data-account-quota": account.id,
                    title: quotaTitle,
                    "aria-label": quotaTitle,
                    style: {
                      flex: "none",
                      minWidth: "3ch",
                      textAlign: "right",
                      whiteSpace: "nowrap",
                      fontVariantNumeric: "tabular-nums",
                      color: quota.kind === "percent" && quota.remaining < 20 ? "#e03131" : "inherit",
                      opacity: quota.kind === "unknown" ? 0.55 : 0.8
                    },
                    children: quota.text
                  }
                ),
                /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { "aria-hidden": "true", style: { flex: "none", width: "1em", textAlign: "center" }, children: selected ? "\u2713" : "" })
              ]
            },
            account.id
          );
        }) }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: { borderTop: "1px solid rgba(128,128,128,0.15)", padding: "6px 12px", display: "flex", alignItems: "center", gap: 12 }, children: [
          canOfferGlobal && /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
            "button",
            {
              type: "button",
              style: { ...actionStyle, padding: "3px 0", fontSize: 12 },
              title: t("badgeGlobalHint"),
              disabled: !view.canSetDefault,
              onClick: () => {
                void mutate("setDefault", selectedBound.id);
              },
              children: t("badgeSetGlobalDefault")
            }
          ),
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", { type: "button", style: { ...actionStyle, marginLeft: "auto", padding: "3px 4px", fontSize: 14 }, title: t("badgeRefresh"), "aria-label": t("badgeRefresh"), onClick: () => {
            void refresh();
          }, children: "\u21BB" })
        ] })
      ] })
    ] }), document.body),
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
      import_dsh_client_ui_primitives.Modal,
      {
        open: runtime.failureNotice != null,
        onClose: () => runtime.controller?.dismissFailure(),
        title: t("badgeFailureTitle"),
        closeLabel: t("badgeClose"),
        description: t("badgeFailureBody")
      }
    )
  ] });
}
function SettingsCopilotIcon({ size = 20, active = false }) {
  return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(
    "svg",
    {
      "aria-hidden": "true",
      width: size,
      height: size,
      viewBox: "0 0 16 16",
      fill: "currentColor",
      style: { display: "block", color: active ? "var(--dsh-accent, #4c6ef5)" : "currentColor" },
      children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("path", { d: "M7.998 15.035c-4.562 0-7.873-2.914-7.998-3.749V9.338c.085-.628.677-1.686 1.588-2.065.013-.07.024-.143.036-.218.029-.183.06-.384.126-.612-.201-.508-.254-1.084-.254-1.656 0-.87.128-1.769.693-2.484.579-.733 1.494-1.124 2.724-1.261 1.206-.134 2.262.034 2.944.765.05.053.096.108.139.165.044-.057.094-.112.143-.165.682-.731 1.738-.899 2.944-.765 1.23.137 2.145.528 2.724 1.261.566.715.693 1.614.693 2.484 0 .572-.053 1.148-.254 1.656.066.228.098.429.126.612.924.385 1.522 1.471 1.591 2.095v1.872c0 .766-3.351 3.795-8.002 3.795Zm0-1.485c2.28 0 4.584-1.11 5.002-1.433V7.862l-.023-.116c-.49.21-1.075.291-1.727.291-1.146 0-2.059-.327-2.71-.991A3.222 3.222 0 0 1 8 6.303a3.24 3.24 0 0 1-.544.743c-.65.664-1.563.991-2.71.991-.652 0-1.236-.081-1.727-.291l-.023.116v4.255c.419.323 2.722 1.433 5.002 1.433ZM6.762 2.83c-.193-.206-.637-.413-1.682-.297-1.019.113-1.479.404-1.713.7-.247.312-.369.789-.369 1.554 0 .793.129 1.171.308 1.371.162.181.519.379 1.442.379.853 0 1.339-.235 1.638-.54.315-.322.527-.827.617-1.553.117-.935-.037-1.395-.241-1.614Zm4.155-.297c-1.044-.116-1.488.091-1.681.297-.204.219-.358.679-.242 1.614.091.726.303 1.231.618 1.553.299.305.784.54 1.638.54.922 0 1.28-.198 1.442-.379.179-.2.308-.578.308-1.371 0-.765-.123-1.242-.37-1.554-.233-.296-.693-.587-1.713-.7Z" }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("path", { d: "M6.25 9.037a.75.75 0 0 1 .75.75v1.501a.75.75 0 0 1-1.5 0V9.787a.75.75 0 0 1 .75-.75Zm4.25.75v1.501a.75.75 0 0 1-1.5 0V9.787a.75.75 0 0 1 1.5 0Z" })
      ]
    }
  );
}
function apply(ctx) {
  ctx.locale.register("copilot-auth", DICTS);
  const t = ctx.locale.bind("copilot-auth");
  if (typeof document !== "undefined" && !document.getElementById("copilot-badge-style")) {
    const style = document.createElement("style");
    style.id = "copilot-badge-style";
    style.textContent = `
.copilot-badge{
  display:inline-flex;align-items:center;gap:6px;box-sizing:border-box;
  max-width:240px;padding:1px 8px;border:none;border-radius:24px;
  background:transparent;color:var(--dsw-alias-label-tertiary);
  font:inherit;font-variant-numeric:tabular-nums;white-space:nowrap;
  cursor:pointer;font-family:inherit;flex:0 1 auto;position:relative;user-select:none;
  /* \u4E0E ui-chat StatsPills .root \u540C\u6B3E\u5B57\u53F7\uFF08secondary - 1px\uFF09\uFF0C\u4FDD\u8BC1\u8DDF\u65C1\u8FB9
     \u8F6E\u6B21/\u7528\u91CF/\u547D\u4E2D\u7387\u4E09\u4E2A pill \u89C6\u89C9\u4E00\u81F4 */
  font-size:calc(var(--dsh-content-font-size-secondary,13px) - 1px);
  line-height:calc(20px + var(--dsh-content-font-delta-secondary,0px));
}
.copilot-badge:hover{
  background:var(--dsw-alias-interactive-bg-hover);
  color:var(--dsw-alias-label-secondary);
}
.copilot-badge svg{
  width:14px;height:14px;flex:none;
  /* octicons copilot-16 path \u89C6\u89C9\u91CD\u5FC3\u504F\u4E0A\uFF08DSH \u6807\u51C6\u56FE\u6807\u5728 path \u5C42\u9762
     \u505A\u4E86\u5149\u5B66\u504F\u79FB\uFF0C\u53C2\u8003 IconGaugeOutline16 \u6CE8\u91CA\u300C0.75 drop optically
     centers the drawn extent in the 16 box\u300D\uFF09\uFF0C\u7528 transform \u8865\u507F
     \u8BA9 logo \u8DDF\u5176\u4ED6 pill svg \u89C6\u89C9\u5BF9\u9F50\uFF0C\u4E0D\u7834\u574F path \u6570\u636E */
  transform:translateY(1px);
}
/* \u54CD\u5E94\u5F0F\u6536\u7F29\uFF1A\u8DDF StatsPills .label \u4E00\u81F4\uFF08min-width:0; overflow:hidden;
   text-overflow:ellipsis\uFF09\uFF0C\u5F53\u7A97\u53E3\u5C0F flex \u5BB9\u5668\u6536\u7F29\u65F6\u6587\u5B57\u88AB\u88C1\u6389\u53EA\u7559
   logo\uFF0C\u8DDF\u65C1\u8FB9 StatsPills pill \u884C\u4E3A\u4E00\u81F4\u3002flex:0 1 auto \u8BA9 label \u53EF\u6536\u7F29
   \u800C svg\uFF08flex:none\uFF09\u4FDD\u6301\u539F\u5C3A\u5BF8\u3002 */
.copilot-badge-label{
  min-width:0;overflow:hidden;text-overflow:ellipsis;
  flex:0 1 auto;white-space:nowrap;
}
`;
    document.head.appendChild(style);
  }
  ctx.slots.inject("settings.section", () => ctx.slots.register(
    { name: "settings.section", id: "copilot", order: 11, label: () => t("nav"), inject: () => ({ t }) },
    CopilotSection
  ));
  ctx.slots.inject("settings.section.icon", () => ctx.slots.register(
    { name: "settings.section.icon", id: "copilot", order: 11, label: () => t("nav") },
    SettingsCopilotIcon
  ));
  ctx.inject(["sessions"], (scope) => {
    const sessions = scope.sessions;
    scope.slots.inject("conversation.composer.dock", () => scope.slots.register(
      { name: "conversation.composer.dock", id: "copilot-badge", order: 50, inject: (sessionId) => ({ t, sessionId, sessions }) },
      CopilotBadge
    ));
  });
}

		return module.exports;
	}
});
