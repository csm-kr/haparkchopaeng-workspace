import { desktopHeartbeat } from "@/lib/local-agent/service";
import { desktopIdentity, parseJson, response } from "@/lib/local-agent/request";
import { HeartbeatSchema } from "@/lib/local-agent/validation";
export async function POST(req: Request): Promise<Response> {
  return response(async () => {
    const identity = desktopIdentity(req);
    const { providers, ...metadata } = await parseJson(req, HeartbeatSchema, 600_000);
    return desktopHeartbeat(identity, providers, metadata);
  });
}
