import { azureDevops } from "./azure-devops"
import { github } from "./github"
import { gitlab } from "./gitlab"
import { jira } from "./jira"
import type { Provider } from "./provider"

/** Every tracker the plugin can sync from, in the order shown when adding a source. */
export const PROVIDERS: Provider[] = [jira, azureDevops, gitlab, github]

export const providerMap = new Map(PROVIDERS.map((provider) => [provider.id, provider]))
