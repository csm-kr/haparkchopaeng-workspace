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
