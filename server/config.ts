import "dotenv/config";
import { z } from "zod";

const configSchema = z.object({
  port: z.string().default("8787"),
  dbPath: z.string().default("./data/afi.db"),
  dataDir: z.string().default("./data"),
  baseRpcUrl: z.string().optional(),
  etherscanApiKey: z.string().optional(),
  locusApiKey: z.string().optional(),
  locusBaseUrl: z.string().default("https://beta-api.paywithlocus.com"),
  locusAgentId: z.string().optional(),
  easBaseUrl: z.string().default("https://base.easscan.org/graphql"),
  easSepoliaUrl: z.string().default("https://base-sepolia.easscan.org/graphql"),
  // Priority 5 APIs (MVP essentials)
  blockscoutApiKey: z.string().optional(),
  coingeckoApiKey: z.string().optional(),
  duneApiKey: z.string().optional(),
  // Priority 4 APIs (MVP enrichment)
  graphApiKey: z.string().optional(),
  // Background jobs
  enableBackgroundJobs: z.boolean().default(true),
});

export type AppConfig = z.infer<typeof configSchema>;

export function getConfig(): AppConfig {
  return configSchema.parse({
    port: process.env.PORT,
    dbPath: process.env.AFI_DB_PATH,
    dataDir: process.env.AFI_DATA_DIR,
    baseRpcUrl: process.env.AFI_BASE_RPC_URL,
    etherscanApiKey: process.env.AFI_ETHERSCAN_API_KEY,
    locusApiKey: process.env.AFI_LOCUS_API_KEY,
    locusBaseUrl: process.env.AFI_LOCUS_BASE_URL,
    locusAgentId: process.env.AFI_LOCUS_AGENT_ID,
    easBaseUrl: process.env.AFI_EAS_BASE_URL,
    easSepoliaUrl: process.env.AFI_EAS_SEPOLIA_URL,
    blockscoutApiKey: process.env.AFI_BLOCKSCOUT_API_KEY,
    coingeckoApiKey: process.env.AFI_COINGECKO_API_KEY,
    duneApiKey: process.env.AFI_DUNE_API_KEY,
    graphApiKey: process.env.AFI_GRAPH_API_KEY,
    enableBackgroundJobs: process.env.AFI_ENABLE_BACKGROUND_JOBS === "false" ? false : true,
  });
}
