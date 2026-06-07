import { stripHtml } from "./utils.ts";

export interface FetchedWebPage {
  url: string;
  finalUrl: string;
  title: string;
  description: string;
  text: string;
  markdown: string;
}

function extractTitle(html: string, fallback: string): string {
  const title = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1];
  return stripHtml(title ?? "").trim() || fallback;
}

function extractMetaDescription(html: string): string {
  const patterns = [
    /<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["'][^>]*>/i,
    /<meta[^>]+content=["']([^"']+)["'][^>]+name=["']description["'][^>]*>/i,
    /<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']+)["'][^>]*>/i,
  ];
  for (const pattern of patterns) {
    const match = html.match(pattern)?.[1];
    if (match) return stripHtml(match);
  }
  return "";
}

function removeBoilerplate(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<svg[\s\S]*?<\/svg>/gi, " ")
    .replace(/<nav[\s\S]*?<\/nav>/gi, " ")
    .replace(/<footer[\s\S]*?<\/footer>/gi, " ")
    .replace(/<header[\s\S]*?<\/header>/gi, " ");
}

function extractReadableHtml(html: string): string {
  const candidates = [
    html.match(/<article[\s\S]*?<\/article>/i)?.[0],
    html.match(/<main[\s\S]*?<\/main>/i)?.[0],
    html.match(/<body[\s\S]*?<\/body>/i)?.[0],
  ].filter((value): value is string => Boolean(value));
  const best = candidates.sort((left, right) => right.length - left.length)[0] ?? html;
  return removeBoilerplate(best);
}

function normalizeText(text: string): string {
  return text
    .replace(/\r/g, "\n")
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s*\n\s*\n+/g, "\n\n")
    .trim();
}

function htmlToText(html: string): string {
  const withBreaks = html
    .replace(/<\/(p|div|section|article|main|h[1-6]|li|tr)>/gi, "\n")
    .replace(/<br\s*\/?>/gi, "\n");
  return normalizeText(stripHtml(withBreaks));
}

export async function fetchWebPage(url: string): Promise<FetchedWebPage> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error("URL 格式不正确");
  }
  if (!["http:", "https:"].includes(parsed.protocol)) {
    throw new Error("仅支持 http / https URL");
  }

  const response = await fetch(parsed, {
    headers: {
      "User-Agent": "SEKA-Knowledge-Agent/0.1",
      Accept: "text/html,text/plain,application/xhtml+xml",
    },
    redirect: "follow",
  });
  if (!response.ok) {
    throw new Error(`网页抓取失败：${response.status} ${response.statusText}`);
  }

  const contentType = response.headers.get("content-type") ?? "";
  const body = await response.text();
  const finalUrl = response.url || url;
  const title = contentType.includes("html") ? extractTitle(body, parsed.hostname) : parsed.hostname;
  const description = contentType.includes("html") ? extractMetaDescription(body) : "";
  const text = contentType.includes("html") ? htmlToText(extractReadableHtml(body)) : normalizeText(body);
  if (!text) throw new Error("网页未提取到可索引正文");

  const markdown = [
    `# ${title}`,
    "",
    `来源：${finalUrl}`,
    description ? `摘要：${description}` : "",
    "",
    text,
  ]
    .filter((line) => line !== "")
    .join("\n");

  return {
    url,
    finalUrl,
    title,
    description,
    text,
    markdown,
  };
}

