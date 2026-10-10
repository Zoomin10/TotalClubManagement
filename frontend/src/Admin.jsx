import { useCallback, useEffect, useRef, useState } from "react";
import "./Admin.css";

const API_URL = import.meta.env.VITE_API_URL;
const emptyFilters = { search: "", team: "", age: "", gender: "", plan: "", billing: "" };
const plans = { MATCHES_AND_TRAINING: "Matches & Training", TRAINING_ONLY: "Training only" };
const money = (pence, currency = "gbp") => new Intl.NumberFormat("en-GB", { style: "currency", currency: currency.toUpperCase() }).format((pence || 0) / 100);
const date = (value) => value ? new Date(value).toLocaleDateString("en-GB", { timeZone: "Europe/London" }) : "—";
const name = (member) => `${member.playerFirstName} ${member.playerSurname}`;
function billing(member) {
  const status = member.stripeSubscriptionStatus;
  if (["canceled", "incomplete_expired"].includes(status)) return { key: "cancelled", label: "Cancelled", tone: "neutral" };
  if (status === "scheduled") return { key: "scheduled", label: "Scheduled", tone: "blue" };
  if (["active", "trialing"].includes(status)) return { key: "active", label: status === "trialing" ? "Trialling" : "Active", tone: "green" };
  if (status) return { key: "attention", label: { past_due: "Past due", unpaid: "Unpaid", incomplete: "Incomplete", paused: "Paused" }[status] || status, tone: "amber" };
  return { key: "setup", label: "Awaiting setup", tone: "amber" };
}
function Badge({ children, tone = "neutral" }) { return <span className={`member-badge badge-${tone}`}>{children}</span>; }
function Metric({ label, value, note, tone }) { return <div className={`member-metric metric-${tone || "blue"}`}><span>{label}</span><strong>{value}</strong><small>{note}</small></div>; }

export default function Admin() {
  const [checking, setChecking] = useState(true);
  const [authenticated, setAuthenticated] = useState(false);
  const [password, setPassword] = useState("");
  const [loginBusy, setLoginBusy] = useState(false);
  const [loginError, setLoginError] = useState("");
  const [members, setMembers] = useState([]);
  const [loaded, setLoaded] = useState(false);
  const [loading, setLoading] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState("");
  const [selected, setSelected] = useState(null);
  const [filters, setFilters] = useState(emptyFilters);
  const [tab, setTab] = useState("all");
  const [page, setPage] = useState(1);
  const sessionGeneration = useRef(0);
  const requestNumber = useRef(0);
  const handleSessionExpired = useCallback(() => {
    sessionGeneration.current += 1;
    setAuthenticated(false); setSelected(null); setMembers([]); setLoaded(false);
  }, []);
  const request = useCallback(async (path, options = {}) => {
    const response = await fetch(`${API_URL}/api/admin${path}`, { ...options, credentials: "include" });
    if (response.status === 401) { handleSessionExpired(); throw new Error("Your session expired. Please log in again."); }
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "The request could not be completed.");
    return data;
  }, [handleSessionExpired]);
  const refreshMembers = useCallback(async () => {
    const generation = sessionGeneration.current;
    const sequence = ++requestNumber.current;
    setLoading(true); setError("");
    try {
      const data = await request("/members");
      if (generation !== sessionGeneration.current || sequence !== requestNumber.current) return;
      if (!Array.isArray(data.members)) throw new Error("Invalid members response");
      setMembers(data.members); setLoaded(true);
      setSelected((current) => current ? data.members.find((member) => member.id === current.id) || null : null);
    } catch (err) {
      if (generation === sessionGeneration.current && sequence === requestNumber.current) setError(err.message);
    } finally {
      if (sequence === requestNumber.current) setLoading(false);
    }
  }, [request]);
  const handleBillingChanged = useCallback((updated) => {
    // The cancellation response does not include invoice summaries.
    setMembers((current) => current.map((member) => member.id === updated.id ? { ...member, ...updated } : member));
    setSelected((current) => current?.id === updated.id ? { ...current, ...updated } : current);
  }, []);
  const logout = useCallback(async () => {
    handleSessionExpired(); setPassword("");
    try { await fetch(`${API_URL}/api/admin/logout`, { method: "POST", credentials: "include" }); }
    catch { setLoginError("Could not clear the server session. Please log in again or close your browser."); }
  }, [handleSessionExpired]);
  useEffect(() => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    let cancelled = false;
    (async () => {
      try {
        const response = await fetch(`${API_URL}/api/admin/me`, { credentials: "include", signal: controller.signal });
        const data = response.ok ? await response.json() : null;
        if (!cancelled) setAuthenticated(data?.authenticated === true);
      } catch { if (!cancelled) setAuthenticated(false); }
      finally { clearTimeout(timeout); if (!cancelled) setChecking(false); }
    })();
    return () => { cancelled = true; clearTimeout(timeout); controller.abort(); };
  }, []);
  useEffect(() => { if (authenticated) refreshMembers(); }, [authenticated, refreshMembers]);
  useEffect(() => {
    if (!authenticated) return;
    let timeout;
    const reset = () => { clearTimeout(timeout); timeout = setTimeout(() => { logout(); }, 15 * 60 * 1000); };
    const events = ["mousemove", "keydown", "click", "scroll", "touchstart"];
    events.forEach((event) => window.addEventListener(event, reset, { passive: true })); reset();
    return () => { clearTimeout(timeout); events.forEach((event) => window.removeEventListener(event, reset)); };
  }, [authenticated, logout]);
  async function login(event) {
    event.preventDefault(); setLoginBusy(true); setLoginError("");
    try {
      const response = await fetch(`${API_URL}/api/admin/login`, { method: "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ password }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Unable to log in.");
      setPassword(""); setAuthenticated(true);
    } catch (err) { setLoginError(err.message); }
    finally { setLoginBusy(false); }
  }
  async function downloadCsv() {
    setExporting(true); setError("");
    try {
      const response = await fetch(`${API_URL}/api/admin/registrations.csv`, { credentials: "include" });
      if (response.status === 401) { handleSessionExpired(); return; }
      if (!response.ok) throw new Error("The CSV could not be downloaded.");
      const blob = await response.blob();
      const url = URL.createObjectURL(blob); const link = document.createElement("a");
      link.href = url; link.download = `wwfc-members-${new Date().toISOString().slice(0, 10)}.csv`;
      document.body.appendChild(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (err) { setError(err.message); } finally { setExporting(false); }
  }
async function deleteMember(member) {
  if (
    !window.confirm(
      `Permanently delete test member ${name(member)}?\n\n` +
      "Their registration, consent details and saved invoices " +
      "will be deleted from this app.\n\n" +
      "Stripe records will remain. This cannot be undone."
    )
  ) {
    return;
  }

  try {
    await request(
      `/registrations/${encodeURIComponent(member.id)}`,
      {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirm: true }),
      }
    );

    setSelected(null);
    await refreshMembers();
  } catch (err) {
    setError(err.message);
  }
}
  const teams = [...new Set(members.map((member) => member.wwfcTeam).filter(Boolean))].sort();
  const unpaidCount = members.filter((member) => member.invoiceSummary?.openInvoiceCount > 0).length;
  const counts = { all: members.length, active: members.filter((m) => billing(m).key === "active").length, setup: members.filter((m) => billing(m).key === "setup").length, cancelled: members.filter((m) => billing(m).key === "cancelled").length, unpaid: unpaidCount };
  const filtered = members.filter((member) => {
    const state = billing(member).key;
    const search = [name(member), member.parentName, member.emergencyContact1?.name, member.emergencyContact1?.email, member.emergencyContact2?.name, member.emergencyContact2?.email, member.wwfcTeam].filter(Boolean).join(" ").toLowerCase();
    return (tab === "all" || (tab === "unpaid" ? member.invoiceSummary?.openInvoiceCount > 0 : state === tab)) &&
      search.includes(filters.search.trim().toLowerCase()) && (!filters.team || member.wwfcTeam === filters.team) &&
      (!filters.age || member.ageGroup === filters.age) && (!filters.gender || member.playerSex === filters.gender) &&
      (!filters.plan || member.paymentPlan === filters.plan) && (!filters.billing || state === filters.billing);
  });
  const pages = Math.max(1, Math.ceil(filtered.length / 20)); const safePage = Math.min(page, pages);
  const visible = filtered.slice((safePage - 1) * 20, safePage * 20);
  const changeFilter = (key, value) => { setFilters((current) => ({ ...current, [key]: value })); setPage(1); };
  const totalOpen = members.reduce((total, member) => total + (member.invoiceSummary?.outstandingPence || 0), 0);
  if (checking || !authenticated) return <main className="admin-page member-login"><section className="login-card">
    <img src="/wwfc-letter-head.png" alt="WWFC" className="admin-logo" /><p className="eyebrow">TOTAL CLUB MANAGEMENT</p><h1>Member management</h1>
    {checking ? <p role="status">Checking your session…</p> : <form onSubmit={login}><label htmlFor="admin-password">Admin password</label><input id="admin-password" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />{loginError && <p className="error" role="alert">{loginError}</p>}<button className="download-btn" disabled={loginBusy}>{loginBusy ? "Signing in…" : "Sign in"}</button></form>}
  </section></main>;
  return <main className="admin-page">
    <header className="admin-header"><div className="club-brand"><img src="/wwfc-letter-head.png" alt="WWFC" className="admin-logo" /><div><strong>Total Club Management</strong><span>Wroughton & Wichelstowe FC</span></div></div><div className="header-actions"><Badge tone="blue">Stripe test pilot</Badge><button className="logout-btn" onClick={logout}>Sign out</button></div></header>
    <div className="members-shell"><div className="page-heading"><div><p className="eyebrow">CLUB OPERATIONS</p><h1>Members</h1><p>Manage registrations, subscriptions and payment history.</p></div><div className="heading-actions"><button className="secondary-btn" disabled={loading} onClick={refreshMembers}>{loading ? "Refreshing…" : "Refresh members"}</button><button className="download-btn" onClick={downloadCsv} disabled={exporting}>{exporting ? "Exporting…" : "Export registrations"}</button></div></div>
    {error && <p className="error" role="alert">{error}</p>}
    <section className="stats-grid" aria-label="Club membership summary">
      <Metric label="Total members" value={loaded ? members.length : "—"} note="All saved registrations" />
      <Metric label="Active subscriptions" value={loaded ? counts.active : "—"} note="Active or trialling" tone="green" />
      <Metric label="Awaiting setup" value={loaded ? counts.setup : "—"} note="No subscription status recorded" tone="amber" />
      <Metric label="Unpaid invoices" value={loaded ? unpaidCount : "—"} note={loaded ? `${money(totalOpen)} open balance` : "Loading balances"} tone="red" />
      <Metric label="Cancelled billing" value={loaded ? counts.cancelled : "—"} note="Member records retained" tone="neutral" />
    </section>
    <section className="admin-card"><div className="directory-heading"><div><h2>Member directory</h2><p>Billing status and balances reflect your saved records. Refresh after webhook updates.</p></div><span className="record-count">{filtered.length} members</span></div>
      <div className="member-tabs" aria-label="Filter members">{[["all", "All members"], ["active", "Active"], ["setup", "Awaiting setup"], ["unpaid", "Unpaid invoices"], ["cancelled", "Cancelled"]].map(([key, label]) => <button key={key} className={tab === key ? "is-active" : ""} aria-pressed={tab === key} onClick={() => { setTab(key); setPage(1); }}>{label}<span>{loaded ? counts[key] : "—"}</span></button>)}</div>
      <div className="member-filters"><label className="search-filter">Search members<input type="search" placeholder="Player, parent, email or team…" value={filters.search} onChange={(e) => changeFilter("search", e.target.value)} /></label>
        <label>Team<select value={filters.team} onChange={(e) => changeFilter("team", e.target.value)}><option value="">All teams</option>{teams.map((team) => <option key={team}>{team}</option>)}</select></label>
        <label>Age group<select value={filters.age} onChange={(e) => changeFilter("age", e.target.value)}><option value="">All ages</option>{[...Array.from({ length: 12 }, (_, i) => `u${i + 7}`), "adult"].map((age) => <option key={age} value={age}>{age === "adult" ? "Adult" : age.toUpperCase()}</option>)}</select></label>
        <label>Gender<select value={filters.gender} onChange={(e) => changeFilter("gender", e.target.value)}><option value="">All genders</option><option>Male</option><option>Female</option></select></label>
        <label>Payment plan<select value={filters.plan} onChange={(e) => changeFilter("plan", e.target.value)}><option value="">All plans</option>{Object.entries(plans).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
        <label>Subscription<select value={filters.billing} onChange={(e) => changeFilter("billing", e.target.value)}><option value="">All statuses</option>{[["active", "Active / trialling"], ["scheduled", "Scheduled"], ["setup", "Awaiting setup"], ["attention", "Needs attention"], ["cancelled", "Cancelled"]].map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
      </div>
      <div className="results-caption"><span>{loading ? "Loading members…" : `Showing ${filtered.length ? (safePage - 1) * 20 + 1 : 0}–${Math.min(safePage * 20, filtered.length)} of ${filtered.length}`}</span><button className="text-btn" onClick={() => { setFilters(emptyFilters); setTab("all"); setPage(1); }}>Clear filters</button></div>
      <div className="table-wrap"><table className="members-table"><thead><tr><th>Member</th><th>Team</th><th>Parent / contact</th><th>Payment plan</th><th>Subscription</th><th>Open balance</th><th><span className="sr-only">Actions</span></th></tr></thead><tbody>
        {visible.map((member) => { const state = billing(member); return <tr key={member.id}><td><button className="member-name" onClick={() => setSelected(member)}><span className="member-avatar" aria-hidden="true">{member.playerFirstName?.[0]}{member.playerSurname?.[0]}</span><span><strong>{name(member)}</strong><small>{String(member.ageGroup).toUpperCase()} · {member.playerSex}</small></span></button></td><td>{member.wwfcTeam || "—"}</td><td><strong className="cell-title">{member.emergencyContact1?.name || member.parentName || "—"}</strong><small className="cell-subtitle">{member.emergencyContact1?.email || member.email || "No email recorded"}</small></td><td><strong className="cell-title">{plans[member.paymentPlan] || "Not selected"}</strong><small className="cell-subtitle">{member.monthlyAmountPence == null ? "—" : `${money(member.monthlyAmountPence)} / month`}</small></td><td><Badge tone={state.tone}>{state.label}</Badge>{state.key === "scheduled" && <small className="cell-subtitle">Starts {date(member.firstPaymentDate)}</small>}</td><td><strong className={member.invoiceSummary?.outstandingPence > 0 ? "balance-due" : ""}>{money(member.invoiceSummary?.outstandingPence)}</strong><small className="cell-subtitle">{member.invoiceSummary?.openInvoiceCount || 0} open invoices</small></td><td><button className="secondary-btn compact-btn" onClick={() => setSelected(member)} aria-label={`View ${name(member)}`}>View member</button></td></tr>; })}
        {!visible.length && <tr><td colSpan="7"><div className="empty-state"><strong>{loading ? "Loading members…" : error ? "Members could not be loaded" : "No members found"}</strong><p>{error ? "Use Refresh members to try again." : "Try changing your search or filters."}</p></div></td></tr>}
      </tbody></table></div>
      <div className="directory-footer"><span>Balances include open invoices only; drafts and written-off invoices are excluded.</span><div className="pagination"><button className="secondary-btn compact-btn" disabled={safePage === 1} onClick={() => setPage(safePage - 1)}>Previous</button><span>{safePage} / {pages}</span><button className="secondary-btn compact-btn" disabled={safePage === pages} onClick={() => setPage(safePage + 1)}>Next</button></div></div>
    </section></div>
    {selected && <MemberPanel key={selected.id} registration={selected} onClose={() => setSelected(null)} onSessionExpired={handleSessionExpired} onBillingChanged={handleBillingChanged} onInvoicesSynced={refreshMembers} onDelete={() => deleteMember(selected)} />}
  </main>;
}

function MemberPanel({ registration, onClose, onSessionExpired, onBillingChanged, onInvoicesSynced, onDelete }) {
  const [tab, setTab] = useState("payments");
  const panel = useRef(null); const close = useRef(null);
  const closeRef = useRef(onClose); closeRef.current = onClose;
  useEffect(() => {
    const previousFocus = document.activeElement; const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden"; close.current?.focus();
    function keydown(event) {
      if (event.key === "Escape") { event.preventDefault(); closeRef.current(); }
      if (event.key !== "Tab") return;
      const focusable = [...panel.current.querySelectorAll('button:not(:disabled), a[href], input, select, [tabindex="0"]')].filter((element) => element.getClientRects().length);
      const first = focusable[0]; const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    }
    document.addEventListener("keydown", keydown);
    return () => { document.body.style.overflow = overflow; document.removeEventListener("keydown", keydown); previousFocus?.focus(); };
  }, []);
  const state = billing(registration);
  return <div className="modal-backdrop" onClick={onClose}><div ref={panel} className="modal-card" role="dialog" aria-modal="true" aria-labelledby="member-panel-title" onClick={(event) => event.stopPropagation()}>
    <div className="modal-header"><div><p className="eyebrow">MEMBER PROFILE</p><h2 id="member-panel-title">{name(registration)}</h2><p>{registration.wwfcTeam || "Team not recorded"} · {String(registration.ageGroup).toUpperCase()}</p><Badge tone={state.tone}>{state.label}</Badge></div><button ref={close} className="modal-close" aria-label="Close member details" onClick={onClose}>×</button></div>
    <div className="member-tabs profile-tabs">{[["payments", "Payments"], ["details", "Member details"], ["consent", "Consent & medical"]].map(([key, label]) => <button key={key} aria-pressed={tab === key} className={tab === key ? "is-active" : ""} onClick={() => setTab(key)}>{label}</button>)}</div>
    <div hidden={tab !== "payments"}><PaymentHistory registration={registration} onSessionExpired={onSessionExpired} onBillingChanged={onBillingChanged} onInvoicesSynced={onInvoicesSynced} /></div>
    {tab === "details" && <><ModalSection title="Player details"><Detail label="Team" value={registration.wwfcTeam} /><Detail label="Age group" value={String(registration.ageGroup).toUpperCase()} /><Detail label="Gender" value={registration.playerSex} /><Detail label="Date of birth" value={date(registration.playerDob)} /><Detail label="Registered" value={date(registration.createdAt)} /><Detail label="Registration reference" value={registration.id} /><Detail label="Email" value={registration.email} /><Detail label="Postcode" value={registration.postcode} /><Detail label="House number" value={registration.houseNumber} /></ModalSection>{[registration.emergencyContact1, registration.emergencyContact2].map((contact, index) => <ModalSection key={index} title={`Parent / emergency contact ${index + 1}`}><Detail label="Name" value={contact?.name} /><Detail label="Relationship" value={contact?.relationship} /><Detail label="Phone" value={contact?.phoneNumber} /><Detail label="Email" value={contact?.email} /><Detail label="Date of birth" value={date(contact?.dob)} /><Detail label="Postcode" value={contact?.postcode} /><Detail label="House number" value={contact?.houseNumber} /></ModalSection>)}
        {(
      (!registration.stripeScheduleId &&
        !registration.stripeSubscriptionId) ||
      ["canceled", "incomplete_expired"].includes(
        registration.stripeSubscriptionStatus
      )
    ) && (
      <div className="member-danger-zone">
        <p>
          Permanently remove this test member and their saved invoices
          from the app. Stripe records will remain.
        </p>

        <button className="delete-btn" onClick={onDelete}>
          Delete test member
        </button>
      </div>
    )}
  </>
)}
    {tab === "consent" && <><ModalSection title="Medical information"><Detail label="Medical information" value={registration.medicalInfo} wide /><Detail label="Allergies" value={registration.allergies} wide /></ModalSection><ModalSection title="Permissions"><Detail label="Contact consent" value={registration.consentData ? "Yes" : "No"} /><Detail label="Photo consent" value={registration.consentPhotos ? "Yes" : "No"} /><Detail label="Video consent" value={registration.consentVideos ? "Yes" : "No"} /><Detail label="Walk home alone" value={registration.consentWalkHome == null ? "Not applicable" : registration.consentWalkHome ? "Yes" : "No"} />{registration.acceptedPrivacyPolicy != null && <Detail label="Privacy policy accepted" value={registration.acceptedPrivacyPolicy ? "Yes" : "No"} />}</ModalSection><ModalSection title="Signature"><Detail label="Signed by" value={registration.parentName} /><Detail label="Signature" value={registration.parentSignature} /><Detail label="Signature date" value={date(registration.signatureDate)} /></ModalSection></>}
  </div></div>;
}

function Detail({ label, value, wide }) {
  return (
    <div className={wide ? "detail detail-wide" : "detail"}>
      <span>{label}</span>
      <strong>{value == null || value === "" ? "—" : value}</strong>
    </div>
  );
}
function ModalSection({ title, children }) {
  return (
    <section className="modal-section">
      <h3>{title}</h3>
      <div className="modal-grid">{children}</div>
    </section>
  );
}
function PaymentHistory({ registration, onSessionExpired, onBillingChanged, onInvoicesSynced }) {
  const [invoices, setInvoices] = useState([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
const [cancelling, setCancelling] = useState(false);
  const endpoint =
    `${API_URL}/api/admin/registrations/` +
    `${encodeURIComponent(registration.id)}/invoices`;
  async function request(url, options = {}) {
    const response = await fetch(url, {
      ...options,
      credentials: "include",
    });
    if (response.status === 401) {
      onSessionExpired();
      throw new Error("Your session expired. Please log in again.");
    }
    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.error || "Unable to load payment history");
    }
    return data;
  }
  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const response = await fetch(endpoint, {
          credentials: "include",
        });
        if (cancelled) return;
        if (response.status === 401) {
          onSessionExpired();
          return;
        }
        const data = await response.json();
        if (!response.ok) {
          throw new Error(data.error || "Unable to load payment history");
        }
        if (!Array.isArray(data.invoices)) {
          throw new Error("Invalid invoice response");
        }
        if (!cancelled) setInvoices(data.invoices);
      } catch (err) {
        if (!cancelled) setError(err.message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [endpoint, onSessionExpired]);
  async function cancelBilling() {
  const playerName =
    `${registration.playerFirstName} ${registration.playerSurname}`;
  if (
    !window.confirm(
      `Cancel membership payments immediately for ${playerName}?\n\n` +
      "Future monthly billing will stop. No refund will be issued.\n" +
      "Existing unpaid invoices are not written off.\n" +
      "The registration and invoice history will remain."
    )
  ) {
    return;
  }
  setCancelling(true);
  setError("");
  setMessage("");
  try {
    const data = await request(
      `${API_URL}/api/admin/registrations/` +
        `${encodeURIComponent(registration.id)}/billing/cancel`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirm: true }),
      }
    );
    onBillingChanged(data.registration);
    setMessage(data.message);
  } catch (err) {
    setError(err.message);
  } finally {
    setCancelling(false);
  }
}
  async function syncInvoices() {
    setSyncing(true);
    setError("");
    setMessage("");
    try {
      let startingAfter;
      let total = 0;
      do {
        const page = await request(`${endpoint}/sync`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(
            startingAfter ? { startingAfter } : {}
          ),
        });
        total += page.syncedCount;
        if (
          page.hasMore &&
          (!page.nextCursor || page.nextCursor === startingAfter)
        ) {
          throw new Error("Invoice sync returned an invalid page");
        }
        startingAfter = page.hasMore ? page.nextCursor : undefined;
      } while (startingAfter);
      const data = await request(endpoint);
      if (!Array.isArray(data.invoices)) {
        throw new Error("Invalid invoice response");
      }
      setInvoices(data.invoices);
      setMessage(`Updated ${total} invoice${total === 1 ? "" : "s"}.`);
      await onInvoicesSynced();
    } catch (err) {
      setError(err.message);
    } finally {
      setSyncing(false);
    }
  }
  const money = (pence, currency) =>
    new Intl.NumberFormat("en-GB", {
      style: "currency",
      currency: currency.toUpperCase(),
    }).format(pence / 100);
  const date = (value) =>
    value
      ? new Date(value).toLocaleDateString("en-GB", {
          timeZone: "Europe/London",
        })
      : "—";
  const planLabel = {
    MATCHES_AND_TRAINING: "Matches & Training",
    TRAINING_ONLY: "Training only",
  }[registration.paymentPlan] || "Not selected";
  return (
    <section className="modal-section">
      <h3>Membership and payments</h3>
      <div className="modal-grid">
        <Detail label="Payment plan" value={planLabel} />
        <Detail
          label="Monthly amount"
          value={
            registration.monthlyAmountPence == null
              ? "—"
              : money(registration.monthlyAmountPence, "gbp")
          }
        />
        <Detail
          label="First payment date"
          value={date(registration.firstPaymentDate)}
        />
        <Detail
          label="Subscription status"
          value={billing(registration).label}
        />
      </div>
      <button
        type="button"
        className="download-btn"
        onClick={syncInvoices}
     disabled={
  loading || syncing || cancelling || !registration.stripeSubscriptionId
}
      >
        {syncing ? "Syncing…" : "Sync invoices"}
      </button>
{(registration.stripeScheduleId ||
  registration.stripeSubscriptionId) &&
  !["canceled", "incomplete_expired"].includes(
    registration.stripeSubscriptionStatus
  ) && (
    <button
      type="button"
      className="delete-btn"
      onClick={cancelBilling}
      disabled={loading || syncing || cancelling}
      
    >
      {cancelling ? "Cancelling…" : "Cancel membership payments"}
    </button>
  )}
      {error && <p className="error" role="alert">{error}</p>}
      {message && <p role="status">{message}</p>}
      {loading ? (
        <p>Loading payment history…</p>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Date</th>
                <th>Invoice</th>
                <th>Amount due</th>
                <th>Amount paid</th>
                <th>Status</th>
                <th>Payment attempts</th>
                <th>Last failed attempt</th>
                <th>Next retry</th>
                <th>Invoice links</th>
              </tr>
            </thead>
            <tbody>
              {invoices.map((invoice) => (
                <tr key={invoice.stripeInvoiceId}>
                  <td>{date(invoice.invoiceCreatedAt)}</td>
                  <td>{invoice.invoiceNumber || "Draft"}</td>
                  <td>
                    {money(invoice.amountDuePence, invoice.currency)}
                  </td>
                  <td>
                    {money(invoice.amountPaidPence, invoice.currency)}
                  </td>
                  <td>
                    {invoice.status === "open" &&
                    invoice.lastPaymentFailedAt
                      ? "Open — payment failed"
                      : invoice.status}
                  </td>
                  <td>{invoice.attemptCount}</td>
                  <td>{date(invoice.lastPaymentFailedAt)}</td>
                  <td>
                    {invoice.status === "open"
                      ? date(invoice.nextPaymentAttemptAt)
                      : "—"}
                  </td>
                  <td>
                    {invoice.hostedInvoiceUrl && (
                      <a
                        href={invoice.hostedInvoiceUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        View invoice
                      </a>
                    )}
                    {invoice.invoicePdfUrl && (
                      <>
                        {" "}
                        <a
                          href={invoice.invoicePdfUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          PDF
                        </a>
                      </>
                    )}
                    {!invoice.hostedInvoiceUrl &&
                      !invoice.invoicePdfUrl && "—"}
                  </td>
                </tr>
              ))}
              {invoices.length === 0 && (
                <tr>
                  <td colSpan="9">
                    No invoices saved yet. Use Sync invoices to check Stripe.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}