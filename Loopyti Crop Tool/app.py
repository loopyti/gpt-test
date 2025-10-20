from flask import Flask, request, send_file
from flask_cors import CORS
from PIL import Image
import io, os, zipfile
import numpy as np
import logging

# 로깅 설정
# 기본은 INFO만 출력 → DEBUG 보고 싶으면 level=logging.DEBUG 로 바꿔주면 됨
logging.basicConfig(level=logging.INFO)

app = Flask(__name__, static_folder="static", static_url_path="")
CORS(app)

@app.route("/")
def index():
    return app.send_static_file("index.html")

def crop_transparent_stable(img, thresholds=(10, 50, 128, 200), min_ratio=0.1):
    """
    투명 배경 자동 크롭 (배포용 안정 버전)
    thresholds: 여러 임계값 후보
    min_ratio: bbox가 원본 대비 너무 작으면 무시
    """
    img = img.convert("RGBA")
    data = np.array(img)
    alpha = data[:, :, 3]
    h, w = alpha.shape
    total_area = h * w

    best_bbox = None
    best_area = None

    for t in thresholds:
        coords = np.argwhere(alpha > t)
        if coords.size == 0:
            continue

        ymin, xmin = coords.min(axis=0)
        ymax, xmax = coords.max(axis=0) + 1
        area = (xmax - xmin) * (ymax - ymin)

        if area / total_area < min_ratio:
            continue

        if best_area is None or area < best_area:
            best_area = area
            best_bbox = (xmin, ymin, xmax, ymax)
            logging.debug(f"[crop] threshold={t}, bbox={best_bbox}, area={area}")

    if best_bbox:
        logging.info(f"[crop] 최종 bbox={best_bbox}, area={best_area}")
        img = img.crop(best_bbox)
    else:
        logging.warning("[crop] 전경 없음 또는 조건 불충족 → 원본 반환")
    return img

# ✅ ZIP 반환 (다중 파일)
@app.route("/crop/zip", methods=["POST"])
def crop_zip():
    files = request.files.getlist("files")
    if not files:
        return "No files uploaded", 400

    # ✅ 파일 개수 제한
    if len(files) > 3:
        return "Only up to 3 files allowed in free version", 403

    zip_buffer = io.BytesIO()
    with zipfile.ZipFile(zip_buffer, "w") as zipf:
        for f in files:
            if f.mimetype != "image/png":
                return "Only PNG files allowed", 415
            img = Image.open(f)
            logging.info(f"[upload] filename={f.filename}, mode={img.mode}, size={img.size}")
            cropped = crop_transparent_stable(img)
            out_bytes = io.BytesIO()
            cropped.save(out_bytes, format="PNG")
            out_bytes.seek(0)
            zipf.writestr(f"cropped_{f.filename}", out_bytes.getvalue())

    zip_buffer.seek(0)
    return send_file(
        zip_buffer,
        mimetype="application/zip",
        as_attachment=True,
        download_name="cropped_images.zip"
    )

# ✅ 개별 PNG 반환
@app.route("/crop/png", methods=["POST"])
def crop_png():
    f = request.files.get("file")
    if not f:
        return "No file uploaded", 400
    if f.mimetype != "image/png":
        return "Only PNG files allowed", 415

    try:
        img = Image.open(f)
        logging.info(f"[upload] filename={f.filename}, mode={img.mode}, size={img.size}")

        cropped = crop_transparent_stable(img)
        out_bytes = io.BytesIO()
        cropped.save(out_bytes, format="PNG")
        out_bytes.seek(0)

        return send_file(
            out_bytes,
            mimetype="image/png",
            as_attachment=True,
            download_name=f"cropped_{f.filename}"
        )
    except Exception as e:
        logging.error(f"[error] {f.filename} 처리 중 오류: {e}")
        return f"Error occurred while processing {f.filename}", 400

if __name__ == "__main__":
    port = int(os.environ.get("PORT", 7860))
    app.run(host="0.0.0.0", port=port)
