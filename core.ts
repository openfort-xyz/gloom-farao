import type { BrokerAdapter, BrokerConnectionStatus } from "gloomberb/types/broker";
import type { BrokerInstanceConfig } from "gloomberb/types/config";

/**
 * What both entries share. The desktop loads the plugin twice: natively in the
 * Bun process, which runs OAuth and the sync, and as a browser bundle in the
 * view, which only renders the profile form and the status.
 */

const CONNECTED_MESSAGE = "Read-only Orus connection";
const statuses = new Map<string, BrokerConnectionStatus>();
const statusListeners = new Map<string, Set<() => void>>();

export function setStatus(instanceId: string, state: BrokerConnectionStatus["state"], message?: string): void {
  statuses.set(instanceId, { state, message, mode: "oauth", updatedAt: Date.now() });
  for (const listener of statusListeners.get(instanceId) ?? []) listener();
}

export function setConnected(instanceId: string): void {
  setStatus(instanceId, "connected", CONNECTED_MESSAGE);
}

export const faraoAdapterCore = {
  id: "farao",
  name: "Farao",
  configSchema: [{
    key: "connectionMode",
    label: "Connection",
    type: "select",
    required: true,
    defaultValue: "oauth",
    options: [{
      label: "Farao sign-in (read-only sync)",
      value: "oauth",
      description: "Gloomberb opens Orus in your browser; approve it in the Farao app.",
    }],
  }],

  async validate(instance: BrokerInstanceConfig) {
    return instance.config.connectionMode === "oauth";
  },

  getStatus(instance: BrokerInstanceConfig): BrokerConnectionStatus {
    return statuses.get(instance.id) ?? {
      state: instance.config.oauth ? "connected" : "disconnected",
      message: instance.config.oauth ? CONNECTED_MESSAGE : "Sign in during the first sync",
      mode: "oauth",
      updatedAt: 0,
    };
  },

  subscribeStatus(instance: BrokerInstanceConfig, listener: () => void) {
    const listeners = statusListeners.get(instance.id) ?? new Set<() => void>();
    listeners.add(listener);
    statusListeners.set(instance.id, listeners);
    return () => {
      listeners.delete(listener);
      if (listeners.size === 0) statusListeners.delete(instance.id);
    };
  },

  toConfigValues() {
    return { connectionMode: "oauth" };
  },

  fromConfigValues(_values: Record<string, unknown>, previous?: BrokerInstanceConfig) {
    return {
      connectionMode: "oauth",
      ...(previous?.config.oauth ? { oauth: previous.config.oauth } : {}),
    };
  },
} satisfies Partial<BrokerAdapter> & { id: string; name: string };

export const faraoPluginMeta = {
  id: "farao",
  name: "Farao",
  version: "0.1.0",
  description: "Read-only Farao position sync through the Orus MCP server.",
  toggleable: true,
  hosts: ["orus.getfarao.com"],
} as const;
