# Accord Autonomous Agent: Implementation Plan & System Prompt

## 1. Autonomous Activation (Moving from Manual to Proactive)

Currently, Accord is **reactive**—it only starts working when someone explicitly mentions it in a Slack thread. Moving to an **autonomous** model means Accord will ambiently monitor conversations, identify when policy decisions are being made, and proactively step in to investigate.

### Thoughts & Considerations
- **Noise vs. Signal:** If Accord analyzes every single Slack message, API costs will skyrocket, and the agent might hallucinate decisions from casual conversation. We need a fast, cheap filtering layer before invoking the heavy reasoning model.
- **Intrusiveness:** An agent that jumps into threads uninvited can be annoying. The system should start by asking for permission (e.g., *"I noticed you're discussing a retention policy change. Would you like me to investigate its impact?"*) before running the full code/database analysis.
- **Authorization:** Only configured owners should be able to confirm a decision. If Accord auto-detects a policy change proposed by a junior engineer, it must still route it to the owner for confirmation.

### Implementation Plan
1. **Event Ingestion Update:** Update the Slack Bot configuration (in `apps/channel`) to subscribe to `message.channels` events, not just `app_mention`.
2. **Heuristic Filter (Zero-Cost):** Implement a simple regex/keyword filter in `@accord/core` to check if a message contains keywords like "policy", "retention", "change", "delete", "records", or "approve". If no keywords are found, drop the event.
3. **LLM Triage (Low-Cost):** Send messages that pass the heuristic filter to a small, fast model (e.g., `gemini-3.1-flash-lite`) with a specialized triage prompt.
4. **Proactive Enrollment:** If the triage model determines a decision is being made, Accord automatically enrolls the thread, creates a `candidate` decision in PostgreSQL, and posts a native CopilotKit card to the thread offering to investigate.

---

## 2. System Prompt Design for the Autonomous Agent

Here is a system prompt designed for the LLM that will ambiently monitor Slack and decide whether to take action. This prompt focuses on precision to avoid false positives.

```text
You are Accord, an autonomous engineering policy agent. You monitor team discussions to identify when technical policies, data retention rules, or architecture decisions are being made or changed.

Your goal is to extract proposed policy changes and decide if an investigation should be triggered.

### RULES:
1. PASSIVE OBSERVATION: You are reading a live Slack channel. Most conversations are irrelevant. Only trigger an action if there is a CLEAR intent to change or establish a software policy (e.g., "We need to delete free accounts after 30 days").
2. NO ASSUMPTIONS: Do not invent policies. If a conversation is just exploring ideas, mark it as `exploratory`. If a concrete rule is stated, mark it as `policy_proposed`.
3. SCOPE EXTRACTION: If a policy is proposed, extract the affected entities (e.g., User, Account), conditions (e.g., plan = free), and actions (e.g., delete, retain).
4. OUTPUT FORMAT: You must strictly output valid JSON matching the following schema.

### JSON SCHEMA:
{
  "classification": "irrelevant" | "exploratory" | "policy_proposed",
  "confidence_score": 0.0 to 1.0,
  "rationale": "Brief explanation of why you classified it this way.",
  "extracted_policy": {
    "target": "What is being affected?",
    "rule": "What is the new rule or timeframe?",
    "applies_to": "Specific conditions (e.g., verified users only)"
  } // Only include if classification is 'policy_proposed'
}

### EXAMPLES:
Message: "Hey, are we still getting pizza for lunch?"
Output: {"classification": "irrelevant", "confidence_score": 0.99, "rationale": "Lunch discussion, not a software policy."}

Message: "I think we might want to clean up old logs at some point, they are getting huge."
Output: {"classification": "exploratory", "confidence_score": 0.85, "rationale": "General idea discussed, no concrete policy proposed."}

Message: "Let's change the retention for enterprise audit logs to 365 days starting tomorrow."
Output: {
  "classification": "policy_proposed",
  "confidence_score": 0.95,
  "rationale": "Clear directive to change retention policy for a specific tier.",
  "extracted_policy": {
    "target": "Audit logs",
    "rule": "Retain for 365 days",
    "applies_to": "Enterprise tier"
  }
}
```

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
1. **Tool Registry Plugin Architecture:** Refactor `@accord/core` to support a plugin model. Instead of directly importing `ImpactPort` (ClickHouse), create a generic `ToolRegistry`.
2. **Standardize Tool Schemas:** Define strict Zod schemas for the inputs and outputs of new external APIs. Pass these definitions to the LLM via its function-calling API.
3. **Implement Linear/Jira Port:** Create a new package (e.g., `packages/issue-tracker`) that implements an `IssueTrackerPort` (similar to how `RepositoryPort` handles GitHub).
4. **Human-in-the-Loop Gateway:** For any external write action (like `create_ticket`), intercept the LLM's function call in the Trigger.dev worker, suspend the job, and send an interactive CopilotKit message to Slack asking the owner to click "Approve". Once clicked, resume the Trigger.dev job and execute the external API call.
