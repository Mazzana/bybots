import { randomUUID } from "node:crypto";
import { lstat, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { z } from "zod";
import type { RelayActivity } from "./bot-relay";

const rowSchema = z.object({ id: z.string().regex(/^[a-f0-9]{32}$/), source: z.string().max(64), target: z.string().max(64), profile: z.string().max(128), at: z.number().finite(), status: z.enum(["delivering", "replied", "failed", "reply-pending", "uncertain"]) }).strict();
const schema = z.object({ version: z.literal(1), records: z.array(rowSchema).max(4096) }).strict();
export interface RelayJournalStore { load(): Promise<RelayActivity[]>; save(records: RelayActivity[]): Promise<void> }

/** Routing metadata only: never persist prompts, replies, tokens or raw errors. */
export class FileRelayJournal implements RelayJournalStore {
  constructor(private readonly path: string) {}
  async load() {
    try {
      const stat = await lstat(this.path);
      if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 4_000_000) throw new Error("Invalid relay journal");
      return schema.parse(JSON.parse(await readFile(this.path, "utf8"))).records;
    } catch (cause) {
      if ((cause as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw cause;
    }
  }
  async save(records: RelayActivity[]) {
    const value = schema.parse({ version: 1, records });
    await mkdir(dirname(this.path), { recursive: true, mode: 0o700 });
    const temporary = `${this.path}.${randomUUID()}.tmp`;
    try {
      await writeFile(temporary, JSON.stringify(value), { flag: "wx", mode: 0o600 });
      await rename(temporary, this.path);
    } finally { await rm(temporary, { force: true }); }
  }
}
