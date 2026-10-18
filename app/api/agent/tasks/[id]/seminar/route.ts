import { continueSeminarTask } from "@/lib/agent/service";
import { SeminarActionSchema } from "@/lib/seminar/contract";
import { parseJson, response, webScope } from "@/lib/local-agent/request";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  return response(async () => continueSeminarTask(await webScope(req, true), (await params).id, await parseJson(req, SeminarActionSchema)), 202);
}
