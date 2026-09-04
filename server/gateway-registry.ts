import { randomUUID } from "node:crypto";
import { lstat, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { z } from "zod";

const entry = z.object({ id: z.string().regex(/^gw-[a-f0-9]{12}$/), label: z.string().trim().min(1).max(48), baseUrl: z.string().max(2048), relay: z.boolean() }).strict();
const schema = z.object({ version: z.literal(1), primaryRelay: z.boolean(), relayPaused: z.boolean().optional(), defaultGatewayId: z.string().optional(), gateways: z.array(entry).max(8) }).strict()
  .refine((value) => new Set(value.gateways.map((gateway) => gateway.id)).size === value.gateways.length)
  .refine((value) => !value.defaultGatewayId || value.defaultGatewayId === "primary" || value.gateways.some((gateway) => gateway.id === value.defaultGatewayId));
export type GatewayRegistry = z.infer<typeof schema>;
export interface RegistryStore { load(): Promise<GatewayRegistry>; save(value: GatewayRegistry): Promise<void> }

/** Metadata only. Credentials remain in the existing private, per-gateway session store. */
export class FileGatewayRegistry implements RegistryStore {
  constructor(private readonly path: string) {}
  async load(): Promise<GatewayRegistry> {
    try {
      const stat = await lstat(this.path);
      if (stat.isSymbolicLink() || !stat.isFile() || stat.size > 32_768) throw new Error("Invalid gateway registry file");
      return schema.parse(JSON.parse(await readFile(this.path, "utf8")));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return { version: 1, primaryRelay: false, gateways: [] };
      throw error;
    }
  }
  async save(value: GatewayRegistry) {
    const data = schema.parse(value);
    await mkdir(dirname(this.path), { recursive: true, mode: 0o700 });
    const temporary = `${this.path}.${randomUUID()}.tmp`;
    try {
      await writeFile(temporary, JSON.stringify(data), { flag: "wx", mode: 0o600 });
      await rename(temporary, this.path);
    } finally {
      await rm(temporary, { force: true });
    }
  }
}
