"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

type AdminUser = {
  id: string;
  email: string;
  name: string | null;
  role: string;
  onboarded: boolean;
  createdAt: string;
  leadsTotal: number;
  leadsSent: number;
  leadsFailed: number;
};

type AdminStats = {
  totals: { totalUsers: number; totalLeads: number; totalSent: number; totalFailed: number };
  users: AdminUser[];
};

export default function AdminPage() {
  const [stats, setStats] = useState<AdminStats | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    try {
      const res = await fetch("/api/admin/stats");
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        setError(d.error || "Could not load stats");
        return;
      }
      setStats(await res.json());
    } catch {
      setError("Network error");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  return (
    <>
      <header className="header">
        <div className="header-logo">
          <div className="icon">🛡️</div>
          Admin Dashboard
        </div>
        <div className="header-actions">
          <Link href="/" className="btn btn-ghost btn-sm">
            ← Back to App
          </Link>
          <button className="btn btn-ghost btn-sm" onClick={load}>
            ↻ Refresh
          </button>
        </div>
      </header>

      <main className="main-container">
        {loading && (
          <div className="search-panel" style={{ textAlign: "center" }}>
            <span className="loading-spinner"></span> Loading stats...
          </div>
        )}

        {error && (
          <div className="search-panel" style={{ borderColor: "var(--red)" }}>
            {error}
          </div>
        )}

        {stats && (
          <>
            <div className="stats-grid">
              <div className="stat-card">
                <div className="stat-label">Total Users</div>
                <div className="stat-value">{stats.totals.totalUsers}</div>
              </div>
              <div className="stat-card">
                <div className="stat-label">Total Leads</div>
                <div className="stat-value">{stats.totals.totalLeads}</div>
              </div>
              <div className="stat-card">
                <div className="stat-label">Messages Sent</div>
                <div className="stat-value" style={{ color: "var(--green)" }}>
                  {stats.totals.totalSent}
                </div>
              </div>
              <div className="stat-card">
                <div className="stat-label">Failed</div>
                <div className="stat-value" style={{ color: "var(--red)" }}>
                  {stats.totals.totalFailed}
                </div>
              </div>
            </div>

            <div className="search-panel">
              <h2>👥 All Users</h2>
              <div style={{ overflowX: "auto" }}>
                <table className="admin-table">
                  <thead>
                    <tr>
                      <th>User</th>
                      <th>Role</th>
                      <th>Onboarded</th>
                      <th>Leads</th>
                      <th>Sent</th>
                      <th>Failed</th>
                      <th>Joined</th>
                    </tr>
                  </thead>
                  <tbody>
                    {stats.users.map((u) => (
                      <tr key={u.id}>
                        <td>
                          <div style={{ fontWeight: 600 }}>{u.name || "—"}</div>
                          <div style={{ fontSize: 12, color: "var(--text-secondary)" }}>{u.email}</div>
                        </td>
                        <td>
                          <span className={`role-pill ${u.role}`}>{u.role}</span>
                        </td>
                        <td>{u.onboarded ? "✅" : "—"}</td>
                        <td>{u.leadsTotal}</td>
                        <td style={{ color: "var(--green)" }}>{u.leadsSent}</td>
                        <td style={{ color: "var(--red)" }}>{u.leadsFailed}</td>
                        <td style={{ fontSize: 12, color: "var(--text-secondary)" }}>
                          {new Date(u.createdAt).toLocaleDateString()}
                        </td>
                      </tr>
                    ))}
                    {stats.users.length === 0 && (
                      <tr>
                        <td colSpan={7} style={{ textAlign: "center", color: "var(--text-muted)", padding: 20 }}>
                          No users yet
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </>
        )}
      </main>
    </>
  );
}
