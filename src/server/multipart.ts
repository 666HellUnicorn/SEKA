export interface MultipartFile {
  filename: string;
  content: Buffer;
}

export type MultipartFields = Record<string, string | MultipartFile>;

export function parseMultipart(body: Buffer, contentType: string): MultipartFields {
  const match = contentType.match(/boundary=([^;]+)/);
  if (!match) throw new Error("缺少 multipart boundary");
  const boundary = Buffer.from(`--${match[1].trim().replace(/^"|"$/g, "")}`);
  const fields: MultipartFields = {};

  for (const rawPart of body.toString("binary").split(boundary.toString("binary"))) {
    let part = rawPart.trim();
    if (!part || part === "--") continue;
    if (part.endsWith("--")) part = part.slice(0, -2).trim();

    const separatorIndex = part.indexOf("\r\n\r\n");
    if (separatorIndex < 0) continue;
    const headerBlob = part.slice(0, separatorIndex);
    let contentBinary = part.slice(separatorIndex + 4);
    if (contentBinary.endsWith("\r\n")) contentBinary = contentBinary.slice(0, -2);

    const disposition = headerBlob
      .split(/\r?\n/g)
      .find((line) => line.toLowerCase().startsWith("content-disposition:"));
    if (!disposition) continue;

    const name = disposition.match(/name="([^"]+)"/)?.[1];
    if (!name) continue;
    const filename = disposition.match(/filename="([^"]*)"/)?.[1];
    if (filename !== undefined) {
      fields[name] = {
        filename,
        content: Buffer.from(contentBinary, "binary"),
      };
    } else {
      fields[name] = Buffer.from(contentBinary, "binary").toString("utf8");
    }
  }

  return fields;
}

export function isMultipartFile(value: string | MultipartFile | undefined): value is MultipartFile {
  return typeof value === "object" && value !== null && Buffer.isBuffer(value.content);
}

