import { cancelJob } from "@/lib/local-agent/service";
import { parseJson, response, webScope } from "@/lib/local-agent/request";
import { EmptySchema } from "@/lib/local-agent/validation";
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  return response(async () => { const scope = await webScope(req, true); await parseJson(req, EmptySchema); return cancelJob(scope, (await params).id); });
}
