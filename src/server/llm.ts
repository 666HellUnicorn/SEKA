import type { ScoredChunk } from "../shared/types.ts";
import { tokenize } from "./retrieval.ts";

interface LlmResponse {
  answer: string;
  model: string;
}

function formatContexts(contexts: ScoredChunk[]): string {
  return contexts
    .map((context, index) => {
      const title = context.documentTitle ?? context.documentFilename ?? "未知文档";
      const page = context.pageNumber ?? "N/A";
      return `[${index + 1}] ${title} / 页码 ${page}\n${context.content}`;
    })
    .join("\n\n");
}

async function callOpenAiCompatible(question: string, contexts: ScoredChunk[]): Promise<LlmResponse | null> {
  const apiKey = process.env.OPENAI_API_KEY ?? process.env.SEKA_LLM_API_KEY;
  if (!apiKey) return null;

  const baseUrl = (process.env.SEKA_LLM_BASE_URL ?? "https://api.openai.com/v1").replace(/\/+$/, "");
  const model = process.env.SEKA_LLM_MODEL ?? "gpt-4o-mini";
  const prompt = [
    "你是 SEKA 本地知识库助手。请只根据给定资料回答用户问题。",
    "如果资料不足，请明确说“当前知识库中没有足够依据”。",
    "回答中使用 [1]、[2] 这样的引用标记指向资料片段。",
    "",
    `用户问题：${question}`,
    "",
    `资料片段：\n${formatContexts(contexts)}`,
  ].join("\n");

  try {
    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: "你擅长基于私有知识库进行可溯源问答。" },
          { role: "user", content: prompt },
        ],
        temperature: 0.2,
      }),
    });
    if (!response.ok) {
      throw new Error(`${response.status} ${await response.text()}`);
    }
    const data = (await response.json()) as any;
    const answer = data?.choices?.[0]?.message?.content;
    if (typeof answer !== "string") throw new Error("LLM 响应缺少 choices[0].message.content");
    return { answer, model };
  } catch (error) {
    return {
      answer: `LLM 调用失败，已切换为本地提取式回答。错误：${String(error)}`,
      model: `${model}-failed`,
    };
  }
}

function splitSentences(text: string): string[] {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (!normalized) return [];
  const parts = normalized.split(/(?<=[。！？!?\.])\s+/g);
  if (parts.length > 1) return parts.map((item) => item.trim()).filter(Boolean);
  return normalized.split(/[；;]\s*/g).map((item) => item.trim()).filter(Boolean);
}

function localExtractiveAnswer(question: string, contexts: ScoredChunk[]): LlmResponse {
  if (contexts.length === 0) {
    return {
      answer: "当前知识库中没有找到足够依据。请先上传相关资料，或尝试换一种问法。",
      model: "local-extractive",
    };
  }

  const queryTokens = new Set(tokenize(question));
  const candidates: Array<{ score: number; citationIndex: number; sentence: string }> = [];
  contexts.forEach((context, contextIndex) => {
    for (const sentence of splitSentences(context.content)) {
      const sentenceTokens = new Set(tokenize(sentence));
      let overlap = 0;
      for (const token of queryTokens) {
        if (sentenceTokens.has(token)) overlap += 1;
      }
      const density = overlap / Math.max(1, sentenceTokens.size);
      const score = overlap + density + context.score;
      if (overlap > 0 || contextIndex <= 1) {
        candidates.push({ score, citationIndex: contextIndex + 1, sentence });
      }
    }
  });

  const selected: Array<{ citationIndex: number; sentence: string }> = [];
  const seen = new Set<string>();
  for (const item of candidates.sort((left, right) => right.score - left.score)) {
    const key = item.sentence.slice(0, 120);
    if (seen.has(key)) continue;
    seen.add(key);
    selected.push({ citationIndex: item.citationIndex, sentence: item.sentence });
    if (selected.length >= 5) break;
  }

  if (selected.length === 0) {
    selected.push({ citationIndex: 1, sentence: contexts[0].content.slice(0, 350) });
  }

  const answer = [
    "当前未配置云端或本地大模型，以下是基于检索片段生成的提取式回答：",
    "",
    ...selected.map((item) => `- ${item.sentence} [${item.citationIndex}]`),
    "",
    "如果需要更自然的总结式回答，可以配置 `OPENAI_API_KEY` / `SEKA_LLM_BASE_URL` 使用 OpenAI-compatible 模型。",
  ].join("\n");

  return { answer, model: "local-extractive" };
}

export async function generateAnswer(question: string, contexts: ScoredChunk[]): Promise<LlmResponse> {
  const llmResult = await callOpenAiCompatible(question, contexts);
  if (llmResult && !llmResult.model.endsWith("-failed")) return llmResult;
  const local = localExtractiveAnswer(question, contexts);
  if (llmResult?.model.endsWith("-failed")) {
    return { ...local, answer: `${llmResult.answer}\n\n${local.answer}` };
  }
  return local;
}

