import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
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
  console.log("oauth-authorize called with:", {
    redirect_uri,
    state,
    client_id
  });
  if (!redirect_uri || !state || !client_id) {
    return new Response("Missing params", {
      status: 400,
      headers: corsHeaders
    });
  }
  // 👉 Supabase Auth 경유 ❌, 바로 Google OAuth 동의화면으로
  const googleAuthUrl = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  googleAuthUrl.searchParams.set("response_type", "code");
  googleAuthUrl.searchParams.set("client_id", client_id);
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
