// 일회성 백필 — PDF 첨부가 있는 기존 발표자료의 slideCount를 실제 페이지 수로 채운다.
// 배경: 생성 라우트가 한동안 slideCount를 0으로 박아 둬, 기존 행이 "슬라이드 0장"으로 표시됨.
//      이후 생성 경로는 PDF 페이지 수를 채우도록 고쳤고(app/api/presentations/route.ts), 이 스크립트는 과거 데이터를 보정한다.
// 멱등: 실제 페이지 수와 같으면 건너뛴다. 다운로드/카운트 실패는 건너뛰고 계속(데이터 보정이 멈추지 않게).
// 실행: `npx tsx scripts/backfill-slide-count.mts` (운영 env가 든 .env가 있는 디렉터리에서).
//   페이지 수는 lib/pdf-page-render(mupdf) 대신 pdf-lib로 센다 — mupdf는 top-level await라
//   독립 tsx 스크립트의 CJS 변환과 충돌. "페이지 수"는 라이브러리 무관하게 같으므로 보정엔 무방.
//   .env는 @next/env로 직접 로드한다 — 독립 스크립트는 Next 런타임처럼 자동 로드되지 않으므로.
// @next/env는 CJS라 ESM에서 named export가 안 잡힌다 — default import 후 구조분해.
import nextEnv from "@next/env";
import { PDFDocument } from "pdf-lib";
const { loadEnvConfig } = nextEnv;

// prisma/storage를 import하기 전에 env를 먼저 로드한다(PrismaClient가 생성 시 DATABASE_URL을 읽음).
loadEnvConfig(process.cwd());

async function main() {
  // env 로드 이후에 앱 모듈을 가져온다(정적 import는 호이스팅돼 env보다 먼저 평가되므로 동적 import).
  const { prisma } = await import("@/lib/prisma");
  const { downloadObject } = await import("@/lib/storage");

  // PDF 자산을 가진 발표자료만 — 페이지를 셀 수 있는 대상.
  const rows = await prisma.presentation.findMany({
    where: { assets: { some: { type: "pdf" } } },
    select: {
      id: true,
      title: true,
      slideCount: true,
      assets: { where: { type: "pdf" }, select: { url: true } },
    },
  });

  let updated = 0;
  let skipped = 0;
  let failed = 0;

  for (const p of rows) {
    const url = p.assets[0]?.url; // PDF가 여럿이면 첫 PDF(라이브 공유 카운트와 동일 규칙)
    if (!url) {
      skipped++;
      continue;
    }
    try {
      const doc = await PDFDocument.load(await downloadObject(url), {
        ignoreEncryption: true,
      });
      const count = doc.getPageCount();
      if (count < 1 || count === p.slideCount) {
        skipped++;
        continue;
      }
      await prisma.presentation.update({
        where: { id: p.id },
        data: { slideCount: count },
      });
      updated++;
      console.log(`✓ ${p.title}: ${p.slideCount} → ${count}`);
    } catch (e) {
      failed++;
      console.warn(`✗ ${p.title} (${p.id}): ${(e as Error).message}`);
    }
  }

  console.log(
    `\n완료 — 대상 ${rows.length}건 / 갱신 ${updated} · 건너뜀 ${skipped} · 실패 ${failed}`,
  );

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
