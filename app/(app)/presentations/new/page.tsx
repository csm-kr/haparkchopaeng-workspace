import { SeminarWorkspacePage } from "../workspace-page";
export default async function Page({ searchParams }: { searchParams?: Promise<{ paperId?: string | string[] }> }) {
  const query = await searchParams;
  return SeminarWorkspacePage({ paperId: typeof query?.paperId === "string" ? query.paperId : undefined });
}
