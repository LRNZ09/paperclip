/**
 * Contract tests for CLI-level status filter validation and deduplication in
 * the `issue list` command.
 *
 * The CLI must validate the --status option against the known issue statuses
 * BEFORE sending an HTTP request, so that invalid values are rejected with a
 * local error rather than forwarded to the server.  It must also deduplicate
 * repeated tokens so the outgoing URL carries a canonical, non-redundant set.
 *
 * Both tests fail at base because the CLI currently passes the raw --status
 * value straight to the request URL without validation or deduplication.
 */

import { Command } from "commander";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { registerIssueCommands } from "../commands/client/issue.js";

const COMPANY_ID = "11111111-1111-4111-8111-111111111111";

function createProgram(): Command {
  const program = new Command();
  program.exitOverride();
  program.configureOutput({ writeOut: () => {}, writeErr: () => {} });
  registerIssueCommands(program);
  return program;
}

async function run(args: string[]): Promise<void> {
  await createProgram().parseAsync(
    [
      ...args,
      "--api-base",
      "http://localhost:3100",
      "--api-key",
      "board-token",
    ],
    { from: "user" },
  );
}

/**
 * The `status` query parameters a request URL carries, in order.
 *
 * The required encoding is one parameter per status token — `?status=todo&status=done`
 * — never a single comma-separated value, so this returns the raw parameter
 * values without splitting them.
 */
function statusParamsOf(url: URL): string[] {
  return url.searchParams.getAll("status");
}

describe("issue list – status filter (CLI layer)", () => {
  const savedEnv = {
    PAPERCLIP_API_KEY: process.env.PAPERCLIP_API_KEY,
    PAPERCLIP_API_URL: process.env.PAPERCLIP_API_URL,
  };

  beforeEach(() => {
    vi.restoreAllMocks();
    delete process.env.PAPERCLIP_API_KEY;
    delete process.env.PAPERCLIP_API_URL;
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
    // restoreAllMocks does not undo vi.stubGlobal.
    vi.unstubAllGlobals();
    for (const [key, value] of Object.entries(savedEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  it("rejects an unrecognized --status value before making an HTTP request", async () => {
    // Resolve a valid response so that status validation is the ONLY thing that
    // can make this command fail. A bare vi.fn() resolves undefined, which makes
    // the request blow up downstream and satisfies `.rejects` for an unrelated
    // reason — it passes even against the unfixed CLI.
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify([]), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    // The command should fail locally without ever reaching the network.
    await expect(
      run([
        "issue",
        "list",
        "--company-id",
        COMPANY_ID,
        "--status",
        "not_a_real_status",
      ]),
    ).rejects.toThrow();

    // fetch must not have been called — validation must happen before the HTTP layer.
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("deduplicates repeated status tokens in the outgoing request URL", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify([]), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await run([
      "issue",
      "list",
      "--company-id",
      COMPANY_ID,
      "--status",
      "todo,done,todo",
    ]);

    expect(fetchMock).toHaveBeenCalledOnce();

    const calledUrl = new URL(String(fetchMock.mock.calls[0][0]));
    // Each status must be a separate query parameter, never a single CSV value,
    // and the repeated "todo" must be collapsed to one occurrence.
    expect(statusParamsOf(calledUrl)).toEqual(["todo", "done"]);
    for (const value of statusParamsOf(calledUrl)) {
      expect(value).not.toContain(",");
    }
  });

  it("ignores empty tokens from trailing or doubled commas in --status", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify([]), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await run([
      "issue",
      "list",
      "--company-id",
      COMPANY_ID,
      "--status",
      "todo,,done,",
    ]);

    expect(fetchMock).toHaveBeenCalledOnce();
    const calledUrl = new URL(String(fetchMock.mock.calls[0][0]));
    // Empty tokens must be stripped, leaving exactly two separate parameters.
    expect(statusParamsOf(calledUrl)).toEqual(["todo", "done"]);
  });

  it("trims surrounding whitespace from each --status token", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify([]), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await run([
      "issue",
      "list",
      "--company-id",
      COMPANY_ID,
      "--status",
      " todo , done ",
    ]);

    expect(fetchMock).toHaveBeenCalledOnce();
    const calledUrl = new URL(String(fetchMock.mock.calls[0][0]));
    // Values arrive trimmed, as separate parameters, with no padding preserved.
    expect(statusParamsOf(calledUrl)).toEqual(["todo", "done"]);
  });
});
