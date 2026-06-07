import { readFile } from "node:fs/promises";
import { extname } from "node:path";
import { marked } from "marked";
import type { ParsedFile, ParsedPage } from "../shared/types.ts";
import { stripHtml } from "./utils.ts";

const IMAGE_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".webp", ".bmp", ".gif"]);

export function detectFileType(filename: string): string {
  const ext = extname(filename).toLowerCase();
  if (ext === ".pdf") return "pdf";
  if (ext === ".md" || ext === ".markdown") return "markdown";
  if (ext === ".json") return "json";
  if (ext === ".csv") return "csv";
  if (IMAGE_EXTENSIONS.has(ext)) return "image";
  return "text";
}

function mimeTypeFor(filename: string): string {
  const ext = extname(filename).toLowerCase();
  const map = new Map<string, string>([
    [".txt", "text/plain"],
    [".md", "text/markdown"],
    [".markdown", "text/markdown"],
    [".json", "application/json"],
    [".csv", "text/csv"],
    [".pdf", "application/pdf"],
    [".png", "image/png"],
    [".jpg", "image/jpeg"],
    [".jpeg", "image/jpeg"],
    [".webp", "image/webp"],
    [".bmp", "image/bmp"],
    [".gif", "image/gif"],
  ]);
  return map.get(ext) ?? "application/octet-stream";
}

function decodeText(buffer: Buffer): string {
  const utf8 = buffer.toString("utf8");
  if (!utf8.includes("\uFFFD")) return utf8.replace(/^\uFEFF/, "");
  return buffer.toString("latin1");
}

async function parseTextLike(path: string, fileType: string): Promise<ParsedFile> {
  const buffer = await readFile(path);
  let text = decodeText(buffer);
  const warnings: string[] = [];
  let parser = "text";

  if (fileType === "markdown") {
    parser = "marked";
    try {
      const html = marked.parse(text, { async: false }) as string;
      text = stripHtml(html);
    } catch (error) {
      warnings.push(`Markdown 解析失败，已按纯文本处理：${String(error)}`);
    }
  }

  if (fileType === "json") {
    parser = "json";
    try {
      text = JSON.stringify(JSON.parse(text), null, 2);
    } catch (error) {
      warnings.push(`JSON 解析失败，已按纯文本处理：${String(error)}`);
    }
  }

  text = text.trim();
  return {
    text,
    pages: text ? [{ pageNumber: 1, text }] : [],
    parser,
    warnings,
    fileType,
    mimeType: mimeTypeFor(path),
  };
}

async function parsePdf(path: string): Promise<ParsedFile> {
  const warnings: string[] = [];
  const pages: ParsedPage[] = [];
  try {
    const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
    const buffer = await readFile(path);
    const data = new Uint8Array(buffer);
    const pdf = await pdfjs.getDocument({
      data,
      verbosity: pdfjs.VerbosityLevel.ERRORS,
    }).promise;

    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
      try {
        const page = await pdf.getPage(pageNumber);
        const content = await page.getTextContent();
        const text = content.items
          .map((item: any) => ("str" in item ? item.str : ""))
          .join(" ")
          .replace(/\s+/g, " ")
          .trim();
        if (text) pages.push({ pageNumber, text });
      } catch (error) {
        warnings.push(`第 ${pageNumber} 页文本提取失败：${String(error)}`);
      }
    }

    if (pages.length === 0) {
      warnings.push("PDF 未提取到文本，可能是扫描件；可上传图片或启用 OCR 流程。");
    }
  } catch (error) {
    warnings.push(`PDF 解析失败：${String(error)}`);
  }

  return {
    text: pages.map((page) => page.text).join("\n\n").trim(),
    pages,
    parser: "pdfjs-dist",
    warnings,
    fileType: "pdf",
    mimeType: "application/pdf",
  };
}

async function parseImage(path: string): Promise<ParsedFile> {
  const warnings: string[] = [];
  try {
    const tesseract = await import("tesseract.js");
    const lang = process.env.SEKA_OCR_LANG ?? "eng";
    const result = await tesseract.recognize(path, lang);
    const text = result.data.text.trim();
    if (!text) warnings.push("OCR 未识别到文本。");
    return {
      text,
      pages: text ? [{ pageNumber: 1, text }] : [],
      parser: "tesseract.js",
      warnings,
      fileType: "image",
      mimeType: mimeTypeFor(path),
    };
  } catch (error) {
    warnings.push(`OCR 失败，已保存文件但未提取文本：${String(error)}`);
    const text = `图片文件：${path}`;
    return {
      text,
      pages: [{ pageNumber: 1, text }],
      parser: "image-metadata",
      warnings,
      fileType: "image",
      mimeType: mimeTypeFor(path),
    };
  }
}

export async function parseFile(path: string, filename: string): Promise<ParsedFile> {
  const fileType = detectFileType(filename);
  let result: ParsedFile;
  if (fileType === "pdf") {
    result = await parsePdf(path);
  } else if (fileType === "image") {
    result = await parseImage(path);
  } else {
    result = await parseTextLike(path, fileType);
  }
  return {
    ...result,
    fileType,
    mimeType: mimeTypeFor(filename),
    text: result.text.trim(),
    pages: result.pages.map((page) => ({ pageNumber: page.pageNumber, text: page.text.trim() })).filter((page) => page.text),
  };
}
