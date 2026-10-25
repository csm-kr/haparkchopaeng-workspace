import { createJob, listActiveJobs } from "@/lib/local-agent/service";
import { parseJson, response, webScope } from "@/lib/local-agent/request";
import { JobCreateSchema } from "@/lib/local-agent/validation";
import { HttpError } from "@/lib/http";
export async function GET(req: Request): Promise<Response> {
  return response(async () => {
    if (new URL(req.url).searchParams.get("active") !== "1") throw new HttpError(400, "BAD_REQUEST", "요청 내용을 확인해주세요.");
    return listActiveJobs(await webScope(req));
  });
}
export async function POST(req: Request): Promise<Response> {
  return response(async () => { const scope = await webScope(req, true); return createJob(scope, await parseJson(req, JobCreateSchema)); }, 202);
}
