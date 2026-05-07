import { useState } from "react";
import { Library as LibraryIcon, Mail } from "lucide-react";
import { supabase } from "./supabaseClient";

function GoogleMark({ size = 18 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" aria-hidden="true">
      <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3c-1.6 4.7-6.1 8-11.3 8-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.9 1.2 8 3.1l5.7-5.7C34 5.1 29.3 3 24 3 12.4 3 3 12.4 3 24s9.4 21 21 21 21-9.4 21-21c0-1.2-.1-2.5-.4-3.5z"/>
      <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.6 16 19 13 24 13c3.1 0 5.9 1.2 8 3.1l5.7-5.7C34 5.1 29.3 3 24 3 16.3 3 9.7 7.3 6.3 14.7z"/>
      <path fill="#4CAF50" d="M24 45c5.2 0 9.9-2 13.5-5.2l-6.2-5.2C29.2 36 26.7 37 24 37c-5.2 0-9.6-3.3-11.2-8l-6.5 5C9.6 41 16.3 45 24 45z"/>
      <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.7 2.1-2 3.9-3.7 5.3l6.2 5.2C42.6 35.6 45 30.2 45 24c0-1.2-.1-2.5-.4-3.5z"/>
    </svg>
  );
}

export default function Auth() {
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState("idle");
  const [errorMsg, setErrorMsg] = useState("");

  const sendLink = async (e) => {
    e.preventDefault();
    if (!email.trim()) return;
    setStatus("sending");
    setErrorMsg("");
    const { error } = await supabase.auth.signInWithOtp({
      email: email.trim(),
      options: { emailRedirectTo: window.location.origin }
    });
    if (error) { setStatus("error"); setErrorMsg(error.message); }
    else setStatus("sent");
  };

  const signInWithGoogle = async () => {
    setStatus("sending");
    setErrorMsg("");
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: window.location.origin }
    });
    if (error) { setStatus("error"); setErrorMsg(error.message); }
  };

  return (
    <div
      className="min-h-screen bg-[#F4EBD9] text-[#2A1F14] flex items-center justify-center px-5"
      style={{ fontFamily: "'Plus Jakarta Sans', system-ui, sans-serif" }}
    >
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght,SOFT,WONK@9..144,400;9..144,500;9..144,600;9..144,700&family=Plus+Jakarta+Sans:wght@400;500;600;700&display=swap');
        .display { font-family: 'Fraunces', Georgia, serif; font-variation-settings: 'SOFT' 50, 'WONK' 0; letter-spacing: -0.01em; }
        .display-soft { font-family: 'Fraunces', Georgia, serif; font-variation-settings: 'SOFT' 100, 'WONK' 1; }
        .spine-shadow { box-shadow: 0 1px 0 rgba(43,31,20,0.04), 0 8px 20px -16px rgba(43,31,20,0.18); }
      `}</style>

      <div className="max-w-sm w-full">
        <div className="flex items-center gap-3 mb-2">
          <LibraryIcon size={22} className="text-[#8B3A2A]" />
          <span className="text-xs uppercase tracking-[0.22em] text-[#6B5840]">Personal Library</span>
        </div>
        <h1 className="display text-4xl font-semibold mb-1">MyLibrary</h1>
        <p className="display-soft text-[#6B5840] italic mb-8">Sign in to your shelf.</p>

        {status === "sent" ? (
          <div className="bg-[#FBF6E9] border border-[#2A1F14]/15 rounded-2xl p-6 spine-shadow">
            <Mail size={22} className="text-[#8B3A2A] mb-2" />
            <p className="display text-lg mb-1">Check your inbox.</p>
            <p className="text-sm text-[#6B5840]">
              We sent a sign-in link to <span className="font-medium text-[#2A1F14]">{email}</span>. Tap it on the
              same device you want to use.
            </p>
            <button
              onClick={() => { setStatus("idle"); setEmail(""); }}
              className="mt-4 text-xs text-[#6B5840] hover:text-[#8B3A2A] underline"
            >
              Use a different email
            </button>
          </div>
        ) : (
          <div className="space-y-4">
            <button
              type="button"
              onClick={signInWithGoogle}
              disabled={status === "sending"}
              className="w-full bg-[#FBF6E9] border border-[#2A1F14]/20 text-[#2A1F14] px-4 py-2.5 rounded-full text-sm flex items-center justify-center gap-3 disabled:opacity-30 hover:border-[#8B3A2A] transition spine-shadow"
            >
              <GoogleMark />
              <span>Continue with Google</span>
            </button>

            <div className="flex items-center gap-3 text-[10px] uppercase tracking-[0.2em] text-[#6B5840]/60">
              <div className="flex-1 h-px bg-[#2A1F14]/10" />
              <span>or</span>
              <div className="flex-1 h-px bg-[#2A1F14]/10" />
            </div>

            <form onSubmit={sendLink} className="space-y-3">
              <label className="block">
                <span className="text-[11px] uppercase tracking-wider text-[#6B5840]">Email</span>
                <input
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@example.com"
                  className="w-full mt-1 bg-[#FBF6E9] border border-[#2A1F14]/15 rounded-md px-3 py-2 outline-none focus:border-[#8B3A2A] text-[15px]"
                />
              </label>
              <button
                type="submit"
                disabled={status === "sending" || !email.trim()}
                className="w-full bg-[#2A1F14] text-[#F4EBD9] px-4 py-2.5 rounded-full text-sm disabled:opacity-30 hover:bg-[#8B3A2A] transition"
              >
                {status === "sending" ? "Sending link..." : "Send me a sign-in link"}
              </button>
              {status === "error" && (
                <p className="text-xs text-[#8B3A2A]">{errorMsg}</p>
              )}
              <p className="text-xs text-[#6B5840] pt-2">
                No password. We'll email you a link that signs you in for 30 days on this device.
              </p>
            </form>
          </div>
        )}
      </div>
    </div>
  );
}
