// supabase/functions/activate/index.ts
// ✅ 최종본 (모모 요청사항 반영)
// - issued / active / expired 상태 분기 처리
// - 이미 등록된(active) 키일 때는 owner_user_id 매칭 검증
// - 응답 포맷 통일
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type, apikey"
};
serve(async (req)=>{
  if (req.method === "OPTIONS") {
    return new Response("ok", {
      headers: corsHeaders
    });
  }
  if (req.method !== "POST") {
    return new Response("Method Not Allowed", {
      status: 405
    });
  }
  const { license_key } = await req.json();
  const token = req.headers.get("Authorization")?.replace("Bearer ", "");
  const supabase = createClient(Deno.env.get("SUPABASE_URL"), Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"), {
    auth: {
      persistSession: false
    }
  });
  // 사용자 인증 확인
  const { data: { user } } = await supabase.auth.getUser(token || "");
  if (!user) {
    return new Response(JSON.stringify({
      ok: false,
      reason: "unauthenticated"
    }), {
      headers: corsHeaders
    });
  }
  // 구글 sub / 이메일 추출 (기존 그대로 유지)
  const email = user.email ?? user.user_metadata?.email ?? null;
  let googleSub = null;
  const identities = user.identities || [];
  const g = identities.find((i)=>i.provider === "google");
  if (g?.provider_id) googleSub = g.provider_id;
  if (!googleSub && user.user_metadata?.sub) googleSub = user.user_metadata.sub;
  // 🚨 (수정1) 라이선스 조회: status=issued 필터 제거 → 전체 상태 조회
  const { data: license, error: fetchErr } = await supabase.from("license_keys").select("*").eq("license_key", license_key).maybeSingle();
  if (fetchErr || !license) {
    return new Response(JSON.stringify({
      ok: false,
      reason: "not_found"
    }), {
      headers: corsHeaders
    });
  }
  // 🚨 (수정2) 상태별 분기 처리
  if (license.status === "issued") {
    // ⬇️ issued → active 전환
    let expires_at = null;
    if (license.type === "trial" || license.type === "subscription") {
      if (license.duration_days) {
        expires_at = new Date(Date.now() + license.duration_days * 86400000).toISOString();
      }
    }
    const { error } = await supabase.from("license_keys").update({
      status: "active",
      owner_user_id: user.id,
      owner_google_sub: googleSub,
      owner_email: email,
      activated_at: new Date().toISOString(),
      expires_at
    }).eq("license_key", license_key).eq("status", "issued");
    if (error) {
      return new Response(JSON.stringify({
        ok: false
      }), {
        headers: corsHeaders
      });
    }
    return new Response(JSON.stringify({
      ok: true,
      activated: true
    }), {
      headers: corsHeaders
    });
  }
  if (license.status === "active") {
    // 🚨 레거시 호환: OR 조건으로 매칭 검사
    const matched = license.owner_user_id && license.owner_user_id === user.id || license.owner_google_sub && googleSub && license.owner_google_sub === googleSub || license.owner_email && email && license.owner_email === email;
    if (!matched) {
      // 이미 다른 계정에 묶인 경우
      return new Response(JSON.stringify({
        ok: false,
        reason: "already_registered_to_other"
      }), {
        headers: corsHeaders
      });
    }
    // 🚨 누락된 필드 보완 (백필)
    const updates = {};
    if (!license.owner_user_id) updates.owner_user_id = user.id;
    if (!license.owner_google_sub && googleSub) updates.owner_google_sub = googleSub;
    if (!license.owner_email && email) updates.owner_email = email;
    if (Object.keys(updates).length > 0) {
      await supabase.from("license_keys").update(updates).eq("license_key", license_key).eq("status", "active");
    }
    return new Response(JSON.stringify({
      ok: true,
      activated: true,
      message: "already_active"
    }), {
      headers: corsHeaders
    });
  }
  if (license.status === "expired") {
    // 만료된 라이선스
    return new Response(JSON.stringify({
      ok: false,
      reason: "expired"
    }), {
      headers: corsHeaders
    });
  }
  // 예외 상태
  return new Response(JSON.stringify({
    ok: false,
    reason: "invalid_state"
  }), {
    headers: corsHeaders
  });
});
