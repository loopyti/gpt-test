// ✅ Loopyti Postprocess Function (Supabase Storage + Signed URL)
// 기능: 투명 여백 제거 + 2048px 리사이즈 + 300DPI 메타 추가 + 다운로드 링크 반환
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { Image } from "https://deno.land/x/imagescript@1.3.0/mod.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { v4 as uuidv4 } from "https://esm.sh/uuid@9.0.0";
// ------------------------------
//  CRC32 내장
// ------------------------------
function crc32(buf) {
  let crc = -1;
  for(let i = 0; i < buf.length; i++)crc = crc >>> 8 ^ table[(crc ^ buf[i]) & 0xff];
  return (crc ^ -1) >>> 0;
}
const table = (()=>{
  let t = new Uint32Array(256);
  for(let i = 0; i < 256; i++){
    let c = i;
    for(let j = 0; j < 8; j++)c = c & 1 ? 0xedb88320 ^ c >>> 1 : c >>> 1;
    t[i] = c >>> 0;
  }
  return t;
})();
// ------------------------------
// PNG 유틸
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
  const binary = atob(base64);
  const buffer = new Uint8Array(binary.length);
  for(let i = 0; i < binary.length; i++)buffer[i] = binary.charCodeAt(i);
  return buffer;
}
function encodeBase64Image(bytes) {
  let binary = "";
  for(let i = 0; i < bytes.length; i++)binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}
function startsWithSignature(bytes) {
  if (bytes.length < PNG_SIGNATURE.length) return false;
  for(let i = 0; i < PNG_SIGNATURE.length; i++)if (bytes[i] !== PNG_SIGNATURE[i]) return false;
  return true;
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
  writeUint32(data, 0, ppm);
  writeUint32(data, 4, ppm);
  data[8] = 1;
  const crcInput = new Uint8Array(typeBytes.length + data.length);
  crcInput.set(typeBytes, 0);
  crcInput.set(data, typeBytes.length);
  const crcValue = crc32(crcInput);
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
function ensurePngDpi(pngBytes, dpi) {
  if (!startsWithSignature(pngBytes)) return pngBytes;
  const ppm = Math.max(1, Math.round(dpi / 0.0254));
  const physChunk = buildPhysChunk(ppm);
  const chunks = [];
  const signature = pngBytes.slice(0, 8);
  let offset = 8, inserted = false;
  while(offset < pngBytes.length){
    const length = pngBytes[offset] << 24 | pngBytes[offset + 1] << 16 | pngBytes[offset + 2] << 8 | pngBytes[offset + 3];
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
  if (!inserted) chunks.push(physChunk);
  const totalLength = signature.length + chunks.reduce((s, c)=>s + c.length, 0);
  const result = new Uint8Array(totalLength);
  result.set(signature, 0);
  let cursor = signature.length;
  for (const chunk of chunks){
    result.set(chunk, cursor);
    cursor += chunk.length;
  }
  return result;
}
// ------------------------------
//  Main Logic
// ------------------------------
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type, apikey"
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
async function autoCropTransparent(img) {
  const w = img.width, h = img.height;
  const pixels = img.bitmap;
  let top = h, left = w, right = 0, bottom = 0;
  let found = false;
  for(let y = 0; y < h; y++){
    for(let x = 0; x < w; x++){
      const a = pixels[(y * w + x) * 4 + 3];
      if (a > 20) {
        if (x < left) left = x;
        if (x > right) right = x;
        if (y < top) top = y;
        if (y > bottom) bottom = y;
        found = true;
      }
    }
  }
  if (!found) return img;
  const cropW = right - left;
  const cropH = bottom - top;
  const cropped = await img.crop(left, top, cropW, cropH);
  return cropped;
}
serve(async (req)=>{
  if (req.method === "OPTIONS") return new Response("ok", {
    headers: corsHeaders
  });
  try {
    const { images } = await req.json();
    if (!images?.length) return jsonResponse({
      error: "No images provided"
    }, 400);
    const supabase = createClient(Deno.env.get("SUPABASE_URL"), Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"));
    const bucket = "temp";
    const results = [];
    for (const [i, item] of images.entries()){
      const bytes = decodeBase64Image(typeof item === "string" ? item : item.b64_json);
      let img = await Image.decode(bytes);
      img = await autoCropTransparent(img);
      const maxSide = 2048;
      if (img.width > img.height) img = img.resize(maxSide, Image.RESIZE_AUTO);
      else img = img.resize(Image.RESIZE_AUTO, maxSide);
      let png = await img.encode(9);
      png = ensurePngDpi(png, 300);
      const filename = `post_${uuidv4()}.png`;
      const { error: uploadErr } = await supabase.storage.from(bucket).upload(filename, png, {
        contentType: "image/png",
        upsert: true
      });
      if (uploadErr) throw uploadErr;
      const { data: signed } = await supabase.storage.from(bucket).createSignedUrl(filename, 60);
      const downloadUrl = signed?.signedUrl || "";
      // 🔐 바로 삭제 (용량 0 유지)
      await supabase.storage.from(bucket).remove([
        filename
      ]);
      results.push({
        index: i + 1,
        width: img.width,
        height: img.height,
        link: `[2048px·300dpi 다운로드](${downloadUrl})`
      });
    }
    return jsonResponse({
      success: true,
      results
    });
  } catch (err) {
    console.error("❌ Postprocess Error:", err);
    return jsonResponse({
      error: err.message || "Internal Error"
    }, 500);
  }
});
