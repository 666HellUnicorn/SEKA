import { choice, noul, TypeSafeClient, type Fetch } from "@typesafe-ai/sdk";
import type { AgenticSearchDecision } from "../shared/types.ts";
import { JEV_MODEL, JEV_TIMEOUT_MS } from "./config.ts";

export interface JevDecisionInput {
  question: string;
  round: number;
  maxRounds: number;
  hitCount: number;
  sourceCount: number;
  currentStrategy: string;
  availableStrategies: string[];
}

export interface JevDecisionResult {
  decision: AgenticSearchDecision;
  model: string;
  durationMs: number;
  error?: string;
}

const STRATEGIES = ["expanded_terms", "fallback_terms", "original_terms"] as const;

export class JevDecisionService {
  readonly configured: boolean;
  readonly model: string;
  private readonly client: TypeSafeClient | null;

  constructor(
    options: {
      apiKey?: string;
      model?: string;
      timeoutMs?: number;
      fetch?: Fetch;
    } = {},
  ) {
    const apiKey = options.apiKey ?? process.env.TYPESAFE_API_KEY;
    this.configured = Boolean(apiKey?.trim());
    this.model = options.model ?? JEV_MODEL;
    this.client = this.configured
      ? new TypeSafeClient({
          apiKey,
          defaultModel: this.model,
          timeout: options.timeoutMs ?? JEV_TIMEOUT_MS,
          fetch: options.fetch,
        })
      : null;
  }

  async decide(input: JevDecisionInput): Promise<JevDecisionResult> {
    const startedAt = Date.now();
    if (!this.client) {
      return {
        decision: {
          provider: "local",
          action: "continue",
          nextStrategy: input.availableStrategies[0] ?? "fallback_terms",
          confidence: 1,
          rationale: "未配置 TYPESAFE_API_KEY，使用本地 grep 策略。",
        },
        model: this.model,
        durationMs: Date.now() - startedAt,
        error: "TYPESAFE_API_KEY 未配置",
      };
    }

    try {
      const response = await this.client.systemOne({
        model: this.model,
        state: {
          question: input.question,
          round: input.round,
          maxRounds: input.maxRounds,
          hitCount: input.hitCount,
          sourceCount: input.sourceCount,
          currentStrategy: input.currentStrategy,
          availableStrategies: input.availableStrategies,
        },
        questions: {
          action: choice("在当前证据基础上，应该停止搜索还是继续搜索？", {
            continue: "当前证据不足，继续检索",
            stop: "证据已经足够，停止检索",
          }),
          nextStrategy: choice("如果继续，下一轮优先使用哪种检索策略？", {
            expanded_terms: "使用技术词和同义词扩展",
            fallback_terms: "使用通用兜底词",
            original_terms: "继续使用原始问题词",
          }),
          enoughEvidence: noul("当前命中片段是否已经足够回答问题？"),
        },
      });

      const actionAnswer = response.answers.action;
      const strategyAnswer = response.answers.nextStrategy;
      const evidenceAnswer = response.answers.enoughEvidence;
      const action = actionAnswer.choice === "stop" || evidenceAnswer.noul >= 0.72 ? "stop" : "continue";
      const nextStrategy = STRATEGIES.includes(strategyAnswer.choice as (typeof STRATEGIES)[number])
        ? strategyAnswer.choice
        : input.availableStrategies[0] ?? "fallback_terms";
      const confidence = Math.max(
        actionAnswer.confidence,
        strategyAnswer.confidence,
        Math.max(evidenceAnswer.noul, 1 - evidenceAnswer.noul),
      );

      return {
        decision: {
          provider: "jev",
          action,
          nextStrategy,
          confidence: round(confidence),
          rationale: `Jev 判断：${action === "stop" ? "证据已足够" : `继续使用 ${nextStrategy}`}（evidence=${evidenceAnswer.noul.toFixed(2)}）。`,
        },
        model: response.model,
        durationMs: Date.now() - startedAt,
      };
    } catch (error) {
      return {
        decision: {
          provider: "local",
          action: "continue",
          nextStrategy: input.availableStrategies[0] ?? "fallback_terms",
          confidence: 1,
          rationale: `Jev 调用失败，回退本地 grep：${String(error)}`,
        },
        model: this.model,
        durationMs: Date.now() - startedAt,
        error: String(error),
      };
    }
  }
}

function round(value: number): number {
  return Number(value.toFixed(4));
}
