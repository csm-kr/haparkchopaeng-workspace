import { createConversation, listConversations } from "@/lib/research-chat/service";
import { ConversationCreateSchema } from "@/lib/research-chat/validation";
import { parseJson, response, webScope } from "@/lib/local-agent/request";

export async function GET(req: Request): Promise<Response> {
  return response(async () => listConversations(await webScope(req)));
}
export async function POST(req: Request): Promise<Response> {
  return response(async () => createConversation(await webScope(req, true), await parseJson(req, ConversationCreateSchema)), 201);
}
