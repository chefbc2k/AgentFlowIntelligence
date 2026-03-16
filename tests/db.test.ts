import { describe, expect, it } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import fs from "node:fs";
import { openDatabase } from "../server/db";

describe("db", () => {
  it("creates schema and the data directory on demand", () => {
    const root = mkdtempSync(join(tmpdir(), "afi-db-"));
    const dataDir = join(root, "data");

    expect(fs.existsSync(dataDir)).toBe(false);
    const db = openDatabase({ dbPath: ":memory:", dataDir });
    expect(fs.existsSync(dataDir)).toBe(true);

    const table = db
      .prepare("select name from sqlite_master where type = 'table' and name = 'interactions'")
      .get() as { name: string } | undefined;
    expect(table?.name).toBe("interactions");

    // Second open covers the "dir exists" branch.
    const db2 = openDatabase({ dbPath: ":memory:", dataDir });
    const table2 = db2
      .prepare("select name from sqlite_master where type = 'table' and name = 'settlements'")
      .get() as { name: string } | undefined;
    expect(table2?.name).toBe("settlements");
  });

  it("rolls back failed transactions and rethrows", () => {
    const root = mkdtempSync(join(tmpdir(), "afi-db-tx-"));
    const dataDir = join(root, "data");
    const db = openDatabase({ dbPath: ":memory:", dataDir });

    const insert = db.prepare(
      `insert into interactions (id, created_at, agent_id, wallet_address, counterparty, protocol, summary)
       values (@id, @created_at, @agent_id, @wallet_address, @counterparty, @protocol, @summary)`,
    );
    const count = db.prepare("select count(*) as c from interactions");

    const tx = db.transaction(() => {
      insert.run({
        id: "i1",
        created_at: "2024-01-01T00:00:00Z",
        agent_id: null,
        wallet_address: null,
        counterparty: null,
        protocol: "x402",
        summary: JSON.stringify({}),
      });
      throw new Error("boom");
    });

    expect(() => tx()).toThrow("boom");
    expect((count.get() as { c: number }).c).toBe(0);
  });
});
