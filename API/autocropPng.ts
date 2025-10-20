 (cd "$(git rev-parse --show-toplevel)" && git apply --3way <<'EOF' 
diff --git a/API/autocropPng.ts b/API/autocropPng.ts
new file mode 100644
index 0000000000000000000000000000000000000000..8a58b62c13171031038a6e6721513832a4481b51
--- /dev/null
+++ b/API/autocropPng.ts
@@ -0,0 +1,66 @@
+from PIL import Image
+import io, base64, os
+from typing import Union
+
+
+def _load_png_bytes(source: Union[str, bytes, dict]) -> bytes:
+    if isinstance(source, dict) and "b64_json" in source:
+        return base64.b64decode(source["b64_json"])
+    if isinstance(source, (bytes, bytearray)):
+        return bytes(source)
+    if isinstance(source, str):
+        if source.startswith("data:image"):
+            return base64.b64decode(source.split(",", 1)[1])
+        if os.path.exists(source):
+            with open(source, "rb") as fh:
+                return fh.read()
+    raise ValueError("지원하지 않는 이미지 입력 형식입니다.")
+
+
+def autocrop_png(image, padding: int = 0):
+    """Remove transparent padding around a PNG image."""
+    os.makedirs("/mnt/data", exist_ok=True)
+
+    try:
+        data = _load_png_bytes(image)
+    except Exception as exc:  # noqa: BLE001 - surface validation error to caller
+        print(f"❌ 이미지를 불러오지 못했습니다: {exc}")
+        return
+
+    im = Image.open(io.BytesIO(data))
+    if im.mode != "RGBA":
+        im = im.convert("RGBA")
+
+    alpha = im.split()[-1]
+    bbox = alpha.getbbox()
+    if not bbox:
+        bbox = (0, 0, im.width, im.height)
+
+    left, upper, right, lower = bbox
+    if padding:
+        left = max(0, left - padding)
+        upper = max(0, upper - padding)
+        right = min(im.width, right + padding)
+        lower = min(im.height, lower + padding)
+        bbox = (left, upper, right, lower)
+
+    cropped = im.crop(bbox)
+
+    output_path = "/mnt/data/autocrop_0001.png"
+    index = 1
+    while os.path.exists(output_path):
+        index += 1
+        output_path = f"/mnt/data/autocrop_{index:04d}.png"
+
+    cropped.save(output_path, dpi=(300, 300))
+    width, height = cropped.size
+
+    print(
+        "\n".join(
+            [
+                f"✅ 자동 크롭 완료 — {width}x{height}px",
+                f"[크롭된 PNG 다운로드](sandbox:{output_path})",
+                f"📐 Bounding Box: left={bbox[0]}, top={bbox[1]}, right={bbox[2]}, bottom={bbox[3]}",
+            ]
+        )
+    )
 
EOF
)
