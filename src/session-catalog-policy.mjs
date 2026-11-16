// A separate consumer-only LlmService facade over the published 0.2.2 API.
// Never copies private registries, Service trackers, bindings or Context fields.
export const SESSION_LLM_PUBLIC_METHODS = Object.freeze([
  "registerAdapter", "listProviders", "registerConfigurableProviders", "listConfigurableProviders",
  "registerModelDiscovery", "discoverModels", "remoteDiscoverModels", "providerRetryPolicy",
  "imageRequestPricing", "imageRequestTarget", "fileRequestText", "listModels", "resolveModelInfo",
  "resolveCallConfig", "prepareCall", "stream",
]);

export function createSessionLlmCatalogPolicy(backing, { isManagedReady = () => false } = {}) {
  if (typeof isManagedReady !== "function" || SESSION_LLM_PUBLIC_METHODS.some((method) => typeof backing?.[method] !== "function")) {
    throw new TypeError("Unsupported Session LLM catalog interface");
  }
  const facade = {};
  for (const method of SESSION_LLM_PUBLIC_METHODS) facade[method] = (...args) => Reflect.apply(backing[method], backing, args);
  facade.listProviders = (...args) => {
    const providers = Reflect.apply(backing.listProviders, backing, args);
    if (!Array.isArray(providers)) throw new TypeError("Unsupported Session LLM provider catalog");
    return isManagedReady() === true ? providers.filter((provider) => provider.id !== "github-copilot") : providers;
  };
  facade.listModels = (provider, ...args) => provider === "github-copilot" && isManagedReady() === true
    ? Promise.resolve([]) : Reflect.apply(backing.listModels, backing, [provider, ...args]);
  return Object.freeze(facade);
}
