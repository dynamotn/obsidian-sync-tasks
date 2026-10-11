import type { Provider } from "./provider"

/** Every tracker the plugin can sync from, in the order shown when adding a source. */
export const PROVIDERS: Provider[] = []

export const providerMap = new Map(PROVIDERS.map((provider) => [provider.id, provider]))
