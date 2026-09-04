import { checkHermesContract } from "../server/hermes-contract";
import { HermesGateway } from "../server/hermes-gateway";

const healthOnly = process.argv.includes("--health-only");
const baseUrl = process.env.HERMES_URL || "http://127.0.0.1:9119";
const sessionToken = process.env.HERMES_DASHBOARD_SESSION_TOKEN;
const gateway = sessionToken && !healthOnly ? new HermesGateway({ baseUrl, token: sessionToken }) : undefined;

try {
  const report = await checkHermesContract({
    baseUrl,
    healthOnly,
    sessionToken,
    ...(gateway ? { gateway } : {})
  });
  console.log(`Hermes ${report.version} compatibility checks passed:`);
  for (const check of report.checks) console.log(`  PASS ${check.name} - ${check.detail}`);
  if (healthOnly) console.log("  INFO authenticated REST and JSON-RPC checks were not requested");
} catch (error) {
  console.error(`Hermes compatibility check failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
} finally {
  gateway?.close();
}
