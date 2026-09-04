import { startBridge } from "./runtime";

const runtime = await startBridge();
console.log(`Byfinity Bridge listening on ${runtime.url}`);
