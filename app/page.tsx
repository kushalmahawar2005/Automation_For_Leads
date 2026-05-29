"use client";

import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";

// Types
type Business = {
  id: string;
  name: string;
  address: string;
  phone: string;
  rating?: number;
  website?: string;
};

type Settings = {
  userName: string;
  userBusiness: string;
  userProfession: string;
  serpApiKey: string;
};

type WaStatus = 'INITIALIZING' | 'QR_READY' | 'AUTHENTICATED' | 'READY' | 'DISCONNECTED' | 'ERROR';

const CATEGORIES = [
  "Restaurants & Cafes",
  "Real Estate Agents",
  "Doctors & Clinics",
  "Gyms & Fitness Centers",
  "Salons & Spas",
  "Boutiques & Clothing Stores",
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
  const seenKeysRef = useRef<Set<string>>(new Set());

  const makeBusinessKey = (business: Business) => {
    const name = business.name?.toLowerCase().trim() || "";
    const address = business.address?.toLowerCase().trim() || "";
    const phone = business.phone?.replace(/\s+/g, "").trim() || "";
    return `${phone}||${name}||${address}`;
  };

  const filterNewBusinesses = (items: Business[]) => {
    const fresh: Business[] = [];
    for (const item of items) {
      const key = makeBusinessKey(item);
      if (seenKeysRef.current.has(key)) continue;
      seenKeysRef.current.add(key);
      fresh.push(item);
    }
    return fresh;
  };
  
  // Settings State
  const [showSettings, setShowSettings] = useState(false);
  const [settings, setSettings] = useState<Settings>({
    userName: "",
    userBusiness: "",
    userProfession: "Website Developer",
    serpApiKey: ""
  });

  const [language, setLanguage] = useState<"EN" | "HINGLISH">("EN");
  const [messageTemplate, setMessageTemplate] = useState("");

  // Update Template when settings or language change
  useEffect(() => {
    if (language === "EN") {
      setMessageTemplate(`Hi {{name}},\n\nI am ${settings.userName || '[Your Name]'}, a professional ${settings.userProfession} running ${settings.userBusiness || '[Your Agency]'}.\n\nI noticed your business in {{location}} and I would love to collaborate with you to help grow your brand online.\n\nLet me know if you are looking for ${settings.userProfession} services!\n\nBest regards,\n${settings.userName || '[Your Name]'}`);
    } else {
      let profHinglish = settings.userProfession;
      
      setMessageTemplate(`Hello {{name}},\n\nMera naam ${settings.userName || '[Your Name]'} hai, main ek professional ${profHinglish} hu aur meri agency ka naam ${settings.userBusiness || '[Your Agency]'} hai.\n\nMaine {{location}} mein aapke business ke baare mein dekha aur mujhe aapke sath kaam karke aapki brand ko online grow karne mein khushi hogi.\n\nAgar aapko ${profHinglish} services ki requirement ho toh please mujhe batayein!\n\nThanks & Regards,\n${settings.userName || '[Your Name]'}`);
    }
  }, [language, settings.userName, settings.userBusiness, settings.userProfession]);

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
      } catch (e) {
        console.error("Failed to fetch WA status");
      }
    };

    fetchStatus();
    const interval = setInterval(fetchStatus, 3000);
    return () => clearInterval(interval);
  }, []);

  // Stats
  const [stats, setStats] = useState({
    found: 0,
    selected: 0,
    sent: 0,
    failed: 0,
  });

  // Load settings from DB on mount
  useEffect(() => {
    const loadSettings = async () => {
      try {
        const res = await fetch("/api/settings");
        if (res.ok) {
          const data = await res.json();
          setSettings({
            userName: data.userName || "",
            userBusiness: data.userBusiness || "",
            userProfession: data.userProfession || "Website Developer",
            serpApiKey: data.serpApiKey || ""
          });
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
    } catch (e) {
      showToast("Failed to save settings", "error");
    }
  };

  const [toasts, setToasts] = useState<{id: number, msg: string, type: string}[]>([]);
  const showToast = (msg: string, type: string = "info") => {
    const id = Date.now();
    setToasts(prev => [...prev, { id, msg, type }]);
    setTimeout(() => {
      setToasts(prev => prev.filter(t => t.id !== id));
    }, 3000);
  };

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!location || !query) {
      showToast("Please enter both location and select a category", "error");
      return;
    }

    setIsSearching(true);
    setResults([]);
    setSelectedIds(new Set());
    setPage(1);
    setHasMore(false);
    setTotalResults(null);
    seenKeysRef.current = new Set();
    
    try {
      const res = await fetch("/api/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ location, query, page: 1, pageSize }),
      });

      const data = await res.json();
      
      if (!res.ok) throw new Error(data.error || "Search failed");

      const freshResults = filterNewBusinesses(data.results || []);
      setResults(freshResults);
      setHasMore(Boolean(data.hasNext));
      setTotalResults(typeof data.totalResults === "number" ? data.totalResults : null);
      setStats(s => ({ ...s, found: typeof data.totalResults === "number" ? data.totalResults : (data.results?.length || 0) }));
      showToast(`Found ${freshResults.length} businesses!`, "success");
    } catch (err: any) {
      showToast(err.message, "error");
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

      const freshResults = filterNewBusinesses(data.results || []);
      setResults(freshResults);
      setPage(nextPage);
      setHasMore(Boolean(data.hasNext));
      if (typeof data.totalResults === "number") {
        setTotalResults(data.totalResults);
        setStats(s => ({ ...s, found: data.totalResults }));
      }
    } catch (err: any) {
      showToast(err.message, "error");
    } finally {
      setIsLoadingMore(false);
    }
  };

  const toggleSelectAll = () => {
    if (selectedIds.size === results.filter(r => r.phone).length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(results.filter(r => r.phone).map(r => r.id)));
    }
  };

  const toggleSelect = (id: string, hasPhone: boolean) => {
    if (!hasPhone) return;
    const newSelected = new Set(selectedIds);
    if (newSelected.has(id)) {
      newSelected.delete(id);
    } else {
      newSelected.add(id);
    }
    setSelectedIds(newSelected);
  };

  useEffect(() => {
    setStats(s => ({ ...s, selected: selectedIds.size }));
  }, [selectedIds]);

  const insertVar = (variable: string) => {
    setMessageTemplate(prev => prev + variable);
  };

  const [isSending, setIsSending] = useState(false);
  const [sendProgress, setSendProgress] = useState(0);

  const handleSendMessages = async () => {
    if (selectedIds.size === 0) {
      showToast("Please select at least one contact", "error");
      return;
    }
    if (waStatus !== 'READY') {
      showToast("Please scan the WhatsApp QR code first!", "error");
      return;
    }

    setIsSending(true);
    setSendProgress(0);
    
    let successCount = 0;
    let failCount = 0;

    const selectedBusinesses = results.filter(r => selectedIds.has(r.id));

    for (let i = 0; i < selectedBusinesses.length; i++) {
      const business = selectedBusinesses[i];
      
      const msg = messageTemplate
        .replace(/{{name}}/g, business.name)
        .replace(/{{location}}/g, location);

      try {
        const res = await fetch("/api/send", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            phone: business.phone,
            message: msg,
            leadId: business.id
          })
        });

        if (res.ok) {
          successCount++;
        } else {
          failCount++;
        }
      } catch (e) {
        failCount++;
      }

      setSendProgress(((i + 1) / selectedBusinesses.length) * 100);
      
      await new Promise(r => setTimeout(r, 2500));
    }

    setStats(s => ({ 
      ...s, 
      sent: s.sent + successCount,
      failed: s.failed + failCount
    }));

    setIsSending(false);
    showToast(`Sent: ${successCount}, Failed: ${failCount}`, successCount > 0 ? "success" : "error");
  };

  const handleLogout = async () => {
    await fetch('/api/whatsapp/status', { method: 'POST' });
    setWaStatus('DISCONNECTED');
    setWaQrCode(null);
  };

  return (
    <>
      <header className="header">
        <div className="header-logo">
          <div className="icon">🚀</div>
          Kushal Automation
        </div>
        <div className="header-actions">
          <div className="header-badge" style={{ background: waStatus === 'READY' ? 'var(--green-glow)' : 'var(--accent-glow)', color: waStatus === 'READY' ? 'var(--green)' : 'var(--accent)' }}>
            WA: {waStatus}
          </div>
          {waStatus === 'READY' && (
            <button className="btn btn-ghost btn-sm" onClick={handleLogout}>Logout WA</button>
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
                <span className="loading-spinner"></span> <br/><br/>
                Starting WhatsApp Client...
              </div>
            )}
            {waStatus === 'QR_READY' && waQrCode && (
              <div>
                <img src={waQrCode} alt="WhatsApp QR Code" style={{ background: '#fff', padding: '16px', borderRadius: '12px', display: 'inline-block' }} />
                <p style={{ marginTop: '12px', fontSize: '13px', color: 'var(--text-muted)' }}>Scan with WhatsApp {"->"} Linked Devices</p>
              </div>
            )}
            {waStatus === 'AUTHENTICATED' && (
              <div style={{ color: 'var(--green)' }}>✓ Authenticated! Loading chats...</div>
            )}
            {(waStatus === 'ERROR' || waStatus === 'DISCONNECTED') && (
              <div style={{ padding: '20px', color: 'var(--accent)' }}>
                <span className="loading-spinner"></span> <br/><br/>
                {waStatus === 'ERROR' ? 'Retrying connection...' : 'Connecting to WhatsApp...'}
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
            <div className="stat-label">Messages Sent</div>
            <div className="stat-value" style={{color: 'var(--green)'}}>{stats.sent}</div>
          </div>
          <div className="stat-card">
            <div className="stat-label">Failed</div>
            <div className="stat-value" style={{color: 'var(--red)'}}>{stats.failed}</div>
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
                onChange={e => setLocation(e.target.value)}
              />
            </div>
            <div className="form-group">
              <label>Business Category</label>
              <select 
                className="form-input"
                value={query}
                onChange={e => setQuery(e.target.value)}
              >
                {CATEGORIES.map(cat => <option key={cat} value={cat}>{cat}</option>)}
              </select>
            </div>
            <button type="submit" className="btn btn-primary" disabled={isSearching}>
              {isSearching ? <span className="loading-spinner"></span> : 'Scrape Data'}
            </button>
          </form>
        </div>

        <div className="content-grid">
          <div className="results-panel">
            <div className="panel-header">
              <h3>
                Contacts List <span className="panel-count">
                  {totalResults ? `${results.length}/${totalResults}` : results.length}
                </span>
              </h3>
              <button className="btn btn-ghost btn-sm" onClick={toggleSelectAll}>
                Select All Valid
              </button>
            </div>
            <div className="results-list">
              {isSearching ? (
                <div className="search-loading">
                  <span className="loading-spinner"></span> Scraping Google Maps...
                </div>
              ) : results.length > 0 ? (
                results.map(r => {
                  const hasPhone = !!r.phone;
                  return (
                    <div 
                      key={r.id} 
                      className={`result-item ${selectedIds.has(r.id) ? 'selected' : ''}`}
                      onClick={() => toggleSelect(r.id, hasPhone)}
                      style={{ opacity: hasPhone ? 1 : 0.5 }}
                    >
                      <div className={`result-check ${selectedIds.has(r.id) ? 'checked' : ''}`}>✓</div>
                      <div className="result-info">
                        <div className="result-name">{r.name}</div>
                        <div className="result-address">{r.address}</div>
                      </div>
                      <div className="result-phone">
                        {r.phone || 'No phone'}
                      </div>
                    </div>
                  )
                })
              ) : (
                <div className="no-results">
                  <div className="icon">📍</div>
                  <p>Select category and location to scrape</p>
                </div>
              )}
            </div>
            {results.length > 0 && (
              <div style={{ padding: '12px 16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>
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
            <div className="template-selector" style={{ display: 'flex', gap: '12px' }}>
              <div style={{ flex: 1 }}>
                <label>Template Language</label>
                <select className="template-select" value={language} onChange={e => setLanguage(e.target.value as "EN" | "HINGLISH")}>
                  <option value="EN">English</option>
                  <option value="HINGLISH">Hinglish</option>
                </select>
              </div>
            </div>
            <div className="message-editor">
              <label style={{fontSize: '13px', color: 'var(--text-secondary)', marginBottom: '8px', display: 'block'}}>
                Message Editor (Feel free to edit)
              </label>
              <textarea 
                className="message-textarea"
                value={messageTemplate}
                onChange={e => setMessageTemplate(e.target.value)}
                placeholder="Type your WhatsApp message here..."
              ></textarea>
              <div className="message-vars">
                <button className="var-tag" onClick={() => insertVar('{{name}}')}>+ Business Name</button>
                <button className="var-tag" onClick={() => insertVar('{{location}}')}>+ Location</button>
              </div>
            </div>
            
            {isSending && (
              <div style={{padding: '0 20px'}}>
                <div style={{fontSize: '12px', color: 'var(--text-secondary)', marginBottom: '4px'}}>
                  Sending messages... {Math.round(sendProgress)}%
                </div>
                <div className="progress-bar">
                  <div className="progress-fill" style={{width: `${sendProgress}%`}}></div>
                </div>
              </div>
            )}

            <div className="message-actions">
              <button 
                className="btn btn-success" 
                onClick={handleSendMessages}
                disabled={isSending || selectedIds.size === 0 || waStatus !== 'READY'}
              >
                {waStatus !== 'READY' ? 'Scan QR First' : isSending ? 'Sending...' : `Send WhatsApp (${selectedIds.size})`}
              </button>
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
                <input 
                  type="text" 
                  className="form-input" 
                  value={settings.userName}
                  onChange={e => setSettings({...settings, userName: e.target.value})}
                  placeholder="e.g. Kushal"
                />
              </div>
              <div className="form-group" style={{ marginBottom: '16px' }}>
                <label>Your Business/Agency Name</label>
                <input 
                  type="text" 
                  className="form-input" 
                  value={settings.userBusiness}
                  onChange={e => setSettings({...settings, userBusiness: e.target.value})}
                  placeholder="e.g. Kushal Studios"
                />
              </div>
              <div className="form-group" style={{ marginBottom: '16px' }}>
                <label>Your Profession / Field</label>
                <select 
                  className="form-input"
                  value={settings.userProfession}
                  onChange={e => setSettings({...settings, userProfession: e.target.value})}
                >
                  {PROFESSIONS.map(p => <option key={p} value={p}>{p}</option>)}
                </select>
                <div className="api-hint">This will adapt the message templates for your field.</div>
              </div>
              <hr style={{ border: 'none', borderTop: '1px solid var(--glass-border)', margin: '20px 0' }} />
              <div className="form-group" style={{ marginBottom: '16px' }}>
                <label>Your SerpAPI Key</label>
                <input
                  type="password"
                  className="form-input"
                  value={settings.serpApiKey}
                  onChange={e => setSettings({ ...settings, serpApiKey: e.target.value })}
                  placeholder="Paste your SerpAPI key"
                  autoComplete="off"
                />
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
        {toasts.map(t => (
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
