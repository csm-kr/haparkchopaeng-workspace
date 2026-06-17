import { createSupabaseAdmin } from "@/lib/supabase/admin";

// Supabase Storage 헬퍼 — 서버 전용(ADR-016).
// CRITICAL: service role 키는 서버에서만(R2). 비공개 버킷·단기 서명 URL만 — 공개 버킷·영구 URL 금지(R36).
// CRITICAL: 환경변수는 모듈 로드가 아니라 호출 시점에 읽는다 — 키 없이도 next build 통과(R2).

const DEFAULT_BUCKET = "hapark";

function bucketName(): string {
  return process.env.SUPABASE_STORAGE_BUCKET ?? DEFAULT_BUCKET;
}

/** 비공개 버킷을 멱등 생성한다(service role). 이미 있으면 아무것도 하지 않는다. */
export async function ensureBucket(): Promise<void> {
  const admin = createSupabaseAdmin();
  const name = bucketName();
  const { data } = await admin.storage.getBucket(name);
  if (data) return;
  // 비공개 버킷 — 다운로드는 서명 URL로만(R36).
  const { error } = await admin.storage.createBucket(name, { public: false });
  if (error) throw new Error(error.message);
}

/** 클라이언트 직접 업로드용 서명 URL(프리사인). 비공개 버킷, 서버는 서명만(R36). */
export async function createSignedUploadUrl(
  path: string,
): Promise<{ uploadUrl: string; path: string }> {
  const admin = createSupabaseAdmin();
  const { data, error } = await admin.storage
    .from(bucketName())
    .createSignedUploadUrl(path);
  if (error || !data) {
    throw new Error(error?.message ?? "업로드 URL을 만들지 못했어요.");
  }
  return { uploadUrl: data.signedUrl, path };
}

/** 단기 서명 다운로드 URL. 공개 버킷·영구 URL 금지(R36). */
export async function signedDownloadUrl(
  path: string,
  ttlSec = 60,
): Promise<string> {
  const admin = createSupabaseAdmin();
  const { data, error } = await admin.storage
    .from(bucketName())
    .createSignedUrl(path, ttlSec);
  if (error || !data) {
    throw new Error(error?.message ?? "다운로드 URL을 만들지 못했어요.");
  }
  return data.signedUrl;
}

/** 서버가 PDF 바이트를 스토리지에 직접 올린다(arXiv fetch 경로). */
export async function uploadPdf(
  path: string,
  body: ArrayBuffer | Buffer,
): Promise<void> {
  await ensureBucket();
  const admin = createSupabaseAdmin();
  const { error } = await admin.storage
    .from(bucketName())
    .upload(path, body, { contentType: "application/pdf", upsert: false });
  if (error) throw new Error(error.message);
}

/** 스토리지 객체를 Buffer로 내려받는다(서버 전용 — PDF 페이지 렌더 입력 등). 실패 시 throw. */
export async function downloadObject(path: string): Promise<Buffer> {
  const admin = createSupabaseAdmin();
  const { data, error } = await admin.storage.from(bucketName()).download(path);
  if (error || !data) {
    throw new Error(error?.message ?? "객체를 내려받지 못했어요.");
  }
  return Buffer.from(await data.arrayBuffer());
}

/** 서버가 PNG 바이트를 스토리지에 올린다(figure 렌더 결과). 비공개 버킷·덮어쓰기 허용(재분석 시 갱신). */
export async function uploadPng(path: string, body: Buffer): Promise<void> {
  await ensureBucket();
  const admin = createSupabaseAdmin();
  const { error } = await admin.storage
    .from(bucketName())
    .upload(path, body, { contentType: "image/png", upsert: true });
  if (error) throw new Error(error.message);
}

/**
 * 스토리지 객체를 제거한다(논문 삭제 시 원문 PDF 정리).
 * best-effort: 실패해도 throw하지 않는다 — 스토리지 정리 실패가 DB 삭제를 막지 않게.
 */
export async function removeObject(path: string): Promise<void> {
  try {
    const admin = createSupabaseAdmin();
    await admin.storage.from(bucketName()).remove([path]);
  } catch {
    // 정리 실패는 무시(고아 객체는 별도 청소로). DB가 진실의 원천.
  }
}

/**
 * 스토리지 폴더(prefix) 아래 객체를 모두 제거한다(논문 삭제 시 figure 이미지 정리).
 * best-effort: 실패해도 throw하지 않는다 — 정리 실패가 DB 삭제를 막지 않게(removeObject와 동일 정책).
 */
export async function removeFolder(prefix: string): Promise<void> {
  try {
    const admin = createSupabaseAdmin();
    const bucket = bucketName();
    const { data } = await admin.storage.from(bucket).list(prefix);
    if (!data || data.length === 0) return;
    await admin.storage.from(bucket).remove(data.map((f) => `${prefix}/${f.name}`));
  } catch {
    // 정리 실패는 무시 — best-effort.
  }
}
