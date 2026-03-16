import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import React from "react";
import { App } from "../../src/app";

describe("AFI UI", () => {
  it("renders the header", () => {
    render(<App />);
    expect(screen.getByText(/Agent Flow Intelligence/i)).toBeInTheDocument();
  });
});
