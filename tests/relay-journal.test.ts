import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { FileRelayJournal } from "../server/relay-journal";

it("persists bounded metadata and rejects fields that could contain message content", async () => {
  const dir = await mkdtemp(join(tmpdir(), "bybots-relay-journal-"));
  const path = join(dir, "relay.json");
  try {
    const journal = new FileRelayJournal(path);
    expect(await journal.load()).toEqual([]);
    const record = { id: "a".repeat(32), source: "primary", target: "remote", profile: "writer", at: Date.now(), status: "delivering" as const };
    await journal.save([record]);
    expect(await new FileRelayJournal(path).load()).toEqual([record]);
    await expect(journal.save([{ ...record, message: "private" } as typeof record])).rejects.toThrow();
    expect(await readFile(path, "utf8")).not.toContain("private");
    expect(await journal.load()).toEqual([record]);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
