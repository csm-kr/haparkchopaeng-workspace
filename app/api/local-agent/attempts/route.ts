import { createAttempt } from "@/lib/local-agent/service";
import { parseJson, response, webScope } from "@/lib/local-agent/request";
import { EmptySchema } from "@/lib/local-agent/validation";
export async function POST(req: Request): Promise<Response> {
  return response(async () => { const scope = await webScope(req, true); await parseJson(req, EmptySchema); return createAttempt(scope); }, 201);
}
