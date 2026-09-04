import { resolve } from "node:path";
import { isIP } from "node:net";
import type { FastifyInstance } from "fastify";
import { createApp } from "./app";
import { defaultConfigFile, FileHermesConnectionStore, HermesConnectionManager } from "./hermes-connection";
import { FileGatewayRegistry } from "./gateway-registry";
import { MultiGateway } from "./multi-gateway";
import { FileRelayJournal } from "./relay-journal";
import { resolveLocalHermesSessionToken } from "./hermes-local-token";
import packageJson from "../package.json";

export interface BridgeRuntimeOptions {
  host?: string;
  port?: number;
  hermesUrl?: string;
  hermesSessionToken?: string;
  accessTokens?: { admin?: string; operator?: string; viewer?: string };
  trustedHostnames?: string[];
  staticDir?: string;
  configFile?: string;
}

export interface BridgeRuntime {
  app: FastifyInstance;
  url: string;
  close(): Promise<void>;
}

function isLoopbackHost(host: string) {
  const normalized = host.toLowerCase().replace(/^\[|\]$/g, "");
  return normalized === "localhost"
    || normalized === "::1"
    || (isIP(normalized) === 4 && Number(normalized.split(".")[0]) === 127);
}

export async function startBridge(options: BridgeRuntimeOptions = {}): Promise<BridgeRuntime> {
  const host = options.host ?? process.env.BYFINITY_HOST ?? "127.0.0.1";
  const rawPort = options.port ?? Number.parseInt(process.env.BYFINITY_PORT ?? "4179", 10);
  const port = Number.isInteger(rawPort) && rawPort >= 0 && rawPort <= 65_535 ? rawPort : 4179;
  const hermesUrl = options.hermesUrl ?? process.env.HERMES_URL ?? "http://127.0.0.1:9120";
  const configuredHermesSessionToken = options.hermesSessionToken ?? process.env.HERMES_DASHBOARD_SESSION_TOKEN ?? "";
  const hermesSessionToken = await resolveLocalHermesSessionToken(hermesUrl, configuredHermesSessionToken);
  const remoteToken = process.env.BYFINITY_REMOTE_TOKEN;
  const accessTokens = options.accessTokens ?? {
    admin: process.env.BYFINITY_ADMIN_TOKEN || remoteToken,
    operator: process.env.BYFINITY_OPERATOR_TOKEN,
    viewer: process.env.BYFINITY_VIEWER_TOKEN
  };
  const trustedHostnames = options.trustedHostnames ?? [
    "localhost",
    "127.0.0.1",
    "::1",
    ...(process.env.BYFINITY_TRUSTED_HOSTNAMES ?? "").split(",").map((value) => value.trim()).filter(Boolean)
  ];

  if (!isLoopbackHost(host) && !Object.values(accessTokens).some(Boolean)) {
    throw new Error("At least one BYFINITY_*_TOKEN is required when the Bridge is exposed beyond loopback");
  }

  const connectionManager = new HermesConnectionManager({
    defaultConnection: { baseUrl: hermesUrl, token: hermesSessionToken },
    store: new FileHermesConnectionStore(options.configFile),
    resolveLocalToken: resolveLocalHermesSessionToken
  });
  await connectionManager.initialize();

  const configPath = options.configFile ?? defaultConfigFile();
  const gateways = new MultiGateway(connectionManager, new FileGatewayRegistry(`${configPath}.gateways.json`), configPath, undefined, new FileRelayJournal(`${configPath}.relay.json`));
  try { await gateways.initialize(); } catch (cause) { gateways.close(); throw cause; }
  const bridge = createApp({
    hermes: gateways.hermes,
    chat: gateways.chat,
    groups: gateways.groups,
    connection: gateways,
    gateways,
    accessTokens,
    trustedLocalHostnames: trustedHostnames,
    bridgeVersion: packageJson.version,
    staticDir: options.staticDir ?? resolve(process.cwd(), "dist")
  });
  bridge.addHook("onClose", async () => gateways.close());

  try {
    await bridge.listen({ host, port });
  } catch (cause) {
    gateways.close();
    throw cause;
  }

  const address = bridge.server.address();
  const actualPort = typeof address === "object" && address ? address.port : port;
  const publicHost = host === "0.0.0.0" || host === "::" ? "127.0.0.1" : host;
  return {
    app: bridge,
    url: `http://${publicHost.includes(":") ? `[${publicHost}]` : publicHost}:${actualPort}`,
    close: () => bridge.close()
  };
}
