import { submitResult } from "@/lib/local-agent/service";
import { desktopIdentity, parseJson, response } from "@/lib/local-agent/request";
import { ResultSchema } from "@/lib/local-agent/validation";
export async function POST(req: Request): Promise<Response> {
  return response(async () => { const identity = desktopIdentity(req); return submitResult(identity, await parseJson(req, ResultSchema, 1_000_000)); });
}
