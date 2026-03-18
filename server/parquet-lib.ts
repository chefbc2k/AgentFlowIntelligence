import { createRequire } from "node:module";

type ParquetCursor = {
  next: () => Promise<Record<string, unknown> | null>;
};

type OpenParquetReader = {
  getCursor: () => ParquetCursor;
  close: () => Promise<void>;
};

type OpenParquetWriter = {
  appendRow: (row: Record<string, unknown>) => Promise<void>;
  close: () => Promise<void>;
};

type ParquetModule = {
  ParquetReader: {
    openFile: (filePath: string) => Promise<OpenParquetReader>;
  };
  ParquetWriter: {
    openFile: (schema: unknown, filePath: string) => Promise<OpenParquetWriter>;
  };
  ParquetSchema: new (schemaDefinition: Record<string, unknown>) => unknown;
};

const require = createRequire(import.meta.url);
const parquetModule = require("../vendor/parquetjs-lite/parquet");
const { ParquetReader, ParquetWriter, ParquetSchema } = parquetModule as ParquetModule;

export { ParquetReader, ParquetWriter, ParquetSchema };
