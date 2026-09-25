# Accord — notes for coding agents

**Accord catches when a Slack decision changes what software should do, investigates the actual
implementation and affected data, and keeps the finding current until resolution is verified.**

Read `docs/build-spec/00-START-HERE.md`, then `01-SHARED-CONTRACTS.md` with
`packages/accord-contracts/src/types.ts`, then your assigned agent file, then
`06-ACCEPTANCE-AND-REVIEW.md`. Your own complete handoff is in `docs/build-spec/handoffs/`.

Do not report any capability as working until its acceptance test passes. No capability is implied
by a button or a mock. A failed dependency must be visible as incomplete evidence.

## Provenance

This repository was bootstrapped from the CopilotKit **agents-everywhere-starter-kit** at commit
`6443333e4b81fd6e21a4f531bdeee3a71eccd7b5`, imported without its `.git` directory. The starter's MIT
`LICENSE` is retained and must stay. `apps/web`, `apps/mobile` and `packages/agent-core` are
inherited starter examples: they may remain, but they are never advertised as Accord features.

## Ownership — do not edit another owner's paths

| Owner | Branch | Exclusive paths |
|---|---|---|
| Agent 1 | `accord/core` | `packages/accord-contracts/**`, `packages/accord-store/**`, `packages/accord-core/**`, `apps/worker/**`, `trigger.config.ts`, `tools/**`, root manifests, lockfile, `tsconfig.base.json`, `.env.example`, `.gitignore`, this file |
| Agent 2 | `accord/slack` | `apps/channel/**`, `packages/slack-delivery/**` |
| Agent 3 | `accord/repository` | `packages/repo-investigator/**`, `packages/retention-fixture/**`, `fixtures/retention-app/**` |
| Agent 4 | `accord/data-integration` | `packages/data-impact/**`, `packages/privacy/**`, `infra/**`, `scripts/**`, `tests/e2e/**`, `tests/live/**`, `README.md`, `SUBMISSION.md` |

Agent 1 owns PostgreSQL migrations; Agent 4 owns ClickHouse schemas. Agent 3 owns fixture policy and
code; Agent 4 owns account and record seed data. Each agent owns its own package manifest, but only
Agent 1 commits the root lockfile. Send root script, dependency and environment requests to Agent 1
in your handoff; Agent 1 applies them. Never create an alternative copy of another owner's package.

## Rules that are easy to get wrong here

- **`@accord/contracts` is the only cross-owner surface.** Import package roots, never another
  owner's internal files. A contract change needs Agent 1's version bump and every consumer updated
  before merge. Do not silently accept a second shape.
- **Validate at every boundary.** External events, model output, tool arguments, persisted JSON and
  package-boundary results all go through the strict schema. Unknown keys are rejected; nullable
  fields are present as `null`. Schema validation establishes shape, not authorization or truth.
- **Factories are dependency-injected and side-effect free on import.** Importing a package must
  never start a server, connect to Slack or read a credential. Composition happens in the channel
  executable and the Trigger task entry files.
- **Test doubles live under `test/` or `*.test.*`.** Production composition must never select a
  double because a key is missing. There is no production `mock` mode.
- **Unknown is not zero and not success.** Unknown counts are `null`. A missing trusted path is
  `unsupported`, not `no_conflict`. A Slack delivery error is not an investigation failure.
- **Obsolete work must not win.** Compare decision version AND context revision in one transaction
  before any result becomes the authoritative current finding.
- **`@ag-ui/client` must stay deduped.** The root `overrides` pins it to the exact version
  `@copilotkit/runtime` declares. Two copies produce two `AbstractAgent` types and every
  `createChannel({ agent })` fails on a private `_debug` property. If you bump
  `@copilotkit/runtime`, re-check `npm ls @ag-ui/client` and update the override — through Agent 1.
- **`@copilotkit/channels` and `@copilotkit/runtime` are a tested pair.** Bump together, keep exact.
- **Files containing JSX must be `.tsx`** with `jsxImportSource: "@copilotkit/channels"`. Not React.
- **`maxSteps` defaults to 1** on `BuiltInAgent`. An agent with tools needs more.
- **Do not add `identifyUser` to `CopilotRuntime`** — it belongs on `createChannel`.
- **Never invent a Channels component or prop.** Read `.agents/skills/build-channels-agent/SKILL.md`
  before touching `apps/channel/`. The most common failure here is a plausible-looking invented API.
- Run `npm run verify` before claiming anything works.

## Root commands

`npm ci` · `npm run typecheck` · `npm test` · `npm run verify` — offline, no credentials.

`npm run dev:up` / `dev:down` — local PostgreSQL and ClickHouse from `infra/compose.yaml`.
`npm run db:migrate` — PostgreSQL schema. `npm run demo:seed` — the immutable ClickHouse dataset.
`npm run dev:slack` — the CopilotKit Slack bridge. `npm run dev:worker` — the Trigger.dev worker.
`npm run demo:preflight` · `demo:reset` · `demo:prepare-prs` · `review:evidence`.

`npm run test:integration` — real PostgreSQL and ClickHouse: the store suite, then the e2e suite.
`npm run test:live` — real provider checks, then the live end-to-end flow check.

Every command that needs a real service names the missing configuration and exits nonzero rather
than reporting a pass it has not earned. `tools/pending.mjs` is the helper for that, and any root
script added for work that is not finished yet must use it instead of printing success.

<!-- TRIGGER.DEV SKILLS START -->
## Trigger.dev agent skills

This project has Trigger.dev agent skills installed in `.agents/skills/`. Before writing or changing Trigger.dev code (background tasks, scheduled tasks, realtime, or chat.agent AI agents), load the most relevant skill: `trigger-authoring-chat-agent`.
<!-- TRIGGER.DEV SKILLS END -->
