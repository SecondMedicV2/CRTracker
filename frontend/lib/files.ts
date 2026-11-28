import { ApiError } from "@/lib/api";

function saveBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/** Downloads a server-generated file (e.g. a formula-safe CSV) from the API. */
export async function downloadFromApi(path: string, filename: string) {
  const r = await fetch(`/api/v1${path}`);
  if (!r.ok) throw new ApiError(r.status, "Download failed. Please try again.");
  saveBlob(await r.blob(), filename);
}

/** Uploads one file as multipart form data and returns the JSON reply. */
export async function uploadToApi<T = any>(path: string, file: File): Promise<T> {
  const fd = new FormData();
  fd.append("file", file);
  const r = await fetch(`/api/v1${path}`, { method: "POST", body: fd });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new ApiError(r.status, typeof data.detail === "string" ? data.detail : "Upload failed.");
  return data;
}

export function saveCanvasPng(canvas: HTMLCanvasElement, filename: string) {
  canvas.toBlob((b) => b && saveBlob(b, filename), "image/png");
}
