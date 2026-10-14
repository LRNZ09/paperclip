import { fc, test } from "@fast-check/vitest";
import { beforeAll, describe, expect, it } from "vitest";
import { HttpError } from "../errors.ts";
import { parseStatusFilter } from "../services/issues.ts";

// Discoverable from ALL_ISSUE_STATUSES in server/src/services/issues.ts.
const KNOWN_STATUSES = [
  "backlog",
  "todo",
  "in_progress",
  "in_review",
  "blocked",
  "done",
  "cancelled",
] as const;
type KnownStatus = (typeof KNOWN_STATUSES)[number];

const statusArb = fc.constantFrom(...KNOWN_STATUSES);

// Always produces arrays that contain at least one duplicate (doubled).
const withDupsArb = fc
  .array(statusArb, { minLength: 1, maxLength: 10 })
  .map((arr) => [...arr, ...arr]);

// Mixed array: first element is a CSV of all statuses, rest are the same statuses
// individually — guarantees duplicates that cross the CSV/single-token boundary.
const mixedFormWithDupsArb = fc
  .array(statusArb, { minLength: 2, maxLength: 8 })
  .map((arr) => [arr.join(","), ...arr]);

// Mixed array where a CSV element embeds an unknown token alongside valid ones.
const mixedArrayWithUnknownCsvArb = fc
  .tuple(
    fc.array(statusArb, { minLength: 0, maxLength: 3 }),
    fc.array(statusArb, { minLength: 1, maxLength: 3 }),
    fc.string({ minLength: 1, maxLength: 20 }).filter((s) => {
      const t = s.trim();
      return t.length > 0 && !t.includes(",") && !KNOWN_STATUSES.includes(t as KnownStatus);
    }),
  )
  .map(([singles, csvTokens, unknownToken]) => [
    ...singles,
    [...csvTokens, unknownToken].join(","),
  ]);

// Single token that is definitely not a known status and contains no comma
// (so it can't accidentally parse as a valid CSV of known values).
const unknownTokenArb = fc
  .string({ minLength: 1, maxLength: 20 })
  .filter((s) => {
    const t = s.trim();
    return t.length > 0 && !t.includes(",") && !KNOWN_STATUSES.includes(t as KnownStatus);
  });

describe("parseStatusFilter – property-based contract", () => {
  // ── Deduplication ──────────────────────────────────────────────────────────

  test.prop([withDupsArb], { seed: 42 })(
    "output contains no duplicate tokens",
    (input) => {
      const out = parseStatusFilter(input);
      expect(out.length).toBe(new Set(out).size);
    },
  );

  test.prop([withDupsArb], { seed: 42 })(
    "output preserves first-occurrence order and drops later repeats",
    (input) => {
      const out = parseStatusFilter(input);
      const seen = new Set<string>();
      const expected: string[] = [];
      for (const s of input) {
        if (!seen.has(s)) {
          seen.add(s);
          expected.push(s);
        }
      }
      expect(out).toEqual(expected);
    },
  );

  test.prop([withDupsArb], { seed: 42 })(
    "CSV form with duplicates produces same result as the deduplicated array form",
    (input) => {
      const unique = [...new Set(input)];
      expect(parseStatusFilter(input.join(","))).toEqual(parseStatusFilter(unique));
    },
  );

  test.prop([fc.array(statusArb, { minLength: 1, maxLength: 10 })], { seed: 42 })(
    "adding duplicate entries does not change the result",
    (arr) => {
      // double = arr repeated twice; both halves are the same set of statuses
      const doubled = [...arr, ...arr];
      expect(parseStatusFilter(doubled)).toEqual(parseStatusFilter([...new Set(arr)]));
    },
  );

  test.prop([mixedFormWithDupsArb], { seed: 42 })(
    "mixed array where a CSV element duplicates later single tokens deduplicates correctly",
    (input) => {
      const out = parseStatusFilter(input);
      expect(out.length).toBe(new Set(out).size);
    },
  );

  // ── Validation with structured client errors ───────────────────────────────

  test.prop([unknownTokenArb], { seed: 42 })(
    "a single unknown token throws HttpError(400)",
    (token) => {
      let caught: unknown;
      try {
        parseStatusFilter(token);
      } catch (e) {
        caught = e;
      }
      expect(caught).toBeInstanceOf(HttpError);
      expect((caught as HttpError).status).toBe(400);
    },
  );

  test.prop([fc.array(statusArb, { minLength: 1, maxLength: 5 }), unknownTokenArb], { seed: 42 })(
    "an unknown token inside an array throws HttpError(400)",
    (validStatuses, unknownToken) => {
      const mixed = [...validStatuses, unknownToken];
      let caught: unknown;
      try {
        parseStatusFilter(mixed);
      } catch (e) {
        caught = e;
      }
      expect(caught).toBeInstanceOf(HttpError);
      expect((caught as HttpError).status).toBe(400);
    },
  );

  test.prop([fc.array(statusArb, { minLength: 1, maxLength: 5 }), unknownTokenArb], { seed: 42 })(
    "an unknown token inside a CSV string throws HttpError(400)",
    (validStatuses, unknownToken) => {
      const csv = [...validStatuses, unknownToken].join(",");
      let caught: unknown;
      try {
        parseStatusFilter(csv);
      } catch (e) {
        caught = e;
      }
      expect(caught).toBeInstanceOf(HttpError);
      expect((caught as HttpError).status).toBe(400);
    },
  );

  test.prop([mixedArrayWithUnknownCsvArb], { seed: 42 })(
    "an unknown token embedded in a CSV element of a mixed array throws HttpError(400)",
    (input) => {
      let caught: unknown;
      try {
        parseStatusFilter(input);
      } catch (e) {
        caught = e;
      }
      expect(caught).toBeInstanceOf(HttpError);
      expect((caught as HttpError).status).toBe(400);
    },
  );
});

// ── Barrel re-export ─────────────────────────────────────────────────────────
// The helper must be reachable from the services barrel, which is the import
// surface consumers use.

describe("parseStatusFilter (services barrel export)", () => {
  // Resolved dynamically so a missing re-export produces a clear assertion
  // failure rather than a module-load crash.
  let viaBarrel: unknown;

  beforeAll(async () => {
    const mod = (await import("../services/index.ts")) as Record<string, unknown>;
    viaBarrel = mod.parseStatusFilter;
  });

  it("is re-exported from the services barrel as a function", () => {
    expect(typeof viaBarrel).toBe("function");
  });

  it("normalizes mixed array and CSV input when reached through the barrel", () => {
    expect(typeof viaBarrel).toBe("function");
    const parse = viaBarrel as typeof parseStatusFilter;
    expect(parse("in_review")).toEqual(["in_review"]);
    expect(parse(["todo,done", "todo"])).toEqual(["todo", "done"]);
  });
});
