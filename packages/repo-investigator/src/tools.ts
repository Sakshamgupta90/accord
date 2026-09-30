/**
 * Specialist Repository Investigator Tools
 * Provides the 6 bounded tools exposed to the LLM investigator.
 */
import {
  parseRetentionPolicy,
  verifyGeneratorConsistency,
} from '@accord/retention-fixture';
import type { CommitTarget, Evidence, PolicyIntent, RetentionProjection } from '@accord/contracts';
import { REPOSITORY_LIMITS } from './config.js';
import type { EvidenceRegistry } from './evidence.js';
import type { GitHubAdapter } from './github.js';
import { verifyAgainstTrustedProfile } from './trust/profile.js';
import { evaluateCategoryMatrix } from './trust/projection.js';

export interface ToolContext {
  target: CommitTarget;
  intent: PolicyIntent;
  asOf: string;
  github: GitHubAdapter;
  evidenceRegistry: EvidenceRegistry;
}

export class ToolRegistry {
  constructor(private readonly ctx: ToolContext) {}

  async listRepoPaths(params: { suffixFilter?: string }): Promise<{ paths: string[]; truncated: boolean }> {
    const paths = await this.ctx.github.listAllowedPaths(this.ctx.target, params.suffixFilter);
    const truncated = paths.length >= REPOSITORY_LIMITS.MAX_ALLOWED_FILES;
    return { paths, truncated };
  }

  async searchRepoText(params: { query: string; pathFilter?: string }): Promise<{
    hits: Array<{ path: string; line: number; text: string }>;
    totalHits: number;
  }> {
    const paths = await this.ctx.github.listAllowedPaths(this.ctx.target, params.pathFilter);
    const hits: Array<{ path: string; line: number; text: string }> = [];

    for (const path of paths) {
      if (hits.length >= REPOSITORY_LIMITS.MAX_SEARCH_HITS_PER_QUERY) break;
      const content = await this.ctx.github.readFile(this.ctx.target, path);
      const lines = content.split('\n');
      for (let i = 0; i < lines.length; i++) {
        if (lines[i]!.includes(params.query)) {
          hits.push({
            path,
            line: i + 1,
            text: lines[i]!.trim(),
          });
          if (hits.length >= REPOSITORY_LIMITS.MAX_SEARCH_HITS_PER_QUERY) break;
        }
      }
    }

    return { hits, totalHits: hits.length };
  }

  async readRepoFile(params: { path: string; startLine?: number; endLine?: number }): Promise<{
    evidenceId: string;
    path: string;
    startLine: number;
    endLine: number;
    content: string;
    locator: string;
  }> {
    const fullContent = await this.ctx.github.readFile(this.ctx.target, params.path);
    const lines = fullContent.split('\n');
    const totalLines = lines.length;

    const startLine = Math.max(1, params.startLine || 1);
    const endLine = Math.min(totalLines, params.endLine || totalLines);

    if (startLine > endLine) {
      throw new Error(`readRepoFile: startLine (${startLine}) cannot be greater than endLine (${endLine})`);
    }

    const slice = lines.slice(startLine - 1, endLine);
    const numberedContent = slice
      .map((line, idx) => `${startLine + idx}: ${line}`)
      .join('\n');

    const evidence = this.ctx.evidenceRegistry.mint({
      kind: params.path.endsWith('.md') ? 'guidance' : 'code',
      summary: `Read lines ${startLine}-${endLine} of ${params.path}`,
      repository: this.ctx.target.repository,
      commitSha: this.ctx.target.sha,
      path: params.path,
      startLine,
      endLine,
      rawExcerpt: slice.join('\n'),
    });

    return {
      evidenceId: evidence.id,
      path: params.path,
      startLine,
      endLine,
      content: numberedContent,
      locator: evidence.locator,
    };
  }

  async checkGeneration(params: {
    idlEvidenceId: string;
    artifactEvidenceId: string;
  }): Promise<{
    consistent: boolean;
    reason?: string | undefined;
    parsedSourcePolicy?: RetentionProjection | undefined;
    parsedGeneratedPolicy?: RetentionProjection | undefined;
  }> {
    const idlEv = this.ctx.evidenceRegistry.get(params.idlEvidenceId);
    if (!idlEv) {
      throw new Error(`checkGeneration: IDL evidence ID ${params.idlEvidenceId} not found`);
    }

    const artEv = this.ctx.evidenceRegistry.get(params.artifactEvidenceId);
    if (!artEv) {
      throw new Error(`checkGeneration: Artifact evidence ID ${params.artifactEvidenceId} not found`);
    }

    try {
      const sourceJson = JSON.parse(idlEv.excerpt);
      const artifactJson = JSON.parse(artEv.excerpt);

      const sourcePolicy = parseRetentionPolicy(sourceJson);
      const consistency = verifyGeneratorConsistency(sourcePolicy, artifactJson);

      return {
        consistent: consistency.consistent,
        reason: consistency.reason,
        parsedSourcePolicy: sourcePolicy,
        parsedGeneratedPolicy: artifactJson.policy ? parseRetentionPolicy(artifactJson.policy) : undefined,
      };
    } catch (err: any) {
      return {
        consistent: false,
        reason: `JSON parsing or schema error during generation check: ${err.message}`,
      };
    }
  }

  async checkSupportedBehavior(params: {
    policyEvidenceId: string;
    runtimeFilePaths?: string[];
  }): Promise<{
    trustedRuntime: 'matched' | 'unsupported';
    categoryResults: any;
    observedProjection: RetentionProjection | null;
  }> {
    const polEv = this.ctx.evidenceRegistry.get(params.policyEvidenceId);
    if (!polEv) {
      throw new Error(`checkSupportedBehavior: Policy evidence ID ${params.policyEvidenceId} not found`);
    }

    // 1. Fetch runtime files for trusted checksum checking
    const prefix = this.ctx.target.pathPrefix.replace(/^\/+|\/+$/g, '');
    const pathsToCheck = params.runtimeFilePaths || [
      `${prefix}/src/policy-resolver.ts`,
      `${prefix}/src/cleanup.ts`,
      `${prefix}/scripts/generate.ts`,
      `${prefix}/src/display-policy.ts`,
      `${prefix}/src/index.ts`,
    ];

    const fetchedMap = new Map<string, string>();
    for (const p of pathsToCheck) {
      try {
        const content = await this.ctx.github.readFile(this.ctx.target, p);
        fetchedMap.set(p, content);
      } catch {
        // Missing runtime files lead to trust check failure
      }
    }

    const trust = verifyAgainstTrustedProfile(fetchedMap);
    const trustedRuntime = trust.matched ? 'matched' : 'unsupported';

    // 2. Parse observed projection
    let observedProjection: RetentionProjection | null = null;
    try {
      const parsedRaw = JSON.parse(polEv.excerpt);
      const policyData = parsedRaw.policy || parsedRaw;
      observedProjection = parseRetentionPolicy(policyData);
    } catch {
      // If parsing fails, observed projection is null
    }

    // 3. Category matrix checks
    const baselineProjection: RetentionProjection = {
      schemaVersion: 1,
      defaultDays: 30,
      rules: [],
    };

    let categoryResults = null;
    if (observedProjection) {
      categoryResults = evaluateCategoryMatrix(
        observedProjection,
        baselineProjection,
        this.ctx.intent,
        this.ctx.asOf
      );
    }

    return {
      trustedRuntime,
      categoryResults,
      observedProjection,
    };
  }
}
