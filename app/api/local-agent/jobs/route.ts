import { createJob } from "@/lib/local-agent/service";
import { parseJson, response, webScope } from "@/lib/local-agent/request";
import { JobCreateSchema } from "@/lib/local-agent/validation";
export async function POST(req: Request): Promise<Response> {
  return response(async () => { const scope = await webScope(req, true); return createJob(scope, await parseJson(req, JobCreateSchema)); }, 202);
}
