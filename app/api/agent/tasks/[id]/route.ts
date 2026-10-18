import { controlTask, getTask } from "@/lib/agent/service";
import { TaskControlSchema } from "@/lib/agent/contract";
import { parseJson, response, webScope } from "@/lib/local-agent/request";

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  return response(async () => getTask(await webScope(req), (await params).id));
}
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  return response(async () => controlTask(await webScope(req, true), (await params).id, await parseJson(req, TaskControlSchema)), 202);
}
