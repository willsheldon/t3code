import {
  THREAD_FILTER_STATUS_OPTIONS,
  THREAD_TITLE_RULE_LIMIT,
  ThreadFilterStatusesSchema,
  ThreadTitleRuleSchema,
} from "@t3tools/client-runtime/state/thread-filters";
import { EnvironmentId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

/**
 * The thread list filters kept per device. A missing field decodes to its default, so a record
 * from an earlier build still loads.
 */
const ThreadListFilters = Schema.Struct({
  environmentId: Schema.NullOr(EnvironmentId).pipe(
    Schema.withDecodingDefault(Effect.succeed(null)),
  ),
  projectKeys: Schema.Array(Schema.String).pipe(Schema.withDecodingDefault(Effect.succeed([]))),
  statuses: ThreadFilterStatusesSchema.pipe(Schema.withDecodingDefault(Effect.succeed([]))),
  accountKey: Schema.NullOr(Schema.String).pipe(Schema.withDecodingDefault(Effect.succeed(null))),
  rules: Schema.Array(ThreadTitleRuleSchema).pipe(Schema.withDecodingDefault(Effect.succeed([]))),
});
export type ThreadListFilters = typeof ThreadListFilters.Type;

const decodeThreadListFilters = Schema.decodeUnknownOption(ThreadListFilters);
const decodeTitleRule = Schema.decodeUnknownOption(ThreadTitleRuleSchema);
const isEnvironmentId = Schema.is(EnvironmentId);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** The stored rules that decode, once per id and up to the rule limit; a record without any has none. */
function usableStoredRules(raw: unknown): ReadonlyArray<typeof ThreadTitleRuleSchema.Type> {
  if (!Array.isArray(raw)) return [];
  const rules = new Map<string, typeof ThreadTitleRuleSchema.Type>();
  for (const candidate of raw) {
    const rule = Option.getOrUndefined(decodeTitleRule(candidate));
    if (rule !== undefined && !rules.has(rule.id)) rules.set(rule.id, rule);
  }
  return [...rules.values()].slice(0, THREAD_TITLE_RULE_LIMIT);
}

/**
 * Keeps the usable part of a stored record: the `projectKey` of earlier builds becomes a
 * one-project list, and a corrupt field is left out, so it decodes to its default and the
 * other fields survive.
 */
function usableStoredFields(raw: Record<string, unknown>): Record<string, unknown> {
  const projectKeys = Array.isArray(raw.projectKeys)
    ? raw.projectKeys
    : typeof raw.projectKey === "string"
      ? [raw.projectKey]
      : [];
  return {
    ...(isEnvironmentId(raw.environmentId) ? { environmentId: raw.environmentId } : {}),
    projectKeys: [
      ...new Set(projectKeys.filter((key) => typeof key === "string" && key.length > 0)),
    ],
    // Canonical order keeps reset keys stable, as on web.
    statuses: THREAD_FILTER_STATUS_OPTIONS.map((option) => option.value).filter(
      (status) => Array.isArray(raw.statuses) && raw.statuses.includes(status),
    ),
    ...(typeof raw.accountKey === "string" ? { accountKey: raw.accountKey } : {}),
    rules: usableStoredRules(raw.rules),
  };
}

/** The saved filters, or undefined when the stored value is not a record. */
export function decodeStoredThreadListFilters(raw: unknown): ThreadListFilters | undefined {
  if (!isRecord(raw)) return undefined;
  return Option.getOrUndefined(decodeThreadListFilters(usableStoredFields(raw)));
}
