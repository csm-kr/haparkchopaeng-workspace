import { acknowledgeDesktop } from "@/lib/local-agent/service";
import { parseJson, response } from "@/lib/local-agent/request";
import { DesktopAckSchema } from "@/lib/local-agent/validation";
export async function POST(req: Request): Promise<Response> {
  return response(async () => acknowledgeDesktop(await parseJson(req, DesktopAckSchema)));
}
