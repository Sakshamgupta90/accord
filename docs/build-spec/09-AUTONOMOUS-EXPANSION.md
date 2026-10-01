# Accord Autonomous Agent: Implementation Plan & System Prompt

## 1. Autonomous Activation (Moving from Manual to Proactive)

Currently, Accord is **reactive**—it only starts working when someone explicitly mentions it in a Slack thread. Moving to an **autonomous** model means Accord will ambiently monitor conversations, identify when policy decisions are being made, and proactively step in to investigate.

### Thoughts & Considerations
- **Noise vs. Signal:** If Accord analyzes every single Slack message, API costs will skyrocket, and the agent might hallucinate decisions from casual conversation. We need a fast, cheap filtering layer before invoking the heavy reasoning model.
- **Intrusiveness:** An agent that jumps into threads uninvited can be annoying. The system should start by asking for permission (e.g., *"I noticed you're discussing a retention policy change. Would you like me to investigate its impact?"*) before running the full code/database analysis.
- **Authorization:** Only configured owners should be able to confirm a decision. If Accord auto-detects a policy change proposed by a junior engineer, it must still route it to the owner for confirmation.

### Implementation (as built)
Pipeline for a message in a thread Accord has not joined, cheapest check first:

1. **Transport filters (free):** the Slack adapter already drops bot messages and edits. `message.channels` is already in `apps/channel/slack-app-manifest.json`.
2. **Audience (free):** the real channel comes from the conversation key (`<channel>::<threadTs>`). Messages outside `ACCORD_SLACK_CHANNEL_ID` never reach a model. Mentions use the same check.
3. **Keyword prefilter (free):** `mayProposeRetentionPolicy()` in `@accord/core` is tuned for recall over retention words and durations. It drops questions about the current state and very long pastes.
4. **Thread history (one Slack call):** `thread.getMessages()` supplies earlier human messages, bounded to one snapshot. This lets "ok, 30 days it is" be read in context. The same history becomes the enrollment snapshot, so interpretation also sees it.
5. **Triage model (one small call):** `ApplicationPort.triageEvent()` validates the event, applies the audience and own-bot checks, sanitizes it and calls the `TriagePort`. The output is schema-validated (`TriageResultSchema`). Failures are logged and skipped; they never break the channel.
6. **Enrollment:** only `policy_proposed` at or above `ACCORD_TRIAGE_MIN_CONFIDENCE` (default 0.75) enrolls. The store gets an explicit `{ enroll: true }`, and the persisted event keeps `wasMention: false`. The normal context job then runs interpretation. Owner confirmation is unchanged, so triage never creates or confirms a decision itself.
7. **Announcement:** the acceptance that enrolled the thread posts the "Accord joined this thread" card once. A racing second message does not repeat it.

Configuration (`.env.example`): `ACCORD_TRIAGE=on|off` (default on), `ACCORD_TRIAGE_MODEL` (defaults to `ACCORD_MODEL`; set it to a cheaper model to save cost), `ACCORD_TRIAGE_MIN_CONFIDENCE` and `ACCORD_TRIAGE_REASONING_EFFORT`.

---

## 2. Triage Prompt

The production prompt is `TRIAGE_INSTRUCTIONS` in `packages/accord-core/src/model/triage.ts`. It is enforced with strict JSON-schema structured output:

```json
{ "classification": "irrelevant" | "exploratory" | "policy_proposed", "confidence": 0.0-1.0, "rationale": "one sentence" }
```

Design choices:
- **Classification only, no extraction.** The interpretation model already extracts a validated `PolicyIntent` from the whole thread after enrollment. Extracting it twice would cost output tokens and could disagree.
- **Context in the user turn, labelled untrusted.** Earlier messages and the TARGET message are rendered as JSON lines and never spliced into the instructions.
- **Bias to `exploratory` when unsure.** Together with the confidence floor, this keeps false-positive interruptions rare.
- **Small output budget** (1,024 tokens, leaving headroom for thinking models), a 15s timeout and no SDK retries. Triage is best effort: a mention always still works.

---

## 3. Extending Connectivity to Additional Tools

Right now, Accord talks to PostgreSQL (for its own state) and ClickHouse (for data impact). To make it a truly universal agent, it needs to interact with the broader engineering ecosystem.

### Thoughts & Considerations
- **Read vs. Write:** It is much safer to give the agent read access to external tools than write access. For MVP, focus on fetching context. If writes are needed (e.g., creating a Jira ticket), they should require a human approval button in Slack.
- **Dynamic Tool Calling:** Instead of hardcoding PostgreSQL and ClickHouse queries, Accord should dynamically select which system to query based on the policy domain.

### Suggested Tools to Integrate
1. **Issue Trackers (Jira / Linear):**
   - *Why:* When Accord detects a discrepancy between a Slack decision and the codebase, it should automatically propose a Jira/Linear ticket to fix it.
   - *Action:* Agent uses `create_issue` tool, but posts a Slack card saying "Click here to approve creating this Jira ticket."
2. **CI/CD Systems (GitHub Actions / Jenkins):**
   - *Why:* If a PR is opened that violates a confirmed Slack policy, Accord should be able to post a failing status check to GitHub, blocking the merge.
   - *Action:* Agent uses `post_commit_status` tool.
3. **Observability (Datadog / Sentry):**
   - *Why:* If a policy dictates "No plain-text emails in logs", Accord could query Datadog to verify if the policy is currently being violated in production.
   - *Action:* Agent uses `query_logs` or `check_monitor_status` tools.
4. **Cloud Providers (AWS / GCP IAM):**
   - *Why:* For infrastructure policies (e.g., "S3 buckets must not be public").

### Implementation Plan
1. **Tool Registry Plugin Architecture:** `ToolRegistryPort` in `@accord/contracts` is the contract for this (not yet implemented). Each `ToolDefinition` declares `access: 'read' | 'write'`. `call()` returns `completed` for reads and `approval_required` for writes, and only `resolveApproval()` by the configured owner executes a write. Keep `ImpactPort` and `RepositoryPort` as typed ports and add new integrations beside them.
2. **Standardize Tool Schemas:** Define strict Zod schemas for the inputs and outputs of new external APIs. Pass these definitions to the LLM via its function-calling API.
3. **Implement Linear/Jira Port:** Create a new package (e.g., `packages/issue-tracker`) that implements an `IssueTrackerPort` (similar to how `RepositoryPort` handles GitHub).
4. **Human-in-the-Loop Gateway:** For any external write action (like `create_ticket`), intercept the LLM's function call in the Trigger.dev worker, suspend the job, and send an interactive CopilotKit message to Slack asking the owner to click "Approve". Once clicked, resume the Trigger.dev job and execute the external API call.
