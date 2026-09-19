import Config from './config.js';
import type { QualityReviewConfig } from './config.js';
import { type LlmStreamLike } from './reviewer.js';
export declare const name = "quality-review";
export declare const inject: string[];
export { Config };
/** Minimal structural typings for the host objects this plugin touches. */
interface ContentBlock {
    type?: string;
    text?: string;
}
interface DerivedMessage {
    role?: string;
    content?: ContentBlock[];
}
interface SessionLike {
    deriveMessages(): DerivedMessage[];
}
/**
 * A steering message. The host requires steering content to be *identified*:
 * replay validates that a `user/message` carries a non-empty string `id` and
 * throws "lacks an identified message" otherwise (see `assertMessageEventShape`
 * in packages/core/session). Declaring that shape here is what keeps the
 * requirement enforceable — an `unknown` parameter let the id-less literal
 * below compile, and the session only failed later, on the next replay.
 */
interface SteerMessage {
    id: string;
    role: string;
    content: ContentBlock[];
    source: {
        kind: string;
        plugin: string;
        form: string;
        summary: string;
    };
}
interface AgentLike {
    id: string;
    session: SessionLike;
    provider?: string;
    model?: string;
    steer(message: SteerMessage): void;
}
interface CordisContextLike {
    llm: LlmStreamLike;
    on(event: 'agent/turn-stopping', listener: (payload: {
        agent: AgentLike;
        turn: number;
        signal: AbortSignal;
    }) => unknown): unknown;
}
export declare function apply(ctx: CordisContextLike, config: QualityReviewConfig): void;
//# sourceMappingURL=index.d.ts.map