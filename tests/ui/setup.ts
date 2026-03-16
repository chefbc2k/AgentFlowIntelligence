import "@testing-library/jest-dom/vitest";
import { vi } from "vitest";

const mockFetch = vi.fn(() =>
  Promise.resolve({
    json: () => Promise.resolve([]),
  }),
);

// @ts-expect-error - test-only global override
global.fetch = mockFetch;
