python
from PIL import Image, PngImagePlugin
import io, base64, os

def fix_sandbox_links(t:str)->str:
    """sandbox 링크 내 %7B, %7D 자동 복원"""
    return t.replace("%7B","{").replace("%7D","}") if t else t


def resize_selected_images(selected_indices=None, factor=2.0):
    """선택한 이미지 번호만 지정 배율로 리사이즈"""
    global last_generated_images
    if not last_generated_images:
        print("❌ 최근 생성된 이미지가 없습니다.")
        return

    factor_str = str(factor).rstrip('0').rstrip('.')
    links = []

    for idx, path in enumerate(last_generated_images, start=1):
        if selected_indices and idx not in selected_indices:
            continue

        input_path = path.replace(".png", "_2048_300dpi.png")
        if not os.path.exists(input_path):
            input_path = path

        im = Image.open(input_path)
        new_size = (int(im.width * factor), int(im.height * factor))
        im = im.resize(new_size, Image.Resampling.LANCZOS)

        download_base = "/mnt/data"
        filename = os.path.basename(input_path).replace(".png", f"_x{factor}.png")
        output_path = os.path.join(download_base, filename)
        im.save(output_path, dpi=(300, 300))

        # ✅ universal sandbox 링크 — 세션/유저 무관하게 동작
        links.append(f"{idx}️⃣ [x{factor_str} 다운로드](sandbox:{output_path})")

    if links:
        print(fix_sandbox_links("\n".join(links)))
    else:
        print("❌ 지정한 이미지 번호를 찾을 수 없습니다.")
