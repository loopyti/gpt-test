import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { Image } from "https://deno.land/x/imagescript@1.3.0/mod.ts";
import { corsHeaders } from "../_shared-ts/index.ts";
import { decodeBase64Image, encodeBase64Image, ensurePngDpi } from "../_shared-ts/image.ts";

const DEFAULT_DPI = 300;

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", {
      headers: corsHeaders,
    });
  }

  if (req.method !== "POST") {
    return new Response("Method Not Allowed", {
      status: 405,
      headers: corsHeaders,
    });
  }

  try {
    const payload = await req.json();
    if (!payload || !Array.isArray(payload.images) || payload.images.length === 0) {
      return new Response(JSON.stringify({
        ok: false,
        reason: "invalid_payload",
      }), {
        status: 400,
        headers: {
          ...corsHeaders,
          "content-type": "application/json",
        },
      });
    }

    const defaultScale = typeof payload.scale === "number" ? payload.scale : undefined;

    const results = await Promise.all(payload.images.map((entry: ResizeRequestItem, index: number) =>
      handleSingleResize(entry, index, defaultScale)
    ));

    return new Response(JSON.stringify({
      ok: true,
      images: results,
    }), {
      headers: {
        ...corsHeaders,
        "content-type": "application/json",
      },
    });
  } catch (error) {
    console.error("[resize-images]", error);
    return new Response(JSON.stringify({
      ok: false,
      reason: "internal_error",
    }), {
      status: 500,
      headers: {
        ...corsHeaders,
        "content-type": "application/json",
      },
    });
  }
});

type ResizeRequestItem = {
  base64: string;
  scale?: number;
  width?: number;
  height?: number;
};

async function handleSingleResize(entry: ResizeRequestItem, index: number, defaultScale?: number) {
  try {
    const result = await resizeImage(entry, defaultScale);
    return {
      index,
      ok: true,
      ...result,
    };
  } catch (error) {
    console.error(`[resize-images] item ${index}`, error);
    return {
      index,
      ok: false,
      reason: error instanceof Error ? error.message : "unknown_error",
    };
  }
}

async function resizeImage(entry: ResizeRequestItem, defaultScale?: number) {
  if (!entry || typeof entry.base64 !== "string" || entry.base64.length === 0) {
    throw new Error("missing_base64");
  }
  const bytes = decodeBase64Image(entry.base64);
  const decoded = await Image.decode(bytes);
  const { width: originalWidth, height: originalHeight } = decoded;

  const { width, height, scale } = resolveTargetDimensions(entry, defaultScale, originalWidth, originalHeight);
  const resized = await decoded.resize(width, height);
  const encoded = await resized.encode();
  const withDpi = ensurePngDpi(encoded, DEFAULT_DPI);

  return {
    base64: encodeBase64Image(withDpi),
    width: resized.width,
    height: resized.height,
    scale,
    original: {
      width: originalWidth,
      height: originalHeight,
    },
  };
}

function resolveTargetDimensions(entry: ResizeRequestItem, defaultScale: number | undefined, originalWidth: number, originalHeight: number) {
  if (entry.width || entry.height) {
    const targetWidth = entry.width ? Math.max(1, Math.round(entry.width)) : Math.round((entry.height! / originalHeight) * originalWidth);
    const targetHeight = entry.height ? Math.max(1, Math.round(entry.height)) : Math.round((entry.width! / originalWidth) * originalHeight);
    return {
      width: targetWidth,
      height: targetHeight,
      scale: targetWidth / originalWidth,
    };
  }

  const scale = typeof entry.scale === "number" ? entry.scale : defaultScale;
  if (!scale || !isFinite(scale) || scale <= 0) {
    throw new Error("invalid_scale");
  }
  const width = Math.max(1, Math.round(originalWidth * scale));
  const height = Math.max(1, Math.round(originalHeight * scale));
  return { width, height, scale };
}
