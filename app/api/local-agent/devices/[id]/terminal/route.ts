import { requestTerminal } from "@/lib/local-agent/service";
import { parseJson, response, webScope } from "@/lib/local-agent/request";
import { TerminalRequestSchema } from "@/lib/local-agent/validation";
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  return response(async () => {
    const scope = await webScope(req, true);
    const { provider } = await parseJson(req, TerminalRequestSchema);
    return requestTerminal(scope, (await params).id, provider);
  }, 202);
}
