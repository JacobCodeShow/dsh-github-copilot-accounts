// Adapter-owned transport metadata. Never serialized as model input or accepted
// from browser RPC. A managed logical route delegates to a fixed account route
// without changing the outer immutable DSH request/session identity.
export const ACCOUNT_REQUEST_CONTEXT = Symbol.for("copilot-auth.account-request-context.v1");

const validEpoch = (value) => typeof value === "string" && value !== ""
  || Number.isSafeInteger(value) && value >= 0;
const valid = (context) => context !== null && typeof context === "object"
  && typeof context.logicalProvider === "string" && context.logicalProvider !== ""
  && validEpoch(context.defaultEpoch);

// Read a detached validated view. Bound routes normally carry no managed scope.
export function accountRequestContext(options) {
  const context = options?.[ACCOUNT_REQUEST_CONTEXT];
  return valid(context) ? Object.freeze({ logicalProvider: context.logicalProvider, defaultEpoch: context.defaultEpoch }) : undefined;
}

// Enumerable symbol metadata survives adapter-owned option spreads, but is not
// JSON/model input. Never mutate the caller's frozen public GenerateOptions.
export function withAccountRequestContext(options, context) {
  if (!valid(context)) throw new TypeError("Invalid managed account request context");
  return { ...options, [ACCOUNT_REQUEST_CONTEXT]: Object.freeze({ logicalProvider: context.logicalProvider, defaultEpoch: context.defaultEpoch }) };
}
