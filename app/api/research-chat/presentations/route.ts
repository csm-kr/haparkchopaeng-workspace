import { listResearchPresentations } from "@/lib/research-chat/service";
import { response, webScope } from "@/lib/local-agent/request";

export async function GET(req: Request): Promise<Response> {
  return response(async () => listResearchPresentations(await webScope(req)));
}
