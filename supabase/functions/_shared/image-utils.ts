import {
  Image,
  ResamplingFilter,
} from "https://deno.land/x/imagescript@1.2.17/mod.ts";
import { encode as encodeBase64 } from "https://deno.land/std@0.224.0/encoding/base64.ts";
import { corsHeaders } from "./cors.ts";

const PNG_SIGNATURE = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
const METERS_PER_INCH = 39.3701;

export type ImagePayload =
  | string
  | {
      b64_json?: string | null;
      path?: string | null;
    };

export interface ProcessedImageInfo {
  width: number;
  height: number;
}

export interface ResizeOptions {
  allowUpscale?: boolean;
}

export interface ResizeImageResult {
  image: Image;
  info: ProcessedImageInfo;
  scale: number;
  wasResized: boolean;
}

export async function decodeImage(payload: ImagePayload, loader: (path: string) => Promise<Uint8Array> | undefined = () => undefined): Promise<Uint8Array> {
  if (payload == null) {
    throw new Error("이미지 데이터가 비어 있습니다.");
  }

  if (typeof payload === "string") {
    if (payload.startsWith("data:image")) {
      const base64 = payload.split(",", 2)[1] ?? "";
      return Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));
    }

    if (payload.trim().length === 0) {
      throw new Error("빈 문자열 이미지를 처리할 수 없습니다.");
    }

    const fromLoader = await loader(payload);
    if (fromLoader) {
      return fromLoader;
    }

    throw new Error("지원하지 않는 이미지 문자열 형식입니다.");
  }

  if (payload.b64_json && payload.b64_json.length > 0) {
    return Uint8Array.from(atob(payload.b64_json), (char) => char.charCodeAt(0));
  }

  if (payload.path) {
    const fromLoader = await loader(payload.path);
    if (fromLoader) {
      return fromLoader;
    }
  }

  throw new Error("지원하지 않는 이미지 입력 구조입니다.");
}

export async function resizeToMaxDimension(
  buffer: Uint8Array,
  target: number,
  options: ResizeOptions = {},
): Promise<ResizeImageResult> {
  const image = await Image.decode(buffer);
  return resizeImageToMaxDimension(image, target, options);
}

export async function resizeImageToMaxDimension(
  image: Image,
  target: number,
  options: ResizeOptions = {},
): Promise<ResizeImageResult> {
  if (image.width === 0 || image.height === 0) {
    throw new Error("이미지 크기가 유효하지 않습니다.");
  }

  const { allowUpscale = false } = options;
  const targetDimension = Math.max(1, Math.floor(target));
  const longestSide = Math.max(image.width, image.height);

  const shouldResize = allowUpscale ? longestSide !== targetDimension : longestSide > targetDimension;
  if (!shouldResize) {
    return {
      image,
      info: { width: image.width, height: image.height },
      scale: 1,
      wasResized: false,
    };
  }

  const scale = targetDimension / longestSide;
  const targetWidth = Math.max(1, Math.round(image.width * scale));
  const targetHeight = Math.max(1, Math.round(image.height * scale));
  const resized = await image.resize(targetWidth, targetHeight, ResamplingFilter.LANCZOS3);
  return {
    image: resized,
    info: { width: resized.width, height: resized.height },
    scale,
    wasResized: true,
  };
}

export async function resizeByFactor(
  buffer: Uint8Array,
  factor: number,
): Promise<ResizeImageResult> {
  const image = await Image.decode(buffer);
  if (image.width === 0 || image.height === 0) {
    throw new Error("이미지 크기가 유효하지 않습니다.");
  }

  if (!Number.isFinite(factor) || factor <= 0) {
    throw new Error("리사이즈 배율이 유효하지 않습니다.");
  }

  if (Math.abs(factor - 1) < 1e-6) {
    return {
      image,
      info: { width: image.width, height: image.height },
      scale: 1,
      wasResized: false,
    };
  }

  const targetWidth = Math.max(1, Math.round(image.width * factor));
  const targetHeight = Math.max(1, Math.round(image.height * factor));
  const resized = await image.resize(targetWidth, targetHeight, ResamplingFilter.LANCZOS3);
  return {
    image: resized,
    info: { width: resized.width, height: resized.height },
    scale: factor,
    wasResized: true,
  };
}

export async function autocropTransparent(
  buffer: Uint8Array,
  padding: number,
): Promise<{
  image: Image;
  info: ProcessedImageInfo;
  bounds: { left: number; top: number; right: number; bottom: number };
  original: ProcessedImageInfo;
  wasCropped: boolean;
}> {
  const image = await Image.decode(buffer);
  if (image.width === 0 || image.height === 0) {
    throw new Error("이미지 크기가 유효하지 않습니다.");
  }

  const original = { width: image.width, height: image.height } as ProcessedImageInfo;
  const bitmap = image.bitmap;
  let minX = image.width;
  let minY = image.height;
  let maxX = -1;
  let maxY = -1;

  for (let y = 0; y < image.height; y += 1) {
    for (let x = 0; x < image.width; x += 1) {
      const alpha = bitmap[(y * image.width + x) * 4 + 3];
      if (alpha > 0) {
        if (x < minX) minX = x;
        if (y < minY) minY = y;
        if (x > maxX) maxX = x;
        if (y > maxY) maxY = y;
      }
    }
  }

  if (maxX < 0 || maxY < 0) {
    return {
      image,
      info: { width: image.width, height: image.height },
      bounds: { left: 0, top: 0, right: image.width - 1, bottom: image.height - 1 },
      original,
      wasCropped: false,
    };
  }

  const left = Math.max(0, minX - padding);
  const top = Math.max(0, minY - padding);
  const right = Math.min(image.width - 1, maxX + padding);
  const bottom = Math.min(image.height - 1, maxY + padding);

  const cropWidth = right - left + 1;
  const cropHeight = bottom - top + 1;
  const cropped = await image.crop(left, top, cropWidth, cropHeight);

  const wasCropped =
    left > 0 ||
    top > 0 ||
    right < original.width - 1 ||
    bottom < original.height - 1 ||
    padding > 0;

  return {
    image: cropped,
    info: { width: cropped.width, height: cropped.height },
    bounds: { left, top, right, bottom },
    original,
    wasCropped,
  };
}

export async function encodePngWithMetadata(
  image: Image,
  dpi: number,
  softwareLabel: string,
): Promise<Uint8Array> {
  const encoded = new Uint8Array(await image.encode());
  const withDpi = setPngDpi(encoded, dpi);
  return insertSoftwareText(withDpi, softwareLabel);
}

export function pngToBase64(png: Uint8Array): string {
  return encodeBase64(png);
}

export function pngToDataUrl(png: Uint8Array): string {
  return `data:image/png;base64,${pngToBase64(png)}`;
}

function ensureSignature(buffer: Uint8Array): void {
  if (buffer.length < PNG_SIGNATURE.length || !buffer.slice(0, 8).every((value, index) => value === PNG_SIGNATURE[index])) {
    throw new Error("PNG 시그니처가 올바르지 않습니다.");
  }
}

interface PngChunk {
  type: string;
  data: Uint8Array;
  raw: Uint8Array;
}

function parseChunks(buffer: Uint8Array): PngChunk[] {
  ensureSignature(buffer);
  const chunks: PngChunk[] = [];
  let offset = 8;
  while (offset < buffer.length) {
    const length = readUint32(buffer, offset);
    const typeBytes = buffer.slice(offset + 4, offset + 8);
    const type = new TextDecoder().decode(typeBytes);
    const data = buffer.slice(offset + 8, offset + 8 + length);
    const raw = buffer.slice(offset, offset + 12 + length);
    chunks.push({ type, data, raw });
    offset += 12 + length;
  }
  return chunks;
}

function buildChunk(type: string, data: Uint8Array): Uint8Array {
  const typeBytes = new TextEncoder().encode(type);
  const chunk = new Uint8Array(12 + data.length);
  const view = new DataView(chunk.buffer);
  view.setUint32(0, data.length);
  chunk.set(typeBytes, 4);
  chunk.set(data, 8);
  const crcValue = crc32(concat(typeBytes, data));
  view.setUint32(8 + data.length, crcValue);
  return chunk;
}

function concat(...arrays: Uint8Array[]): Uint8Array {
  const total = arrays.reduce((sum, arr) => sum + arr.length, 0);
  const result = new Uint8Array(total);
  let offset = 0;
  for (const arr of arrays) {
    result.set(arr, offset);
    offset += arr.length;
  }
  return result;
}

function rebuildPng(chunks: PngChunk[]): Uint8Array {
  const body = concat(...chunks.map((chunk) => chunk.raw));
  return concat(PNG_SIGNATURE, body);
}

function setPngDpi(buffer: Uint8Array, dpi: number): Uint8Array {
  const chunks = parseChunks(buffer);
  const filtered = chunks.filter((chunk) => chunk.type !== "pHYs");
  const ppm = Math.round(dpi * METERS_PER_INCH);
  const data = new Uint8Array(9);
  const view = new DataView(data.buffer);
  view.setUint32(0, ppm);
  view.setUint32(4, ppm);
  data[8] = 1; // meter
  const chunk = buildChunk("pHYs", data);
  const index = filtered.findIndex((item) => item.type === "IDAT");
  const insertAt = index >= 0 ? index : filtered.length;
  filtered.splice(insertAt, 0, { type: "pHYs", data, raw: chunk });
  return rebuildPng(filtered);
}

function insertSoftwareText(buffer: Uint8Array, software: string): Uint8Array {
  const chunks = parseChunks(buffer);
  const filtered = chunks.filter((chunk) => {
    if (chunk.type !== "tEXt") return true;
    const zeroIndex = chunk.data.indexOf(0);
    if (zeroIndex < 0) return true;
    const keyword = new TextDecoder().decode(chunk.data.slice(0, zeroIndex));
    return keyword !== "Software";
  });

  const encoder = new TextEncoder();
  const keywordBytes = encoder.encode("Software");
  const textBytes = encoder.encode(software);
  const data = concat(keywordBytes, new Uint8Array([0]), textBytes);
  const chunk = buildChunk("tEXt", data);
  const insertAt = filtered.length - 1; // before IEND
  filtered.splice(insertAt, 0, { type: "tEXt", data, raw: chunk });
  return rebuildPng(filtered);
}

function readUint32(buffer: Uint8Array, offset: number): number {
  return (
    (buffer[offset] << 24) |
    (buffer[offset + 1] << 16) |
    (buffer[offset + 2] << 8) |
    buffer[offset + 3]
  ) >>> 0;
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) {
      c = ((c & 1) !== 0 ? 0xedb88320 ^ (c >>> 1) : c >>> 1) >>> 0;
    }
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buffer: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < buffer.length; i += 1) {
    c = CRC_TABLE[(c ^ buffer[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

export function errorResponse(message: string, status = 400): Response {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      ...corsHeaders,
    },
  });
}
