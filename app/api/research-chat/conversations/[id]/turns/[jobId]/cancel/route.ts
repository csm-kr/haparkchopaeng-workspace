import { cancelTurn } from "@/lib/research-chat/service";
import { parseJson, response, webScope } from "@/lib/local-agent/request";
import { EmptySchema } from "@/lib/local-agent/validation";

export async function POST(req: Request, { params }: { params: Promise<{ id: string; jobId: string }> }): Promise<Response> {
  return response(async () => {
    const scope = await webScope(req, true);
    await parseJson(req, EmptySchema);
    const { id, jobId } = await params;
    return cancelTurn(scope, id, jobId);
  });
}
