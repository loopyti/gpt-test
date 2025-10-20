from PIL import Image, PngImagePlugin
import io, base64, os

def postprocess_images(imgs):
    os.makedirs("/mnt/data", exist_ok=True); links=[]
    for i,x in enumerate(imgs,1):
        d=base64.b64decode(x.get("b64_json") if isinstance(x,dict) else x.split(",")[1])
        im=Image.open(io.BytesIO(d));w,h=im.size;s=2048/max(w,h)
        im=im.resize((int(w*s),int(h*s)),Image.Resampling.LANCZOS)
        p=f"/mnt/data/img_{i:02d}_2048_300dpi.png"
        m=PngImagePlugin.PngInfo()
        m.add_text("Software","Image Processor Engine")  # ✅ 안전한 메타명칭
        im.save(p,"PNG",dpi=(300,300),pnginfo=m,optimize=True)

        # ✅ universal sandbox 링크 (세션/유저 상관없이 작동)
        links.append(f"[2048px·300dpi 다운로드](sandbox:{p})")

    print("✅이미지 생성 완료\n\n"+"\n\n".join(links) if links else "⚠️변환된 이미지가 없습니다.")
