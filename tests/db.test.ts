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
});

