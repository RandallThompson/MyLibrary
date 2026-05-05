import { useState } from "react";
import { Library as LibraryIcon, Mail } from "lucide-react";
import { supabase } from "./supabaseClient";

export default function Auth() {
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState("idle"); // idle | sending | sent | error
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
    if (error) {
      setStatus("error");
      setErrorMsg(error.message);
    } else {
      setStatus("sent");
    }
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
        <h1 className="display text-4xl font-semibold mb-1">The Shelf</h1>
        <p className="display-soft text-[#6B5840] italic mb-8">Sign in with your email.</p>

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
              {status === "sending" ? "Sending link…" : "Send me a sign-in link"}
            </button>
            {status === "error" && (
              <p className="text-xs text-[#8B3A2A]">{errorMsg}</p>
            )}
            <p className="text-xs text-[#6B5840] pt-2">
              No password. We'll email you a link that signs you in for 30 days on this device.
            </p>
          </form>
        )}
      </div>
    </div>
  );
}
