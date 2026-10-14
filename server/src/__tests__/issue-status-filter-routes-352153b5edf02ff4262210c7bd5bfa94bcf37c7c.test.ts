/**
 * Route-layer contract tests for status-filter validation and normalisation.
 *
 * These tests use a mocked issueService so the validation logic must execute at
 * the route layer BEFORE the service is invoked.  Agents that only fix
 * parseStatusFilter inside the service will still fail here because the mock
 * bypasses the service's internal call.
 *
 * The mock spreads the real module (via importActual) so that any utility
 * helpers or constants the route imports from the barrel pass through as-is,
 * regardless of whether the agent adds them to services/index.ts or imports
 * them directly from services/issues.ts.  Only the service factories are
 * replaced with test doubles.
 */

import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { errorHandler } from "../middleware/index.js";
import { issueRoutes } from "../routes/issues.js";

// ── mocks ─────────────────────────────────────────────────────────────────────

const mockIssueService = vi.hoisted(() => ({
  list: vi.fn(),
  count: vi.fn(),
  // methods referenced during route initialisation
  clearExecutionRunIfTerminal: vi.fn(),
  clearCheckoutRunIfTerminal: vi.fn(),
  addStopRelayCommentIfNeeded: vi.fn(),
  archiveInbox: vi.fn(),
}));

const mockAccessService = vi.hoisted(() => ({
  decide: vi.fn(),
  canUser: vi.fn(),
  hasPermission: vi.fn(),
}));

const mockInstanceSettingsService = vi.hoisted(() => ({
  get: vi.fn(async () => ({
    id: "instance-settings-1",
    general: { censorUsernameInLogs: false, feedbackDataSharingPreference: "prompt" },
  })),
  listCompanyIds: vi.fn(async () => ["company-1"]),
}));

const mockDb = vi.hoisted(() => {
  const q: any = {};
  q.select = vi.fn(() => q);
  q.from = vi.fn(() => q);
  q.innerJoin = vi.fn(() => q);
  q.leftJoin = vi.fn(() => q);
  q.where = vi.fn(() => q);
  q.orderBy = vi.fn(() => q);
  q.limit = vi.fn(() => q);
  q.offset = vi.fn(() => q);
  q.then = (resolve: (rows: unknown[]) => unknown, reject?: (e: unknown) => unknown) =>
    Promise.resolve([]).then(resolve, reject);
  q.execute = vi.fn(async () => []);
  q.transaction = vi.fn(async (fn: (tx: unknown) => unknown) => fn(q));
  return q;
});

// Spread the real module so constants and type helpers pass through, and
// explicitly pull parseStatusFilter from its source module so the mock works
// whether the agent imports it through the barrel or directly from issues.ts.
vi.mock("../services/index.js", async (importActual) => {
  const actual = await importActual<typeof import("../services/index.js")>();
  const { parseStatusFilter } = await vi.importActual<
    typeof import("../services/issues.js")
  >("../services/issues.js");
  return {
    ...actual,
    parseStatusFilter,
    issueService: () => mockIssueService,
    companyService: () => ({ getById: vi.fn(async () => ({ id: "company-1", name: "Test" })) }),
    accessService: () => mockAccessService,
    agentService: () => ({ getById: vi.fn() }),
    heartbeatService: () => ({
      wakeup: vi.fn(async () => undefined),
      reportRunActivity: vi.fn(async () => undefined),
      cancelRun: vi.fn(async () => undefined),
    }),
    instanceSettingsService: () => mockInstanceSettingsService,
    issueApprovalService: () => ({}),
    issueRecoveryActionService: () => ({
      listActiveForIssues: vi.fn(async () => new Map()),
    }),
    issueReferenceService: () => ({
      syncIssue: vi.fn(async () => undefined),
      syncComment: vi.fn(async () => undefined),
      syncDocument: vi.fn(async () => undefined),
      emptySummary: vi.fn(() => ({ outbound: [], inbound: [] })),
      listIssueReferenceSummary: vi.fn(async () => ({ outbound: [], inbound: [] })),
      deleteDocumentSource: vi.fn(async () => undefined),
      diffIssueReferenceSummary: vi.fn(() => ({
        addedReferencedIssues: [],
        removedReferencedIssues: [],
        currentReferencedIssues: [],
      })),
    }),
    issueThreadInteractionService: () => ({}),
    inboxAgentPolicyService: () => ({}),
    documentService: () => ({
      getIssueDocumentPayload: vi.fn(async () => ({})),
      getIssueDocumentByKey: vi.fn(async () => null),
    }),
    documentAnnotationService: () => ({ remapOpenThreadsForDocument: async () => [] }),
    goalService: () => ({ getById: vi.fn(), getDefaultCompanyGoal: vi.fn() }),
    projectService: () => ({ getById: vi.fn(), listByIds: vi.fn(async () => []) }),
    workProductService: () => ({ listForIssue: vi.fn(async () => []) }),
    feedbackService: () => ({
      listIssueVotesForUser: vi.fn(async () => []),
      saveIssueVote: vi.fn(async () => ({ vote: null })),
    }),
    environmentService: () => ({}),
    executionWorkspaceService: () => ({ getById: vi.fn() }),
    routineService: () => ({ syncRunStatusForIssue: vi.fn(async () => undefined) }),
    companySkillService: () => ({ completeTestRunForIssue: vi.fn(async () => null) }),
    logActivity: vi.fn(async () => undefined),
    publishActivity: vi.fn(async () => undefined),
  };
});

// ── app factory ───────────────────────────────────────────────────────────────

function createApp() {
  const app = express();
  app.use(express.json());
  // Simulate a board actor with full access to company-1.
  app.use((req, _res, next) => {
    (req as any).actor = {
      type: "board",
      userId: "local-board",
      companyIds: ["company-1"],
      source: "local_implicit",
      isInstanceAdmin: true,
    };
    next();
  });
  app.use("/api", issueRoutes(mockDb as any, {} as any));
  app.use(errorHandler);
  return app;
}

const app = createApp();

// ── helpers ───────────────────────────────────────────────────────────────────

/** filters argument passed to the first svc.count() call */
function capturedCountFilters() {
  return mockIssueService.count.mock.calls[0]?.[1] as Record<string, unknown> | undefined;
}

/** filters argument passed to the first svc.list() call */
function capturedListFilters() {
  return mockIssueService.list.mock.calls[0]?.[1] as Record<string, unknown> | undefined;
}

// ── test setup ────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
  // Allow full-scope company reads for the board actor.
  mockAccessService.decide.mockResolvedValue({
    allowed: true,
    action: "company_scope:read",
    reason: "allow_test",
    explanation: "Allowed by test mock.",
  });
  mockIssueService.count.mockResolvedValue(0);
  mockIssueService.list.mockResolvedValue([]);
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/companies/:companyId/issues/count
// ─────────────────────────────────────────────────────────────────────────────

describe("GET /api/companies/:companyId/issues/count – status filter", () => {
  it("returns 400 and does not call the service for an unknown status value", async () => {
    const res = await request(app)
      .get("/api/companies/company-1/issues/count")
      .query({ attention: "blocked", status: "not_a_real_status" });

    expect(res.status).toBe(400);
    expect(mockIssueService.count).not.toHaveBeenCalled();
  });

  it("returns 400 for an unknown status mixed into a valid array", async () => {
    const res = await request(app)
      .get("/api/companies/company-1/issues/count")
      .query({ attention: "blocked", status: ["todo", "xyzzy"] });

    expect(res.status).toBe(400);
    expect(mockIssueService.count).not.toHaveBeenCalled();
  });

  it("returns 400 for an unknown token inside a CSV status string", async () => {
    const res = await request(app)
      .get("/api/companies/company-1/issues/count")
      .query({ attention: "blocked", status: "done,not_real" });

    expect(res.status).toBe(400);
    expect(mockIssueService.count).not.toHaveBeenCalled();
  });

  it("calls the service with a deduplicated status array from repeated query keys", async () => {
    const res = await request(app)
      .get("/api/companies/company-1/issues/count")
      .query({ attention: "blocked", status: ["todo", "todo", "done"] });

    expect(res.status).toBe(200);
    expect(mockIssueService.count).toHaveBeenCalledOnce();
    expect(capturedCountFilters()?.status).toEqual(["todo", "done"]);
  });

  it("calls the service with a deduplicated status array from a CSV with duplicates", async () => {
    const res = await request(app)
      .get("/api/companies/company-1/issues/count")
      .query({ attention: "blocked", status: "blocked,blocked,in_review" });

    expect(res.status).toBe(200);
    expect(mockIssueService.count).toHaveBeenCalledOnce();
    expect(capturedCountFilters()?.status).toEqual(["blocked", "in_review"]);
  });

  it("calls the service with a deduplicated status array from mixed array+CSV duplicates", async () => {
    const res = await request(app)
      .get("/api/companies/company-1/issues/count")
      .query({ attention: "blocked", status: ["done,in_review", "done"] });

    expect(res.status).toBe(200);
    expect(capturedCountFilters()?.status).toEqual(["done", "in_review"]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/companies/:companyId/issues
// ─────────────────────────────────────────────────────────────────────────────

describe("GET /api/companies/:companyId/issues – status filter", () => {
  it("returns 400 and does not call the service for an unknown status value", async () => {
    const res = await request(app)
      .get("/api/companies/company-1/issues")
      .query({ status: "garbage_status" });

    expect(res.status).toBe(400);
    expect(mockIssueService.list).not.toHaveBeenCalled();
  });

  it("returns 400 for an unknown status mixed into a valid array", async () => {
    const res = await request(app)
      .get("/api/companies/company-1/issues")
      .query({ status: ["in_progress", "not_valid"] });

    expect(res.status).toBe(400);
    expect(mockIssueService.list).not.toHaveBeenCalled();
  });

  it("calls the service with a deduplicated status array from repeated query keys", async () => {
    const res = await request(app)
      .get("/api/companies/company-1/issues")
      .query({ status: ["todo", "done", "todo"] });

    expect(res.status).toBe(200);
    expect(mockIssueService.list).toHaveBeenCalledOnce();
    expect(capturedListFilters()?.status).toEqual(["todo", "done"]);
  });

  it("calls the service with a deduplicated status from a CSV with duplicates", async () => {
    const res = await request(app)
      .get("/api/companies/company-1/issues")
      .query({ status: "backlog,todo,backlog" });

    expect(res.status).toBe(200);
    expect(capturedListFilters()?.status).toEqual(["backlog", "todo"]);
  });
});
