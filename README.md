# Accord

Accord keeps a Slack policy decision connected to the code and synthetic data it changes. A team enrolls one thread by mentioning Accord; the configured owner confirms a narrowly supported retention decision; Accord investigates the fixed GitHub commit and calculates its current impact from a read-only ClickHouse view. Findings remain tied to the decision version and context revision until a proposed fix is verified at its PR head commit.

In the same Slack thread, Accord can also answer questions about the configured GitHub repository: it reads and searches the code, reads commits, issues and pull requests, and, when asked how to make a change, suggests up to three approaches ranked for this project. All GitHub access is read-only.

This is deliberately a bounded MVP: one configured Slack workspace/channel, one GitHub repository, the synthetic `fixtures/retention-app/` policy fixture, and immediate retention changes for existing records. It does not delete records, execute fetched PR code, monitor all conversations, or prove a deployed fix.

- [Architecture](#architecture)
- [Run it on your own machine](#run-it-on-your-own-machine)
- [Every time you run it](#every-time-you-run-it)
- [What to ask Accord in Slack](#what-to-ask-accord-in-slack)
- [Troubleshooting](#troubleshooting)
- [Reference](#reference)

## Architecture

```text
Slack thread → channel bridge (apps/channel) → durable coordinator / Trigger task (apps/worker)
                    │                              ├─ GitHub investigator (fixed SHA, trusted evaluator)
                    │                              └─ ClickHouse ImpactPort (restricted joined view, aggregates only)
                    │                                      ↓
                    │                              same Slack bot updates one finding message in the thread
                    └─ read-only GitHub tools: code, commits, issues, pull requests
```

PostgreSQL is the durable decision/outbox authority. ClickHouse contains only the synthetic fixture and exposes the worker runtime role to `accord_retention_view`, not the source tables. Shared privacy guards redact known/configured secret values, block secret-bearing repository paths (including `.env` and `*.env` files), and fail closed for a mismatched team, channel, repository, or dataset. Their scope is bounded safeguards, not a claim of universal DLP or local-only processing.

Two processes run on your machine while Accord is live:

| Process | Command | What it does |
|---|---|---|
| Slack bridge | `npm run dev:slack` | Connects to Slack (Socket Mode), enrolls threads, answers questions |
| Worker | `npm run dev:worker` | Runs the Trigger.dev jobs: interpret the decision, investigate, publish the finding |

Both must stay running. When you stop them, Accord stops replying.

## Run it on your own machine

These steps were written for macOS; Linux works the same way. Plan about 30–45 minutes the first time, most of it creating accounts and the Slack app.

### 1. Install the tools

| Tool | Why | Install |
|---|---|---|
| Node.js 22 or newer | Runs everything | [nodejs.org](https://nodejs.org) or `nvm install 22` |
| Git | Clone the repo | Preinstalled on macOS (`xcode-select --install` if missing) |
| Docker | Runs local ClickHouse (and PostgreSQL) | **Either** [Docker Desktop](https://www.docker.com/products/docker-desktop/) **or** the free Colima route below |

Colima route (no Docker Desktop, no licence needed):

```bash
brew install colima docker docker-compose
mkdir -p ~/.docker/cli-plugins
ln -sfn "$(brew --prefix)/opt/docker-compose/bin/docker-compose" ~/.docker/cli-plugins/docker-compose
colima start --cpu 2 --memory 4
docker compose version
```

### 2. Get the code and install dependencies

```bash
git clone <this-repository-url> accord
cd accord
npm ci
npm run verify        # offline typecheck + tests, needs no credentials
```

### 3. Create your accounts and keys

You need one of each. Keep every value private; you will paste them into `.env` in step 4.

| Service | What to get | Where |
|---|---|---|
| **Google AI Studio** (model) | `GOOGLE_API_KEY` | [aistudio.google.com/apikey](https://aistudio.google.com/apikey) |
| **CopilotKit Intelligence** | `INTELLIGENCE_API_KEY` (project API key) and the **Channel Code** | CopilotKit dashboard → your project → API Keys / Channels |
| **Trigger.dev** | `TRIGGER_PROJECT_REF` (`proj_…`) and the **dev** secret key `TRIGGER_SECRET_KEY` (`tr_dev_…`) | [cloud.trigger.dev](https://cloud.trigger.dev) → project → API keys |
| **GitHub** | A fine-grained token with **read-only** access to the repository: Contents, Metadata, Issues, Pull requests | GitHub → Settings → Developer settings → Fine-grained tokens |
| **Slack** | A workspace where you can install apps (see step 3a) | [api.slack.com/apps](https://api.slack.com/apps) |

OpenAI works instead of Google if you prefer; see [Model configuration](#model-configuration).

#### 3a. Create the Slack app

1. Go to [api.slack.com/apps](https://api.slack.com/apps) → **Create New App** → **From an app manifest**, choose your workspace, and paste the contents of [`apps/channel/slack-app-manifest.json`](apps/channel/slack-app-manifest.json).
2. **Install to Workspace**. Copy the **Bot User OAuth Token** (`xoxb-…`) → `SLACK_BOT_TOKEN`. The manifest includes `files:read` for deliberate knowledge-base uploads; if the app already exists, reinstall it after updating the manifest to grant that scope.
3. **Basic Information → App-Level Tokens → Generate** with the `connections:write` scope. Copy it (`xapp-…`) → `SLACK_APP_TOKEN`.
4. In Slack, create or pick a channel (e.g. `#general`) and invite the bot: `/invite @Accord`.
5. Collect the IDs:
   - **Team ID** (`T…`) and **bot user ID** (`U…`): run
     ```bash
     curl -s -H "Authorization: Bearer xoxb-YOUR-TOKEN" https://slack.com/api/auth.test
     ```
     `team_id` → `ACCORD_SLACK_TEAM_ID`, `user_id` → `ACCORD_BOT_USER_ID`.
   - **Channel ID** (`C…`): open the channel → channel name → bottom of the About tab → `ACCORD_SLACK_CHANNEL_ID`.
   - **Your user ID** (`U…`): your Slack profile → ⋮ → **Copy member ID** → `ACCORD_OWNER_SLACK_USER_ID`. Only this person can confirm a decision.

#### 3b. Find the CopilotKit Channel Code

The Channel Code is a lowercase, hyphenated name such as `accord`, **not** an id like `channel_01a0…`.

```bash
npx copilotkit@latest login
npx copilotkit@latest project list --json            # find your project's slug
npx copilotkit@latest project select --project <slug>
npm run channel:status                                # shows "name": "<channel-code>"
```

### 4. Create `.env`

Create a file called `.env` in the repository root with the content below and fill in your values. **Never commit it.** The PostgreSQL and ClickHouse values already match `infra/compose.yaml`.

```dotenv
# ── Mode
ACCORD_MODE=demo
PORT=3000
LOG_LEVEL=info

# ── Model (Google Gemini)
ACCORD_MODEL_PROVIDER=google
GOOGLE_API_KEY=
ACCORD_MODEL=gemini-3-flash-preview
ACCORD_MODEL_REASONING_EFFORT=low
MODEL_PROVIDER=google
MODEL=gemini-3-flash-preview
# Optional semantic retrieval overrides. Defaults are Google gemini-embedding-001 or
# OpenAI text-embedding-3-small according to ACCORD_MODEL_PROVIDER.
# ACCORD_EMBEDDING_PROVIDER=google
# ACCORD_EMBEDDING_MODEL=gemini-embedding-001

# ── CopilotKit Channels
INTELLIGENCE_API_KEY=
CHANNEL_CODE=

# ── Slack
SLACK_BOT_TOKEN=
SLACK_APP_TOKEN=
ACCORD_SLACK_TEAM_ID=
ACCORD_SLACK_CHANNEL_ID=
ACCORD_OWNER_SLACK_USER_ID=
ACCORD_BOT_USER_ID=

# ── GitHub (the repository Accord investigates and answers questions about)
GITHUB_TOKEN=
ACCORD_GITHUB_OWNER=
ACCORD_GITHUB_REPO=
ACCORD_REPO_REF=main
ACCORD_REPO_PATH_PREFIX=fixtures/retention-app/
ACCORD_TRUSTED_PROFILE_VERSION=1.0

# ── Trigger.dev
TRIGGER_PROJECT_REF=
TRIGGER_SECRET_KEY=

# ── PostgreSQL (local, matches infra/compose.yaml)
DATABASE_URL=postgres://accord_admin:local-development-only@localhost:5432/accord

# ── ClickHouse (local, matches infra/compose.yaml)
CLICKHOUSE_URL=http://localhost:8123
CLICKHOUSE_DATABASE=accord_demo
CLICKHOUSE_USER=accord_runtime
CLICKHOUSE_PASSWORD=choose-a-long-random-password
# Seed-only admin identity; used by `npm run demo:seed`.
ACCORD_CLICKHOUSE_ADMIN_USER=accord_admin
ACCORD_CLICKHOUSE_ADMIN_PASSWORD=local-development-only

# ── Dataset (fixed; must match infra/clickhouse/seed/*.json)
ACCORD_DATASET_VERSION=accord-demo-2026-09-12
ACCORD_DEMO_AS_OF=2026-09-12T00:00:00.000Z
ACCORD_DEMO_RESET_ENABLED=false
```

`ACCORD_GITHUB_OWNER`/`ACCORD_GITHUB_REPO` must point at a repository that contains `fixtures/retention-app/` (a fork or copy of this one), because the investigator verifies that fixture against committed checksums.

### 5. Start the databases, create the schema and seed the demo data

```bash
npm run dev:up          # PostgreSQL + ClickHouse in Docker
docker compose -f infra/compose.yaml ps   # wait until both show "healthy"
```

Create the restricted ClickHouse runtime user (use the same password you put in `CLICKHOUSE_PASSWORD`):

```bash
docker compose -f infra/compose.yaml exec clickhouse clickhouse-client \
  --user accord_admin --password local-development-only --multiquery --query "
  CREATE USER IF NOT EXISTS accord_runtime IDENTIFIED WITH sha256_password BY 'choose-a-long-random-password';
  GRANT accord_runtime_readonly TO accord_runtime;
  SET DEFAULT ROLE accord_runtime_readonly TO accord_runtime;"
```

Then:

```bash
npm run db:migrate       # PostgreSQL schema
npm run demo:seed        # 6 accounts, 19 records in ClickHouse
npm run demo:preflight   # every line should say READY
```

> **Already running PostgreSQL on port 5432** (for example Postgres.app)? The Docker PostgreSQL cannot bind that port. Either quit your local PostgreSQL, or start only ClickHouse with `docker compose -f infra/compose.yaml up -d clickhouse` and create the role and database in your own PostgreSQL:
> ```bash
> psql -h localhost -d postgres -c "CREATE ROLE accord_admin LOGIN PASSWORD 'local-development-only' CREATEDB;"
> psql -h localhost -d postgres -c "CREATE DATABASE accord OWNER accord_admin;"
> ```

### 6. Log in to Trigger.dev (once)

```bash
npx trigger.dev@4.5.16 login
```

The first `npm run dev:worker` may also offer to install an MCP server and agent skills; answering **No** is fine and keeps the repository clean.

### 7. Start Accord

Open **two terminal tabs** in the repository folder.

Tab 1, the worker:

```bash
npm run dev:worker
```

Wait for `Local worker ready`.

Tab 2, the Slack bridge:

```bash
npm run dev:slack
```

Wait for `✓ Accord Slack Channel "<channel-code>" online — listening on :3000`. You can confirm with:

```bash
curl -s localhost:3000/health
```

It should report `"status":"healthy"`, `"connected":true` and `"ready":true`.

### 8. Try it in Slack

In the channel you configured, post a **new** message that mentions the bot:

> @Accord Confirmed: free accounts with verified university status now get 90 days retention for records we already store, effective immediately

Accord posts an **Accord Active** card in the thread, answers, and a little later posts the finding in the same thread: the code still keeps records for 30 days, and 7 records across 2 accounts would be selected for cleanup too early. Keep replying inside that thread to continue.

## Every time you run it

After a restart of your computer:

```bash
colima start                         # only if you use Colima; Docker Desktop: just open it
npm run dev:up                       # or: docker compose -f infra/compose.yaml up -d clickhouse
```

Then Tab 1 `npm run dev:worker`, Tab 2 `npm run dev:slack`. The schema, seed data and logins persist; you do not repeat steps 3–6.

To stop: `Ctrl+C` in both tabs, then optionally `npm run dev:down` (the data volumes are kept).

## What to ask Accord in Slack

Start with a new top-level message that @mentions the bot; follow up with plain replies **inside that thread**.

**Retention decisions (the core workflow)**
- `@Accord Confirmed: free accounts with verified university status now get 90 days retention for records we already store, effective immediately`
- In the thread: `What's the current status of this decision?` · `Let's mark this as tentative until legal signs off.` · `Update: make it 60 days instead of 90.` · `We're withdrawing this decision.`
- `@Accord Should we maybe give paid company accounts 45 days retention?` (a proposal, not a confirmation)
- `@Accord Let's keep student data longer.` (too vague, so Accord asks a clarifying question)

**Code**
- `@Accord How does Accord decide whether someone is allowed to confirm a decision?`
- `@Accord Where is the retention cleanup logic and what does it do?`
- `@Accord Which files talk to ClickHouse?`
- `@Accord Can you show me the .env file?` (refused by design)

**Ranked change suggestions** (read-only; Accord posts a card with up to 3 approaches ranked by fit, risk, effort, testability and security, each citing the real files it would touch)
- `@Accord I need to add rate limiting so a single Slack user can't spam Accord. How should we do it?`
- `@Accord I need to make the retention period configurable per plan instead of hardcoded. Suggest the best ways to do it.`

**GitHub activity**
- `@Accord Who made the latest commit and what did it change?`
- `@Accord Who last changed the authorization code?`
- `@Accord What issues are open?` · `@Accord Are there any open pull requests?` · `@Accord Summarise PR #1.`

**Developer knowledge base** (separate from GitHub and retention evidence)
- The configured owner attaches a `.txt`, `.md`, `.csv`, `.json`, `.xml`, or Word `.docx` file and writes: `@Accord add this to the knowledge base`.
- `@Accord What do the legacy Delphi notes say about ownership?`
- `@Accord Compare the documented Pascal migration rationale with the current resolver code.`
- `@Accord What documents are available in the knowledge base?`

Accord extracts and redacts text, stores only that text in PostgreSQL, and returns bounded results cited by document name and chunk number. It does not treat uploaded text as instructions, and uploaded knowledge never changes a retention decision or finding. Uploading is owner-only to prevent an arbitrary channel participant from poisoning the shared knowledge base.

**Licence and cost scenarios** (separate structured PostgreSQL inventory)
- `@Accord List active licences for Figma.`
- `@Accord What would the recurring cost be if we removed the three licences you just listed?`

An administrator or approved ETL loads `accord_license_inventory`; Slack can only list and estimate from those scoped rows. Accord never stores licence keys, cancels subscriptions, edits inventory, combines currencies, or invents contract/proration/tax assumptions.

Only the configured owner (`ACCORD_OWNER_SLACK_USER_ID`) can confirm a decision; the same message from anyone else is recorded as a candidate. Code, GitHub, knowledge-base and licence answers are exploration, not Accord findings.

## Troubleshooting

| Symptom | Cause and fix |
|---|---|
| Bridge exits: `Realtime Gateway Channel scope requires a lowercase kebab-case channelName` | `CHANNEL_CODE` holds an id (`channel_…`). Use the Channel Code from `npm run channel:status` (step 3b). |
| `npm run channel:status` says *not signed in* / *no hosted Intelligence project* | Run `npx copilotkit@latest login`, then `npx copilotkit@latest project select --project <slug>`. |
| Worker prints *You must login to continue* | Run `npx trigger.dev@4.5.16 login` once. |
| `docker: command not found` / `Cannot connect to the Docker daemon` | Start Docker Desktop, or `colima start`. |
| `error getting credentials - docker-credential-desktop` (Colima) | Remove the `"credsStore": "desktop"` line from `~/.docker/config.json`. |
| `role "accord_admin" does not exist` | Another PostgreSQL owns port 5432. See the note in step 5. |
| `demo:preflight` shows `MISSING ClickHouse endpoint` | ClickHouse isn't running: `docker compose -f infra/compose.yaml up -d clickhouse`. |
| Model errors `503 … high demand` | That Gemini model is overloaded. Use `ACCORD_MODEL=gemini-3-flash-preview` (or another model your key lists) and restart both tabs. |
| `429 RESOURCE_EXHAUSTED … free_tier_requests, limit: 20` | The Gemini free tier allows only a small number of requests **per model per day**, and every Slack message uses several (interpretation, agent steps, investigation). Switch to another model with its own quota (e.g. `gemini-3.1-flash-lite`) and restart both tabs, or enable billing on the Google AI Studio project before a demo. |
| Replies are slow | Keep `ACCORD_MODEL_REASONING_EFFORT=low`. The first question after a restart also downloads the repository once (a few seconds). |
| Finding says *Investigation incomplete … unsupported runtime* | The repository at `ACCORD_REPO_REF` must contain an unmodified `fixtures/retention-app/` (it is checked against committed checksums), and `GITHUB_TOKEN` must be able to read it. |
| Nothing happens in Slack | The bot must be in the channel (`/invite @Accord`), the message must be in `ACCORD_SLACK_CHANNEL_ID` and must @mention the bot, and both tabs must be running. `curl -s localhost:3000/health` should be healthy. |
| A decision stays a *candidate* | Only `ACCORD_OWNER_SLACK_USER_ID` can confirm. Check it is your member ID. |

## Reference

### Commands

| Command | Purpose |
|---|---|
| `npm ci` | Install dependencies |
| `npm run verify` | Typecheck and offline tests (no credentials) |
| `npm run dev:up` / `npm run dev:down` | Start / stop local PostgreSQL and ClickHouse |
| `npm run db:migrate` | Apply the PostgreSQL schema |
| `npm run demo:seed` | Seed the immutable ClickHouse demo dataset |
| `npm run demo:preflight` | Check configuration and services without printing values |
| `npm run dev:worker` | Trigger.dev worker |
| `npm run dev:slack` | Slack bridge |
| `npm run channel:status` | CopilotKit channel status |
| `npm run test:integration` | Real PostgreSQL and ClickHouse suites |
| `npm run test:live` | Real provider checks, then the live end-to-end check |
| `npm run demo:prepare-prs` | Prepare demo scenario branches (dry run unless `--apply-local`; pushes only with `--push`) |
| `npm run review:evidence` | Sanitized evidence manifest |

### Knowledge base and licence inventory

Run `npm run db:migrate` after updating Accord to create the knowledge and inventory tables. Knowledge documents and commercial inventory are deliberately separate:

| PostgreSQL table | Contents | Who writes it | What Slack can do |
|---|---|---|---|
| `accord_knowledge_documents` / `accord_knowledge_chunks` | Redacted extracted developer documentation, scoped to one team/channel | Configured owner through an explicit Slack attachment upload | List/search and cite excerpts |
| `accord_license_inventory` | Vendor, product, SKU, seat count, cost, currency, renewal/status—never licence keys | Administrator or approved ETL | List inventory and estimate removal cost |

The upload flow accepts text-based files and Word `.docx` up to 5 MiB. Unsupported formats, unreadable content, and oversized documents are rejected visibly; they are not silently indexed. Search is lexical and bounded, so it is transparent and does not require sending private documents to an embedding provider.

### Slack semantic knowledge graph

Accord also builds a separate **knowledge graph for Slack**. Each human message observed in the configured channel is normalized and redacted before a durable PostgreSQL queue stores it. The worker claims queue rows every minute, sends only that redacted message text to the configured embedding provider, and writes a 768-dimensional `pgvector` embedding. Graph nodes represent threads and messages; edges represent thread membership, reply chronology, and only high-confidence semantic neighbours. This enables `search_slack_thread_knowledge` to find a relevant historical discussion even when its wording differs from the question, then `inspect_slack_thread_knowledge` to show the bounded source messages and graph links.

The graph is strictly scoped by Slack team and channel, is read-only from the agent, and is never used as retention-policy evidence. It covers messages observed after deployment. To queue historical channel history after migration, an operator can run `npm run semantic:backfill -- --max=1000`; it is read-only against Slack, redacts before queueing, and never sends message text to the embedding provider itself. Re-run with a larger bound if needed. Ordinary Slack runtime traffic is never blocked while an embedding is generated. Local development uses `pgvector/pgvector:0.8.6-pg17`; a production PostgreSQL instance must have the `vector` extension installed before `npm run db:migrate`.

### Model configuration

Accord defaults to Google AI Studio through Google's OpenAI-compatible endpoint with structured JSON output; no OpenAI credit is required. Set `ACCORD_MODEL_PROVIDER=google`, `GOOGLE_API_KEY` and `ACCORD_MODEL` (for example `gemini-3-flash-preview` or `gemini-3.5-flash`), and keep `MODEL_PROVIDER`/`MODEL` consistent for the Slack agent. `ACCORD_MODEL_REASONING_EFFORT` (optional: `minimal`, `low`, `medium`, `high`) trades depth for speed; `low` brings decision interpretation from roughly 12 s to 2–5 s.

To use OpenAI instead, set `ACCORD_MODEL_PROVIDER=openai`, `MODEL_PROVIDER=openai`, an OpenAI `ACCORD_MODEL`/`MODEL`, and `OPENAI_API_KEY`. Run the provider suite with `node --env-file=.env tools/live.mjs`; provider tests do not establish a complete Slack end-to-end pass.

### Synthetic retention demonstration

The immutable `accord-demo-2026-09-12` fixture has six accounts and 19 records at the fixed clock. The owner confirms: “Free accounts with verified university status should retain existing records for 90 days, starting now.” Baseline behavior selects 17 records, including 9 in scope; the intended policy selects 10 total and 2 in scope. The difference is 7 prematurely selected records across 2 accounts. No cleanup is ever performed.

For a two-minute demo: show the enrolled owner decision, the conflict finding and aggregate query evidence, mark it tentative, link a UI-only PR (still conflicting), then link a source-and-generated correct PR (verified at its commit; deployment remains unverified). Scenario branches/PRs are created only with the explicit `--apply-local`/`--push` operator flags.

### Security notes

- `.env` holds live credentials: never commit it, and rotate any key that was ever committed.
- The ClickHouse admin identity is for seeding only; the bridge and worker use the restricted `accord_runtime` role, which can read only `accord_retention_view`.
- Repository reads refuse `.env`-style files, key files and other secret-bearing paths, and redact credential-shaped text before the model sees it. GitHub access is read-only.

### Verification status

`npm run verify` covers contracts, package unit tests, the Slack bridge (including the repository and GitHub tools with a stubbed API), query parameterization, audience/path rejection, redaction and safe logging. Real ClickHouse, PostgreSQL, GitHub, model, Trigger and Slack behaviour is exercised by running the steps above; `npm run test:integration` and `npm run test:live` are the recorded credentialed checks, and a capability should not be described as passed until those complete. `scripts/review-evidence.ts` creates a sanitized manifest that leaves unrecorded checks pending.

### Provenance

The repository began from CopilotKit’s `agents-everywhere-starter-kit` at `6443333e4b81fd6e21a4f531bdeee3a71eccd7b5`; its MIT license remains. The inherited web/mobile examples are not Accord features. Accord’s build specification and acceptance rubric live in [`docs/build-spec/`](docs/build-spec/00-START-HERE.md).
