# Native Harness account-route inheritance verification (DSH 0.2.2-rc.1)

## Scope and safety

This verification targets ordinary native Harness Sessions/Agents only. External ACP/Codex sessions and non-native delegation backends are explicitly unsupported by this policy.

All verification uses **new synthetic Sessions**, fresh private Cordis contexts, fake adapters/protocol output, and fake account-route IDs. No application is started, no real model/HTTP request is made, no account credentials are read, and no existing user Session/header is accessed or modified. Native tests trap `fetch` and assert zero attempts.

The optional installed-code test is `test/session-inheritance-native.test.mjs`. It imports the extracted installation fixture under `../dsh-session-account-review/installed/dsh/node_modules`; CI without this fixture skips those tests. `test/subagent-account-policy.test.mjs` is pure dependency-injected coverage and needs no installed DSH fixture.

In examples below, **A/B/C are distinct public account provider routes**, not credentials.

## Tested behavior

### Session persistence / restore

Released `model/selection` and `request/header.config.provider` records carry the public account route as an ordinary provider ID. The real exported `AgentModel`/`modelSelectionProjectionDefinition` choose pending selection first, then last-used request route, then creation/default options.

The test uses the real current Session v4 codec to encode synthetic physical JSONL rows into a unique workspace fixture directory. The **real JSONL backend opens and reads the file**, and `Session.fromRestore` plus real `AgentModel` reconstruct the saved routes. A second fresh backend instance reopens the same fixture and obtains the same result. A pending B remains the next selection while the historical last request is A, even when supplied creation/default options now name C. The original Session header and the physical file's first header line remain unchanged.

**Important limitation:** fixture bytes are written with plain Node fs using native codec output. The test does **not** exercise the backend's native writer/append/fsync/Windows locking path, process-crash durability, or a full Agent-loop/process restart. It proves actual codec + backend read + Session restore + selection semantics, not writer E2E.

Fixture storage is pinned to this checkout's `.test-artifacts/session-inheritance-native-*` directory. Physical paths are checked outside OneDrive. Cleanup checks realpath, direct-parent relationship, prefix, directory type and no symlink before deleting only the generated private directory. No ambient `DSH_HOME` or user's Sessions root is used.

### Ordinary UI / native SessionStore fork

Real `SessionStore.fork` copies exactly the requested inclusive prefix. A cut through completed turn A retains A. A later cut which includes pending selection B retains B, even if its last historical request header was A. Parent selection changes after the cut do not rebind either child.

These ordinary prefix forks are intentionally left native. The account policy does not reinterpret their prefix or force the current global/default account onto them.

### Native spawn child

The real exported `resolveChildAgentOptions` inherits the parent's **last committed request header**, not a later pending selection. Before any request header exists, it uses parent creation options (again not a pending-only selection). Explicit child route overrides win and clear inherited route-specific reasoning effort when appropriate.

A native spawn provider returns no history seed. A fresh spawn child's real `AgentModel` therefore uses its captured inherited options B, without the seeded-history ambiguity below. Later parent pending selection C does not mutate those captured child options.

### Native tool-fork ambiguity — actually reproduced

The real in-process fork provider seeds only through the last completed `turn/end`, excluding the active tool-call turn.

Reproduced trace:

1. Completed turn 1 used A.
2. A B selection was recorded **after** that completed turn.
3. Current turn 2 request header uses B; parent later has pending C.
4. Native child option inheritance correctly captures B from the current header.
5. Fork seed cuts at turn 1 and excludes B's selection/header.
6. Real child `AgentModel` prefers recorded seed A over constructor fallback options B.

Thus **captured child options alone do not guarantee a fork child uses B**. Treating the last-header inheritance helper as a full end-to-end guarantee would overclaim and could use the wrong account.

### Minimal supported correction

`src/subagent-account-policy.mjs` provides an awaited `agent/created` listener. Real native `AgentRegistry.announce` awaits serial creation listeners; native Agent-loop setup has already written the child's descriptor, and first prompt/step dispatch happens only after materialization/announcement succeeds.

The hook only considers:

- `source === "startup"`, `header.origin === "subagent"`, `header.isSeeded === true`, and native `agent.model.select` support;
- exact **original** `agents`, `sessions`, `llm` and `sessionQuery` services shared with the feature context (Cordis exported `symbols.original` handles tracing proxies);
- exact live Agent/Session identity plus a live runtime parent proven by `agents.isOwnedBy`, not merely a durable lineage string;
- a public live `sessionQuery.observeSession(..., {projectionMode:"none"})` observation;
- the **first child-owned descriptor**, outside inherited events and inside the current lifecycle, of released version 3/continuable mode and the configured native fork provider name;
- descriptor provider/model/effort matching the child's captured options and a feature-owned enabled account route.

If the child already has a released **own current-lifecycle `model/selection` or `request/header`**, correction is skipped: explicit child/setup controls are more specific than constructor fallback. Resume, historical-only descriptors, ordinary UI forks, unbound routes, other service scopes and other backend descriptors are not rebound.

For an inherited-only case, the hook validates the exact captured account/model through public `llm.resolveCallConfig`, rechecks liveness and route ownership, then calls the real `agent.model.select(B)`. This appends a released control record **after the inherited prefix and before first dispatch**. It does not invent a request header, edit parent history, rewrite immutable headers, or replace/patch any core method or provider.

The native test executes this production hook through real `Context`/`AgentRegistry`/`SessionQuery`/`LlmRuntime` APIs and verifies corrected B, untouched parent/prefix/header, and zero protocol calls during correction. A missing captured route causes actual native announcement rejection before startup continuation, rather than allowing inherited A as fallback. A separate native case verifies an explicit own C is preserved.

Default native backend name is `fork`. Custom native fork `providerName` configurations must be supplied as `forkProviderName` by the bootstrap; unrelated/custom external backend names are not automatically classified as supported native forks.

### Existing / cold-resumed child

The released first `subagent/descriptor` is authoritative for continuation reconstruction. The test obtains the actual manager method through an exported `SubagentRuntime` mounted on a fresh private context with inert dependencies, and invokes its unchanged `coldResume` method with synthetic observation/materialization stubs. It captures the actual reconstruction arguments: descriptor A remains fallback A even when the parent now has B. The child's own later recorded choice C still wins in real `AgentModel`.

This is a method-level reconstruction proof, **not** a full resumed child Agent/process/model execution. No source body is reimplemented/evaluated, and no real child is launched. The production hook skips `source:"resume"` and historical descriptors so it never forces old child state to follow the current parent/default account.

### Unavailable routes and auxiliary requests

Real `LlmRuntime.prepareCall` rejects an unregistered saved account route with `NO_ADAPTER`; it does not switch to a registered global `github-copilot` route or another account.

The real session-title LLM helper uses the recorded request route A by default, ignoring pending B. An explicit configured auxiliary provider/model pair C takes priority and is preserved. Tests use an actual LLM service with a fake adapter and static output; no real inference occurs.

This does not prove every auxiliary plugin follows the same contract. Providers with independent explicit route policies must remain independently configured; do not globally rewrite every LLM request to the Session account.

## Installation-source evidence

All locations are workspace-relative to `../dsh-session-account-review/installed/dsh/node_modules/@deepseek-ai/`:

- `dsh-agent/lib/index.js:140-203`: released selection projection and `AgentModel` precedence.
- `dsh-session/lib/index.js:927-935,1380-1430,2025-2038`: fork seed, restore semantics and exact-prefix fork.
- `dsh-subagent/lib/index.js:294-331`: last-header child option inheritance and explicit override behavior.
- `dsh-subagent-fork-in-process/lib/index.js:22-47`: completed-turn prefix and native fork preparation.
- `dsh-agent-loop/lib/index.js:536-545`: actual loop Agent constructs `AgentModel` over seeded projections/options.
- `dsh-subagent/lib/index.js:1397-1469,1802-1829`: descriptor/options/seed creation and setup before submission.
- `dsh-agent/lib/index.js:703-714,736-738`: awaited serial creation hook and exact runtime ownership.
- `dsh-agent-loop/lib/index.js:1565-1580,1668-1693,1765`: setup/announcement ordering and startup vs resume source.
- `dsh-subagent/lib/index.js:676-707,2155-2208`: immutable first descriptor fold and cold-resume reconstruction.
- `dsh-session-persistence-jsonl/lib/index.js:63-111,2488-2540,3621-3648`: native backend read/open and explicit storage root configuration.
- `dsh-session-title-llm/lib/index.js:114-121,160-219`: recorded-route default and explicit auxiliary override.

## Remaining integration / acceptance work

Bootstrap owns mounting/disposal and registry ownership callbacks. Keep the listener awaited; do not fire-and-forget it. Account-specific adapters still independently validate credentials/model/lifecycle at dispatch.

Not covered here: full Agent-loop first-step execution, backend native writer locks/crash recovery, actual token/network behavior, browser/native desktop UI, external ACP/Codex workflows, custom non-default fork compositions without an explicit configured provider name, or future DSH versions.
