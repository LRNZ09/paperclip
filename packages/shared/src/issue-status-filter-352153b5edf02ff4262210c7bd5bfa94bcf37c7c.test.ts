/**
 * Contract tests for the parseIssueStatusFilter utility that must be exported
 * from @paperclipai/shared.
 *
 * Centralising the parse/validate/deduplicate logic in the shared package lets
 * both the server (services/issues.ts) and the CLI (commands/client/issue.ts)
 * import a single authoritative implementation instead of duplicating or
 * diverging.  The tests fail at base because the export does not yet exist.
 */

import { beforeAll, describe, expect, it } from "vitest";
import { ISSUE_STATUSES } from "./constants.js";

// Loaded dynamically so a missing export produces a clear assertion failure
// ("expected 'undefined' to be 'function'") rather than a module-load crash.
let parseIssueStatusFilter: (...args: unknown[]) => unknown;

beforeAll(async () => {
  const mod = (await import("./index.js")) as Record<string, unknown>;
  parseIssueStatusFilter = mod.parseIssueStatusFilter as typeof parseIssueStatusFilter;
});

describe("parseIssueStatusFilter (shared package export)", () => {
  it("is exported from the package index as a function", () => {
    expect(typeof parseIssueStatusFilter).toBe("function");
  });

  it("accepts every status in ISSUE_STATUSES without throwing", () => {
    expect(typeof parseIssueStatusFilter).toBe("function");
    for (const status of ISSUE_STATUSES) {
      expect(() => parseIssueStatusFilter(status)).not.toThrow();
    }
  });

  it("returns a single-element array for a single valid status string", () => {
    expect(typeof parseIssueStatusFilter).toBe("function");
    expect(parseIssueStatusFilter("todo")).toEqual(["todo"]);
    expect(parseIssueStatusFilter("done")).toEqual(["done"]);
  });

  it("splits a comma-separated string into individual valid status tokens", () => {
    expect(typeof parseIssueStatusFilter).toBe("function");
    expect(parseIssueStatusFilter("todo,done")).toEqual(["todo", "done"]);
    expect(parseIssueStatusFilter("in_progress,blocked")).toEqual([
      "in_progress",
      "blocked",
    ]);
  });

  it("deduplicates repeated valid statuses from a CSV string", () => {
    expect(typeof parseIssueStatusFilter).toBe("function");
    expect(parseIssueStatusFilter("todo,todo")).toEqual(["todo"]);
    expect(parseIssueStatusFilter("done,in_review,done")).toEqual([
      "done",
      "in_review",
    ]);
  });

  it("deduplicates repeated valid statuses from a string array", () => {
    expect(typeof parseIssueStatusFilter).toBe("function");
    expect(parseIssueStatusFilter(["done", "done", "blocked"])).toEqual([
      "done",
      "blocked",
    ]);
  });

  it("deduplicates across mixed array+CSV input", () => {
    expect(typeof parseIssueStatusFilter).toBe("function");
    expect(parseIssueStatusFilter(["todo,done", "todo"])).toEqual([
      "todo",
      "done",
    ]);
  });

  it("throws for a single unknown status token", () => {
    expect(typeof parseIssueStatusFilter).toBe("function");
    expect(() => parseIssueStatusFilter("not_a_status")).toThrow();
  });

  it("throws when an array contains an unknown token alongside valid ones", () => {
    expect(typeof parseIssueStatusFilter).toBe("function");
    expect(() => parseIssueStatusFilter(["todo", "bad_value"])).toThrow();
  });

  it("throws when a CSV string contains an unknown token", () => {
    expect(typeof parseIssueStatusFilter).toBe("function");
    expect(() => parseIssueStatusFilter("todo,garbage_status")).toThrow();
  });

  it("returns an empty array for undefined input (no filter applied)", () => {
    expect(typeof parseIssueStatusFilter).toBe("function");
    // Matches the contract of the parser being centralised: parseStatusFilter in
    // server/src/services/issues.ts returns [] when no filter is supplied.
    expect(parseIssueStatusFilter(undefined)).toEqual([]);
  });

  it("exports an issueStatusFilterSchema Zod schema that validates status tokens", async () => {
    const mod = (await import("./index.js")) as Record<string, unknown>;
    const schema = mod.issueStatusFilterSchema as
      | { safeParse: (v: unknown) => { success: boolean; data?: unknown } }
      | undefined;
    expect(schema).toBeDefined();
    // Every known status must be accepted.
    for (const status of ISSUE_STATUSES) {
      expect(schema!.safeParse(status).success).toBe(true);
    }
    // Unknown tokens must be rejected.
    expect(schema!.safeParse("garbage").success).toBe(false);
    expect(schema!.safeParse("TODO").success).toBe(false);
    // An empty filter string carries no tokens, which is not an error: the
    // shared pipeline drops empty entries rather than rejecting them, matching
    // parseEnumList in validators/search.ts (`if (!item) continue`), already
    // used for ISSUE_STATUSES, and parseStatusFilter in
    // server/src/services/issues.ts.
    const emptyResult = schema!.safeParse("");
    expect(emptyResult.success).toBe(true);
    expect(emptyResult.data ?? []).toEqual([]);
  });

  it("issueStatusFilterSchema parses a comma-separated string into an array", async () => {
    const mod = (await import("./index.js")) as Record<string, unknown>;
    const schema = mod.issueStatusFilterSchema as
      | { safeParse: (v: unknown) => { success: boolean; data?: unknown } }
      | undefined;
    expect(schema).toBeDefined();
    const result = schema!.safeParse("todo,done");
    expect(result.success).toBe(true);
    expect(result.data).toEqual(["todo", "done"]);
  });

  it("issueStatusFilterSchema parses a string array and deduplicates it", async () => {
    const mod = (await import("./index.js")) as Record<string, unknown>;
    const schema = mod.issueStatusFilterSchema as
      | { safeParse: (v: unknown) => { success: boolean; data?: unknown } }
      | undefined;
    expect(schema).toBeDefined();
    const result = schema!.safeParse(["todo", "done", "todo"]);
    expect(result.success).toBe(true);
    expect(result.data).toEqual(["todo", "done"]);
  });

  it("issueStatusFilterSchema rejects any array containing an unknown token", async () => {
    const mod = (await import("./index.js")) as Record<string, unknown>;
    const schema = mod.issueStatusFilterSchema as
      | { safeParse: (v: unknown) => { success: boolean } }
      | undefined;
    expect(schema).toBeDefined();
    expect(schema!.safeParse(["todo", "garbage"]).success).toBe(false);
    expect(schema!.safeParse("done,not_real").success).toBe(false);
  });
});
