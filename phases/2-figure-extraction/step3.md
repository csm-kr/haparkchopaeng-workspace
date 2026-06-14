# Step 3: figure-image-serving

## 읽어야 할 파일

- `/docs/superpowers/specs/2026-06-14-figure-image-extraction-design.md` — "서빙", "매핑", "에러 처리"
- `app/api/papers/[id]/pdf/route.ts` — 서명 URL 302 리디렉트 패턴(동일하게 따른다)
- `app/api/papers/[id]/route.ts` — DELETE 핸들러(figure 정리 추가 지점), `removeObject`
- `lib/papers.ts` — `getPaperDetail`의 figure 매핑
- `components/analyzer/analysis-view.tsx` — figure `imageUrl` 렌더(변경 없음 확인용)

## 작업

저장된 figure 이미지를 인증·서명 URL로 서빙하고, 상세에 연결한다.

- `app/api/figures/[id]/image/route.ts` (신규): `requireAuth` → `prisma.figure.findUnique`로 `imageUrl`(경로) 조회 → 없으면 404 → `signedDownloadUrl(path, 60)` → 302 리디렉트. (PDF 라우트와 동일 패턴, R36.)
- `lib/papers.ts`: `getPaperDetail`의 figure 매핑에서 `imageUrl: f.imageUrl ? `/api/figures/${f.id}/image` : null`로 변환(DB엔 경로, 클라엔 라우트 URL).
- `app/api/papers/[id]/route.ts`: 논문 삭제 시 `figures/{paperId}/` 객체를 best-effort 정리(`removeObject` 정책과 동일, 실패해도 DB 삭제를 막지 않음).
- `components/analyzer/analysis-view.tsx`는 변경하지 않는다 — `f.imageUrl` 있으면 `<img>`, 없으면 기존 "이미지 없음" UI가 그대로 동작하는지 확인만.

## Acceptance Criteria

```bash
npx tsc --noEmit
npx vitest run app/api/figures
npm run build
npm test
```

TDD: 서빙 라우트 테스트 — 경로 있으면 302 + 서명 URL, 없으면 404, 미인증 차단. `lib/papers` figure 매핑이 경로→`/api/figures/{id}/image`로 바뀌는지.

## 금지사항

- DB에 서명 URL/공개 URL을 저장하지 마라. 경로만(R36).
- `analysis-view.tsx`의 figure UI를 새로 만들지 마라. 이유: 기존 `imageUrl` 분기가 이미 있다(스펙 "매핑").
- 미인증 접근을 허용하지 마라. 이유: 비공개 버킷·세션 가드(R36).
- 기존 테스트를 깨뜨리지 마라.
