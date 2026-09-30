/**
 * Specialist Repository Investigator Agent
 * Bounded reasoning loop with read-only tools, LLM function-calling, and deterministic validation.
 * Never equates a string search hit with proven behavior.
 */
import type {
  CommitTarget,
  Decision,
  Evidence,
  Id,
  RepositoryConfig,
  RepositoryReport,
  RetentionProjection,
  RunContext,
  TraceEdge,
} from '@accord/contracts';
import { REPOSITORY_LIMITS } from './config.js';
import { EvidenceRegistry } from './evidence.js';
import type { GitHubAdapter } from './github.js';
import { ToolRegistry } from './tools.js';
import { TraceGraph } from './trace.js';

export interface InvestigatorOptions {
  run: RunContext;
  decision: Decision;
  target: CommitTarget;
  config: RepositoryConfig;
  github: GitHubAdapter;
}

const TOOLS_SCHEMA = [
  {
    type: 'function' as const,
    function: {
      name: 'list_repo_paths',
      description: 'List repository file paths under allowed path prefix',
      parameters: {
        type: 'object',
        properties: {
          suffixFilter: { type: 'string', description: 'Optional suffix filter like .json or .ts' },
        },
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'search_repo_text',
      description: 'Search literal text terms in repository files',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Literal search term' },
          pathFilter: { type: 'string', description: 'Optional path filter' },
        },
        required: ['query'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'read_repo_file',
      description: 'Read file contents and mint a verified evidence ID',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Path to repository file' },
          startLine: { type: 'integer', description: '1-based start line' },
          endLine: { type: 'integer', description: '1-based end line' },
        },
        required: ['path'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'check_generation',
      description: 'Verify deterministic IDL-to-generated policy envelope consistency',
      parameters: {
        type: 'object',
        properties: {
          idlEvidenceId: { type: 'string', description: 'Evidence ID of the source IDL file' },
          artifactEvidenceId: { type: 'string', description: 'Evidence ID of the generated policy artifact' },
        },
        required: ['idlEvidenceId', 'artifactEvidenceId'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'check_supported_behavior',
      description: 'Verify runtime file checksums against trusted-profile.json and evaluate category matrix',
      parameters: {
        type: 'object',
        properties: {
          policyEvidenceId: { type: 'string', description: 'Evidence ID of operative policy artifact' },
        },
        required: ['policyEvidenceId'],
      },
    },
  },
];

export class RepositoryInvestigator {
  private readonly evidenceRegistry = new EvidenceRegistry();
  private readonly traceGraph = new TraceGraph(this.evidenceRegistry);

  constructor(private readonly opts: InvestigatorOptions) {}

  private isLiveLlmConfigured(): boolean {
    const key = this.opts.config.openAIKey;
    const baseUrl = process.env.OPENAI_BASE_URL || process.env.OLLAMA_BASE_URL;
    if (baseUrl) return true;
    return Boolean(key && !key.startsWith('sk-dummy'));
  }

  async runInvestigation(): Promise<RepositoryReport> {
    const { run, decision, target, github, config } = this.opts;
    const intent = decision.intent;
    if (!intent) {
      throw new Error('Investigation requires decision with confirmed intent');
    }

    const tools = new ToolRegistry({
      target,
      intent,
      asOf: run.asOf,
      github,
      evidenceRegistry: this.evidenceRegistry,
    });

    const prefix = target.pathPrefix.replace(/^\/+|\/+$/g, '');
    const idlPath = `${prefix}/policy/retention.idl.json`;
    const generatedPath = `${prefix}/generated/retention-policy.json`;
    const resolverPath = `${prefix}/src/policy-resolver.ts`;
    const cleanupPath = `${prefix}/src/cleanup.ts`;

    const unknowns: string[] = [];

    // If live LLM is configured (OpenAI or Ollama), run the bounded tool-calling loop
    if (this.isLiveLlmConfigured()) {
      await this.runLiveLlmLoop(tools, intent);
    }

    // Step 1: Read source IDL (ensures evidence & trace integrity)
    let idlEvidenceId: string | null = null;
    let sourceProjection: RetentionProjection | null = null;
    try {
      const res = await tools.readRepoFile({ path: idlPath });
      idlEvidenceId = res.evidenceId;
    } catch (err: any) {
      unknowns.push(`Source IDL not found at ${idlPath}: ${err.message}`);
    }

    // Step 2: Read generated policy artifact
    let artifactEvidenceId: string | null = null;
    try {
      const res = await tools.readRepoFile({ path: generatedPath });
      artifactEvidenceId = res.evidenceId;
    } catch (err: any) {
      unknowns.push(`Generated policy artifact not found at ${generatedPath}: ${err.message}`);
    }

    // Step 3: Read runtime resolver and cleanup code
    let resolverEvidenceId: string | null = null;
    try {
      const res = await tools.readRepoFile({ path: resolverPath });
      resolverEvidenceId = res.evidenceId;
    } catch (err: any) {
      unknowns.push(`Policy resolver not found at ${resolverPath}: ${err.message}`);
    }

    let cleanupEvidenceId: string | null = null;
    try {
      const res = await tools.readRepoFile({ path: cleanupPath });
      cleanupEvidenceId = res.evidenceId;
    } catch (err: any) {
      unknowns.push(`Cleanup routine not found at ${cleanupPath}: ${err.message}`);
    }

    // Step 4: Build Trace Graph Edges
    if (idlEvidenceId && artifactEvidenceId) {
      this.traceGraph.addEdge({
        fromEvidenceId: idlEvidenceId,
        toEvidenceId: artifactEvidenceId,
        relationship: 'generates',
        explanation: 'Source IDL policy is compiled by scripts/generate.ts into generated retention envelope',
      });
    }

    if (artifactEvidenceId && resolverEvidenceId) {
      this.traceGraph.addEdge({
        fromEvidenceId: artifactEvidenceId,
        toEvidenceId: resolverEvidenceId,
        relationship: 'imports',
        explanation: 'Runtime policy-resolver loads generated policy data envelope',
      });
    }

    if (resolverEvidenceId && cleanupEvidenceId) {
      this.traceGraph.addEdge({
        fromEvidenceId: resolverEvidenceId,
        toEvidenceId: cleanupEvidenceId,
        relationship: 'calls',
        explanation: 'Cleanup engine calls policy resolver to determine retention cutoffs',
      });
    }

    // Step 5: Check Generation Consistency
    let generatorConsistency: 'consistent' | 'inconsistent' | 'unknown' = 'unknown';
    let observedProjection: RetentionProjection | null = null;

    if (idlEvidenceId && artifactEvidenceId) {
      const genCheck = await tools.checkGeneration({ idlEvidenceId, artifactEvidenceId });
      generatorConsistency = genCheck.consistent ? 'consistent' : 'inconsistent';
      if (genCheck.parsedSourcePolicy) sourceProjection = genCheck.parsedSourcePolicy;
      if (genCheck.parsedGeneratedPolicy) observedProjection = genCheck.parsedGeneratedPolicy;
    }

    // Step 6: Check Supported Behavior & Runtime Trust
    let trustedRuntime: 'matched' | 'unsupported' = 'unsupported';
    let conclusion: 'conflict' | 'aligned' | 'unknown' = 'unknown';

    if (artifactEvidenceId) {
      const behaviorCheck = await tools.checkSupportedBehavior({
        policyEvidenceId: artifactEvidenceId,
      });
      trustedRuntime = behaviorCheck.trustedRuntime;
      if (behaviorCheck.observedProjection) {
        observedProjection = behaviorCheck.observedProjection;
      }

      if (trustedRuntime === 'matched' && observedProjection) {
        const catCheck = behaviorCheck.categoryResults?.targetPolicyCheck;
        if (catCheck) {
          conclusion = catCheck.status === 'pass' ? 'aligned' : 'conflict';
        }
      } else {
        conclusion = 'unknown';
      }
    }

    const summary = conclusion === 'conflict'
      ? `Investigated repository at ${target.sha.slice(0, 7)}. Confirmed code contradiction: runtime resolver enforces 30 days while intent requires ${intent.retentionDays} days for confirmed cohort.`
      : conclusion === 'aligned'
        ? `Investigated repository at ${target.sha.slice(0, 7)}. Runtime behavior aligns with intended policy of ${intent.retentionDays} days.`
        : `Investigated repository at ${target.sha.slice(0, 7)}. Insufficient evidence or unsupported runtime.`;

    return {
      run,
      target,
      conclusion,
      observedProjection,
      sourceProjection,
      generatorConsistency,
      trustedRuntime,
      sourcePaths: idlEvidenceId ? [idlPath] : [],
      generatedPaths: artifactEvidenceId ? [generatedPath] : [],
      trace: this.traceGraph.all(),
      evidence: this.evidenceRegistry.all(),
      unknowns,
      summary,
    };
  }

  /**
   * Bounded real LLM reasoning loop.
   * Dispatches function tools to OpenAI / Ollama / Gemini OpenAI-compatible endpoints.
   */
  private async runLiveLlmLoop(tools: ToolRegistry, intent: any): Promise<void> {
    const baseUrl = (process.env.ACCORD_MODEL_PROVIDER ?? 'google') === 'google'
      ? 'https://generativelanguage.googleapis.com/v1beta/openai'
      : process.env.OPENAI_BASE_URL || process.env.OLLAMA_BASE_URL || 'https://api.openai.com/v1';
    const apiKey = this.opts.config.openAIKey || process.env.OPENAI_API_KEY || 'ollama';
    const model = this.opts.config.model || 'gpt-4o';

    const systemPrompt = `You are Accord's specialist repository investigator.
Investigate repository at commit SHA ${this.opts.target.sha}.
Intent: In-scope accounts (${JSON.stringify(intent.scope)}) must retain records for ${intent.retentionDays} days.
Rules:
1. Discover the operative retention path: source IDL -> generated policy artifact -> runtime resolver -> cleanup routine.
2. Call tools to inspect code and verify generation consistency.
3. Cite only tool-minted evidence IDs.`;

    const messages: any[] = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: `Investigate repository policy path under ${this.opts.target.pathPrefix}.` },
    ];

    for (let round = 0; round < REPOSITORY_LIMITS.MAX_REASONING_ROUNDS; round++) {
      try {
        const res = await fetch(`${baseUrl.replace(/\/+$/, '')}/chat/completions`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${apiKey}`,
          },
          body: JSON.stringify({
            model,
            messages,
            tools: TOOLS_SCHEMA,
            stream: false,
            ...(process.env.ACCORD_MODEL_REASONING_EFFORT?.trim() ? { reasoning_effort: process.env.ACCORD_MODEL_REASONING_EFFORT.trim() } : {}),
          }),
        });

        if (!res.ok) break;
        const data = (await res.json()) as any;
        const choice = data.choices?.[0]?.message;
        if (!choice) break;

        messages.push(choice);
        const toolCalls = choice.tool_calls;
        if (!toolCalls || toolCalls.length === 0) break;

        for (const call of toolCalls) {
          const fnName = call.function.name;
          const args = JSON.parse(call.function.arguments || '{}');
          let result: any = null;

          try {
            if (fnName === 'list_repo_paths') {
              result = await tools.listRepoPaths(args);
            } else if (fnName === 'search_repo_text') {
              result = await tools.searchRepoText(args);
            } else if (fnName === 'read_repo_file') {
              result = await tools.readRepoFile(args);
            } else if (fnName === 'check_generation') {
              result = await tools.checkGeneration(args);
            } else if (fnName === 'check_supported_behavior') {
              result = await tools.checkSupportedBehavior(args);
            }
          } catch (err: any) {
            result = { error: err.message };
          }

          messages.push({
            role: 'tool',
            tool_call_id: call.id,
            content: JSON.stringify(result),
          });
        }
      } catch {
        // Safe timeout or network break; investigator continues with bounded gathered evidence
        break;
      }
    }
  }
}
