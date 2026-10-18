import { listResearchPapers } from "@/lib/research-chat/service";
import { response, webScope } from "@/lib/local-agent/request";

export async function GET(req: Request): Promise<Response> {
  return response(async () => listResearchPapers(await webScope(req)));
}
