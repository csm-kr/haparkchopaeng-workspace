import { pairDesktop } from "@/lib/local-agent/service";
import { parseJson, response } from "@/lib/local-agent/request";
import { DesktopPairSchema } from "@/lib/local-agent/validation";
export async function POST(req: Request): Promise<Response> {
  return response(async () => pairDesktop(await parseJson(req, DesktopPairSchema)));
}
