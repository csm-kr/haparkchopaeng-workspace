import { revokeDevice } from "@/lib/local-agent/service";
import { response, webScope } from "@/lib/local-agent/request";
export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  return response(async () => { await revokeDevice(await webScope(req, true), (await params).id); return { revoked: true }; });
}
