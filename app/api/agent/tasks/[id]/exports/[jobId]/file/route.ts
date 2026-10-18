import { downloadSeminarExport } from "@/lib/seminar/exports";
import { webScope } from "@/lib/local-agent/request";
import { fail, toErrorResponse } from "@/lib/http";

export async function GET(req: Request, { params }: { params: Promise<{ id: string; jobId: string }> }) {
  try {
    const scope = await webScope(req), { id, jobId } = await params, format = new URL(req.url).searchParams.get("format");
    if (format !== "pdf" && format !== "html") return fail(400,"BAD_REQUEST","다운로드할 파일 형식을 확인해주세요.");
    const artifact = await downloadSeminarExport(scope,id,jobId,format);
    return new Response(new Uint8Array(artifact.bytes),{ headers: { "Content-Type": artifact.contentType, "Content-Disposition": `attachment; filename="seminar.${format}"; filename*=UTF-8''${encodeURIComponent(artifact.title.replace(/[\r\n]/g,""))}.${format}`, "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff", "Content-Security-Policy": "sandbox; default-src 'none'", Vary: "Cookie" } });
  } catch (cause) { const result = toErrorResponse(cause); result.headers.set("Cache-Control","private, no-store"); return result; }
}
