import { assert, it, vi } from "@effect/vitest";
import {
  NodeId,
  ProviderSessionId,
  ProviderDriverKind,
  ProviderThreadId,
  ProviderTurnId,
  RunId,
  RunAttemptId,
  RuntimeRequestId,
  ThreadId,
  type OrchestrationV2ThreadProjection,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import * as ProviderAdapter from "@t3tools/provider-core/server/ProviderAdapter";
import * as ProjectionStore from "./ProjectionStore.ts";
import * as ProviderSessionManager from "./ProviderSessionManager.ts";
import * as RuntimeRequestService from "./RuntimeRequestService.ts";

it.effect.each(["expired", "resolved"] as const)(
  "responds only to resolved requests and preserves feedback (%s)",
  (status) => {
    const threadId = ThreadId.make("thread-runtime-request-expired");
    const providerSessionId = ProviderSessionId.make("provider-session-runtime-request-expired");
    const requestId = RuntimeRequestId.make("request-expired");
    const respondToRuntimeRequest = vi.fn(
      (_input: ProviderAdapter.ProviderAdapterV2RuntimeRequestResponseInput) => Effect.void,
    );
    const getSession = vi.fn(() =>
      Effect.succeedSome({
        respondToRuntimeRequest,
      } as never),
    );
    const projection = {
      runtimeRequests: [
        {
          id: requestId,
          nodeId: NodeId.make("node-runtime-request-expired"),
          providerTurnId: null,
          nativeRequestRef: null,
          kind: "command",
          status,
          responseCapability: {
            type: "live",
            providerSessionId,
          },
          createdAt: DateTime.makeUnsafe("2026-07-29T00:00:00.000Z"),
          resolvedAt: DateTime.makeUnsafe("2026-07-29T00:00:01.000Z"),
        },
      ],
    } as unknown as OrchestrationV2ThreadProjection;
    const layerTest = RuntimeRequestService.layer.pipe(
      Layer.provide(
        Layer.mergeAll(
          Layer.mock(ProjectionStore.ProjectionStoreV2)({
            getRuntimeRequest: (_threadId, requestId) =>
              Effect.succeed(
                projection.runtimeRequests.find((request) => request.id === requestId),
              ),
          }),
          Layer.mock(ProviderSessionManager.ProviderSessionManagerV2)({
            get: getSession,
          }),
        ),
      ),
    );

    return Effect.gen(function* () {
      const service = yield* RuntimeRequestService.RuntimeRequestServiceV2;
      const response = service.respond({
        threadId,
        providerSessionId,
        requestId,
        decision: "decline",
        feedback: "Use an explicit path.",
      });
      if (status === "resolved") {
        yield* response;
        assert.deepEqual(respondToRuntimeRequest.mock.calls, [
          [
            {
              requestId,
              decision: "decline",
              feedback: "Use an explicit path.",
            },
          ],
        ]);
        return;
      }
      const error = yield* response.pipe(Effect.flip);

      assert.equal(error.reason, "request-not-ready");
      assert.equal(
        error.message,
        `Runtime request ${requestId} on thread ${threadId} is not ready for response execution.`,
      );
      assert.isUndefined(error.cause);
      assert.equal(getSession.mock.calls.length, 0);
      assert.equal(respondToRuntimeRequest.mock.calls.length, 0);
    }).pipe(Effect.provide(layerTest));
  },
);

it.effect.each(["pending", "resolved", "cancelled", "release-failure", "stale-failure"] as const)(
  "releases the original callback even when the detached card is %s",
  (status) =>
    Effect.gen(function* () {
      const threadId = ThreadId.make("detach-thread");
      const providerSessionId = ProviderSessionId.make("detach-session");
      const target = {
        threadId,
        providerSessionId,
        requestId: RuntimeRequestId.make("detach-request"),
        runId: RunId.make("detach-run"),
        providerThreadId: ProviderThreadId.make("detach-provider-thread"),
        providerTurnId: ProviderTurnId.make("detach-turn"),
      };
      const released: string[] = [];
      const interrupted: string[] = [];
      let reads = 0;
      const layerTest = RuntimeRequestService.layer.pipe(
        Layer.provide(
          Layer.mergeAll(
            Layer.mock(ProjectionStore.ProjectionStoreV2)({
              getThreadRecords: () =>
                Effect.succeed({
                  runs: [
                    {
                      id: target.runId,
                      providerThreadId: target.providerThreadId,
                      activeAttemptId: RunAttemptId.make("detach-attempt"),
                      status: status === "stale-failure" && reads++ > 0 ? "completed" : "waiting",
                    },
                  ],
                } as never),
              getProviderControlContext: () =>
                Effect.succeed({
                  providerThread: { id: target.providerThreadId, providerSessionId },
                  providerTurn: {
                    id: target.providerTurnId,
                    runAttemptId: RunAttemptId.make("detach-attempt"),
                    status: "running",
                    providerThreadId: target.providerThreadId,
                  },
                } as never),
            }),
            Layer.mock(ProviderSessionManager.ProviderSessionManagerV2)({
              get: () =>
                Effect.succeedSome({
                  detachUserInput: () =>
                    Effect.sync(() => {
                      released.push(status);
                    }).pipe(
                      Effect.andThen(
                        status.endsWith("failure")
                          ? Effect.fail(
                              new ProviderAdapter.ProviderAdapterProtocolError({
                                driver: ProviderDriverKind.make("claudeAgent"),
                                detail: "release rejected",
                              }),
                            )
                          : Effect.void,
                      ),
                    ),
                  interruptTurn: () =>
                    Effect.sync(() => {
                      interrupted.push(status);
                    }),
                } as never),
            }),
          ),
        ),
      );
      yield* Effect.gen(function* () {
        const service = yield* RuntimeRequestService.RuntimeRequestServiceV2;
        yield* service.detach(target);
        assert.deepEqual(released, [status]);
        assert.deepEqual(interrupted, status === "release-failure" ? [status] : []);
      }).pipe(Effect.provide(layerTest));
    }),
);
