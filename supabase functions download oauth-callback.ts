import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
const GPT_CALLBACK = Deno.env.get("GPT_CALLBACK_URL");
serve(async (req)=>{
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  if (!code || !state) return new Response("Missing code/state", {
    status: 400
  });
  const pass = new URL(GPT_CALLBACK);
  pass.searchParams.set("code", code);
  pass.searchParams.set("state", state);
  return Response.redirect(pass.toString(), 302);
});
