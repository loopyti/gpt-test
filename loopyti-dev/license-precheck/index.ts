import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type, apikey"
};
serve(async (req)=>{
  if (req.method === "OPTIONS") return new Response("ok", {
    headers: corsHeaders
  });
  const { license_key } = await req.json();
  const supabase = createClient(Deno.env.get("SUPABASE_URL"), Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"));
  const { data, error } = await supabase.from("license_keys").select("status").eq("license_key", license_key).maybeSingle(); // 🚨 (수정2) single → maybeSingle (없는 경우도 null 반환)
  if (error || !data) {
    return new Response(JSON.stringify({
      status: "not_found"
    }), {
      headers: corsHeaders
    });
  }
  // 🚨 (수정3) 단순 valid true/false 대신 status 자체 리턴
  return new Response(JSON.stringify({
    status: data.status // "issued" | "active" | "expired"
  }), {
    headers: corsHeaders
  });
});
