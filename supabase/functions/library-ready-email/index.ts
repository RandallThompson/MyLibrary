// Supabase Edge Function: library-ready-email
//
// Sends the user a "your library is ready" email via Resend after their
// prep job completes. Triggered from the client (prepJob.js) via
// supabase.functions.invoke("library-ready-email", { body: { jobId } }).
//
// Required env vars (set in Supabase Dashboard → Edge Functions → Secrets):
//   RESEND_API_KEY        - your Resend secret key (starts re_...)
//   RESEND_FROM           - "MyLibrary <noreply@yourdomain.com>" (verified Resend sender)
//   APP_URL               - "https://your-vercel.vercel.app" — used in email link
//
// This function trusts the JWT of the calling user. RLS ensures we only see
// our own prep_jobs row.

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const RESEND_URL = "https://api.resend.com/emails";

serve(async (req) => {
  // CORS preflight.
  if (req.method === "OPTIONS") {
    return new Response("ok", {
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
        "Access-Control-Allow-Methods": "POST, OPTIONS"
      }
    });
  }

  const authHeader = req.headers.get("Authorization") || "";
  const token = authHeader.replace(/^Bearer\s+/i, "");
  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;

  const supa = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: `Bearer ${token}` } }
  });

  const { jobId } = await req.json().catch(() => ({}));
  if (!jobId) return json({ error: "jobId required" }, 400);

  // Pull job + auth user.
  const { data: { user } } = await supa.auth.getUser();
  if (!user) return json({ error: "unauthenticated" }, 401);

  const { data: job, error: jobErr } = await supa
    .from("prep_jobs").select("*").eq("id", jobId).single();
  if (jobErr || !job) return json({ error: "job not found" }, 404);
  if (job.email_sent) return json({ ok: true, skipped: "already sent" });

  const apiKey = Deno.env.get("RESEND_API_KEY");
  const from   = Deno.env.get("RESEND_FROM") || "MyLibrary <onboarding@resend.dev>";
  const appUrl = Deno.env.get("APP_URL") || "https://example.vercel.app";
  if (!apiKey) return json({ error: "RESEND_API_KEY missing" }, 500);

  const html = `
    <div style="font-family: Georgia, serif; background: #F4EBD9; color: #2A1F14; padding: 32px; max-width: 480px; margin: 0 auto;">
      <h1 style="font-weight: 600; font-size: 28px; margin: 0 0 8px;">Your library is ready.</h1>
      <p style="color: #6B5840; font-style: italic; margin: 0 0 24px;">Covers, colors, and dimensions for ${job.done_books} of ${job.total_books} books.</p>
      <p style="margin: 0 0 24px;">The Bookshelf Designer is now waiting for you. Pick a bookcase, choose a layout, drag things around, save the looks you like.</p>
      <a href="${appUrl}" style="display: inline-block; background: #2A1F14; color: #F4EBD9; padding: 12px 20px; border-radius: 999px; text-decoration: none;">Open MyLibrary</a>
      <p style="color: #6B5840; font-size: 12px; margin-top: 32px;">— MyLibrary</p>
    </div>
  `;

  const resp = await fetch(RESEND_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      from,
      to: [user.email],
      subject: "Your MyLibrary is ready to design",
      html
    })
  });
  const respBody = await resp.text();
  if (!resp.ok) {
    return json({ error: "resend failed", status: resp.status, body: respBody }, 502);
  }

  await supa.from("prep_jobs").update({ email_sent: true }).eq("id", jobId);
  return json({ ok: true });
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*"
    }
  });
}
