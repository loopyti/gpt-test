import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import {
  autocropTransparent,
  decodeImage,
  encodePngWithMetadata,
  errorResponse,
  type ImagePayload,
} from "../_shared/image-utils.ts";
import { corsHeaders, handleOptions } from "../_shared/cors.ts";
import { createStorageContext, uploadPng, downloadPng, jsonResponse } from "../_shared/storage.ts";

const SOFTWARE_LABEL = "Image Processor Engine";

interface AutocropRequestBody {
  image: ImagePayload;
  padding?: number;
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

  let body: AutocropRequestBody;
  try {
    body = await req.json();
  } catch (error) {
    return errorResponse(`잘못된 JSON 본문입니다: ${error instanceof Error ? error.message : String(error)}`);
  }

  if (!body?.image) {
    return errorResponse("'image' 필드는 필수입니다.");
  }

  const padding = typeof body.padding === "number" && body.padding >= 0 ? Math.floor(body.padding) : 0;
  const storage = createStorageContext();

  try {
    const buffer = await decodeImage(body.image, async (path) => downloadPng(storage, path));
    const { image, info, bounds } = await autocropTransparent(buffer, padding);
    const png = await encodePngWithMetadata(image, 300, SOFTWARE_LABEL);
    const filename = `${body.filenamePrefix ?? "autocrop"}_${crypto.randomUUID()}.png`;
    const stored = await uploadPng(storage, filename, png);

    return jsonResponse({
      message: "✅ 자동 크롭 완료",
      width: info.width,
      height: info.height,
      bounds,
      file: {
        ...stored,
        width: info.width,
        height: info.height,
      },
    });
  } catch (error) {
    return errorResponse(
      error instanceof Error ? error.message : "이미지를 처리하는 중 오류가 발생했습니다.",
    );
  }
});
