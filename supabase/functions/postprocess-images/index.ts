import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import {
  autocropTransparent,
  decodeImage,
  encodePngWithMetadata,
  errorResponse,
  pngToBase64,
  resizeImageToMaxDimension,
  type ImagePayload,
} from "../_shared/image-utils.ts";
import { corsHeaders, handleOptions } from "../_shared/cors.ts";
import { jsonResponse } from "../_shared/storage.ts";

const DEFAULT_MAX_DIMENSION = 2048;
const DEFAULT_DPI = 300;
const SOFTWARE_LABEL = "Image Processor Engine";
const DEFAULT_AUTOCROP_PADDING = 0;

interface PostprocessRequestBody {
  images: ImagePayload[];
  targetMaxDimension?: number;
  targetDpi?: number;
  autocropPadding?: number;
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

  const targetMaxDimension = Math.max(1, Math.floor(body.targetMaxDimension ?? DEFAULT_MAX_DIMENSION));
  const targetDpi = Math.max(72, Math.floor(body.targetDpi ?? DEFAULT_DPI));
  const autocropPadding = Math.max(0, Math.floor(body.autocropPadding ?? DEFAULT_AUTOCROP_PADDING));

  try {
    const results = [] as Array<{
      base64: string;
      width: number;
      height: number;
      originalIndex: number;
      cropBounds: { left: number; top: number; right: number; bottom: number };
      originalSize: { width: number; height: number };
      wasCropped: boolean;
      scale: number;
      wasUpscaled: boolean;
      dpi: number;
    }>;

    for (let index = 0; index < body.images.length; index += 1) {
      const buffer = await decodeImage(body.images[index]);
      const cropResult = await autocropTransparent(buffer, autocropPadding);
      const resized = await resizeImageToMaxDimension(cropResult.image, targetMaxDimension, { allowUpscale: true });
      const png = await encodePngWithMetadata(resized.image, targetDpi, SOFTWARE_LABEL);
      const base64 = pngToBase64(png);

      results.push({
        base64,
        width: resized.info.width,
        height: resized.info.height,
        originalIndex: index + 1,
        cropBounds: cropResult.bounds,
        originalSize: cropResult.original,
        wasCropped: cropResult.wasCropped,
        scale: resized.scale,
        wasUpscaled: resized.scale > 1,
        dpi: targetDpi,
      });
    }

    return jsonResponse({
      message: "✅ 이미지 후처리 완료",
      targetMaxDimension,
      targetDpi,
      autocropPadding,
      images: results.map((result) => ({
        ...result,
        dataUrl: `data:image/png;base64,${result.base64}`,
      })),
    });
  } catch (error) {
    return errorResponse(
      error instanceof Error ? error.message : "이미지를 처리하는 중 오류가 발생했습니다.",
    );
  }
});
