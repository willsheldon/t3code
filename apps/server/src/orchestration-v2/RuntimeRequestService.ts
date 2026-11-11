import {
  ProviderApprovalDecision,
  ProviderSessionId,
  ProviderThreadId,
  ProviderTurnId,
  RunId,
  ProviderUserInputAnswers,
  RuntimeRequestId,
  ThreadId,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import * as ProjectionStore from "./ProjectionStore.ts";
import * as ProviderSessionManager from "./ProviderSessionManager.ts";

export class RuntimeRequestResponseExecutionError extends Schema.TaggedError<RuntimeRequestResponseExecutionError>()(
  "RuntimeRequestResponseExecutionError",
  {
    reason: Schema.Literals([
      "request-missing",
      "request-not-ready",
      "request-not-resumable",
      "provider-session-not-active",
      "unexpected-failure",
    ]),
    threadId: ThreadId,
    providerSessionId: ProviderSessionId,
    requestId: RuntimeRequestId,
    cause: Schema.optional(Schema.Defect()),
  },
) {
  override get message(): string {
    switch (this.reason) {
      case "request-missing":
        return `Runtime request ${this.requestId} no longer exists on thread ${this.threadId}.`;
      case "request-not-ready":
        return `Runtime request ${this.requestId} on thread ${this.threadId} is not ready for response execution.`;
      case "request-not-resumable":
        return `Runtime request ${this.requestId} on thread ${this.threadId} is not resumable on provider session ${this.providerSessionId}.`;
      case "provider-session-not-active":
        return `Provider session ${this.providerSessionId} is not active for runtime request ${this.requestId} on thread ${this.threadId}.`;
      case "unexpected-failure":
        return `Failed to respond to runtime request ${this.requestId} on thread ${this.threadId} via provider session ${this.providerSessionId}.`;
    }
  }
}

const isRuntimeRequestResponseExecutionError = Schema.is(RuntimeRequestResponseExecutionError);

export interface RuntimeRequestServiceV2Shape {
  readonly detach: (input: {
    readonly threadId: ThreadId;
    readonly providerSessionId: ProviderSessionId;
    readonly providerThreadId: ProviderThreadId;
    readonly providerTurnId: ProviderTurnId;
    readonly runId: RunId;
    readonly requestId: RuntimeRequestId;
  }) => Effect.Effect<void, RuntimeRequestResponseExecutionError>;
  readonly respond: (input: {
    readonly threadId: ThreadId;
    readonly providerSessionId: ProviderSessionId;
    readonly requestId: RuntimeRequestId;
    readonly decision?: ProviderApprovalDecision;
    readonly feedback?: string;
    readonly answers?: ProviderUserInputAnswers;
  }) => Effect.Effect<void, RuntimeRequestResponseExecutionError>;
}

export class RuntimeRequestServiceV2 extends Context.Service<
  RuntimeRequestServiceV2,
  RuntimeRequestServiceV2Shape
>()("t3/orchestration-v2/RuntimeRequestService/RuntimeRequestServiceV2") {}

export const layer: Layer.Layer<
  RuntimeRequestServiceV2,
  never,
  ProjectionStore.ProjectionStoreV2 | ProviderSessionManager.ProviderSessionManagerV2
> = Layer.effect(
  RuntimeRequestServiceV2,
  Effect.gen(function* () {
    const projections = yield* ProjectionStore.ProjectionStoreV2;
    const sessions = yield* ProviderSessionManager.ProviderSessionManagerV2;

    return RuntimeRequestServiceV2.of({
      detach: Effect.fn("RuntimeRequestService.detach")(
        function* (input) {
          const load = Effect.fn("RuntimeRequestService.detachTarget")(function* () {
            const context = yield* projections.getProviderControlContext(input.threadId, input);
            const { runs } = yield* projections.getThreadRecords(input.threadId, ["runs"], {
              runIds: [input.runId],
            });
            return { ...context, run: runs[0] };
          });
          const owns = (context: Effect.Success<ReturnType<typeof load>>) =>
            context.run?.id === input.runId &&
            (context.run.status === "running" || context.run.status === "waiting") &&
            context.providerTurn?.id === input.providerTurnId &&
            context.providerTurn.status === "running" &&
            context.providerTurn.providerThreadId === input.providerThreadId &&
            context.providerTurn.runAttemptId === context.run.activeAttemptId &&
            context.run.providerThreadId === input.providerThreadId &&
            context.providerThread?.id === input.providerThreadId &&
            context.providerThread.providerSessionId === input.providerSessionId;
          const context = yield* load();
          if (!owns(context)) return;
          const session = yield* sessions.get(input.providerSessionId);
          if (Option.isNone(session) || session.value.detachUserInput === undefined) return;
          yield* session.value
            .detachUserInput({
              providerThread: context.providerThread!,
              providerTurnId: input.providerTurnId,
              requestId: input.requestId,
            })
            .pipe(
              Effect.catch((cause) =>
                Effect.gen(function* () {
                  const current = yield* load();
                  if (!owns(current)) return;
                  yield* Effect.logWarning(
                    "Question release failed; interrupting its original turn",
                    { requestId: input.requestId, cause },
                  );
                  yield* session.value.interruptTurn({
                    providerThread: current.providerThread!,
                    providerTurnId: input.providerTurnId,
                  });
                }),
              ),
            );
        },
        (effect, input) =>
          effect.pipe(
            Effect.mapError(
              (cause) =>
                new RuntimeRequestResponseExecutionError({
                  ...input,
                  reason: "unexpected-failure",
                  cause,
                }),
            ),
          ),
      ),
      respond: Effect.fn("RuntimeRequestService.respond")(
        function* (input) {
          const request = yield* projections.getRuntimeRequest(input.threadId, input.requestId);
          if (request === undefined) {
            return yield* new RuntimeRequestResponseExecutionError({
              reason: "request-missing",
              threadId: input.threadId,
              providerSessionId: input.providerSessionId,
              requestId: input.requestId,
            });
          }
          // Dispatch persists resolution before this effect runs; pending requests are not executable.
          if (request.status !== "resolved") {
            return yield* new RuntimeRequestResponseExecutionError({
              reason: "request-not-ready",
              threadId: input.threadId,
              providerSessionId: input.providerSessionId,
              requestId: input.requestId,
            });
          }
          if (
            request.responseCapability.type !== "live" ||
            request.responseCapability.providerSessionId !== input.providerSessionId
          ) {
            return yield* new RuntimeRequestResponseExecutionError({
              reason: "request-not-resumable",
              threadId: input.threadId,
              providerSessionId: input.providerSessionId,
              requestId: input.requestId,
            });
          }
          const session = yield* sessions.get(input.providerSessionId);
          if (Option.isNone(session)) {
            return yield* new RuntimeRequestResponseExecutionError({
              reason: "provider-session-not-active",
              threadId: input.threadId,
              providerSessionId: input.providerSessionId,
              requestId: input.requestId,
            });
          }
          yield* session.value.respondToRuntimeRequest({
            requestId: input.requestId,
            ...(input.decision === undefined ? {} : { decision: input.decision }),
            ...(input.feedback === undefined ? {} : { feedback: input.feedback }),
            ...(input.answers === undefined ? {} : { answers: input.answers }),
          });
        },
        (effect, input) =>
          effect.pipe(
            Effect.mapError((cause) =>
              isRuntimeRequestResponseExecutionError(cause)
                ? cause
                : new RuntimeRequestResponseExecutionError({
                    reason: "unexpected-failure",
                    threadId: input.threadId,
                    providerSessionId: input.providerSessionId,
                    requestId: input.requestId,
                    cause,
                  }),
            ),
          ),
      ),
    });
  }),
);
