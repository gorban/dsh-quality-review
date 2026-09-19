/**
 * Plugin configuration schema (Standard-Schema via schemastery).
 *
 * Every field has a safe default so the bundle row can be inserted with no
 * `config` at all; profile layers override individual keys.
 */
import Schema from '@deepseek-ai/schemastery';

export interface QualityReviewConfig {
  /** Master switch; when false the plugin listens but never reviews. */
  enabled: boolean;
  /** Reviewer model route; empty strings mean "reuse the agent's own route". */
  reviewer: {
    provider: string;
    model: string;
  };
  /** Maximum steered review follow-ups per assistant turn (loop guard). */
  maxRounds: number;
  /** Review dimensions written into the reviewer prompt. */
  aspects: {
    factualAccuracy: boolean;
    completeness: boolean;
    logicalConsistency: boolean;
    instructionFollowing: boolean;
  };
  /** Reviewer call limits. */
  review: {
    maxTokens: number;
    temperature: number;
    timeoutMs: number;
  };
  /**
   * Minimum character length of the assistant's visible reply that makes a
   * turn worth reviewing — trivially short replies are skipped.
   */
  minReplyChars: number;
  /**
   * Common-task exemption keywords: when the user prompt contains any of these
   * (case-insensitive substring match), the turn is skipped entirely. Use it
   * to let routine SOP-style tasks through without a review, so the auditor
   * never nags on a well-understood workflow.
   */
  exemptPatterns: string[];
  /**
   * SOP folder reference standards: a directory the user can keep dropping
   * task standard files into. Each file name (extension stripped) matches a
   * related task; the matched file's *content* is handed to the reviewer as
   * the quality standard the answer is checked against. `dir` empty means the
   * default folder under DSH_HOME.
   */
  sop: {
    enabled: boolean;
    dir: string;
  };
}

const Config: Schema<QualityReviewConfig> = Schema.object({
  enabled: Schema.boolean()
    .default(true)
    .description('Master switch; when off, the plugin stays loaded but performs no review.'),
  reviewer: Schema.object({
    provider: Schema.string()
      .default('')
      .description('Reviewer model provider id; leave empty to reuse the provider of this agent.'),
    model: Schema.string()
      .default('')
      .description('Reviewer model id; leave empty to reuse the model of this agent.'),
  })
    .default({})
    .description('Independent reviewer model route; defaults to reusing the model of the session.'),
  maxRounds: Schema.natural()
    .max(5)
    .default(2)
    .description('Upper bound on revision rounds per answer (loop guard); defaults to 2.'),
  aspects: Schema.object({
    factualAccuracy: Schema.boolean().default(true).description('Factual accuracy: check for clear factual errors and fabricated information.'),
    completeness: Schema.boolean().default(true).description('Completeness: check whether any part of the user question was left unanswered.'),
    logicalConsistency: Schema.boolean().default(true).description('Logical consistency: check for contradictory reasoning and unsupported conclusions.'),
    instructionFollowing: Schema.boolean().default(true).description('Instruction following: check for violations of the format, language, and constraints the user explicitly set.'),
  })
    .default({})
    .description('Review aspect switches.'),
  review: Schema.object({
    maxTokens: Schema.natural().default(2048).description('Output token limit for review requests.'),
    temperature: Schema.number().min(0).max(2).default(0.1).description('Sampling temperature for review requests; a low value keeps verdicts stable.'),
    timeoutMs: Schema.natural().default(120_000).description('Review request timeout (milliseconds).'),
  })
    .default({})
    .description('Review call limits.'),
  minReplyChars: Schema.natural()
    .default(200)
    .description('Replies shorter than this many characters are not reviewed, avoiding overreaction to small talk.'),
  exemptPatterns: Schema.array(Schema.string())
    .default([])
    .description('Routine-task exemption: skip review when the user prompt contains any of these keywords (for recurring SOP tasks, to avoid false positives).'),
  sop: Schema.object({
    enabled: Schema.boolean()
      .default(true)
      .description('Enable SOP standards reference: read files whose names match the task from a folder and inject their content as the quality standard for that task.'),
    dir: Schema.string()
      .default('')
      .description('SOP folder path; leave empty to use the default directory DSH_HOME/quality-review/sop.'),
  })
    .default({})
    .description('Routine-task SOP standards reference.'),
});

export default Config;
