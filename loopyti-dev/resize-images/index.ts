import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
const GOOGLE_CLIENT_ID = Deno.env.get("GOOGLE_CLIENT_ID");
export const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type, apikey, x-client-info",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Max-Age": "86400"
};
serve(async (req)=>{
  if (req.method === "OPTIONS") {
    return new Response("ok", {
      headers: corsHeaders
    });
  }
  const url = new URL(req.url);
  const redirect_uri = url.searchParams.get("redirect_uri"); // GPT 콜백 주소
  const state = url.searchParams.get("state");
  const client_id = url.searchParams.get("client_id");
  // ✅ 빈 client_id면 환경변수 GOOGLE_CLIENT_ID로 대체
  const resolvedClientId = client_id?.trim() || GOOGLE_CLIENT_ID?.trim();
  console.log("oauth-authorize called with:", {
    redirect_uri,
    state,
    client_id,
    resolvedClientId
  });
  // ✅ 검사 시 resolvedClientId 사용
  if (!redirect_uri || !state || !resolvedClientId) {
    return new Response("Missing params", {
      status: 400,
      headers: corsHeaders
    });
  }
  // ✅ Google OAuth 리디렉션
  const googleAuthUrl = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  googleAuthUrl.searchParams.set("response_type", "code");
  googleAuthUrl.searchParams.set("client_id", resolvedClientId);
  googleAuthUrl.searchParams.set("redirect_uri", redirect_uri);
  googleAuthUrl.searchParams.set("scope", "openid email profile");
  googleAuthUrl.searchParams.set("state", state);
  googleAuthUrl.searchParams.set("access_type", "offline");
  googleAuthUrl.searchParams.set("prompt", "consent");
  console.log("Redirecting to Google:", googleAuthUrl.toString());
  const headers = new Headers(corsHeaders);
  headers.set("Location", googleAuthUrl.toString());
  return new Response(null, {
    status: 302,
    headers
  });
});
