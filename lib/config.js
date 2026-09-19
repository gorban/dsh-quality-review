/**
 * Plugin configuration schema (Standard-Schema via schemastery).
 *
 * Every field has a safe default so the bundle row can be inserted with no
 * `config` at all; profile layers override individual keys.
 */
import Schema from '@deepseek-ai/schemastery';
const Config = Schema.object({
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
//# sourceMappingURL=config.js.map