import { claimJob } from "@/lib/local-agent/service";
import { desktopIdentity, parseJson, response } from "@/lib/local-agent/request";
import { EmptySchema } from "@/lib/local-agent/validation";
export async function POST(req: Request): Promise<Response> {
  return response(async () => { const identity = desktopIdentity(req); await parseJson(req, EmptySchema); return claimJob(identity); });
}
