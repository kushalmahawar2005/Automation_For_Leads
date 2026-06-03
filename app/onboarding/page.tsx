"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

type Step = 1 | 2 | 3 | 4;

const PROFESSIONS = [
  "Website Developer",
  "Video Editor",
  "Graphic Designer",
  "SEO Expert",
  "Social Media Manager",
  "Digital Marketing Agency",
];

type WaStatus = "INITIALIZING" | "QR_READY" | "AUTHENTICATED" | "READY" | "DISCONNECTED" | "ERROR";

export default function OnboardingPage() {
  const router = useRouter();
  const [step, setStep] = useState<Step>(1);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const [userName, setUserName] = useState("");
  const [userBusiness, setUserBusiness] = useState("");
  const [userProfession, setUserProfession] = useState(PROFESSIONS[0]);
  const [serpApiKey, setSerpApiKey] = useState("");

  const [waStatus, setWaStatus] = useState<WaStatus>("DISCONNECTED");
  const [waQr, setWaQr] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/settings")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!d) return;
        setUserName(d.userName || "");
        setUserBusiness(d.userBusiness || "");
        setUserProfession(d.userProfession || PROFESSIONS[0]);
        setSerpApiKey(d.serpApiKey || "");
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (step !== 4) return;
    let cancelled = false;
    const poll = async () => {
      try {
        const res = await fetch("/api/whatsapp/status");
        if (!res.ok) return;
        const data = await res.json();
        if (cancelled) return;
        setWaStatus(data.status);
        setWaQr(data.qr);
      } catch {}
    };
    poll();
    const id = setInterval(poll, 3000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [step]);

  const saveSettings = async (patch: Record<string, string>) => {
    const res = await fetch("/api/settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });
    if (!res.ok) {
      const d = await res.json().catch(() => ({}));
      throw new Error(d.error || "Could not save");
    }
  };

  const handleNextFromProfile = async () => {
    setError(null);
    if (!userName.trim() || !userBusiness.trim()) {
      setError("Name and business are both required.");
      return;
    }
    setSaving(true);
    try {
      await saveSettings({ userName: userName.trim(), userBusiness: userBusiness.trim(), userProfession });
      setStep(3);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  };

  const handleNextFromSerp = async () => {
    setError(null);
    if (!serpApiKey.trim()) {
      setError("SerpAPI key is required to scrape leads.");
      return;
    }
    setSaving(true);
    try {
      await saveSettings({ serpApiKey: serpApiKey.trim() });
      setStep(4);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  };

  const handleFinish = async () => {
    setError(null);
    setSaving(true);
    try {
      const res = await fetch("/api/onboarding/complete", { method: "POST" });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        setError(d.error || "Could not finish onboarding");
        return;
      }
      router.replace("/");
      router.refresh();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  };

  const handleLogout = async () => {
    await fetch("/api/auth/logout", { method: "POST" });
    router.replace("/login");
    router.refresh();
  };

  return (
    <main className="auth-wrap">
      <div className="auth-card" style={{ maxWidth: 560 }}>
        <div className="onboard-progress">
          {[1, 2, 3, 4].map((n) => (
            <div key={n} className={`onboard-dot ${step >= (n as Step) ? "active" : ""}`}>
              {n}
            </div>
          ))}
        </div>

        {step === 1 && (
          <>
            <div className="auth-brand">🚀 Kushal Automation</div>
            <h1 className="auth-title">Welcome aboard!</h1>
            <p className="auth-subtitle">
              4 quick steps and you&apos;re ready to scrape leads and send WhatsApp messages on autopilot.
            </p>
            <ul className="onboard-list">
              <li>👤 Profile setup — for personalised messages</li>
              <li>🔑 SerpAPI key — to scrape Google Maps</li>
              <li>📱 WhatsApp connect — optional, can do later</li>
              <li>✅ Done — start finding leads</li>
            </ul>
            <button className="btn btn-primary" onClick={() => setStep(2)}>
              Let&apos;s get started
            </button>
          </>
        )}

        {step === 2 && (
          <>
            <h1 className="auth-title">Tell us about you</h1>
            <p className="auth-subtitle">This personalises every outreach message you send.</p>
            <div className="auth-form">
              <div className="form-group">
                <label>Your name *</label>
                <input
                  type="text"
                  className="form-input"
                  value={userName}
                  onChange={(e) => setUserName(e.target.value)}
                  placeholder="e.g. Kushal"
                  autoFocus
                />
              </div>
              <div className="form-group">
                <label>Your business / agency *</label>
                <input
                  type="text"
                  className="form-input"
                  value={userBusiness}
                  onChange={(e) => setUserBusiness(e.target.value)}
                  placeholder="e.g. Kushal Studios"
                />
              </div>
              <div className="form-group">
                <label>What do you do?</label>
                <select
                  className="form-input"
                  value={userProfession}
                  onChange={(e) => setUserProfession(e.target.value)}
                >
                  {PROFESSIONS.map((p) => (
                    <option key={p} value={p}>
                      {p}
                    </option>
                  ))}
                </select>
              </div>
              {error && <div className="auth-error">{error}</div>}
              <div className="onboard-actions">
                <button className="btn btn-ghost" onClick={() => setStep(1)}>
                  Back
                </button>
                <button className="btn btn-primary" onClick={handleNextFromProfile} disabled={saving}>
                  {saving ? "Saving..." : "Next"}
                </button>
              </div>
            </div>
          </>
        )}

        {step === 3 && (
          <>
            <h1 className="auth-title">Add your SerpAPI key</h1>
            <p className="auth-subtitle">
              We use SerpAPI to scrape Google Maps for businesses in your target city. Grab a free key at{" "}
              <a href="https://serpapi.com" target="_blank" rel="noreferrer" style={{ color: "var(--accent)" }}>
                serpapi.com
              </a>{" "}
              — 100 free searches per month.
            </p>
            <div className="auth-form">
              <div className="form-group">
                <label>SerpAPI key *</label>
                <input
                  type="password"
                  className="form-input"
                  value={serpApiKey}
                  onChange={(e) => setSerpApiKey(e.target.value)}
                  placeholder="Paste your key"
                  autoComplete="off"
                  autoFocus
                />
                <div className="api-hint">Stored privately — only visible to your account.</div>
              </div>
              {error && <div className="auth-error">{error}</div>}
              <div className="onboard-actions">
                <button className="btn btn-ghost" onClick={() => setStep(2)}>
                  Back
                </button>
                <button className="btn btn-primary" onClick={handleNextFromSerp} disabled={saving}>
                  {saving ? "Saving..." : "Next"}
                </button>
              </div>
            </div>
          </>
        )}

        {step === 4 && (
          <>
            <h1 className="auth-title">Connect WhatsApp</h1>
            <p className="auth-subtitle">
              Scan this QR with WhatsApp → Linked Devices. You can also skip and do this later from the dashboard.
            </p>
            <div style={{ textAlign: "center", padding: "12px 0" }}>
              {waStatus === "INITIALIZING" && (
                <div style={{ padding: 20 }}>
                  <span className="loading-spinner"></span>
                  <br />
                  <br />
                  Starting WhatsApp Client...
                </div>
              )}
              {waStatus === "QR_READY" && waQr && (
                <img
                  src={waQr}
                  alt="WhatsApp QR Code"
                  className="qr-image"
                  style={{ background: "#fff", padding: 16, borderRadius: 12, display: "inline-block" }}
                />
              )}
              {waStatus === "AUTHENTICATED" && (
                <div style={{ color: "var(--green)" }}>✓ Authenticated! Loading chats...</div>
              )}
              {waStatus === "READY" && (
                <div style={{ color: "var(--green)", fontSize: 16, padding: 20 }}>
                  ✅ WhatsApp connected — you&apos;re all set!
                </div>
              )}
              {(waStatus === "DISCONNECTED" || waStatus === "ERROR") && (
                <div style={{ color: "var(--text-secondary)", padding: 20 }}>
                  Couldn&apos;t initialise WhatsApp. You can skip this and try later.
                </div>
              )}
            </div>
            {error && <div className="auth-error">{error}</div>}
            <div className="onboard-actions">
              <button className="btn btn-ghost" onClick={() => setStep(3)}>
                Back
              </button>
              <button className="btn btn-primary" onClick={handleFinish} disabled={saving}>
                {saving ? "Finishing..." : waStatus === "READY" ? "Finish" : "Skip & Finish"}
              </button>
            </div>
          </>
        )}

        <div className="auth-footer">
          Wrong account?{" "}
          <a
            href="#"
            onClick={(e) => {
              e.preventDefault();
              handleLogout();
            }}
          >
            Sign out
          </a>
        </div>
      </div>
    </main>
  );
}
