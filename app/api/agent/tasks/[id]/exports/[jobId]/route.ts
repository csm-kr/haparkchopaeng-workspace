import { getSeminarExport } from "@/lib/seminar/exports";
import { response, webScope } from "@/lib/local-agent/request";

export async function GET(req: Request, { params }: { params: Promise<{ id: string; jobId: string }> }) {
  return response(async () => { const scope = await webScope(req), { id, jobId } = await params; return getSeminarExport(scope,id,jobId); });
}
