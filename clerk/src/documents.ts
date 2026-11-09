import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

export interface Doc {
  name: string;
  text: string;
}

/** Load contributor documents from a folder: .md .txt .csv .json .pdf (text is extracted locally; nothing leaves the machine until the TEE call). */
export async function loadDocuments(dir: string): Promise<Doc[]> {
  const docs: Doc[] = [];
  for (const f of fs.readdirSync(dir).sort()) {
    const p = path.join(dir, f);
    if (!fs.statSync(p).isFile() || f.toLowerCase() === "readme.md") continue;
    const ext = path.extname(f).toLowerCase();
    if ([".md", ".txt", ".csv", ".json"].includes(ext)) docs.push({ name: f, text: fs.readFileSync(p, "utf8") });
    else if (ext === ".pdf") {
      try {
        const pdfParse = createRequire(import.meta.url)("pdf-parse");
        const out = await pdfParse(fs.readFileSync(p));
        docs.push({ name: f, text: out.text });
      } catch (e) {
        docs.push({ name: f, text: `[could not extract PDF text: ${String(e).slice(0, 80)}]` });
      }
    }
  }
  return docs;
}
