import { randomBytes } from "node:crypto";

// One active sign-in for this private server. Disconnect and a new sign-in
// invalidate old callbacks, including token exchanges already in flight.
export class GoogleSignInSession {
  private pending?: { state: string; expiresAt: number };
  version = 0;
  constructor(private readonly now = () => Date.now()) {}

  begin(): string {
    this.version += 1;
    const state = randomBytes(24).toString("hex");
    this.pending = { state, expiresAt: this.now() + 10 * 60_000 };
    return state;
  }

  consume(state: string | undefined): number {
    if (!state || !this.pending || this.pending.state !== state || this.pending.expiresAt <= this.now()) {
      throw new Error("Google sign-in expired or was cancelled. Return to Calendars and connect again.");
    }
    this.pending = undefined;
    return this.version;
  }

  assertCurrent(version: number): void {
    if (version !== this.version) throw new Error("Google sign-in was cancelled. Return to Calendars and connect again.");
  }

  cancel(): void {
    this.version += 1;
    this.pending = undefined;
  }
}
