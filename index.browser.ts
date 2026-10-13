import type { BrokerAdapter } from "gloomberb/types/broker";
import type { GloomPlugin } from "gloomberb/types/plugin";
import { faraoAdapterCore, faraoPluginMeta } from "./core";

/**
 * The desktop view's copy. OAuth needs a localhost server, so Gloomberb
 * forwards every operation to the Bun process; these bodies are a guard rail.
 */
function backendOnly(): never {
  throw new Error("Farao sync runs in the Gloomberb backend.");
}

export const faraoBroker: BrokerAdapter = {
  ...faraoAdapterCore,
  importPositions: backendOnly,
  importPortfolioSnapshot: backendOnly,
  listAccounts: backendOnly,
  connect: backendOnly,
  disconnect: backendOnly,
  getPersistedConfigUpdate: backendOnly,
};

export const faraoPlugin: GloomPlugin = {
  ...faraoPluginMeta,
  broker: faraoBroker,
};

export default faraoPlugin;
