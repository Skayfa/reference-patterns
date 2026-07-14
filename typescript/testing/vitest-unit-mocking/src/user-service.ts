import { fetchUser } from "./api-client.js";

/** Injected collaborator — mocked with a hand-rolled vi.fn() in tests. */
export interface Clock {
  now(): Date;
}

/** Production implementation; tests exercise it with vi.useFakeTimers(). */
export const systemClock: Clock = {
  now: () => new Date(),
};

export interface Greeting {
  message: string;
  generatedAt: string;
}

/**
 * Combines a module dependency (fetchUser -> vi.mock) with an injected one
 * (clock -> vi.fn), the two mocking styles this pattern demonstrates.
 * UTC hours keep the behavior independent of the machine's timezone.
 */
export async function greetUser(id: string, clock: Clock): Promise<Greeting> {
  const user = await fetchUser(id);
  const salutation = clock.now().getUTCHours() < 12 ? "Good morning" : "Hello";
  return {
    message: `${salutation}, ${user.name}!`,
    generatedAt: clock.now().toISOString(),
  };
}
