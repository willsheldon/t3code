import {
  EnvironmentId,
  OperatorTaskError,
  OperatorTaskId,
  type OperatorTaskEntry,
  ProjectId,
  ProviderInstanceId,
  ThreadId,
} from "@t3tools/contracts";
import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Ref from "effect/Ref";
import * as Stream from "effect/Stream";
import type { Tool } from "effect/ai";

import * as OperatorTaskService from "../../../operatorTasks/OperatorTaskService.ts";
import * as McpInvocationContext from "../../McpInvocationContext.ts";
import * as McpToolAccess from "../../McpToolAccess.ts";
import * as McpToolAccessTestkit from "../../McpToolAccess.testkit.ts";
import * as OperatorTasksHandlers from "./handlers.ts";
import { OperatorTasksToolkit } from "./tools.ts";

const CALLER = ThreadId.make("thread:caller");
const OTHER = ThreadId.make("thread:other");

const entry = (overrides: Partial<OperatorTaskEntry> = {}): OperatorTaskEntry => ({
  id: OperatorTaskId.make("task:one"),
  threadId: CALLER,
  createdByThreadId: CALLER,
  action: "Run the migration",
  instructions: "",
  dueAt: null,
  state: "open",
  closeReason: null,
  doneAt: null,
  doneDelivery: null,
  createdAt: "2026-11-12T12:00:00.000Z",
  updatedAt: "2026-11-12T12:00:00.000Z",
  projectId: ProjectId.make("project:mcp-test"),
  threadTitle: "Caller",
  threadArchived: false,
  ...overrides,
});

type Who = "thread" | "subagent" | "client";

const invocation = (who: Who): McpInvocationContext.McpInvocationScope => ({
  environmentId: EnvironmentId.make("environment-1"),
  requestNamespace: "provider-session-1",
  thread:
    who === "client"
      ? undefined
      : {
          threadId: CALLER,
          providerSessionId: "provider-session-1",
          providerInstanceId: ProviderInstanceId.make("codex"),
          ...(who === "subagent" ? { subagent: true } : {}),
        },
  client:
    who === "client"
      ? { sessionId: "client-session", label: "Desktop", access: "auto" }
      : undefined,
  capabilities: new Set(["orchestration"]),
  issuedAt: 1,
});

const makeHarness = Effect.fn("makeOperatorTasksToolkitHarness")(function* (
  options: { readonly fail?: OperatorTaskError } = {},
) {
  const calls = yield* Ref.make<
    ReadonlyArray<{ readonly method: string; readonly input: unknown }>
  >([]);
  const record = (method: string, input: unknown) =>
    Ref.update(calls, (recorded) => [...recorded, { method, input }]).pipe(
      Effect.andThen(options.fail === undefined ? Effect.void : Effect.fail(options.fail)),
    );
  const layerDependencies = Layer.mergeAll(
    Layer.mock(OperatorTaskService.OperatorTaskService)({
      add: (input) => record("add", input).pipe(Effect.as(entry())),
      update: (input) => record("update", input).pipe(Effect.as(entry())),
      list: (input) => record("list", input).pipe(Effect.as({ tasks: [entry()] })),
    }),
    McpToolAccessTestkit.liveThreadsLayer,
  );
  const toolkit = yield* OperatorTasksToolkit.pipe(
    Effect.provide(
      McpToolAccess.HandlersLayer.layer(OperatorTasksHandlers.layer).pipe(
        Layer.provide(layerDependencies),
      ),
    ),
  );
  const call = <Name extends keyof typeof OperatorTasksToolkit.tools>(
    name: Name,
    params: Parameters<typeof toolkit.handle<Name>>[1],
    who: Who = "thread",
  ) =>
    toolkit.handle(name, params).pipe(
      Stream.unwrap,
      Stream.runCollect,
      Effect.map(
        (chunk) => chunk.at(-1)!.result as Tool.Success<(typeof OperatorTasksToolkit.tools)[Name]>,
      ),
      Effect.provideService(McpInvocationContext.McpInvocationContext, invocation(who)),
      Effect.provide(layerDependencies),
    );
  return { calls, call };
});

describe("operator task toolkit handlers", () => {
  it("offers add, update and list, and no tool that marks an item done or reopens it", () => {
    expect(Object.keys(OperatorTasksToolkit.tools).toSorted()).toEqual([
      "my_task_add",
      "my_task_list",
      "my_task_update",
    ]);
  });

  it.effect("adds for the calling thread, or for another thread it names", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness();
      yield* harness.call("my_task_add", {
        action: "Run the migration",
        dueAt: "2026-11-20T09:00:00Z",
      });
      yield* harness.call("my_task_add", { action: "Approve the deploy", threadId: OTHER });
      expect(yield* Ref.get(harness.calls)).toEqual([
        {
          method: "add",
          input: {
            actorThreadId: CALLER,
            action: "Run the migration",
            dueAt: "2026-11-20T09:00:00Z",
          },
        },
        {
          method: "add",
          input: { actorThreadId: CALLER, action: "Approve the deploy", threadId: OTHER },
        },
      ]);
    }),
  );

  it.effect("updates only as the calling thread, whatever else the call carries", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness();
      // Fields no tool declares: a forged actor, a state, a thread to act as.
      const forged = {
        taskId: OperatorTaskId.make("task:one"),
        close: { reason: "Saw the result" },
        state: "done",
        doneAt: "2026-11-12T12:00:00.000Z",
        actor: { kind: "operator" },
        actorThreadId: OTHER,
        threadId: OTHER,
      } as never;
      yield* harness.call("my_task_update", forged);
      expect(yield* Ref.get(harness.calls)).toEqual([
        {
          method: "update",
          input: {
            actorThreadId: CALLER,
            taskId: "task:one",
            close: { reason: "Saw the result" },
          },
        },
      ]);
    }),
  );

  it.effect("refuses writes from a client outside any thread, and from a delegated child", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness();
      for (const who of ["client", "subagent"] as const) {
        const added = yield* harness.call("my_task_add", { action: "x" }, who);
        const updated = yield* harness.call(
          "my_task_update",
          { taskId: OperatorTaskId.make("task:one"), close: { reason: "x" } },
          who,
        );
        for (const result of [added, updated]) {
          expect(result).toMatchObject({ _tag: "OrchestratorMcpFailure" });
        }
      }
      expect(yield* Ref.get(harness.calls)).toEqual([]);
    }),
  );

  it.effect("lets any caller list, with its filters", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness();
      const result = yield* harness.call(
        "my_task_list",
        { state: "open", threadId: CALLER },
        "client",
      );
      expect(result).toEqual({ tasks: [entry()] });
      expect(yield* Ref.get(harness.calls)).toEqual([
        { method: "list", input: { state: "open", threadId: CALLER } },
      ]);
    }),
  );

  it.effect("reports a missing thread or task with a matching code", () =>
    Effect.gen(function* () {
      const missingThread = yield* makeHarness({
        fail: new OperatorTaskError({ message: "Thread thread:nope was not found." }),
      });
      expect(
        yield* missingThread.call("my_task_add", {
          action: "x",
          threadId: ThreadId.make("thread:nope"),
        }),
      ).toMatchObject({ code: "thread_not_found" });
      const missingTask = yield* makeHarness({
        fail: new OperatorTaskError({ message: "Task task:one does not exist." }),
      });
      expect(
        yield* missingTask.call("my_task_update", {
          taskId: OperatorTaskId.make("task:one"),
          close: { reason: "x" },
        }),
      ).toMatchObject({ code: "task_not_found" });
    }),
  );
});
