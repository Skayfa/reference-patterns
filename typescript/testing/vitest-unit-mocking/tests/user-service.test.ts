import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { User } from "../src/api-client.js";
import * as apiClient from "../src/api-client.js";
import { greetUser, systemClock } from "../src/user-service.js";

// Module mock: every export of api-client is replaced by a vi.fn().
// vi.mock is hoisted above the imports — a factory, if provided, must not
// capture variables declared in this file.
vi.mock("../src/api-client.js");

// Fixture builder: one valid default object, overridable per test.
const aUser = (overrides: Partial<User> = {}): User => ({
  id: "u1",
  name: "Ada",
  email: "ada@example.com",
  ...overrides,
});

// Hand-rolled mock for the injected dependency — no module machinery needed.
const clockAt = (iso: string) => ({ now: vi.fn(() => new Date(iso)) });

describe("greetUser", () => {
  beforeEach(() => {
    // Reset call history AND implementations so tests cannot leak into each other.
    vi.resetAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("greets the fetched user by name", async () => {
    // vi.mocked() narrows the import to its mocked type — no `as` casts.
    vi.mocked(apiClient.fetchUser).mockResolvedValue(aUser({ name: "Grace" }));

    const greeting = await greetUser("u1", clockAt("2026-01-01T15:00:00Z"));

    expect(greeting.message).toBe("Hello, Grace!");
    expect(apiClient.fetchUser).toHaveBeenCalledTimes(1);
    expect(apiClient.fetchUser).toHaveBeenCalledWith("u1");
  });

  it("says good morning before noon UTC", async () => {
    vi.mocked(apiClient.fetchUser).mockResolvedValue(aUser());

    const greeting = await greetUser("u1", clockAt("2026-01-01T08:30:00Z"));

    expect(greeting.message).toBe("Good morning, Ada!");
  });

  it("stamps the greeting using the real clock under fake timers", async () => {
    vi.mocked(apiClient.fetchUser).mockResolvedValue(aUser());
    // Fake timers freeze `new Date()` inside systemClock — no injection needed.
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-01T18:00:00Z"));

    const greeting = await greetUser("u1", systemClock);

    expect(greeting.generatedAt).toBe("2026-03-01T18:00:00.000Z");
  });

  it("propagates fetch failures", async () => {
    vi.mocked(apiClient.fetchUser).mockRejectedValue(new Error("boom"));

    await expect(greetUser("u1", clockAt("2026-01-01T15:00:00Z"))).rejects.toThrow(
      "boom",
    );
  });
});
