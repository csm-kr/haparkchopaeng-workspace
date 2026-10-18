import { z } from "zod";
import { HttpError } from "@/lib/http";

const release = z.object({
  platform: z.enum(["windows", "macos", "linux"]),
  url: z.string().min(1).max(2048),
  version: z.string().regex(/^\d+\.\d+\.\d+(?:-[a-zA-Z0-9.-]+)?$/),
  filename: z.string().min(1).max(200).optional(),
  architecture: z.enum(["x64", "arm64", "universal"]).optional(),
  unsigned: z.boolean().optional(),
}).strict();

export type LocalAgentRelease = z.infer<typeof release>;

function safeDownloadUrl(raw: string): boolean {
  if (/[\\\s]/.test(raw)) return false;
  let decoded: string;
  try { decoded = decodeURIComponent(raw); } catch { return false; }
  if (/[\\]/.test(decoded) || decoded.split(/[/?#]/).includes("..")) return false;
  if (raw.startsWith("/") && !raw.startsWith("//") && !decoded.startsWith("//")) return true;
  try {
    const url = new URL(raw);
    return url.protocol === "https:" && !url.username && !url.password;
  } catch { return false; }
}

/** Only published artifacts enter this server-owned manifest. Missing config is a valid empty state. */
export function readLocalAgentReleases(raw: string | undefined): LocalAgentRelease[] {
  if (!raw?.trim()) return [];
  try {
    const releases = z.array(release).max(12).parse(JSON.parse(raw));
    if (releases.some((item) => !safeDownloadUrl(item.url))) throw new Error("Invalid URL");
    return releases;
  } catch {
    throw new HttpError(503, "CONNECTOR_RELEASES_UNAVAILABLE", "AI 브릿지 다운로드를 준비하고 있어요. 잠시 후 다시 확인해주세요.");
  }
}
