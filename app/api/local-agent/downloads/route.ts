import { readLocalAgentReleases } from "@/lib/local-agent-releases";
import { response, webScope } from "@/lib/local-agent/request";

export const dynamic = "force-dynamic";

export async function GET(req: Request): Promise<Response> {
  return response(async () => {
    await webScope(req);
    return { releases: readLocalAgentReleases(process.env.LOCAL_AGENT_RELEASES) };
  });
}
