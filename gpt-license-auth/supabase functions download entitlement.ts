import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY");
const supabaseService = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
const supabaseAnon = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Content-Type": "application/json"
};
serve(async (req)=>{
  if (req.method === "OPTIONS") {
    return new Response("ok", {
      headers: corsHeaders
    });
  }
  const token = req.headers.get("Authorization")?.replace("Bearer ", "");
  if (!token) {
    return new Response(JSON.stringify({
      valid: false,
      reason: "no_token"
    }), {
      headers: corsHeaders,
      status: 200
    });
  }
  // 1️⃣ Supabase JWT 검증
  try {
    const { data: { user }, error } = await supabaseAnon.auth.getUser(token);
    if (user) {
      console.log("[entitlement] Supabase user:", user.id);
      const { data, error: licenseErr } = await supabaseService // 👇 expires_at 추가
      .from("license_keys").select("id, expires_at").or(`owner_user_id.eq.${user.id},owner_google_sub.eq.${user.user_metadata?.sub},owner_email.eq.${user.email}`).eq("status", "active").maybeSingle();
      console.log("[entitlement] query by supabase user:", user.id, user.email, user.user_metadata?.sub);
      console.log("[entitlement] result data:", data);
      console.log("[entitlement] result error:", licenseErr);
      if (data) {
        // 👇 만료 체크 추가
        const now = new Date();
        if (data.expires_at && new Date(data.expires_at) < now) {
          return new Response(JSON.stringify({
            valid: false,
            reason: "expired_license"
          }), {
            headers: corsHeaders,
            status: 200
          });
        }
        return new Response(JSON.stringify({
          valid: true
        }), {
          headers: corsHeaders,
          status: 200
        });
      }
    }
  } catch (e) {
    console.log("[entitlement] Not a Supabase JWT:", e);
  }
  // 2️⃣ 구글 access_token 검증
  if (token.startsWith("ya29")) {
    try {
      const googleResp = await fetch("https://www.googleapis.com/oauth2/v3/userinfo", {
        headers: {
          Authorization: `Bearer ${token}`
        }
      });
      if (googleResp.ok) {
        const profile = await googleResp.json(); // { sub, email, ... }
        console.log("[entitlement] Google profile:", profile);
        const { data, error } = await supabaseService.from("license_keys").select("id, expires_at").or(`owner_google_sub.eq.${profile.sub},owner_email.eq.${profile.email}`).eq("status", "active").maybeSingle();
        console.log("[entitlement] query by google:", profile.sub, profile.email);
        console.log("[entitlement] result data:", data);
        console.log("[entitlement] result error:", error);
        if (data) {
          // 👇 만료 체크 추가
          const now = new Date();
          if (data.expires_at && new Date(data.expires_at) < now) {
            return new Response(JSON.stringify({
              valid: false,
              reason: "expired_license"
            }), {
              headers: corsHeaders,
              status: 200
            });
          }
          return new Response(JSON.stringify({
            valid: true
          }), {
            headers: corsHeaders,
            status: 200
          });
        }
      } else {
        console.log("[entitlement] Google token invalid:", await googleResp.text());
      }
    } catch (e) {
      console.error("[entitlement] Google check error:", e);
    }
  }
  // 3️⃣ 실패 → 인증 불가
  return new Response(JSON.stringify({
    valid: false,
    reason: "no_active_license"
  }), {
    headers: corsHeaders,
    status: 200
  });
});
