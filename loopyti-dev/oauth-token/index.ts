import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const GOOGLE_CLIENT_ID = Deno.env.get("GOOGLE_CLIENT_ID");
const GOOGLE_CLIENT_SECRET = Deno.env.get("GOOGLE_CLIENT_SECRET");
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY");
export const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type, apikey, x-client-info",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Max-Age": "86400"
};
const jsonHeaders = {
  ...corsHeaders,
  "Content-Type": "application/json"
};
serve(async (req)=>{
  if (req.method === "OPTIONS") {
    return new Response("ok", {
      headers: corsHeaders
    });
  }
  if (req.method !== "POST") {
    return new Response("Method Not Allowed", {
      status: 405,
      headers: corsHeaders
    });
  }
  const form = await req.formData();
  const code = form.get("code")?.toString();
  const redirect_uri = form.get("redirect_uri")?.toString();
  if (!code || !redirect_uri) {
    return new Response("Missing code or redirect_uri", {
      status: 400,
      headers: corsHeaders
    });
  }
  // 1️⃣ Google 토큰 교환
  const googleBody = new URLSearchParams({
    code,
    client_id: GOOGLE_CLIENT_ID,
    client_secret: GOOGLE_CLIENT_SECRET,
    redirect_uri,
    grant_type: "authorization_code"
  });
  const googleResp = await fetch(GOOGLE_TOKEN_URL, {
    method: "POST",
    body: googleBody
  });
  const google = await googleResp.json();
  console.log("[oauth-token] Google response:", googleResp.status, google);
  if (!googleResp.ok || !google.id_token) {
    return new Response(JSON.stringify({
      error: "google_token_failed",
      detail: google
    }), {
      status: 400,
      headers: jsonHeaders
    });
  }
  // 2️⃣ Google id_token → Supabase 세션 교환
  const supabaseResp = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=id_token`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "apikey": SUPABASE_ANON_KEY
    },
    body: JSON.stringify({
      id_token: google.id_token,
      provider: "google"
    })
  });
  const supabaseData = await supabaseResp.json();
  console.log("[oauth-token] Supabase response:", supabaseResp.status, supabaseData);
  if (!supabaseResp.ok || !supabaseData.access_token) {
    return new Response(JSON.stringify({
      error: "supabase_token_failed",
      detail: supabaseData
    }), {
      status: 400,
      headers: jsonHeaders
    });
  }
  // 3️⃣ ✅ GPT가 이해할 수 있는 최소 OAuth2 응답 반환
  return new Response(JSON.stringify({
    access_token: supabaseData.access_token,
    token_type: "bearer",
    expires_in: supabaseData.expires_in ?? 3600
  }), {
    status: 200,
    headers: jsonHeaders
  });
});
