import { crc32 } from "https://deno.land/std@0.224.0/hash/crc32.ts";

const PNG_SIGNATURE = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
const TEXT_ENCODER = new TextEncoder();
const TEXT_DECODER = new TextDecoder();

export function decodeBase64Image(input: string): Uint8Array {
  const base64 = input.includes(",") ? input.split(",", 2)[1] : input.trim();
  const normalized = base64.replace(/\s+/g, "");
  const binary = atob(normalized);
  const buffer = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    buffer[i] = binary.charCodeAt(i);
  }
  return buffer;
}

export function encodeBase64Image(bytes: Uint8Array): string {
  let binary = "";
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize);
    let chunkString = "";
    for (let j = 0; j < chunk.length; j++) {
      chunkString += String.fromCharCode(chunk[j]);
    }
    binary += chunkString;
  }
  return btoa(binary);
}

export function ensurePngDpi(pngBytes: Uint8Array, dpi: number): Uint8Array {
  if (!startsWithSignature(pngBytes)) {
    return pngBytes;
  }
  const ppm = Math.max(1, Math.round(dpi / 0.0254));
  const physChunk = buildPhysChunk(ppm);
  const chunks: Uint8Array[] = [];
  const signature = pngBytes.slice(0, 8);
  let offset = 8;
  let inserted = false;
  while (offset < pngBytes.length) {
    const length = readUint32(pngBytes, offset);
    const typeBytes = pngBytes.slice(offset + 4, offset + 8);
    const type = TEXT_DECODER.decode(typeBytes);
    const chunkEnd = offset + 8 + length + 4;
    if (type === "pHYs") {
      chunks.push(physChunk);
      inserted = true;
    } else {
      const chunk = pngBytes.slice(offset, chunkEnd);
      chunks.push(chunk);
      if (type === "IHDR" && !inserted) {
        chunks.push(physChunk);
        inserted = true;
      }
    }
    offset = chunkEnd;
  }
  if (!inserted) {
    chunks.push(physChunk);
  }
  const totalLength = signature.length + chunks.reduce((sum, chunk)=>sum + chunk.length, 0);
  const result = new Uint8Array(totalLength);
  result.set(signature, 0);
  let cursor = signature.length;
  for (const chunk of chunks) {
    result.set(chunk, cursor);
    cursor += chunk.length;
  }
  return result;
}

function startsWithSignature(bytes: Uint8Array): boolean {
  if (bytes.length < PNG_SIGNATURE.length) return false;
  for (let i = 0; i < PNG_SIGNATURE.length; i++) {
    if (bytes[i] !== PNG_SIGNATURE[i]) return false;
  }
  return true;
}

function readUint32(bytes: Uint8Array, offset: number): number {
  return (bytes[offset] << 24) | (bytes[offset + 1] << 16) | (bytes[offset + 2] << 8) | bytes[offset + 3];
}

function buildPhysChunk(ppm: number): Uint8Array {
  const lengthBytes = new Uint8Array([0, 0, 0, 9]);
  const typeBytes = TEXT_ENCODER.encode("pHYs");
  const data = new Uint8Array(9);
  writeUint32(data, 0, ppm);
  writeUint32(data, 4, ppm);
  data[8] = 1; // units: meter
  const crcInput = new Uint8Array(typeBytes.length + data.length);
  crcInput.set(typeBytes, 0);
  crcInput.set(data, typeBytes.length);
  const crcValue = crc32(crcInput) >>> 0;
  const crcBytes = new Uint8Array([
    (crcValue >>> 24) & 0xff,
    (crcValue >>> 16) & 0xff,
    (crcValue >>> 8) & 0xff,
    crcValue & 0xff
  ]);
  const chunk = new Uint8Array(4 + 4 + data.length + 4);
  chunk.set(lengthBytes, 0);
  chunk.set(typeBytes, 4);
  chunk.set(data, 8);
  chunk.set(crcBytes, 8 + data.length);
  return chunk;
}

function writeUint32(target: Uint8Array, offset: number, value: number) {
  target[offset] = (value >>> 24) & 0xff;
  target[offset + 1] = (value >>> 16) & 0xff;
  target[offset + 2] = (value >>> 8) & 0xff;
  target[offset + 3] = value & 0xff;
}
