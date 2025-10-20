# 🎨 Stock Element GPT (요소봇)

> AI 이미지 생성 기반 스톡요소 제작 GPT  
> 정품 사용자(Google 로그인 + 라이선스 등록 완료자)만 접근 가능  
> Supabase + GitHub Pages + Custom GPT(OpenAPI Actions) 기반 인증형 서비스

---

## 🧩 System Overview

요소봇은 단순한 커스텀 GPT가 아니라,  
**인증 서버(Supabase)** 와 **로그인 UI(GitHub Pages)**, 그리고  
**OpenAI Actions 기반 GPT 프런트엔드**가 맞물린 3계층 구조다.

```
┌──────────────────────────────┐
│      Custom GPT (요소봇)       │
│──────────────────────────────│
│  • 실행 시 /entitlement 호출                                │
│  • valid:true → 정상 작동                                    │
│  • valid:false → "license-login.html" 안내 출력               │
│  • 이미지 생성(image_gen) + 후처리(postprocess_images)        │
└──────────────────────────────┘
                │
                ▼
┌──────────────────────────────┐
│     Supabase Edge Functions   │
│──────────────────────────────│
│  /license-precheck : 키 발급상태 확인                         │
│  /activate         : Google 유저에 키 묶기(status=active)      │
│  /entitlement      : 세션 토큰 기반 active 키 확인             │
│  /oauth-*          : GPT OAuth 파사드                         │
└──────────────────────────────┘
                │
                ▼
┌──────────────────────────────┐
│         Supabase DB           │
│──────────────────────────────│
│  TABLE license_keys           │
│   - license_key (text, pk)    │
│   - user_id (uuid, fk)        │
│   - status (issued|active|revoked) │
│   - expires_at (timestamp)    │
└──────────────────────────────┘
                │
                ▼
┌──────────────────────────────┐
│ GitHub Pages (license-login.html) │
│──────────────────────────────│
│  1. Google 로그인                       │
│  2. 라이선스 키 입력 → /activate 호출    │
│  3. 성공 시 “인증 완료” 표시             │
└──────────────────────────────┘
```

---

## 🔐 Authentication Flow

| 단계 | 주체 | 설명 |
|------|------|------|
| ① | 사용자 | GPT 실행 |
| ② | GPT | `/entitlement` 호출 |
| ③ | Supabase | 세션 검증 후 `{valid: true/false}` 응답 |
| ④ | GPT | `false` → 로그인 안내, `true` → 정상 작동 |
| ⑤ | 사용자 | GitHub Pages에서 Google 로그인 + 라이선스 키 입력 |
| ⑥ | Supabase | `/activate` 호출 → 키 `active` 전환 |
| ⑦ | GPT 재실행 | `/entitlement` → `valid:true` → 사용 가능 |

---

## ⚙️ Supabase Edge Functions

### `/functions/entitlement/index.ts`

```ts
import { serve } from "https://deno.land/std/http/server.ts";
import { getUser } from "../_shared/auth.ts";
import { supabaseAdmin } from "../_shared/client.ts";

serve(async (req) => {
  const user = await getUser(req);
  if (!user) return new Response(JSON.stringify({ valid: false }), { status: 200 });

  const { data } = await supabaseAdmin
    .from("license_keys")
    .select("*")
    .eq("user_id", user.id)
    .eq("status", "active")
    .maybeSingle();

  const valid = !!data;
  return new Response(JSON.stringify({ valid, ...data }), { status: 200 });
});
```

---

## 📡 OpenAPI Schema (GPT 연결용)

```yaml
openapi: 3.1.0
info:
  title: GPT License Auth
  version: "1.0.0"

servers:
  - url: https://kwjxtfyzerwynwqnbpjk.supabase.co/functions/v1

paths:
  /entitlement:
    get:
      operationId: checkEntitlement
      security:
        - oauth: []
      responses:
        "200":
          description: License entitlement status
          content:
            application/json:
              schema:
                type: object
                properties:
                  valid:
                    type: boolean
```

---

## 🧠 GPT 내부 Python Logic

```python
from PIL import Image, PngImagePlugin
import io, base64, os

def postprocess_images(generated_images):
    """
    ✅ 최신 GPT 환경 대응 버전
    - Base64 → PNG 변환
    - 자동 2048px 리사이즈
    - 300DPI 메타 추가
    - /mnt/data 내 저장 후 다운로드 링크 출력
    """
    links = []
    download_base = "/mnt/data"
    os.makedirs(download_base, exist_ok=True)

    for idx, item in enumerate(generated_images, start=1):
        if isinstance(item, dict) and "b64_json" in item:
            img_data = base64.b64decode(item["b64_json"])
        elif isinstance(item, str) and item.startswith("data:image"):
            img_data = base64.b64decode(item.split(",")[1])
        else:
            continue

        im = Image.open(io.BytesIO(img_data))
        w, h = im.size
        target = 2048
        if max(w, h) != target:
            if w >= h:
                new_w, new_h = target, int(h * target / w)
            else:
                new_h, new_w = target, int(w * target / h)
            im = im.resize((new_w, new_h), Image.Resampling.LANCZOS)

        meta = PngImagePlugin.PngInfo()
        meta.add_text("Software", "Stock Element GPT")

        filename = f"element_{idx}_2048.png"
        path = os.path.join(download_base, filename)
        im.save(path, dpi=(300, 300), pnginfo=meta)
        links.append(f"[2048px 다운로드]({path})")

    return "\n".join(links)
```

---

## 🔒 Security Principles

| 위험 | 대응 방법 |
|------|------------|
| 라이선스 키 유출 | 키만으로는 사용 불가 (Google 계정 연동 필요) |
| GPT 내부 검증 조작 | GPT는 키를 직접 다루지 않음 (`/entitlement`만 신뢰) |
| 세션 만료 | 매 실행 시 Supabase에서 갱신 검증 |
| Function 접근권한 | RLS + JWT로 보호, Admin 전용 함수 분리 |

---

## 📁 Repository Structure

```
/supabase/functions/
  ├─ activate/
  ├─ entitlement/
  ├─ license-precheck/
  ├─ oauth-authorize/
  ├─ oauth-token/
  └─ oauth-callback/

/public/
  ├─ license-login.html
  ├─ redirect.html
  └─ styles.css

/openapi/
  └─ gpt-license-auth.yaml
```

---

## 💡 개발 및 배포 참고

| 구분 | 기술 스택 |
|------|------------|
| GPT | OpenAI Custom GPT (Actions 사용) |
| 백엔드 | Supabase Edge Functions (Deno) |
| DB | Supabase PostgreSQL + Row Level Security |
| 프론트 | GitHub Pages (정적 로그인 UI) |
| 인증 | Google OAuth 2.0 |
| 통신 | HTTPS (CORS 허용, Bearer Token 기반) |

---

## 🧱 핵심 설계 포인트

- GPT는 **서버의 판단만 신뢰**, 클라이언트 입력은 무시  
- 한 번 인증된 사용자는 **세션 유지**, 매번 로그인 불필요  
- 키는 **발급(issued) → 활성(active) → 만료(revoked)** 상태로 관리  
- **Service Role Key** 는 Edge Function 내부에서만 사용 (노출 금지)

---

© 2025 Loopyti / Moruti All rights reserved.
