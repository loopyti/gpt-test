// ✅ Loopyti Resize Function (Self-contained, Supabase 호환)
// 기능: 배율 리사이즈 + 300DPI 메타 추가 + Base64 반환
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { Image } from "https://deno.land/x/imagescript@1.3.0/mod.ts";
// ------------------------------
//  CRC32 (내장 버전, 외부 import 없음)
// ------------------------------
function crc32(buf) {
  let crc = -1;
  for(let i = 0; i < buf.length; i++){
    crc = crc >>> 8 ^ table[(crc ^ buf[i]) & 0xff];
  }
  return (crc ^ -1) >>> 0;
}
const table = (()=>{
  let t = new Uint32Array(256);
  for(let i = 0; i < 256; i++){
    let c = i;
    for(let j = 0; j < 8; j++){
      c = c & 1 ? 0xedb88320 ^ c >>> 1 : c >>> 1;
    }
    t[i] = c >>> 0;
  }
  return t;
})();
// ------------------------------
//  PNG 유틸
// ------------------------------
const PNG_SIGNATURE = new Uint8Array([
  137,
  80,
  78,
  71,
  13,
  10,
  26,
  10
]);
const TEXT_ENCODER = new TextEncoder();
const TEXT_DECODER = new TextDecoder();
function decodeBase64Image(input) {
  const base64 = input.includes(",") ? input.split(",", 2)[1] : input.trim();
  const normalized = base64.replace(/\s+/g, "");
  const binary = atob(normalized);
  const buffer = new Uint8Array(binary.length);
  for(let i = 0; i < binary.length; i++)buffer[i] = binary.charCodeAt(i);
  return buffer;
}
function encodeBase64Image(bytes) {
  let binary = "";
  const chunkSize = 0x8000;
  for(let i = 0; i < bytes.length; i += chunkSize){
    const chunk = bytes.subarray(i, i + chunkSize);
    let chunkString = "";
    for(let j = 0; j < chunk.length; j++){
      chunkString += String.fromCharCode(chunk[j]);
    }
    binary += chunkString;
  }
  return btoa(binary);
}
function readUint32(bytes, offset) {
  return bytes[offset] << 24 | bytes[offset + 1] << 16 | bytes[offset + 2] << 8 | bytes[offset + 3];
}
function writeUint32(target, offset, value) {
  target[offset] = value >>> 24 & 0xff;
  target[offset + 1] = value >>> 16 & 0xff;
  target[offset + 2] = value >>> 8 & 0xff;
  target[offset + 3] = value & 0xff;
}
function buildPhysChunk(ppm) {
  const lengthBytes = new Uint8Array([
    0,
    0,
    0,
    9
  ]);
  const typeBytes = TEXT_ENCODER.encode("pHYs");
  const data = new Uint8Array(9);
  const ppm = Math.max(1, Math.round(300 / 0.0254)); // DPI 300 고정
  writeUint32(data, 0, ppm);
  writeUint32(data, 4, ppm);
  data[8] = 1;
  const crcInput = new Uint8Array(typeBytes.length + data.length);
  crcInput.set(typeBytes, 0);
  crcInput.set(data, typeBytes.length);
  const crcValue = crc32(crcInput) >>> 0;
  const crcBytes = new Uint8Array([
    crcValue >>> 24 & 0xff,
    crcValue >>> 16 & 0xff,
    crcValue >>> 8 & 0xff,
    crcValue & 0xff
  ]);
  const chunk = new Uint8Array(4 + 4 + data.length + 4);
  chunk.set(lengthBytes, 0);
  chunk.set(typeBytes, 4);
  chunk.set(data, 8);
  chunk.set(crcBytes, 8 + data.length);
  return chunk;
}
function ensurePngDpi(pngBytes) {
  if (!pngBytes.slice(0, 8).every((v, i)=>v === PNG_SIGNATURE[i])) return pngBytes;
  const physChunk = buildPhysChunk(Math.max(1, Math.round(300 / 0.0254)));
  const chunks = [];
  const signature = pngBytes.slice(0, 8);
  let offset = 8;
  let inserted = false;
  while(offset < pngBytes.length){
    const length = readUint32(pngBytes, offset);
    const typeBytes = pngBytes.slice(offset + 4, offset + 8);
    const type = TEXT_DECODER.decode(typeBytes);
    const chunkEnd = offset + 8 + length + 4;
    const chunk = pngBytes.slice(offset, chunkEnd);
    chunks.push(chunk);
    if (type === "IHDR" && !inserted) {
      chunks.push(physChunk);
      inserted = true;
    }
    offset = chunkEnd;
  }
  const total = signature.length + chunks.reduce((s, c)=>s + c.length, 0);
  const result = new Uint8Array(total);
  result.set(signature, 0);
  let cursor = signature.length;
  for (const c of chunks){
    result.set(c, cursor);
    cursor += c.length;
  }
  return result;
}
// ------------------------------
//  메인 로직
// ------------------------------
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type"
};
function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json"
    },
    status
  });
}
serve(async (req)=>{
  if (req.method === "OPTIONS") return new Response("ok", {
    headers: corsHeaders
  });
  try {
    const { images, factor = 1.0 } = await req.json();
    if (!images?.length) return jsonResponse({
      error: "No images provided"
    }, 400);
    if (factor <= 0 || factor > 4.0) return jsonResponse({
      error: "Invalid factor"
    }, 400);
    const results = [];
    for (const [i, item] of images.entries()){
      const bytes = decodeBase64Image(typeof item === "string" ? item : item.b64_json);
      let img = await Image.decode(bytes);
      const newW = Math.max(1, Math.round(img.width * factor));
      const newH = Math.max(1, Math.round(img.height * factor));
      img = img.resize(newW, newH);
      let png = await img.encode(9);
      png = ensurePngDpi(png);
      const base64 = encodeBase64Image(png);
      results.push({
        index: i + 1,
        width: newW,
        height: newH,
        base64
      });
    }
    return jsonResponse({
      success: true,
      results
    });
  } catch (err) {
    console.error("❌ Resize Error:", err);
    return jsonResponse({
      error: err.message || "Internal Error"
    }, 500);
  }
});
