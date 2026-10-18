import { createTask, listTasks } from "@/lib/agent/service";
import { TaskCreateSchema } from "@/lib/agent/contract";
import { parseJson, response, webScope } from "@/lib/local-agent/request";

export async function GET(req: Request): Promise<Response> {
  return response(async () => listTasks(await webScope(req), new URL(req.url).searchParams.get("conversationId") ?? undefined));
}
export async function POST(req: Request): Promise<Response> {
  return response(async () => createTask(await webScope(req, true), await parseJson(req, TaskCreateSchema)), 202);
}
