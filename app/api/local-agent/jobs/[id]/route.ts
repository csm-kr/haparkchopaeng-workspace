import { getJob } from "@/lib/local-agent/service";
import { response, webScope } from "@/lib/local-agent/request";
export const dynamic = "force-dynamic";
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  return response(async () => getJob(await webScope(req), (await params).id));
}
