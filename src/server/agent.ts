import type { AgentIntent, AgentRunResult, AgentToolCall, CitationSource } from "../shared/types.ts";
import { KnowledgeBase } from "./core.ts";
import { newId, utcNow } from "./utils.ts";

interface AgentOptions {
  workspace?: string;
  topK?: number;
}

interface ToolContext {
  calls: AgentToolCall[];
}

function detectIntent(task: string): AgentIntent {
  const normalized = task.toLowerCase();
  if (/https?:\/\//i.test(task) && /(导入|抓取|保存|收集|index|ingest)/i.test(task)) return "ingest_url";
  if (/(对比|比较|差异|compare|diff)/i.test(task)) return "compare";
  if (/(缺口|缺失|缺少|还需要|不足|gap|missing)/i.test(task)) return "gap_analysis";
  if (/(总结|摘要|归纳|summarize|summary)/i.test(task)) return "summarize";
  if (normalized.includes("compare")) return "compare";
  return "answer";
}

function extractUrls(text: string): string[] {
  return Array.from(new Set(text.match(/https?:\/\/[^\s，。；、)）]+/g) ?? []));
}

function extractCompareTargets(task: string): string[] {
  const quoted = Array.from(task.matchAll(/[《"“](.+?)[》"”]/g)).map((match) => match[1].trim());
  if (quoted.length >= 2) return quoted.slice(0, 2);
  const byVs = task.split(/\s+(?:vs|VS|和|与|跟|对比)\s+/).map((part) => part.trim()).filter(Boolean);
  return byVs.length >= 2 ? byVs.slice(0, 2) : [];
}

function mergeSources(...sourceGroups: CitationSource[][]): CitationSource[] {
  const seen = new Set<string>();
  const merged: CitationSource[] = [];
  for (const group of sourceGroups) {
    for (const source of group) {
      const key = source.chunkId;
      if (seen.has(key)) continue;
      seen.add(key);
      merged.push({ ...source, citationIndex: merged.length + 1 });
    }
  }
  return merged;
}

async function recordTool<T>(
  context: ToolContext,
  toolName: string,
  input: Record<string, unknown>,
  run: () => Promise<T>,
  summarize: (result: T) => string,
): Promise<T> {
  const startedAt = utcNow();
  const call: AgentToolCall = {
    id: newId(),
    toolName,
    input,
    outputSummary: "",
    status: "success",
    startedAt,
    endedAt: startedAt,
  };
  try {
    const result = await run();
    call.outputSummary = summarize(result);
    call.endedAt = utcNow();
    context.calls.push(call);
    return result;
  } catch (error) {
    call.status = "error";
    call.outputSummary = String(error);
    call.endedAt = utcNow();
    context.calls.push(call);
    throw error;
  }
}

export class KnowledgeAgent {
  private readonly kb: KnowledgeBase;

  constructor(kb: KnowledgeBase) {
    this.kb = kb;
  }

  async run(task: string, options: AgentOptions = {}): Promise<AgentRunResult> {
    const normalizedTask = task.trim();
    if (!normalizedTask) throw new Error("Agent 任务不能为空");

    const workspace = options.workspace || "all";
    const topK = options.topK ?? 6;
    const intent = detectIntent(normalizedTask);
    const context: ToolContext = { calls: [] };

    let answer = "";
    let sources: CitationSource[] = [];

    if (intent === "ingest_url") {
      const urls = extractUrls(normalizedTask);
      if (urls.length === 0) throw new Error("未在任务中找到 URL");
      const docs = [];
      for (const url of urls) {
        const doc = await recordTool(
          context,
          "web_fetch_and_ingest",
          { url, workspace },
          () => this.kb.ingestUrl(url, { workspace: workspace === "all" ? "default" : workspace, tags: ["agent", "web"] }),
          (doc) => `已导入 ${doc.title}，生成 ${doc.chunkCount} 个知识块。`,
        );
        docs.push(doc);
      }
      answer = [
        `已完成网页导入，共 ${docs.length} 个 URL。`,
        ...docs.map((doc, index) => `${index + 1}. ${doc.title}（空间：${doc.workspace}，chunks：${doc.chunkCount}）`),
      ].join("\n");
    } else if (intent === "compare") {
      const targets = extractCompareTargets(normalizedTask);
      if (targets.length >= 2) {
        const left = await recordTool(
          context,
          "knowledge_query",
          { question: targets[0], workspace, topK },
          () => this.kb.query(targets[0], topK, workspace),
          (result) => `检索 ${result.sources.length} 个来源片段。`,
        );
        const right = await recordTool(
          context,
          "knowledge_query",
          { question: targets[1], workspace, topK },
          () => this.kb.query(targets[1], topK, workspace),
          (result) => `检索 ${result.sources.length} 个来源片段。`,
        );
        sources = mergeSources(left.sources, right.sources);
        answer = [
          `已对比两个目标：${targets[0]} 与 ${targets[1]}`,
          "",
          "## 目标 A 相关信息",
          left.answer,
          "",
          "## 目标 B 相关信息",
          right.answer,
          "",
          "## 初步差异判断",
          "- 请重点查看两个目标引用来源中的功能、限制、时间、适用范围和版本描述。",
          "- 如果需要更精准的表格化差异，建议上传命名明确的两份版本文档后再次运行对比任务。",
        ].join("\n");
      } else {
        const result = await recordTool(
          context,
          "knowledge_query",
          { question: normalizedTask, workspace, topK },
          () => this.kb.query(normalizedTask, topK, workspace),
          (result) => `检索 ${result.sources.length} 个来源片段。`,
        );
        sources = result.sources;
        answer = `${result.answer}\n\n提示：如果要做精确对比，可以在任务中用书名号标出两个对象，例如：对比《旧版产品文档》和《新版产品文档》。`;
      }
    } else if (intent === "gap_analysis") {
      const result = await recordTool(
        context,
        "knowledge_query",
        { question: normalizedTask, workspace, topK },
        () => this.kb.query(normalizedTask, topK, workspace),
        (result) => `检索 ${result.sources.length} 个来源片段。`,
      );
      sources = result.sources;
      const weakEvidence = result.sources.length < 3;
      answer = [
        "## 知识缺口分析",
        weakEvidence ? "- 当前命中的来源片段较少，说明知识库可能缺少足够资料。" : "- 当前已有一定来源依据，但仍建议补充结构化材料。",
        "- 建议补充：背景说明、版本记录、决策依据、FAQ、流程规范、边界条件。",
        "- 建议把关键问答保存为知识，并为文档补充 workspace / tags，提升后续检索质量。",
        "",
        "## 当前检索依据",
        result.answer,
      ].join("\n");
    } else if (intent === "summarize") {
      const result = await recordTool(
        context,
        "knowledge_query",
        { question: normalizedTask, workspace, topK },
        () => this.kb.query(normalizedTask, topK, workspace),
        (result) => `检索 ${result.sources.length} 个来源片段。`,
      );
      sources = result.sources;
      answer = [
        "## 知识库摘要",
        result.answer,
        "",
        "## 可沉淀为简历亮点的表达",
        "- 支持多源文档接入、知识空间管理、混合检索、引用溯源和反馈迭代。",
      ].join("\n");
    } else {
      const result = await recordTool(
        context,
        "knowledge_query",
        { question: normalizedTask, workspace, topK },
        () => this.kb.query(normalizedTask, topK, workspace),
        (result) => `检索 ${result.sources.length} 个来源片段。`,
      );
      answer = result.answer;
      sources = result.sources;
    }

    return {
      runId: newId(),
      intent,
      task: normalizedTask,
      workspace,
      answer,
      sources,
      toolCalls: context.calls,
      createdAt: utcNow(),
    };
  }
}
