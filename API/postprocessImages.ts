import fs from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";

export interface PostprocessImagesActionInput {
  images: Array<string | { b64_json?: string | null } | null>;
  targetMaxDimension?: number;
  targetDpi?: number;
}

export interface PostprocessImagesActionResult {
  message: string;
  downloads: Array<{ label: string; url: string; path: string }>;
  processedImages: Array<{
    path: string;
    width: number;
    height: number;
    dpi: number;
  }>;
}

export interface CustomGPTAction<Input, Output> {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  handler: (input: Input) => Promise<Output>;
}

const OUTPUT_DIRECTORY = "/mnt/data";
const SOFTWARE_TEXT = "Image Processor Engine";
const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

function ensurePngSignature(buffer: Buffer): void {
  if (!buffer.subarray(0, 8).equals(PNG_SIGNATURE)) {
    throw new Error("Provided image is not a valid PNG file");
  }
}

function createTextChunk(keyword: string, text: string): Buffer {
  const keywordBuffer = Buffer.from(keyword, "latin1");
  const textBuffer = Buffer.from(text, "latin1");
  const data = Buffer.concat([
    keywordBuffer,
    Buffer.from([0]),
    textBuffer,
  ]);

  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);

  const type = Buffer.from("tEXt", "ascii");
  const crcBuffer = Buffer.alloc(4);
  crcBuffer.writeUInt32BE(crc32(Buffer.concat([type, data])), 0);

  return Buffer.concat([length, type, data, crcBuffer]);
}

function insertTextChunk(buffer: Buffer, chunk: Buffer): Buffer {
  ensurePngSignature(buffer);

  let offset = 8; // skip signature
  while (offset < buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.subarray(offset + 4, offset + 8).toString("ascii");

    if (type === "IEND") {
      const before = buffer.subarray(0, offset);
      const after = buffer.subarray(offset);
      return Buffer.concat([before, chunk, after]);
    }

    offset += 8 + length + 4; // length + type + data + crc
  }

  throw new Error("Failed to inject PNG metadata: IEND chunk not found");
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i += 1) {
    let c = i;
    for (let k = 0; k < 8; k += 1) {
      c = ((c & 1) !== 0 ? 0xedb88320 ^ (c >>> 1) : c >>> 1) >>> 0;
    }
    table[i] = c >>> 0;
  }
  return table;
})();

function crc32(buffer: Buffer): number {
  let crc = 0xffffffff;
  for (let i = 0; i < buffer.length; i += 1) {
    crc = CRC_TABLE[(crc ^ buffer[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function decodeImagePayload(
  image: string | { b64_json?: string | null } | null,
): Buffer {
  if (image == null) {
    throw new Error("Encountered empty image payload");
  }

  if (typeof image === "string") {
    const commaIndex = image.indexOf(",");
    const base64 = commaIndex >= 0 ? image.slice(commaIndex + 1) : image;
    return Buffer.from(base64, "base64");
  }

  if (typeof image.b64_json === "string" && image.b64_json.length > 0) {
    return Buffer.from(image.b64_json, "base64");
  }

  throw new Error("Unsupported image payload structure");
}

async function savePngWithMetadata(
  buffer: Buffer,
  index: number,
  width: number,
  height: number,
  dpi: number,
): Promise<{ path: string; linkLabel: string }> {
  await fs.mkdir(OUTPUT_DIRECTORY, { recursive: true });

  const filename = `img_${String(index + 1).padStart(2, "0")}_${width}x${height}_${dpi}dpi.png`;
  const outputPath = path.join(OUTPUT_DIRECTORY, filename);

  const textChunk = createTextChunk("Software", SOFTWARE_TEXT);
  const finalBuffer = insertTextChunk(buffer, textChunk);
  await fs.writeFile(outputPath, finalBuffer);

  const linkLabel = `[${width}×${height}·${dpi}dpi 다운로드](sandbox:${outputPath})`;
  return { path: outputPath, linkLabel };
}

async function processImage(
  payload: Buffer,
  index: number,
  targetMaxDimension: number,
  targetDpi: number,
): Promise<{
  path: string;
  linkLabel: string;
  width: number;
  height: number;
}> {
  const baseImage = sharp(payload);
  const metadata = await baseImage.metadata();

  if (!metadata.width || !metadata.height) {
    throw new Error("Unable to read image dimensions");
  }

  const scale = targetMaxDimension / Math.max(metadata.width, metadata.height);
  const width = Math.max(1, Math.round(metadata.width * scale));
  const height = Math.max(1, Math.round(metadata.height * scale));

  const resized = await baseImage
    .resize(width, height, {
      kernel: sharp.kernel.lanczos3,
    })
    .png({ compressionLevel: 9 })
    .withMetadata({ density: targetDpi })
    .toBuffer();

  const result = await savePngWithMetadata(resized, index, width, height, targetDpi);

  return {
    path: result.path,
    linkLabel: result.linkLabel,
    width,
    height,
  };
}

async function handlePostprocessImages(
  input: PostprocessImagesActionInput,
): Promise<PostprocessImagesActionResult> {
  const { images, targetMaxDimension = 2048, targetDpi = 300 } = input;

  if (!Array.isArray(images) || images.length === 0) {
    throw new Error("이미지 데이터가 비어 있습니다.");
  }

  const processedImages: PostprocessImagesActionResult["processedImages"] = [];
  const downloads: PostprocessImagesActionResult["downloads"] = [];

  for (let index = 0; index < images.length; index += 1) {
    const payload = decodeImagePayload(images[index]);
    const result = await processImage(
      payload,
      index,
      targetMaxDimension,
      targetDpi,
    );

    processedImages.push({
      path: result.path,
      width: result.width,
      height: result.height,
      dpi: targetDpi,
    });

    downloads.push({
      label: result.linkLabel,
      url: `sandbox:${result.path}`,
      path: result.path,
    });
  }

  const message =
    downloads.length > 0
      ? `✅이미지 생성 완료\n\n${downloads
          .map((download) => download.label)
          .join("\n\n")}`
      : "⚠️변환된 이미지가 없습니다.";

  return {
    message,
    downloads,
    processedImages,
  };
}

export const postprocessImagesAction: CustomGPTAction<
  PostprocessImagesActionInput,
  PostprocessImagesActionResult
> = {
  name: "postprocess_images",
  description:
    "이미지 생성 직후, 해상도 2048px/300dpi로 리샘플링하고 샌드박스 다운로드 링크를 반환합니다.",
  parameters: {
    type: "object",
    properties: {
      images: {
        type: "array",
        description: "base64 또는 data URL 형식의 이미지 목록",
        items: {
          oneOf: [
            { type: "string", description: "data:image/...;base64,<데이터> 형식" },
            {
              type: "object",
              properties: {
                b64_json: {
                  type: "string",
                  description: "OpenAI 이미지 API 응답의 b64_json 필드",
                },
              },
              required: ["b64_json"],
            },
          ],
        },
      },
      targetMaxDimension: {
        type: "integer",
        minimum: 1,
        default: 2048,
        description: "가장 긴 변의 목표 픽셀 크기",
      },
      targetDpi: {
        type: "integer",
        minimum: 72,
        default: 300,
        description: "출력 DPI(pixels per inch)",
      },
    },
    required: ["images"],
  },
  handler: handlePostprocessImages,
};

export default postprocessImagesAction;
