// Minimal stand-ins for the two helpers Trezu's build-proposal.ts imports from "@/lib/utils",
// re-implemented here so the engine runs outside the Trezu app (see tsconfig paths).
export function jsonToBase64(json: unknown): string {
  return Buffer.from(JSON.stringify(json)).toString("base64");
}

export const parseKeyToReadableFormat = (key: string) =>
  key
    .replace(/_/g, " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/\b\w/g, (c) => c.toUpperCase());

export const encodeToMarkdown = (data: Record<string, unknown>) =>
  Object.entries(data)
    .filter(([key, value]) => key && value !== null && value !== undefined && value !== "")
    .map(([key, value]) => `* ${parseKeyToReadableFormat(key)}: ${String(value)}`)
    .join(" <br>");
