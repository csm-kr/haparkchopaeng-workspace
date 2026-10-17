import { renewWebPermission } from "@/lib/local-agent/service";
import { parseJson, response, webScope } from "@/lib/local-agent/request";
import { WebHeartbeatSchema } from "@/lib/local-agent/validation";
export async function POST(req: Request): Promise<Response> {
  return response(async () => { const scope = await webScope(req, true); const input = await parseJson(req, WebHeartbeatSchema); return renewWebPermission(scope, input.deviceId); });
}
