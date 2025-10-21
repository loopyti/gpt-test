import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { Image } from "https://deno.land/x/imagescript@1.3.0/mod.ts";
import { corsHeaders } from "../_shared-ts/index.ts";
import { decodeBase64Image, encodeBase64Image, ensurePngDpi } from "../_shared-ts/image.ts";

const TARGET_MAX_DIMENSION = 2048;
const TARGET_DPI = 300;
const AUTOCROP_ALPHA_THRESHOLD = 8;

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
    if (!payload || !Array.isArray(payload.images)) {
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

    const results = await Promise.all(payload.images.map((base64: string, index: number) =>
      processImage(base64, index)
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
    console.error("[postprocess-images]", error);
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

async function processImage(base64: string, index: number) {
  const inputBytes = decodeBase64Image(base64);
  const decoded = await Image.decode(inputBytes);
  const original = {
    width: decoded.width,
    height: decoded.height,
  };
  const cropped = autoCropTransparent(decoded, AUTOCROP_ALPHA_THRESHOLD);
  const resized = await resizeToMaxDimension(cropped, TARGET_MAX_DIMENSION);
  const encoded = await resized.encode();
  const withDpi = ensurePngDpi(encoded, TARGET_DPI);
  return {
    index,
    width: resized.width,
    height: resized.height,
    base64: encodeBase64Image(withDpi),
    original,
  };
}

function autoCropTransparent(image: Image, alphaThreshold = 0): Image {
  const threshold = Math.min(255, Math.max(0, Math.floor(alphaThreshold)));
  const width = image.width;
  const height = image.height;
  if (width === 0 || height === 0) {
    return image;
  }

  const raw = (image as unknown as { bitmap?: Uint8Array; data?: Uint8Array }).bitmap ??
    (image as unknown as { data?: Uint8Array }).data;
  if (!raw || raw.length < width * height * 4) {
    return image;
  }

  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;

  for (let y = 0; y < height; y++) {
    const rowOffset = y * width * 4;
    for (let x = 0; x < width; x++) {
      const alpha = raw[rowOffset + x * 4 + 3];
      if (alpha > threshold) {
        if (x < minX) minX = x;
        if (y < minY) minY = y;
        if (x > maxX) maxX = x;
        if (y > maxY) maxY = y;
      }
    }
  }

  if (maxX === -1 || maxY === -1) {
    return image;
  }

  if (minX === 0 && minY === 0 && maxX === width - 1 && maxY === height - 1) {
    return image;
  }

  const cropWidth = Math.max(1, maxX - minX + 1);
  const cropHeight = Math.max(1, maxY - minY + 1);
  const hasClone = typeof (image as unknown as { clone?: () => Image }).clone === "function";
  const working = hasClone ? (image as unknown as { clone: () => Image }).clone() : image;
  if (typeof working.crop === "function") {
    working.crop(minX, minY, cropWidth, cropHeight);
  }
  return working;
}

async function resizeToMaxDimension(image: Image, target: number): Promise<Image> {
  const maxSide = Math.max(image.width, image.height);
  if (maxSide === target) {
    return image;
  }
  const scale = target / maxSide;
  const nextWidth = Math.max(1, Math.round(image.width * scale));
  const nextHeight = Math.max(1, Math.round(image.height * scale));
  if (nextWidth === image.width && nextHeight === image.height) {
    return image;
  }
  return await image.resize(nextWidth, nextHeight);
}
