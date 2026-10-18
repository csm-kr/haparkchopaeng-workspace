import { revalidatePath } from "next/cache";
import { saveTaskNote, saveTaskSeminar } from "@/lib/agent/service";
import { ReviewedSaveSchema } from "@/lib/agent/contract";
import { parseJson, response, webScope } from "@/lib/local-agent/request";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  return response(async () => {
    const scope = await webScope(req, true);
    const id = (await params).id;
    const input = await parseJson(req, ReviewedSaveSchema);
    const result = "seminar" in input ? await saveTaskSeminar(scope, id, input) : await saveTaskNote(scope, id, input);
    revalidatePath(`/papers/${result.paper.id}`);
    if (result.savedPresentation) { revalidatePath("/presentations"); revalidatePath(`/presentations/${result.savedPresentation.id}`); }
    return result;
  });
}
