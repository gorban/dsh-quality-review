/**
 * Reviewer core: renders the audit prompt, calls the reviewer model through
 * the host `ctx.llm` streaming service, and parses the verdict.
 *
 * The reviewer answers with a strict JSON object:
 *   { "pass": boolean, "issues": [ { "aspect", "problem", "suggestion" } ] }
 *
 * Parsing is defensive: the first JSON object in the reply wins, and any
 * malformed or missing verdict degrades to "pass" so a flaky reviewer never
 * wedges the agent loop.
 */
import type { QualityReviewConfig } from './config.js';
import { renderSopReference } from './sop.js';
import type { SopStandard } from './sop.js';

export interface ReviewIssue {
  aspect: string;
  problem: string;
  suggestion: string;
}

export interface ReviewVerdict {
  pass: boolean;
  issues: ReviewIssue[];
  /** Raw reviewer text, kept for logging. */
  raw: string;
}

export interface ReviewRequest {
  /** The user's latest prompt (best effort; may be empty). */
  userPrompt: string;
  /** The assistant reply under review (visible text only). */
  assistantReply: string;
  /** Which review round this is, 1-based; fed to the prompt for context. */
  round: number;
  maxRounds: number;
  /** SOP standards (all files once a match triggers) used as the reference benchmark. */
  sopStandards?: SopStandard[];
}

export interface LlmStreamLike {
  stream(request: {
    provider: string;
    model: string;
    messages: unknown[];
    system?: string;
    maxTokens?: number;
    temperature?: number;
    signal?: AbortSignal;
  }): AsyncIterable<unknown>;
}

export interface ReviewerRoute {
  provider: string;
  model: string;
}

export class ReviewError extends Error {}

const SYSTEM_PROMPT = `You are a strict, critical, but fair reviewer of AI answer quality. Your job is to review the final answer another AI assistant gave to a user's question.

Judge only by the review aspects enabled below; any aspect may be switched off, and you must not comment on a disabled aspect.

Decision criteria:
- Fail an answer only when it has a **clear, substantive** problem. Stylistic preferences and optional improvements are not grounds for failure.
- When you are unsure whether something is true, pass it — better to miss a problem than to flag an innocent answer.
- Your output is parsed by a program: emit exactly one JSON object, with no other text, explanation, or Markdown code fence.

Output format (strictly):
{"pass": true}
or
{"pass": false, "issues": [{"aspect": "<aspect name>", "problem": "<what the concrete problem is>", "suggestion": "<how it should be fixed>"}]}

The issues array lists substantive problems only, and each entry must be specific enough to act on directly.`;

function enabledAspects(config: QualityReviewConfig): string[] {
  const labels: Array<[keyof QualityReviewConfig['aspects'], string, string]> = [
    ['factualAccuracy', 'Factual accuracy', 'Whether the answer contains clear factual errors, or fabricated citations/data/concepts'],
    ['completeness', 'Completeness', 'Whether it fully answers every part of the question the user asked, or omits key points'],
    ['logicalConsistency', 'Logical consistency', 'Whether the reasoning contradicts itself, and whether the conclusions follow from the evidence'],
    ['instructionFollowing', 'Instruction following', 'Whether it violated any format, language, length, or other constraint the user explicitly set'],
  ];
  return labels
    .filter(([key]) => config.aspects[key])
    .map(([, name, desc]) => `- ${name}: ${desc}`);
}

export function renderReviewPrompt(request: ReviewRequest, config: QualityReviewConfig): string {
  const sopStandards = Array.isArray(request.sopStandards)
    ? request.sopStandards.filter((standard) => standard.content !== '')
    : [];
  const hasSop = sopStandards.length > 0;
  const aspects = enabledAspects(config);
  if (hasSop) {
    aspects.push('- SOP compliance: whether the answer follows the quality standard for this task, with no omissions, deviations, or violations');
  }
  const aspectBlock = aspects.length > 0 ? aspects.join('\n') : '- Overall quality: whether the answer is reasonable, credible, and useful';
  const sopBlock = hasSop
    ? `\n[Quality standard for this task (SOP)]\n${renderSopReference(sopStandards)}\n`
    : '';
  return `Review the quality of the following AI assistant answer.

[Enabled review aspects]
${aspectBlock}
${sopBlock}
[The user's question]
${request.userPrompt.trim() === '' ? '(the original text was unavailable; judge by the answer itself)' : request.userPrompt}

[The AI assistant's answer]
${request.assistantReply}

[Review round] ${request.round} of ${request.maxRounds}${request.round > 1 ? ' (this answer was revised per the previous round, so check specifically whether the revision resolved the problem)' : ''}

Now give your review verdict (JSON only):`;
}

/** Accumulate a dsh-llm stream into plain text. */
async function collectText(stream: AsyncIterable<unknown>, signal: AbortSignal): Promise<string> {
  let text = '';
  for await (const chunk of stream) {
    signal.throwIfAborted();
    const c = chunk as { type?: string; text?: string; reason?: { kind: string; failure?: { message: string } } };
    if (c.type === 'text-delta' && typeof c.text === 'string') text += c.text;
    else if (c.type === 'finish' && c.reason && (c.reason.kind === 'error' || c.reason.kind === 'aborted')) {
      throw new ReviewError(`reviewer call failed: ${c.reason.kind}: ${c.reason.failure?.message ?? 'unknown'}`);
    }
  }
  return text;
}

/** Extract the first balanced JSON object from arbitrary text. */
export function extractJsonObject(text: string): string | undefined {
  const start = text.indexOf('{');
  if (start < 0) return undefined;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return undefined;
}

function normalizeIssue(value: unknown): ReviewIssue | undefined {
  if (typeof value !== 'object' || value === null) return undefined;
  const v = value as Record<string, unknown>;
  const problem = typeof v.problem === 'string' ? v.problem.trim() : '';
  if (problem === '') return undefined;
  return {
    aspect: typeof v.aspect === 'string' && v.aspect.trim() !== '' ? v.aspect.trim() : 'Overall',
    problem,
    suggestion: typeof v.suggestion === 'string' ? v.suggestion.trim() : '',
  };
}

export function parseVerdict(raw: string): ReviewVerdict {
  const json = extractJsonObject(raw);
  if (json === undefined) return { pass: true, issues: [], raw };
  try {
    const parsed = JSON.parse(json) as Record<string, unknown>;
    if (parsed.pass !== false) return { pass: true, issues: [], raw };
    const issues = Array.isArray(parsed.issues)
      ? parsed.issues.map(normalizeIssue).filter((i): i is ReviewIssue => i !== undefined)
      : [];
    // A fail verdict without any actionable issue cannot be fixed — treat as pass.
    if (issues.length === 0) return { pass: true, issues: [], raw };
    return { pass: false, issues, raw };
  } catch {
    return { pass: true, issues: [], raw };
  }
}

export class Reviewer {
  constructor(
    private readonly llm: LlmStreamLike,
    private readonly route: ReviewerRoute,
    private readonly config: QualityReviewConfig,
  ) {}

  async review(request: ReviewRequest, signal?: AbortSignal): Promise<ReviewVerdict> {
    const timeout = AbortSignal.timeout(this.config.review.timeoutMs);
    const combined = signal !== undefined ? AbortSignal.any([signal, timeout]) : timeout;
    const stream = this.llm.stream({
      provider: this.route.provider,
      model: this.route.model,
      messages: [
        {
          role: 'user',
          content: [{ type: 'text', text: renderReviewPrompt(request, this.config) }],
        },
      ],
      system: SYSTEM_PROMPT,
      maxTokens: this.config.review.maxTokens,
      temperature: this.config.review.temperature,
      signal: combined,
    });
    const raw = await collectText(stream, combined);
    return parseVerdict(raw);
  }
}

/** Render the steered follow-up message sent back to the agent. */
export function renderFixRequest(verdict: ReviewVerdict, round: number, maxRounds: number): string {
  const items = verdict.issues
    .map((issue, index) => {
      const suggestion = issue.suggestion === '' ? '' : `\n   Suggestion: ${issue.suggestion}`;
      return `${index + 1}. [${issue.aspect}] ${issue.problem}${suggestion}`;
    })
    .join('\n');
  const tail =
    round >= maxRounds
      ? '\n\nThis is your last chance to revise: do your best to fix each point, and if something genuinely cannot be fixed, briefly explain why.'
      : '';
  return `[Quality review] Your previous answer failed review (round ${round}/${maxRounds}) with ${verdict.issues.length} issue(s):\n\n${items}\n\nRevise your answer to address the points above: give the corrected complete answer directly, without arguing or restating the review.${tail}`;
}
