import { describe, expect, it } from "vitest";
import { getConfig } from "../server/config";

const ENV_KEYS = [
  "PORT",
  "AFI_DB_PATH",
  "AFI_DATA_DIR",
  "AFI_BASE_RPC_URL",
  "AFI_ETHERSCAN_API_KEY",
  "AFI_LOCUS_API_KEY",
  "AFI_LOCUS_BASE_URL",
  "AFI_LOCUS_AGENT_ID",
  "AFI_EAS_BASE_URL",
  "AFI_EAS_SEPOLIA_URL",
] as const;

function withEnv(next: Partial<Record<(typeof ENV_KEYS)[number], string>>, fn: () => void) {
  const prior = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]])) as Record<string, string | undefined>;
  for (const key of ENV_KEYS) delete process.env[key];
  for (const [key, value] of Object.entries(next)) {
    process.env[key] = value;
  }
  try {
    fn();
  } finally {
    for (const key of ENV_KEYS) {
      const value = prior[key];
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

describe("config", () => {
  it("applies defaults when env is missing", () => {
    withEnv({}, () => {
      const config = getConfig();
      expect(config.port).toBe("8787");
      expect(config.dbPath).toBe("./data/afi.db");
      expect(config.dataDir).toBe("./data");
      expect(config.locusBaseUrl).toBe("https://beta-api.paywithlocus.com");
      expect(config.easBaseUrl).toBe("https://base.easscan.org/graphql");
    });
  });

  it("reads overrides from env", () => {
    withEnv(
      {
        PORT: "9999",
        AFI_DB_PATH: ":memory:",
        AFI_DATA_DIR: "/tmp/afi-data",
        AFI_LOCUS_API_KEY: "key",
      },
      () => {
        const config = getConfig();
        expect(config.port).toBe("9999");
        expect(config.dbPath).toBe(":memory:");
        expect(config.dataDir).toBe("/tmp/afi-data");
        expect(config.locusApiKey).toBe("key");
      },
    );
  });
});

