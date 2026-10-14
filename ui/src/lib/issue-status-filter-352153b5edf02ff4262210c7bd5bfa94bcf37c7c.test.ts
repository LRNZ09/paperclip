import { describe, expect, it } from "vitest";
import { parseIssueStatusFilter } from "@paperclipai/shared";
import {
  issueQuickFilterPresets,
  normalizeIssueFilterState,
} from "./issue-filters";

describe("normalizeIssueFilterState – status validation", () => {
  it("filters out status values that are not valid IssueStatus tokens", () => {
    const { statuses } = normalizeIssueFilterState({
      statuses: ["todo", "garbage_status", "done"],
    });
    expect(statuses).toEqual(["todo", "done"]);
  });

  it("returns an empty statuses array when all supplied values are unrecognised", () => {
    const { statuses } = normalizeIssueFilterState({
      statuses: ["NOT_A_STATUS", "bogus", "TODO"],
    });
    expect(statuses).toHaveLength(0);
  });

  it("trims whitespace from status values before validating them", () => {
    const { statuses } = normalizeIssueFilterState({
      statuses: [" todo ", "done ", "  in_progress"],
    });
    expect(statuses).toEqual(["todo", "done", "in_progress"]);
  });
});

describe("issueQuickFilterPresets – shared contract", () => {
  it.each(issueQuickFilterPresets.filter((p) => p.statuses.length > 0))(
    "preset '$label' statuses are accepted by parseIssueStatusFilter",
    (preset) => {
      expect(() =>
        parseIssueStatusFilter(preset.statuses.join(",")),
      ).not.toThrow();
    },
  );
});
