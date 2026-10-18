import { cancelAttempt, getAttempt } from "@/lib/local-agent/service";
import { response, webScope } from "@/lib/local-agent/request";
type Context = { params: Promise<{ id: string }> };
export const dynamic = "force-dynamic";
export async function GET(req: Request, { params }: Context): Promise<Response> {
  return response(async () => getAttempt(await webScope(req), (await params).id));
}
export async function DELETE(req: Request, { params }: Context): Promise<Response> {
  return response(async () => { await cancelAttempt(await webScope(req, true), (await params).id); return { cancelled: true }; });
}
