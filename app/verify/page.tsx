"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";

function VerifyInner() {
  const router = useRouter();
  const params = useSearchParams();
  const email = params.get("email") || "";

  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [cooldown, setCooldown] = useState(0);

  useEffect(() => {
    if (cooldown <= 0) return;
    const t = setInterval(() => setCooldown((c) => Math.max(0, c - 1)), 1000);
    return () => clearInterval(t);
  }, [cooldown]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setInfo(null);
    if (!/^\d{6}$/.test(code)) {
      setError("Enter the 6-digit code");
      return;
    }
    setLoading(true);
    try {
      const res = await fetch("/api/auth/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, code }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Verification failed");
        return;
      }
      router.replace("/");
      router.refresh();
    } catch {
      setError("Network error");
    } finally {
      setLoading(false);
    }
  };

  const handleResend = async () => {
    setError(null);
    setInfo(null);
    try {
      const res = await fetch("/api/auth/resend", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      const data = await res.json();
      if (res.status === 429) {
        setCooldown(data.cooldown || 60);
        setError(data.error || "Please wait before requesting another code.");
        return;
      }
      if (!res.ok) {
        setError(data.error || "Could not resend code");
        return;
      }
      setInfo("A new code has been sent to your email.");
      setCooldown(60);
    } catch {
      setError("Network error");
    }
  };

  return (
    <main className="auth-wrap">
      <div className="auth-card">
        <div className="auth-brand">🚀 Kushal Automation</div>
        <h1 className="auth-title">Verify your email</h1>
        <p className="auth-subtitle">
          We sent a 6-digit code to {email ? <strong>{email}</strong> : "your email"}. Enter it below to continue.
        </p>

        <form onSubmit={handleSubmit} className="auth-form">
          <div className="form-group">
            <label>Verification code</label>
            <input
              type="text"
              inputMode="numeric"
              className="form-input"
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
              placeholder="123456"
              maxLength={6}
              autoFocus
              required
              style={{ letterSpacing: "8px", textAlign: "center", fontSize: "20px" }}
            />
          </div>

          {error && <div className="auth-error">{error}</div>}
          {info && <div className="api-hint" style={{ color: "#16a34a" }}>{info}</div>}

          <button type="submit" className="btn btn-primary" disabled={loading}>
            {loading ? "Verifying..." : "Verify & continue"}
          </button>
        </form>

        <div className="auth-footer">
          Didn't get it?{" "}
          <button
            type="button"
            onClick={handleResend}
            disabled={cooldown > 0}
            style={{
              background: "none",
              border: "none",
              color: cooldown > 0 ? "#94a3b8" : "#2563eb",
              cursor: cooldown > 0 ? "default" : "pointer",
              padding: 0,
              font: "inherit",
            }}
          >
            {cooldown > 0 ? `Resend in ${cooldown}s` : "Resend code"}
          </button>
        </div>
        <div className="auth-footer">
          <Link href="/login">Back to login</Link>
        </div>
      </div>
    </main>
  );
}

export default function VerifyPage() {
  return (
    <Suspense fallback={<main className="auth-wrap" />}>
      <VerifyInner />
    </Suspense>
  );
}
