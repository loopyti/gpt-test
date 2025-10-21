import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import {
  decodeImage,
  encodePngWithMetadata,
  errorResponse,
  jsonResponse,
  pngToBase64,
  resizeByFactor,
  type ImagePayload,
} from "../_shared/image-utils.ts";
import { corsHeaders, handleOptions } from "../_shared/cors.ts";

const DEFAULT_FACTOR = 2.0;
const DEFAULT_DPI = 300;
const SOFTWARE_LABEL = "Image Processor Engine";

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

interface ResizeRequestBody {
  images: ImagePayload[];
  selectedIndices?: number[];
  factor?: number;
  targetDpi?: number;
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

  if (!body?.images || !Array.isArray(body.images) || body.images.length === 0) {
    return errorResponse("'images' 배열은 최소 한 개 이상의 항목을 포함해야 합니다.");
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
  for (const image of body.images) {
    if (selectedIndices.size === 0 || selectedIndices.has(runningIndex)) {
      sources.push({ payload: image, index: runningIndex });
    }
    runningIndex += 1;
  }

  if (sources.length === 0) {
    return errorResponse("선택한 인덱스에 해당하는 이미지가 없습니다.");
  }

  const factor = clamp(
    typeof body.factor === "number" && Number.isFinite(body.factor) ? body.factor : DEFAULT_FACTOR,
    0.1,
    8,
  );
  const targetDpi = Math.max(72, Math.floor(body.targetDpi ?? DEFAULT_DPI));
  try {
    const results = [] as Array<{
      width: number;
      height: number;
      index: number;
      base64: string;
    }>;

    for (let index = 0; index < sources.length; index += 1) {
      const source = sources[index];
      const buffer = await decodeImage(source.payload);
      const { image, info } = await resizeByFactor(buffer, factor);
      const png = await encodePngWithMetadata(image, targetDpi, SOFTWARE_LABEL);
      const base64 = pngToBase64(png);
      results.push({ base64, width: info.width, height: info.height, index: source.index });
    }

    return jsonResponse({
      message: "✅ 리사이즈 완료",
      factor,
      targetDpi,
      images: results.map((result) => ({
        base64: result.base64,
        dataUrl: `data:image/png;base64,${result.base64}`,
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
