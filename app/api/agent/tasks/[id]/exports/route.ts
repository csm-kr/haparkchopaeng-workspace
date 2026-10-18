import { queueSeminarExport } from "@/lib/agent/service";
import { ExportRequestSchema } from "@/lib/seminar/export-contract";
import { parseJson, response, webScope } from "@/lib/local-agent/request";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return response(async () => queueSeminarExport(await webScope(req,true),(await params).id,await parseJson(req,ExportRequestSchema)),202);
}
