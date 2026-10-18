import { getStatus } from "@/lib/local-agent/service";
import { response, webScope } from "@/lib/local-agent/request";
export const dynamic = "force-dynamic";
export async function GET(req: Request): Promise<Response> {
  return response(async () => getStatus(await webScope(req), new URL(req.url).searchParams.get("deviceId") || undefined));
}
