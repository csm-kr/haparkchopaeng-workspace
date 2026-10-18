import { SeminarWorkspacePage } from "../../workspace-page";
export default async function Page({ params }: { params: Promise<{ taskId: string }> }) { return SeminarWorkspacePage({ taskId: (await params).taskId }); }
