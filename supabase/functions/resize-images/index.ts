import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import {
  decodeImage,
  encodePngWithMetadata,
  errorResponse,
  resizeByFactor,
  type ImagePayload,
} from "../_shared/image-utils.ts";
import { corsHeaders, handleOptions } from "../_shared/cors.ts";
import { createStorageContext, uploadPng, downloadPng, jsonResponse } from "../_shared/storage.ts";

const DEFAULT_FACTOR = 2.0;
const DEFAULT_DPI = 300;
const SOFTWARE_LABEL = "Image Processor Engine";

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

interface ResizeRequestBody {
  images?: ImagePayload[];
  paths?: string[];
  selectedIndices?: number[];
  factor?: number;
  targetDpi?: number;
  filenamePrefix?: string;
}

serve(async (req) => {
  const options = handleOptions(req);
  if (options) {
    return options;
  }

  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405, headers: corsHeaders });
  }

  let body: ResizeRequestBody;
  try {
    body = await req.json();
  } catch (error) {
    return errorResponse(`잘못된 JSON 본문입니다: ${error instanceof Error ? error.message : String(error)}`);
  }

  const selectedIndices = new Set(
    Array.isArray(body.selectedIndices)
      ? body.selectedIndices
        .map((value) => Math.trunc(value))
        .filter((value) => value > 0)
      : [],
  );

  const sources = [] as Array<{ payload: ImagePayload; index: number }>;
  let runningIndex = 1;
  if (Array.isArray(body.images)) {
    for (const image of body.images) {
      if (selectedIndices.size === 0 || selectedIndices.has(runningIndex)) {
        sources.push({ payload: image, index: runningIndex });
      }
      runningIndex += 1;
    }
  }
  if (Array.isArray(body.paths)) {
    for (const path of body.paths) {
      if (selectedIndices.size === 0 || selectedIndices.has(runningIndex)) {
        sources.push({ payload: { path }, index: runningIndex });
      }
      runningIndex += 1;
    }
  }

  if (sources.length === 0) {
    if (selectedIndices.size > 0) {
      return errorResponse("선택한 인덱스에 해당하는 이미지가 없습니다.");
    }
    return errorResponse("'images' 또는 'paths' 중 하나 이상을 제공해야 합니다.");
  }

  const factor = clamp(
    typeof body.factor === "number" && Number.isFinite(body.factor) ? body.factor : DEFAULT_FACTOR,
    0.1,
    8,
  );
  const targetDpi = Math.max(72, Math.floor(body.targetDpi ?? DEFAULT_DPI));
  const storage = createStorageContext();

  try {
    const results = [] as Array<{
      file: Awaited<ReturnType<typeof uploadPng>>;
      width: number;
      height: number;
      index: number;
    }>;

    for (let index = 0; index < sources.length; index += 1) {
      const source = sources[index];
      const buffer = await decodeImage(source.payload, async (path) => downloadPng(storage, path));
      const { image, info } = await resizeByFactor(buffer, factor);
      const png = await encodePngWithMetadata(image, targetDpi, SOFTWARE_LABEL);
      const factorLabel = factor.toFixed(2).replace(/\.00$/, "").replace(/0+$/, "");
      const filename = `${body.filenamePrefix ?? "resized"}_${String(source.index).padStart(2, "0")}_x${factorLabel}_${info.width}x${info.height}_${targetDpi}dpi.png`;
      const stored = await uploadPng(storage, filename, png);
      results.push({ file: stored, width: info.width, height: info.height, index: source.index });
    }

    return jsonResponse({
      message: "✅ 리사이즈 완료",
      factor,
      targetDpi,
      files: results.map((result) => ({
        ...result.file,
        width: result.width,
        height: result.height,
        originalIndex: result.index,
      })),
    });
  } catch (error) {
    return errorResponse(
      error instanceof Error ? error.message : "이미지를 처리하는 중 오류가 발생했습니다.",
    );
  }
});
