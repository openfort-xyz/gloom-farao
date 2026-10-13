import type { BrokerAdapter } from "gloomberb/types/broker";
import type { BrokerInstanceConfig } from "gloomberb/types/config";
import type { GloomPlugin } from "gloomberb/types/plugin";
import { faraoAdapterCore, faraoPluginMeta, setStatus } from "./core";

// Deferred so the OAuth server, the MCP client and their `node:*` imports load only on sync.
const native = () => import("./native");

const loadSnapshot = async (instance: BrokerInstanceConfig) => (await native()).loadFaraoPortfolio(instance);

export const faraoBroker: BrokerAdapter = {
  ...faraoAdapterCore,

  async importPositions(instance) {
    return (await loadSnapshot(instance)).positions;
  },

  async importPortfolioSnapshot(instance) {
    return loadSnapshot(instance);
  },

  async listAccounts(instance) {
    return (await loadSnapshot(instance)).accounts;
  },

  async connect(instance) {
    await loadSnapshot(instance);
  },

  async disconnect(instance) {
    (await native()).forgetPendingOAuth(instance.id);
    setStatus(instance.id, "disconnected");
  },

  async getPersistedConfigUpdate(instance) {
    return (await native()).takePersistedConfigUpdate(instance.id);
  },
};

export const faraoPlugin: GloomPlugin = {
  ...faraoPluginMeta,
  broker: faraoBroker,
};

export default faraoPlugin;
