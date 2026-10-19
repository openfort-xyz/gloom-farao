import { randomBytes } from "node:crypto";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import {
  type OAuthClientProvider,
  type OAuthDiscoveryState,
  UnauthorizedError,
} from "@modelcontextprotocol/sdk/client/auth.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { OAuthClientInformationMixed, OAuthTokens } from "@modelcontextprotocol/sdk/shared/auth.js";
import type { BrokerInstanceConfig } from "gloomberb/types/config";
import { setConnected, setStatus } from "./core";
import {
  type BrokerPortfolioSnapshot,
  type OrusAccountStatus,
  type OrusPortfolio,
  type OrusPosition,
  toSnapshot,
} from "./normalize";

const ORUS_MCP_URL = process.env.FARAO_ORUS_MCP_URL ?? "https://orus.getfarao.com/mcp";
/** Orus advertises its trading scopes too; the consent screen asks only for these. */
export const READ_SCOPES = "account:read portfolio:read positions:read";
export const READ_TOOLS = ["get_account_status", "get_portfolio", "get_positions"] as const;
const SIGN_IN_TIMEOUT_MS = 5 * 60_000;

interface FaraoOAuthData {
  clientInformation?: OAuthClientInformationMixed;
  tokens?: OAuthTokens;
  codeVerifier?: string;
  discoveryState?: OAuthDiscoveryState;
}

/** OAuth state from the last sync, held until Gloomberb persists it into the profile. */
const pendingOAuth = new Map<string, FaraoOAuthData>();

export function forgetPendingOAuth(instanceId: string): void {
  pendingOAuth.delete(instanceId);
}

export function takePersistedConfigUpdate(instanceId: string): Record<string, unknown> | null {
  const oauth = pendingOAuth.get(instanceId);
  if (!oauth) return null;
  pendingOAuth.delete(instanceId);
  return { connectionMode: "oauth", oauth };
}

interface ListedTool {
  name: string;
  annotations?: { readOnlyHint?: boolean };
}

/** Refuses the server unless every tool this plugin calls exists and is marked read-only. */
export function requireReadOnlyTools(tools: ListedTool[]): void {
  const byName = new Map(tools.map((tool) => [tool.name, tool]));
  for (const name of READ_TOOLS) {
    if (byName.get(name)?.annotations?.readOnlyHint !== true) {
      throw new Error(`Orus did not expose the read-only ${name} tool.`);
    }
  }
}

/** Command that opens an http(s) URL in the browser. Windows skips cmd.exe, which would split the URL at `&` or `|`. */
export function browserCommand(url: URL, platform: NodeJS.Platform = process.platform): string[] {
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error(`Gloomberb will not open a ${url.protocol} sign-in link.`);
  }
  const href = url.toString();
  if (platform === "darwin") return ["open", href];
  if (platform === "win32") return ["rundll32", "url.dll,FileProtocolHandler", href];
  return ["xdg-open", href];
}

function openExternal(url: URL): Promise<number> {
  return Bun.spawn(browserCommand(url), { stdout: "ignore", stderr: "ignore" }).exited;
}

class FaraoOAuthProvider implements OAuthClientProvider {
  constructor(
    readonly redirectUrl: string,
    private readonly oauth: FaraoOAuthData,
    private readonly oauthState: string,
  ) {}

  get clientMetadata() {
    return {
      client_name: "Gloomberb Farao Position Sync",
      redirect_uris: [this.redirectUrl],
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "client_secret_post",
      scope: READ_SCOPES,
    };
  }

  state() { return this.oauthState; }

  /** The callback port changes every sync, so a client registered for another port is re-registered. */
  clientInformation() {
    const client = this.oauth.clientInformation;
    if (client && "redirect_uris" in client && !client.redirect_uris.includes(this.redirectUrl)) return undefined;
    return client;
  }

  saveClientInformation(value: OAuthClientInformationMixed) { this.oauth.clientInformation = value; }
  tokens() { return this.oauth.tokens; }
  saveTokens(value: OAuthTokens) { this.oauth.tokens = value; }

  async redirectToAuthorization(url: URL) {
    url.searchParams.set("scope", READ_SCOPES);
    const exitCode = await openExternal(url);
    if (exitCode !== 0) throw new Error(`Gloomberb could not open the browser. Open this page to sign in: ${url}`);
  }

  saveCodeVerifier(value: string) { this.oauth.codeVerifier = value; }
  codeVerifier() {
    if (!this.oauth.codeVerifier) throw new Error("The Orus OAuth verifier is missing.");
    return this.oauth.codeVerifier;
  }
  saveDiscoveryState(value: OAuthDiscoveryState) { this.oauth.discoveryState = value; }
  discoveryState() { return this.oauth.discoveryState; }

  invalidateCredentials(scope: "all" | "client" | "tokens" | "verifier" | "discovery") {
    if (scope === "all" || scope === "client") delete this.oauth.clientInformation;
    if (scope === "all" || scope === "tokens") delete this.oauth.tokens;
    if (scope === "all" || scope === "verifier") delete this.oauth.codeVerifier;
    if (scope === "all" || scope === "discovery") delete this.oauth.discoveryState;
  }
}

interface OAuthCallback {
  redirectUrl: string;
  code: Promise<string>;
  close(): void;
}

function callbackPage(status: number, body: string) {
  return new Response(body, { status, headers: { "Content-Type": "text/plain; charset=utf-8" } });
}

/** A one-shot loopback server that resolves with the authorization code Orus redirects back with. */
function startOAuthCallback(expectedState: string): OAuthCallback {
  const { promise: code, resolve, reject } = Promise.withResolvers<string>();
  code.catch(() => {});
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch(request) {
      const url = new URL(request.url);
      if (url.pathname !== "/callback") return callbackPage(404, "Not found.");
      const error = url.searchParams.get("error");
      if (error) {
        reject(new Error(`Farao sign-in failed: ${error}.`));
        return callbackPage(400, "Farao sign-in failed. Return to Gloomberb.");
      }
      const authorizationCode = url.searchParams.get("code");
      if (!authorizationCode || url.searchParams.get("state") !== expectedState) {
        reject(new Error("Gloomberb could not verify the Farao sign-in response."));
        return callbackPage(400, "Gloomberb could not verify this Farao sign-in.");
      }
      resolve(authorizationCode);
      return callbackPage(200, "Farao is connected. You can close this page and return to Gloomberb.");
    },
  });
  const timeout = setTimeout(() => reject(new Error("Farao sign-in timed out after 5 minutes.")), SIGN_IN_TIMEOUT_MS);
  return {
    redirectUrl: `http://127.0.0.1:${server.port}/callback`,
    code,
    close() {
      clearTimeout(timeout);
      server.stop(true);
    },
  };
}

async function connect(provider: FaraoOAuthProvider, callback: OAuthCallback): Promise<Client> {
  const transport = new StreamableHTTPClientTransport(new URL(ORUS_MCP_URL), { authProvider: provider });
  const client = new Client({ name: "gloom-farao", version: "0.1.0" });
  try {
    await client.connect(transport);
    return client;
  } catch (error) {
    await client.close().catch(() => {});
    if (!(error instanceof UnauthorizedError)) throw error;
    await transport.finishAuth(await callback.code);
  }
  const authorized = new Client({ name: "gloom-farao", version: "0.1.0" });
  await authorized.connect(new StreamableHTTPClientTransport(new URL(ORUS_MCP_URL), { authProvider: provider }));
  return authorized;
}

async function callTool<T>(client: Client, name: (typeof READ_TOOLS)[number]): Promise<T> {
  const result = await client.callTool({ name, arguments: {} });
  if (result.isError) {
    const text = (result.content as Array<{ type: string; text?: string }>)
      .flatMap((block) => (block.type === "text" && block.text ? [block.text] : []))
      .join("\n");
    throw new Error(`Orus ${name} failed: ${text || "no message"}`);
  }
  if (!result.structuredContent) throw new Error(`Orus ${name} returned no structured content.`);
  return result.structuredContent as T;
}

export async function loadFaraoPortfolio(instance: BrokerInstanceConfig): Promise<BrokerPortfolioSnapshot> {
  setStatus(instance.id, "connecting", "Waiting for Farao");
  const stored = pendingOAuth.get(instance.id) ?? instance.config.oauth;
  const oauth: FaraoOAuthData = stored && typeof stored === "object" ? structuredClone(stored) : {};
  const oauthState = randomBytes(24).toString("hex");
  const callback = startOAuthCallback(oauthState);
  let client: Client | null = null;
  try {
    client = await connect(new FaraoOAuthProvider(callback.redirectUrl, oauth, oauthState), callback);
    pendingOAuth.set(instance.id, oauth);
    requireReadOnlyTools((await client.listTools()).tools);
    const [status, portfolio, positions] = await Promise.all([
      callTool<OrusAccountStatus>(client, "get_account_status"),
      callTool<OrusPortfolio>(client, "get_portfolio"),
      callTool<{ positions: OrusPosition[] }>(client, "get_positions"),
    ]);
    const snapshot = toSnapshot(status, portfolio, positions.positions);
    setConnected(instance.id);
    return snapshot;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    setStatus(instance.id, "error", message);
    throw new Error(`Gloomberb could not sync Farao. ${message}`);
  } finally {
    await client?.close().catch(() => {});
    callback.close();
  }
}
