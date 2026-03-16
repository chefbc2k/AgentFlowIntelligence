import { describe, expect, it, vi } from "vitest";

describe("main entry", () => {
  it("mounts the app into #root", async () => {
    vi.resetModules();
    document.body.innerHTML = '<div id="root"></div>';

    const renderSpy = vi.fn();
    const createRootSpy = vi.fn(() => ({ render: renderSpy }));

    vi.doMock("react-dom/client", () => ({ createRoot: createRootSpy }));
    vi.doMock("../../src/app", () => ({ App: () => null }));
    vi.doMock("../../src/styles.css", () => ({}));

    await import("../../src/main");

    expect(createRootSpy).toHaveBeenCalledWith(document.getElementById("root"));
    expect(renderSpy).toHaveBeenCalledTimes(1);
  });
});

