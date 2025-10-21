import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import {
  decodeImage,
  encodePngWithMetadata,
  errorResponse,
  resizeToMaxDimension,
  type ImagePayload,
} from "../_shared/image-utils.ts";
import { corsHeaders, handleOptions } from "../_shared/cors.ts";
import { createStorageContext, uploadPng, downloadPng, jsonResponse } from "../_shared/storage.ts";

const DEFAULT_MAX_DIMENSION = 2048;
const DEFAULT_DPI = 300;
const SOFTWARE_LABEL = "Image Processor Engine";

interface PostprocessRequestBody {
  images: ImagePayload[];
  targetMaxDimension?: number;
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

  let body: PostprocessRequestBody;
  try {
    body = await req.json();
  } catch (error) {
    return errorResponse(`잘못된 JSON 본문입니다: ${error instanceof Error ? error.message : String(error)}`);
  }

  if (!body?.images || !Array.isArray(body.images) || body.images.length === 0) {
    return errorResponse("'images' 배열은 필수입니다.");
  }

  const targetMaxDimension = Math.max(
    1,
    Math.floor(body.targetMaxDimension ?? DEFAULT_MAX_DIMENSION),
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

    for (let index = 0; index < body.images.length; index += 1) {
      const buffer = await decodeImage(body.images[index], async (path) => downloadPng(storage, path));
      const { image, info } = await resizeToMaxDimension(buffer, targetMaxDimension);
      const png = await encodePngWithMetadata(image, targetDpi, SOFTWARE_LABEL);
      const filename = `${body.filenamePrefix ?? "img"}_${String(index + 1).padStart(2, "0")}_${info.width}x${info.height}_${targetDpi}dpi.png`;
      const stored = await uploadPng(storage, filename, png);
      results.push({ file: stored, width: info.width, height: info.height, index: index + 1 });
    }

    return jsonResponse({
      message: "✅ 이미지 후처리 완료",
      targetMaxDimension,
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
