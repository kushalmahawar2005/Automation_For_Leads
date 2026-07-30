"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";

// Types
type Business = {
  id: string;
  name: string;
  address: string;
  phone: string;
  rating?: number;
  website?: string;
  status?: string;
  lastError?: string | null;
};

type Settings = {
  userName: string;
  userBusiness: string;
  userProfession: string;
  portfolioLink: string;
  serpApiKey: string;
  dailyCap: number;
  minDelaySec: number;
  maxDelaySec: number;
  batchSize: number;
  batchPauseSec: number;
  warmup: boolean;
  validateNumbers: boolean;
};

type Template = { id: string; name: string; language: string; body: string };

// Built-in starter messages
type Preset = "INTRO" | "PITCH";

type Campaign = {
  running: boolean;
  total: number;
  sent: number;
  failed: number;
  invalid: number;
  skipped: number;
  processed: number;
  currentName?: string;
  nextSendAt?: number;
  stopReason?: string;
  dailyCap: number;
  dailySentToday: number;
};

type WaStatus = 'INITIALIZING' | 'QR_READY' | 'AUTHENTICATED' | 'READY' | 'DISCONNECTED' | 'ERROR';

type ViewMode = 'SEARCH' | 'FOUND' | 'SENT' | 'FAILED' | 'INVALID';

const CATEGORIES = [
  "Restaurants & Cafes",
  "Real Estate Agents",
  "Doctors & Clinics",
  "Gyms & Fitness Centers",
  "Salons & Spas",
  "Boutiques",
  "Clothing Stores",
  "Photographers & Video Studios",
  "Wedding Planners",
  "Coaching Institutes",
  "Hardware & Paint Stores",
  "Jewellery Shops",
  "Car Dealerships & Garages"
];

const PROFESSIONS = [
  "Website Developer",
  "Video Editor",
  "Graphic Designer",
  "SEO Expert",
  "Social Media Manager",
  "Digital Marketing Agency"
];

type CurrentUser = { id: string; email: string; name: string | null; role?: string };

export default function Home() {
  const router = useRouter();
  const [currentUser, setCurrentUser] = useState<CurrentUser | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);

  useEffect(() => {
    fetch("/api/auth/me")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (d?.user) {
          setCurrentUser(d.user);
          setIsAdmin(d.user.role === "admin");
        }
      })
      .catch(() => {});
  }, []);

  const handleAccountLogout = async () => {
    await fetch("/api/auth/logout", { method: "POST" });
    router.replace("/login");
    router.refresh();
  };

  // State
  const [location, setLocation] = useState("");
  const [query, setQuery] = useState(CATEGORIES[0]);
  const [results, setResults] = useState<Business[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [isSearching, setIsSearching] = useState(false);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [totalResults, setTotalResults] = useState<number | null>(null);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const pageSize = 20;

  // View: live search results vs. saved-lead buckets (Found/Sent/Failed/Invalid)
  const [viewMode, setViewMode] = useState<ViewMode>('SEARCH');
  const [counts, setCounts] = useState<Record<string, number>>({ FOUND: 0, SENT: 0, FAILED: 0, INVALID: 0, ALL: 0 });

  // Settings State
  const [showSettings, setShowSettings] = useState(false);
  const [settings, setSettings] = useState<Settings>({
    userName: "",
    userBusiness: "",
    userProfession: "Website Developer",
    portfolioLink: "",
    serpApiKey: "",
    dailyCap: 40,
    minDelaySec: 8,
    maxDelaySec: 30,
    batchSize: 10,
    batchPauseSec: 90,
    warmup: true,
    validateNumbers: true,
  });

  const [language, setLanguage] = useState<"EN" | "HINGLISH">("EN");
  const [preset, setPreset] = useState<Preset>("INTRO");
  const [messageTemplate, setMessageTemplate] = useState("");
  const templateDirty = useRef(false);

  // Update Template when settings, language or preset change (unless user edited it)
  useEffect(() => {
    if (templateDirty.current) return;
    const me = settings.userName || '[Your Name]';
    const agency = settings.userBusiness || '[Your Agency]';
    const prof = settings.userProfession;
    if (preset === "PITCH") {
      // Competitor-gap pitch: leans on {{competitor}} / {{business_type}} / {{link}}
      if (language === "EN") {
        setMessageTemplate(`Hello {{name}},\n\n${me} here, from ${agency}. We build websites and mobile applications for businesses across Rajasthan.\n\nWhile researching {{business_type}} businesses in {{area}}, I found that {{business}} doesn't currently have a website, while {{competitor}} does — which means they appear first when customers search online, despite your stronger reviews.\n\nA recent project of ours: {{link}}\n\nWould you be open to a short call this week to discuss what this could look like for {{business}}?\n\nRegards,\n${me}`);
      } else {
        setMessageTemplate(`Hello {{name}},\n\nMain ${me}, ${agency} se. Hum Rajasthan ke businesses ke liye websites aur mobile applications banate hain.\n\n{{area}} ke {{business_type}} businesses dekhte waqt maine notice kiya ki {{business}} ki abhi tak koi website nahi hai, jabki {{competitor}} ki hai — isliye online search mein customers ko pehle wo dikhte hain, aapke reviews behtar hone ke bawajood.\n\nHamara ek recent project: {{link}}\n\nKya is week ek chhoti si call ho sakti hai, taaki {{business}} ke liye ye kaisa dikhega wo discuss kar sakein?\n\nThanks & Regards,\n${me}`);
      }
      return;
    }
    if (language === "EN") {
      setMessageTemplate(`Hi {{name}},\n\nI am ${me}, a professional ${prof} running ${agency}.\n\nI noticed your business in {{location}} and I would love to collaborate with you to help grow your brand online.\n\nLet me know if you are looking for ${prof} services!\n\nBest regards,\n${me}`);
    } else {
      setMessageTemplate(`Hello {{name}},\n\nMera naam ${me} hai, main ek professional ${prof} hu aur meri agency ka naam ${agency} hai.\n\nMaine {{location}} mein aapke business ke baare mein dekha aur mujhe aapke sath kaam karke aapki brand ko online grow karne mein khushi hogi.\n\nAgar aapko ${prof} services ki requirement ho toh please mujhe batayein!\n\nThanks & Regards,\n${me}`);
    }
  }, [language, preset, settings.userName, settings.userBusiness, settings.userProfession]);

  // Saved templates
  const [templates, setTemplates] = useState<Template[]>([]);
  const loadTemplates = useCallback(async () => {
    try {
      const res = await fetch("/api/templates");
      if (res.ok) {
        const data = await res.json();
        setTemplates(data.templates || []);
      }
    } catch { /* ignore */ }
  }, []);
  useEffect(() => { loadTemplates(); }, [loadTemplates]);

  // Media attachment (portfolio / brochure)
  const [media, setMedia] = useState<{ token: string; name: string } | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // WhatsApp State
  const [waStatus, setWaStatus] = useState<WaStatus>('DISCONNECTED');
  const [waQrCode, setWaQrCode] = useState<string | null>(null);

  // Poll WhatsApp Status
  useEffect(() => {
    const fetchStatus = async () => {
      try {
        const res = await fetch('/api/whatsapp/status');
        const data = await res.json();
        setWaStatus(data.status);
        setWaQrCode(data.qr);
      } catch {
        console.error("Failed to fetch WA status");
      }
    };
    fetchStatus();
    const interval = setInterval(fetchStatus, 3000);
    return () => clearInterval(interval);
  }, []);

  // Stats
  const [stats, setStats] = useState({ found: 0, selected: 0, sent: 0, failed: 0 });

  // Load lead status counts
  const loadCounts = useCallback(async () => {
    try {
      const res = await fetch("/api/leads?take=1");
      if (res.ok) {
        const data = await res.json();
        setCounts(data.counts);
        setStats((s) => ({ ...s, sent: data.counts.SENT || 0, failed: data.counts.FAILED || 0 }));
      }
    } catch { /* ignore */ }
  }, []);
  useEffect(() => { loadCounts(); }, [loadCounts]);

  // Load settings from DB on mount
  useEffect(() => {
    const loadSettings = async () => {
      try {
        const res = await fetch("/api/settings");
        if (res.ok) {
          const data = await res.json();
          setSettings((prev) => ({
            ...prev,
            userName: data.userName || "",
            userBusiness: data.userBusiness || "",
            userProfession: data.userProfession || "Website Developer",
            portfolioLink: data.portfolioLink || "",
            serpApiKey: data.serpApiKey || "",
            dailyCap: data.dailyCap ?? 40,
            minDelaySec: data.minDelaySec ?? 8,
            maxDelaySec: data.maxDelaySec ?? 30,
            batchSize: data.batchSize ?? 10,
            batchPauseSec: data.batchPauseSec ?? 90,
            warmup: data.warmup ?? true,
            validateNumbers: data.validateNumbers ?? true,
          }));
        }
      } catch (error) {
        console.error("Error loading settings", error);
      }
    };
    loadSettings();
  }, []);

  // Handlers
  const saveSettings = async () => {
    try {
      await fetch("/api/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(settings),
      });
      setShowSettings(false);
      showToast("Settings saved securely in DB", "success");
    } catch {
      showToast("Failed to save settings", "error");
    }
  };

  const [toasts, setToasts] = useState<{ id: number; msg: string; type: string }[]>([]);
  const showToast = (msg: string, type: string = "info") => {
    const id = Date.now() + Math.random();
    setToasts((prev) => [...prev, { id, msg, type }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 3500);
  };

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!location || !query) {
      showToast("Please enter both location and select a category", "error");
      return;
    }
    setViewMode('SEARCH');
    setIsSearching(true);
    setResults([]);
    setSelectedIds(new Set());
    setPage(1);
    setHasMore(false);
    setTotalResults(null);

    try {
      const res = await fetch("/api/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ location, query, page: 1, pageSize }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Search failed");

      setResults(data.results || []);
      setHasMore(Boolean(data.hasNext));
      setTotalResults(typeof data.totalResults === "number" ? data.totalResults : null);
      setStats((s) => ({ ...s, found: typeof data.totalResults === "number" ? data.totalResults : (data.results?.length || 0) }));
      const dup = data.duplicateCount ? ` (${data.duplicateCount} duplicate${data.duplicateCount > 1 ? 's' : ''} skipped)` : '';
      showToast(`Found ${data.newCount ?? data.results?.length ?? 0} new businesses!${dup}`, "success");
      loadCounts();
    } catch (err) {
      showToast((err as Error).message, "error");
    } finally {
      setIsSearching(false);
    }
  };

  const handleLoadNext = async () => {
    if (isLoadingMore || !hasMore) return;
    setIsLoadingMore(true);
    try {
      const nextPage = page + 1;
      const res = await fetch("/api/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ location, query, page: nextPage, pageSize }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Search failed");

      setResults((prev) => [...prev, ...(data.results || [])]);
      setPage(nextPage);
      setHasMore(Boolean(data.hasNext));
      if (typeof data.totalResults === "number") {
        setTotalResults(data.totalResults);
        setStats((s) => ({ ...s, found: data.totalResults }));
      }
      loadCounts();
    } catch (err) {
      showToast((err as Error).message, "error");
    } finally {
      setIsLoadingMore(false);
    }
  };

  // Switch to a saved-lead bucket (Found/Sent/Failed/Invalid)
  const loadBucket = async (mode: ViewMode) => {
    setViewMode(mode);
    setSelectedIds(new Set());
    setHasMore(false);
    if (mode === 'SEARCH') return;
    setIsSearching(true);
    try {
      const res = await fetch(`/api/leads?status=${mode}&take=500`);
      const data = await res.json();
      if (res.ok) {
        setResults(data.leads || []);
        setCounts(data.counts);
        setTotalResults(data.counts[mode] ?? (data.leads?.length || 0));
      }
    } catch {
      showToast("Failed to load leads", "error");
    } finally {
      setIsSearching(false);
    }
  };

  const toggleSelectAll = () => {
    const valid = results.filter((r) => r.phone);
    if (selectedIds.size === valid.length && valid.length > 0) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(valid.map((r) => r.id)));
    }
  };

  const toggleSelect = (id: string, hasPhone: boolean) => {
    if (!hasPhone) return;
    const next = new Set(selectedIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelectedIds(next);
  };

  useEffect(() => {
    setStats((s) => ({ ...s, selected: selectedIds.size }));
  }, [selectedIds]);

  const insertVar = (variable: string) => {
    templateDirty.current = true;
    setMessageTemplate((prev) => prev + variable);
  };

  // ---- Template save / apply / delete ----
  const applyTemplate = (id: string) => {
    if (!id) return;
    const t = templates.find((x) => x.id === id);
    if (!t) return;
    templateDirty.current = true;
    setMessageTemplate(t.body);
    if (t.language === "EN" || t.language === "HINGLISH") setLanguage(t.language);
    showToast(`Loaded template "${t.name}"`, "info");
  };

  const saveTemplate = async () => {
    const name = window.prompt("Template name?");
    if (!name?.trim()) return;
    try {
      const res = await fetch("/api/templates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim(), body: messageTemplate, language }),
      });
      if (!res.ok) throw new Error("Failed");
      await loadTemplates();
      showToast("Template saved", "success");
    } catch {
      showToast("Failed to save template", "error");
    }
  };

  // ---- Media upload ----
  const handleMediaSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setIsUploading(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch("/api/media/upload", { method: "POST", body: fd });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Upload failed");
      setMedia({ token: data.token, name: data.name });
      showToast(`Attached ${data.name}`, "success");
    } catch (err) {
      showToast((err as Error).message, "error");
    } finally {
      setIsUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  // ---- Bulk send (server-side, anti-ban) ----
  const [campaign, setCampaign] = useState<Campaign | null>(null);
  const [isStarting, setIsStarting] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const pollCampaign = useCallback(() => {
    if (pollRef.current) clearInterval(pollRef.current);
    pollRef.current = setInterval(async () => {
      try {
        const res = await fetch("/api/send/bulk");
        const data = await res.json();
        setCampaign(data.campaign);
        if (data.campaign && !data.campaign.running) {
          if (pollRef.current) clearInterval(pollRef.current);
          pollRef.current = null;
          loadCounts();
          if (viewMode !== 'SEARCH') loadBucket(viewMode);
          const c = data.campaign as Campaign;
          const reason = c.stopReason === 'DAILY_CAP' ? ' — daily limit reached' :
            c.stopReason === 'TOO_MANY_FAILURES' ? ' — stopped (too many failures, possible block)' :
            c.stopReason === 'STOPPED' ? ' — stopped by you' : '';
          showToast(`Done. Sent ${c.sent}, failed ${c.failed}, invalid ${c.invalid}${reason}`, c.sent > 0 ? "success" : "error");
        }
      } catch { /* ignore */ }
    }, 2000);
  }, [loadCounts, viewMode]);

  // Resume polling if a campaign is already running (e.g. after refresh)
  useEffect(() => {
    fetch("/api/send/bulk").then((r) => r.json()).then((data) => {
      if (data.campaign) {
        setCampaign(data.campaign);
        if (data.campaign.running) pollCampaign();
      }
    }).catch(() => {});
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [pollCampaign]);

  const handleSendMessages = async () => {
    if (selectedIds.size === 0) {
      showToast("Please select at least one contact", "error");
      return;
    }
    if (waStatus !== 'READY') {
      showToast("Please scan the WhatsApp QR code first!", "error");
      return;
    }
    setIsStarting(true);
    try {
      const res = await fetch("/api/send/bulk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          leadIds: Array.from(selectedIds),
          templateBody: messageTemplate,
          fallbackLocation: location,
          mediaToken: media?.token || null,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to start");
      setCampaign(data.campaign);
      pollCampaign();
      showToast(`Started sending to ${selectedIds.size} contacts (with safe delays)`, "success");
    } catch (err) {
      showToast((err as Error).message, "error");
    } finally {
      setIsStarting(false);
    }
  };

  const stopCampaign = async () => {
    await fetch("/api/send/bulk", { method: "DELETE" });
    showToast("Stopping after current message...", "info");
  };

  const resendFailed = async () => {
    await loadBucket('FAILED');
    showToast("Loaded failed leads — Select All, then Send to retry", "info");
  };

  const handleLogout = async () => {
    await fetch('/api/whatsapp/status', { method: 'POST' });
    setWaStatus('DISCONNECTED');
    setWaQrCode(null);
  };

  const usesCompetitor = /{{\s*competitor\s*}}/i.test(messageTemplate);
  const usesLink = /{{\s*(link|portfolio)\s*}}/i.test(messageTemplate);

  const isSending = !!campaign?.running;
  const progress = campaign && campaign.total > 0 ? (campaign.processed / campaign.total) * 100 : 0;
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!isSending) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [isSending]);
  const nextInSec = campaign?.nextSendAt ? Math.max(0, Math.round((campaign.nextSendAt - now) / 1000)) : 0;

  const tabs: { key: ViewMode; label: string }[] = [
    { key: 'SEARCH', label: 'Search' },
    { key: 'FOUND', label: `New (${counts.FOUND || 0})` },
    { key: 'SENT', label: `Sent (${counts.SENT || 0})` },
    { key: 'FAILED', label: `Failed (${counts.FAILED || 0})` },
    { key: 'INVALID', label: `Invalid (${counts.INVALID || 0})` },
  ];

  return (
    <>
      <header className="header">
        <div className="header-logo">
          <div className="icon">🚀</div>
          <span className="header-title">Kushal Automation</span>
        </div>
        <div className="header-actions">
          <div className="header-badge" style={{ background: waStatus === 'READY' ? 'var(--green-glow)' : 'var(--accent-glow)', color: waStatus === 'READY' ? 'var(--green)' : 'var(--accent)' }}>
            WA: {waStatus}
          </div>
          {waStatus !== 'DISCONNECTED' && (
            <button className="btn btn-ghost btn-sm" onClick={handleLogout} style={{ background: waStatus === 'ERROR' ? 'rgba(239, 68, 68, 0.2)' : undefined, color: waStatus === 'ERROR' ? '#ef4444' : undefined }}>
              {waStatus === 'ERROR' ? 'Reset WA' : 'Logout WA'}
            </button>
          )}
          {currentUser && (
            <span className="header-badge" title={currentUser.email}>
              {currentUser.name || currentUser.email}
            </span>
          )}
          {isAdmin && (
            <a href="/admin" className="btn btn-ghost btn-sm" style={{ background: 'var(--accent-glow)', color: 'var(--accent)' }}>
              🛡️ Admin
            </a>
          )}
          <button className="btn btn-ghost btn-sm" onClick={handleAccountLogout}>
            Sign out
          </button>
          <button className="btn btn-ghost btn-icon" onClick={() => setShowSettings(true)}>
            ⚙️
          </button>
        </div>
      </header>

      <main className="main-container">
        {/* WhatsApp QR Panel */}
        {waStatus !== 'READY' && (
          <div className="search-panel" style={{ textAlign: 'center', borderColor: 'var(--accent)', background: 'var(--bg-secondary)' }}>
            <h2>📱 Scan WhatsApp QR Code</h2>
            <p style={{ color: 'var(--text-secondary)', marginBottom: '16px' }}>
              Connect your WhatsApp to send automated messages directly from your number.
            </p>
            {waStatus === 'INITIALIZING' && (
              <div style={{ padding: '20px' }}>
                <span className="loading-spinner"></span> <br /><br />
                Starting WhatsApp Client...
              </div>
            )}
            {waStatus === 'QR_READY' && waQrCode && (
              <div>
                <img src={waQrCode} alt="WhatsApp QR Code" className="qr-image" style={{ background: '#fff', padding: '16px', borderRadius: '12px', display: 'inline-block' }} />
                <p style={{ marginTop: '12px', fontSize: '13px', color: 'var(--text-muted)' }}>Scan with WhatsApp {"->"} Linked Devices</p>
              </div>
            )}
            {waStatus === 'AUTHENTICATED' && (
              <div style={{ color: 'var(--green)' }}>✓ Authenticated! Loading chats...</div>
            )}
            {(waStatus === 'ERROR' || waStatus === 'DISCONNECTED') && (
              <div style={{ padding: '20px', color: 'var(--accent)' }}>
                <span className="loading-spinner"></span> <br /><br />
                {waStatus === 'ERROR' ? 'Connection error encountered. Retrying...' : 'Connecting to WhatsApp...'}
                <div style={{ marginTop: '16px' }}>
                  <button className="btn btn-secondary btn-sm" onClick={handleLogout}>
                    🔄 Reset WhatsApp Session
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        <div className="stats-grid">
          <div className="stat-card">
            <div className="stat-label">Leads Found</div>
            <div className="stat-value">{stats.found}</div>
          </div>
          <div className="stat-card">
            <div className="stat-label">Selected</div>
            <div className="stat-value">{stats.selected}</div>
          </div>
          <div className="stat-card">
            <div className="stat-label">Sent Today</div>
            <div className="stat-value" style={{ color: 'var(--green)' }}>
              {campaign?.dailySentToday ?? 0}<span style={{ fontSize: '14px', color: 'var(--text-muted)' }}>/{settings.dailyCap}</span>
            </div>
          </div>
          <div className="stat-card">
            <div className="stat-label">Failed</div>
            <div className="stat-value" style={{ color: 'var(--red)' }}>{stats.failed}</div>
          </div>
        </div>

        <div className="search-panel">
          <h2>🔍 Find Targeted Businesses</h2>
          <form className="search-form" onSubmit={handleSearch}>
            <div className="form-group">
              <label>Target Location (City or Area)</label>
              <input
                type="text"
                className="form-input"
                placeholder="e.g. Jaipur, Delhi, Andheri West..."
                value={location}
                onChange={(e) => setLocation(e.target.value)}
              />
            </div>
            <div className="form-group">
              <label>Business Category</label>
              <select
                className="form-input"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              >
                {CATEGORIES.map((cat) => <option key={cat} value={cat}>{cat}</option>)}
              </select>
            </div>
            <button type="submit" className="btn btn-primary" disabled={isSearching}>
              {isSearching ? <span className="loading-spinner"></span> : 'Scrape Data'}
            </button>
          </form>
        </div>

        <div className="content-grid">
          <div className="results-panel">
            {/* Status filter tabs */}
            <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', padding: '4px 4px 12px' }}>
              {tabs.map((t) => (
                <button
                  key={t.key}
                  className="btn btn-ghost btn-sm"
                  onClick={() => (t.key === 'SEARCH' ? setViewMode('SEARCH') : loadBucket(t.key))}
                  style={viewMode === t.key ? { background: 'var(--accent-glow)', color: 'var(--accent)' } : undefined}
                >
                  {t.label}
                </button>
              ))}
            </div>
            <div className="panel-header">
              <h3>
                {viewMode === 'SEARCH' ? 'Contacts List' : `${viewMode} Leads`} <span className="panel-count">
                  {totalResults ? `${results.length}/${totalResults}` : results.length}
                </span>
              </h3>
              <div style={{ display: 'flex', gap: '6px' }}>
                {viewMode === 'FAILED' && counts.FAILED > 0 && (
                  <button className="btn btn-ghost btn-sm" onClick={toggleSelectAll} title="Select all to resend">
                    Select Failed
                  </button>
                )}
                <button className="btn btn-ghost btn-sm" onClick={toggleSelectAll}>
                  Select All Valid
                </button>
              </div>
            </div>
            <div className="results-list">
              {isSearching ? (
                <div className="search-loading">
                  <span className="loading-spinner"></span> {viewMode === 'SEARCH' ? 'Scraping Google Maps...' : 'Loading leads...'}
                </div>
              ) : results.length > 0 ? (
                results.map((r) => {
                  const hasPhone = !!r.phone;
                  const statusColor = r.status === 'SENT' ? 'var(--green)' : r.status === 'FAILED' ? 'var(--red)' : r.status === 'INVALID' ? 'var(--text-muted)' : 'var(--accent)';
                  return (
                    <div
                      key={r.id}
                      className={`result-item ${selectedIds.has(r.id) ? 'selected' : ''}`}
                      onClick={() => toggleSelect(r.id, hasPhone)}
                      style={{ opacity: hasPhone ? 1 : 0.5 }}
                    >
                      <div className={`result-check ${selectedIds.has(r.id) ? 'checked' : ''}`}>✓</div>
                      <div className="result-info">
                        <div className="result-name">
                          {r.name}
                          {r.status && r.status !== 'FOUND' && (
                            <span style={{ marginLeft: 8, fontSize: 11, color: statusColor }}>● {r.status}</span>
                          )}
                        </div>
                        <div className="result-address">{r.lastError ? `⚠️ ${r.lastError}` : r.address}</div>
                      </div>
                      <div className="result-phone">
                        {r.phone || 'No phone'}
                      </div>
                    </div>
                  );
                })
              ) : (
                <div className="no-results">
                  <div className="icon">📍</div>
                  <p>{viewMode === 'SEARCH' ? 'Select category and location to scrape' : 'No leads in this bucket yet'}</p>
                </div>
              )}
            </div>
            {viewMode === 'SEARCH' && results.length > 0 && (
              <div className="results-footer">
                <div className="results-summary">
                  {totalResults ? `Showing ${results.length} of ${totalResults}` : `Showing ${results.length}`}
                </div>
                <button
                  className="btn btn-ghost btn-sm"
                  onClick={handleLoadNext}
                  disabled={isLoadingMore || !hasMore}
                >
                  {isLoadingMore ? 'Loading...' : hasMore ? 'Next 20' : 'No more'}
                </button>
              </div>
            )}
          </div>

          <div className="message-panel">
            <div className="template-selector template-row" style={{ gap: 10 }}>
              <div style={{ flex: 1 }}>
                <label>Message Style</label>
                <select className="template-select" value={preset} onChange={(e) => { templateDirty.current = false; setPreset(e.target.value as Preset); }}>
                  <option value="INTRO">Simple Intro</option>
                  <option value="PITCH">Website Pitch (competitor angle)</option>
                </select>
              </div>
              <div style={{ flex: 1 }}>
                <label>Template Language</label>
                <select className="template-select" value={language} onChange={(e) => { templateDirty.current = false; setLanguage(e.target.value as "EN" | "HINGLISH"); }}>
                  <option value="EN">English</option>
                  <option value="HINGLISH">Hinglish</option>
                </select>
              </div>
              <div style={{ flex: 1 }}>
                <label>Saved Templates</label>
                <select className="template-select" defaultValue="" onChange={(e) => { applyTemplate(e.target.value); e.target.value = ""; }}>
                  <option value="">Load saved…</option>
                  {templates.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                </select>
              </div>
            </div>
            <div className="message-editor">
              <label style={{ fontSize: '13px', color: 'var(--text-secondary)', marginBottom: '8px', display: 'block' }}>
                Message Editor (Feel free to edit)
              </label>
              <textarea
                className="message-textarea"
                value={messageTemplate}
                onChange={(e) => { templateDirty.current = true; setMessageTemplate(e.target.value); }}
                placeholder="Type your WhatsApp message here..."
              ></textarea>
              <div className="message-vars">
                <button className="var-tag" onClick={() => insertVar('{{name}}')}>+ Name</button>
                <button className="var-tag" onClick={() => insertVar('{{location}}')}>+ Location</button>
                <button className="var-tag" onClick={() => insertVar('{{address}}')}>+ Address</button>
                <button className="var-tag" onClick={() => insertVar('{{rating}}')}>+ Rating</button>
                <button className="var-tag" onClick={() => insertVar('{{website}}')}>+ Website</button>
                <button className="var-tag" onClick={() => insertVar('{{business_type}}')}>+ Category</button>
                <button className="var-tag" onClick={() => insertVar('{{area}}')}>+ Area</button>
                <button className="var-tag" onClick={() => insertVar('{{competitor}}')}>+ Competitor</button>
                <button className="var-tag" onClick={() => insertVar('{{link}}')}>+ My Link</button>
                <button className="var-tag" onClick={saveTemplate} style={{ background: 'var(--accent-glow)', color: 'var(--accent)' }}>💾 Save Template</button>
              </div>
              {usesCompetitor && (
                <div className="api-hint" style={{ marginTop: 8 }}>
                  {"{{competitor}}"} picks a rival from the same category + area that already has a
                  website (best-rated first). If none is found it falls back to “a nearby competitor”.
                </div>
              )}
              {usesLink && !settings.portfolioLink && (
                <div className="api-hint" style={{ marginTop: 6, color: 'var(--red)' }}>
                  ⚠️ {"{{link}}"} will send blank — add your portfolio link in ⚙️ Settings.
                </div>
              )}
              {/* Media attach */}
              <div style={{ marginTop: 10, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                <input ref={fileInputRef} type="file" accept="image/*,application/pdf" style={{ display: 'none' }} onChange={handleMediaSelect} />
                <button className="var-tag" onClick={() => fileInputRef.current?.click()} disabled={isUploading}>
                  {isUploading ? 'Uploading…' : '📎 Attach Image/PDF'}
                </button>
                {media && (
                  <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
                    {media.name} <button className="btn-icon" style={{ fontSize: 14 }} onClick={() => setMedia(null)}>×</button>
                  </span>
                )}
              </div>
            </div>

            {campaign && (isSending || campaign.stopReason) && (
              <div style={{ padding: '0 20px' }}>
                <div style={{ fontSize: '12px', color: 'var(--text-secondary)', marginBottom: '4px', display: 'flex', justifyContent: 'space-between' }}>
                  <span>
                    {isSending ? `Sending… ${campaign.processed}/${campaign.total}` : 'Finished'}
                    {isSending && campaign.currentName ? ` → ${campaign.currentName}` : ''}
                  </span>
                  <span>✅ {campaign.sent} · ❌ {campaign.failed} · 🚫 {campaign.invalid}</span>
                </div>
                <div className="progress-bar">
                  <div className="progress-fill" style={{ width: `${progress}%` }}></div>
                </div>
                {isSending && nextInSec > 0 && (
                  <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>
                    Next message in {nextInSec}s (human-like delay to stay safe)
                  </div>
                )}
              </div>
            )}

            <div className="message-actions">
              {isSending ? (
                <button className="btn btn-ghost" onClick={stopCampaign} style={{ color: 'var(--red)' }}>
                  ⏹ Stop Sending
                </button>
              ) : (
                <button
                  className="btn btn-success"
                  onClick={handleSendMessages}
                  disabled={isStarting || selectedIds.size === 0 || waStatus !== 'READY'}
                >
                  {waStatus !== 'READY' ? 'Scan QR First' : isStarting ? 'Starting…' : `Send WhatsApp (${selectedIds.size})`}
                </button>
              )}
              {!isSending && counts.FAILED > 0 && viewMode !== 'FAILED' && (
                <button className="btn btn-ghost" onClick={resendFailed} style={{ marginLeft: 8 }}>
                  ♻️ Resend Failed ({counts.FAILED})
                </button>
              )}
            </div>
          </div>
        </div>
      </main>

      {/* Settings Modal */}
      {showSettings && (
        <div className="modal-overlay">
          <div className="modal">
            <div className="modal-header">
              <h3>⚙️ User Profile & Configuration</h3>
              <button className="btn-icon" onClick={() => setShowSettings(false)}>×</button>
            </div>
            <div className="modal-body" style={{ maxHeight: '60vh', overflowY: 'auto' }}>
              <div className="form-group" style={{ marginBottom: '16px' }}>
                <label>Your Name</label>
                <input type="text" className="form-input" value={settings.userName} onChange={(e) => setSettings({ ...settings, userName: e.target.value })} placeholder="e.g. Kushal" />
              </div>
              <div className="form-group" style={{ marginBottom: '16px' }}>
                <label>Your Business/Agency Name</label>
                <input type="text" className="form-input" value={settings.userBusiness} onChange={(e) => setSettings({ ...settings, userBusiness: e.target.value })} placeholder="e.g. Kushal Studios" />
              </div>
              <div className="form-group" style={{ marginBottom: '16px' }}>
                <label>Your Profession / Field</label>
                <select className="form-input" value={settings.userProfession} onChange={(e) => setSettings({ ...settings, userProfession: e.target.value })}>
                  {PROFESSIONS.map((p) => <option key={p} value={p}>{p}</option>)}
                </select>
                <div className="api-hint">This will adapt the message templates for your field.</div>
              </div>
              <div className="form-group" style={{ marginBottom: '16px' }}>
                <label>Portfolio / Recent Work Link</label>
                <input type="url" className="form-input" value={settings.portfolioLink} onChange={(e) => setSettings({ ...settings, portfolioLink: e.target.value })} placeholder="https://your-recent-project.com" />
                <div className="api-hint">Sent wherever your message uses {"{{link}}"}.</div>
              </div>
              <hr style={{ border: 'none', borderTop: '1px solid var(--glass-border)', margin: '20px 0' }} />

              {/* Anti-ban controls */}
              <h4 style={{ margin: '0 0 12px', fontSize: 14 }}>🛡️ Safety / Anti-Ban</h4>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 16 }}>
                <div className="form-group">
                  <label>Daily send limit</label>
                  <input type="number" className="form-input" min={1} max={200} value={settings.dailyCap} onChange={(e) => setSettings({ ...settings, dailyCap: Number(e.target.value) })} />
                </div>
                <div className="form-group">
                  <label>Messages per batch</label>
                  <input type="number" className="form-input" min={1} max={100} value={settings.batchSize} onChange={(e) => setSettings({ ...settings, batchSize: Number(e.target.value) })} />
                </div>
                <div className="form-group">
                  <label>Min delay (sec)</label>
                  <input type="number" className="form-input" min={3} value={settings.minDelaySec} onChange={(e) => setSettings({ ...settings, minDelaySec: Number(e.target.value) })} />
                </div>
                <div className="form-group">
                  <label>Max delay (sec)</label>
                  <input type="number" className="form-input" min={3} value={settings.maxDelaySec} onChange={(e) => setSettings({ ...settings, maxDelaySec: Number(e.target.value) })} />
                </div>
                <div className="form-group">
                  <label>Batch cool-down (sec)</label>
                  <input type="number" className="form-input" min={0} value={settings.batchPauseSec} onChange={(e) => setSettings({ ...settings, batchPauseSec: Number(e.target.value) })} />
                </div>
              </div>
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10, cursor: 'pointer' }}>
                <input type="checkbox" checked={settings.warmup} onChange={(e) => setSettings({ ...settings, warmup: e.target.checked })} />
                <span>Warm-up mode (slower for first few messages)</span>
              </label>
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6, cursor: 'pointer' }}>
                <input type="checkbox" checked={settings.validateNumbers} onChange={(e) => setSettings({ ...settings, validateNumbers: e.target.checked })} />
                <span>Skip numbers not on WhatsApp (recommended)</span>
              </label>
              <div className="api-hint">Lower limits + longer delays = safer number. New numbers: keep ≤ 30/day for the first week.</div>

              <hr style={{ border: 'none', borderTop: '1px solid var(--glass-border)', margin: '20px 0' }} />
              <div className="form-group" style={{ marginBottom: '16px' }}>
                <label>Your SerpAPI Key</label>
                <input type="password" className="form-input" value={settings.serpApiKey} onChange={(e) => setSettings({ ...settings, serpApiKey: e.target.value })} placeholder="Paste your SerpAPI key" autoComplete="off" />
                <div className="api-hint">Get one at serpapi.com — stored privately for your account only.</div>
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn btn-ghost" onClick={() => setShowSettings(false)}>Cancel</button>
              <button className="btn btn-primary" onClick={saveSettings}>Save to Database</button>
            </div>
          </div>
        </div>
      )}

      {/* Toasts */}
      <div className="toast-container">
        {toasts.map((t) => (
          <div key={t.id} className={`toast ${t.type}`}>
            {t.type === 'success' && '✅'}
            {t.type === 'error' && '❌'}
            {t.type === 'info' && 'ℹ️'}
            {t.msg}
          </div>
        ))}
      </div>
    </>
  );
}
