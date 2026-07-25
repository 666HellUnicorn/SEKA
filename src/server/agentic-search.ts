import type {
  AgentToolCall,
  AgenticSearchQuery,
  AgenticSearchResult,
  AgenticSearchRound,
  CitationSource,
  KnowledgeChunk,
  ScoredChunk,
} from "../shared/types.ts";
import { tokenize } from "./retrieval.ts";
import { newId, utcNow } from "./utils.ts";

interface AgenticSearchOptions {
  workspace?: string;
  topK?: number;
  maxRounds?: number;
  toCitation: (chunk: ScoredChunk, citationIndex: number) => CitationSource;
}

interface QueryPlan {
  strategy: string;
  queries: AgenticSearchQuery[];
}

const IDENTIFIER_RE = /[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)*/g;
const CJK_RUN_RE = /[\u3400-\u9fff]{2,}/g;
const FALLBACK_TERMS = ["summary", "feature", "limitation", "audit", "feedback", "workspace"];

const EXPANSION_GROUPS: Array<{ triggers: string[]; terms: string[]; reason: string }> = [
  {
    triggers: ["权限", "授权", "访问", "隔离", "role", "rbac", "viewer", "editor", "admin", "workspace"],
    terms: ["RBAC", "role", "viewer", "editor", "admin", "allowedWorkspaces", "workspace", "权限", "授权", "隔离"],
    reason: "权限 / workspace 隔离相关扩展",
  },
  {
    triggers: ["审计", "日志", "audit", "audit_logs", "action", "resourceType"],
    terms: ["audit", "audit_logs", "auditLogs", "action", "resourceType", "审计", "日志", "记录"],
    reason: "审计日志相关扩展",
  },
  {
    triggers: ["反馈", "修正", "feedback", "resolve", "resolved"],
    terms: ["feedback", "FeedbackItem", "resolve", "resolved", "resolution", "反馈", "修正", "沉淀"],
    reason: "反馈闭环相关扩展",
  },
  {
    triggers: ["报告", "导出", "markdown", "export"],
    terms: ["export", "markdown", "report", "summary", "导出", "报告", "摘要", "文档清单"],
    reason: "Markdown 报告导出相关扩展",
  },
  {
    triggers: ["上传", "文档", "索引", "chunk", "chunks", "reindex"],
    terms: ["upload", "document", "chunks", "chunk", "reindex", "parse", "上传", "文档", "索引", "切块"],
    reason: "文档解析与索引相关扩展",
  },
  {
    triggers: ["agent", "工具", "toolCalls", "agent.run", "tool"],
    terms: ["agent", "AgentRunResult", "toolCalls", "agent.run", "intent", "工具", "调用"],
    reason: "Agent 工具调用相关扩展",
  },
];

export class AgenticSearchService {
  search(question: string, chunks: KnowledgeChunk[], options: AgenticSearchOptions): AgenticSearchResult {
    const normalizedQuestion = question.trim();
    const topK = clampInteger(options.topK, 5, 1, 20);
    const maxRounds = clampInteger(options.maxRounds, 3, 1, 5);
    const workspace = options.workspace || "all";
    const startedAt = utcNow();

    const plans = this.planQueries(normalizedQuestion, maxRounds);
    const allHits = new Map<string, ScoredChunk>();
    const rounds: AgenticSearchRound[] = [];

    for (let index = 0; index < plans.length; index += 1) {
      const plan = plans[index];
      const roundHits = new Map<string, ScoredChunk>();

      for (const query of plan.queries) {
        for (const hit of this.runGrepQuery(query, chunks)) {
          mergeHit(roundHits, hit);
          mergeHit(allHits, hit);
        }
      }

      const citations = sortHits([...roundHits.values()])
        .slice(0, topK)
        .map((chunk, citationIndex) => options.toCitation(chunk, citationIndex + 1));

      rounds.push({
        round: index + 1,
        strategy: plan.strategy,
        queries: plan.queries,
        hitCount: roundHits.size,
        hits: citations,
      });

      if (allHits.size >= topK) break;
    }

    const sources = sortHits([...allHits.values()])
      .slice(0, topK)
      .map((chunk, index) => options.toCitation(chunk, index + 1));
    const endedAt = utcNow();
    const toolCalls: AgentToolCall[] = [
      {
        id: newId(),
        toolName: "grep.agentic_search",
        input: { question: normalizedQuestion, workspace, topK, maxRounds },
        outputSummary: `完成 ${rounds.length} 轮 grep-style 检索，命中 ${sources.length} 个引用来源。`,
        status: "success",
        startedAt,
        endedAt,
      },
    ];

    return {
      question: normalizedQuestion,
      workspace,
      answer: buildExtractiveAnswer(rounds.length, sources),
      rounds,
      sources,
      toolCalls,
      createdAt: endedAt,
    };
  }

  private planQueries(question: string, maxRounds: number): QueryPlan[] {
    const baseTerms = extractTerms(question);
    const identifiers = extractIdentifiers(question);
    const cjkTerms = extractCjkTerms(question);
    const plans: QueryPlan[] = [
      {
        strategy: "original_terms",
        queries: limitQueries([
          makeQuery(question, baseTerms.slice(0, 8), "原始问题关键词"),
          identifiers.length ? makeQuery(identifiers.join(" "), identifiers, "英文 / 代码标识符") : null,
          cjkTerms.length ? makeQuery(cjkTerms.join(" "), cjkTerms, "中文短语与二元词") : null,
        ]),
      },
    ];

    if (maxRounds >= 2) {
      const expandedQueries = expansionQueries(question, baseTerms);
      plans.push({
        strategy: "expanded_terms",
        queries: expandedQueries.length
          ? limitQueries(expandedQueries)
          : limitQueries([makeQuery(baseTerms.join(" "), baseTerms, "无显式同义词命中，复用基础关键词")]),
      });
    }

    if (maxRounds >= 3) {
      plans.push({
        strategy: "fallback_terms",
        queries: limitQueries([
          makeQuery(FALLBACK_TERMS.join(" "), FALLBACK_TERMS, "通用项目证据兜底词"),
          makeQuery("audit feedback workspace", ["audit", "feedback", "workspace"], "权限 / 反馈 / 空间兜底组合"),
          makeQuery("summary feature limitation", ["summary", "feature", "limitation"], "摘要 / 特性 / 限制兜底组合"),
        ]),
      });
    }

    return plans.slice(0, maxRounds).filter((plan) => plan.queries.length > 0);
  }

  private runGrepQuery(query: AgenticSearchQuery, chunks: KnowledgeChunk[]): ScoredChunk[] {
    const terms = normalizeTerms(query.terms.length ? query.terms : extractTerms(query.query));
    if (terms.length === 0) return [];
    const phrase = query.query.trim().toLowerCase();
    const scored: ScoredChunk[] = [];

    for (const chunk of chunks) {
      const content = chunk.content.toLowerCase();
      const title = (chunk.documentTitle ?? "").toLowerCase();
      const filename = (chunk.documentFilename ?? "").toLowerCase();
      const section = (chunk.sectionTitle ?? "").toLowerCase();
      const source = (chunk.documentSource ?? "").toLowerCase();
      let rawScore = 0;
      let matchedTerms = 0;

      for (const term of terms) {
        if (content.includes(term)) {
          rawScore += 1;
          matchedTerms += 1;
        }
        if (title.includes(term)) rawScore += 2;
        if (filename.includes(term)) rawScore += 1.4;
        if (section.includes(term)) rawScore += 1.2;
        if (source.includes(term)) rawScore += 0.8;
      }

      if (phrase.length >= 2) {
        if (content.includes(phrase)) rawScore += 2.5;
        if (title.includes(phrase) || filename.includes(phrase) || section.includes(phrase)) rawScore += 2;
      }

      if (rawScore <= 0) continue;
      const overlapBoost = matchedTerms / Math.max(terms.length, 1);
      const keywordScore = rawScore / (rawScore + 6);
      const score = keywordScore * 0.85 + overlapBoost * 0.15;
      scored.push({
        ...chunk,
        score: roundScore(score),
        keywordScore: roundScore(keywordScore),
        vectorScore: 0,
      });
    }

    return sortHits(scored);
  }
}

function extractTerms(text: string): string[] {
  const terms = new Set<string>();
  for (const token of tokenize(text)) {
    if (token.length >= 2) terms.add(token);
  }
  for (const identifier of extractIdentifiers(text)) {
    terms.add(identifier);
    for (const part of splitIdentifier(identifier)) {
      if (part.length >= 2) terms.add(part);
    }
  }
  for (const term of extractCjkTerms(text)) terms.add(term);
  return normalizeTerms([...terms]);
}

function extractIdentifiers(text: string): string[] {
  return normalizeTerms(text.match(IDENTIFIER_RE) ?? []);
}

function splitIdentifier(identifier: string): string[] {
  return identifier
    .replaceAll(".", " ")
    .replaceAll("_", " ")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part.toLowerCase());
}

function extractCjkTerms(text: string): string[] {
  const terms = new Set<string>();
  const runs = text.match(CJK_RUN_RE) ?? [];
  for (const run of runs) {
    if (run.length <= 8) terms.add(run);
    for (let index = 0; index < run.length - 1; index += 1) {
      terms.add(run.slice(index, index + 2));
    }
  }
  return [...terms];
}

function expansionQueries(question: string, baseTerms: string[]): AgenticSearchQuery[] {
  const normalizedQuestion = question.toLowerCase();
  const termSet = new Set(baseTerms.map((term) => term.toLowerCase()));
  return EXPANSION_GROUPS.filter((group) =>
    group.triggers.some((trigger) => normalizedQuestion.includes(trigger.toLowerCase()) || termSet.has(trigger.toLowerCase())),
  ).map((group) => makeQuery(group.terms.join(" "), group.terms, group.reason));
}

function makeQuery(query: string, terms: string[], reason: string): AgenticSearchQuery {
  return {
    query: query.trim(),
    terms: normalizeTerms(terms),
    reason,
  };
}

function limitQueries(queries: Array<AgenticSearchQuery | null>): AgenticSearchQuery[] {
  const seen = new Set<string>();
  const result: AgenticSearchQuery[] = [];
  for (const query of queries) {
    if (!query || query.terms.length === 0) continue;
    const key = query.terms.join("|");
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(query);
    if (result.length >= 6) break;
  }
  return result;
}

function normalizeTerms(terms: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const term of terms) {
    const normalized = term.trim().toLowerCase();
    if (normalized.length < 2 || seen.has(normalized)) continue;
    seen.add(normalized);
    result.push(normalized);
  }
  return result;
}

function mergeHit(target: Map<string, ScoredChunk>, hit: ScoredChunk): void {
  const existing = target.get(hit.id);
  if (!existing || hit.score > existing.score) {
    target.set(hit.id, hit);
  }
}

function sortHits(hits: ScoredChunk[]): ScoredChunk[] {
  return hits.sort((left, right) => right.score - left.score || left.chunkIndex - right.chunkIndex);
}

function buildExtractiveAnswer(roundCount: number, sources: CitationSource[]): string {
  if (sources.length === 0) {
    return "没有找到足够证据。建议补充关键词或上传更多文档。";
  }
  const evidence = sources
    .slice(0, 3)
    .map((source, index) => `${index + 1}. [${source.citationIndex}] ${compactSnippet(source.snippet)}`)
    .join("\n");
  return [
    `Agentic Search 基于 ${roundCount} 轮 grep-style 检索找到 ${sources.length} 个可引用来源。`,
    "",
    "关键证据：",
    evidence,
    "",
    "结论：以上片段是当前知识库中与问题最相关的证据。你可以根据引用来源继续追问，或补充更明确的关键词提升召回率。",
  ].join("\n");
}

function compactSnippet(snippet: string): string {
  const compact = snippet.replace(/\s+/g, " ").trim();
  return compact.length > 220 ? `${compact.slice(0, 220)}…` : compact;
}

function roundScore(value: number): number {
  return Number(value.toFixed(6));
}

function clampInteger(value: unknown, fallback: number, min: number, max: number): number {
  const parsed = Number(value);
  const integer = Number.isFinite(parsed) ? Math.trunc(parsed) : fallback;
  return Math.min(max, Math.max(min, integer));
}
