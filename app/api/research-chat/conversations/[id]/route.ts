import { getConversation } from "@/lib/research-chat/service";
import { response, webScope } from "@/lib/local-agent/request";

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  return response(async () => getConversation(await webScope(req), (await params).id));
}
