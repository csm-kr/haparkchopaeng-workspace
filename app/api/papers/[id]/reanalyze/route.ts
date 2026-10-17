import { cancelLocalAnalysis, getLocalAnalysisState, LocalAnalysisRequestSchema, requestLocalAnalysis } from "@/lib/local-ai/service";
import { parseJson, response, webScope } from "@/lib/local-agent/request";

type Context = { params: Promise<{ id: string }> };
export async function POST(req: Request, { params }: Context): Promise<Response> {
  return response(async () => {
    const scope = await webScope(req, true);
    const input = await parseJson(req, LocalAnalysisRequestSchema);
    return requestLocalAnalysis(scope, (await params).id, input);
  }, 202);
}
export async function GET(req: Request, { params }: Context): Promise<Response> {
  return response(async () => getLocalAnalysisState(await webScope(req), (await params).id));
}
export async function DELETE(req: Request, { params }: Context): Promise<Response> {
  return response(async () => cancelLocalAnalysis(await webScope(req, true), (await params).id));
}
