import { ResearchChatPage } from "./view";

export default async function Page({ searchParams }: { searchParams?: Promise<{ paperId?: string | string[]; work?: string | string[] }> }) {
  const query = await searchParams;
  return ResearchChatPage({ initialPaperId: typeof query?.paperId === "string" ? query.paperId : undefined, initialWork: query?.work === "seminar" ? "seminar" : undefined });
}
