import { useEffect, useState } from "react";
import "./Admin.css";

const API_URL = import.meta.env.VITE_API_URL;

export default function Admin() {
  const [isCheckingAuth, setIsCheckingAuth] = useState(true);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [password, setPassword] = useState("");
  const [loginError, setLoginError] = useState("");
  const [stats, setStats] = useState(null);
  const [registrations, setRegistrations] = useState([]);
  const [selectedRegistration, setSelectedRegistration] = useState(null);
  const [filters, setFilters] = useState({
  ageGroup: "",
  playerSex: "",
  wwfcTeam: "",
});

  async function logout() {
  await fetch(`${API_URL}/api/admin/logout`, {
    method: "POST",
    credentials: "include",
  });

  setIsAuthenticated(false);
  setStats(null);
  setRegistrations([]);
  setPassword("");
}


async function checkAuth() {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 8000);

  try {
    const res = await fetch(`${API_URL}/api/admin/me`, {
      method: "GET",
      credentials: "include",
      signal: controller.signal,
    });

    setIsAuthenticated(res.ok);
  } catch (error) {
    if (error.name === "AbortError") {
      console.warn("Initial admin session check timed out");
    } else {
      console.error("Initial admin session check failed:", error);
    }

    setIsAuthenticated(false);
  } finally {
    clearTimeout(timeoutId);
    setIsCheckingAuth(false);
  }
}

  async function handleLogin(e) {
  e.preventDefault();
  setLoginError("");

  try {
    const res = await fetch(`${API_URL}/api/admin/login`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      credentials: "include",
      body: JSON.stringify({ password }),
    });

    if (!res.ok) {
      setLoginError("Incorrect password");
      return;
    }

    setPassword("");
    setIsAuthenticated(true);
  } catch (error) {
    console.error("Admin login failed:", error);
    setLoginError("Unable to log in. Please try again.");
  }
}

async function loadDashboard() {
  try {
    const res = await fetch(`${API_URL}/api/admin/dashboard`, {
      credentials: "include",
    });

    if (res.status === 401) {
      setIsAuthenticated(false);
      return;
    }

    if (!res.ok) {
      throw new Error(`Dashboard request failed: ${res.status}`);
    }

    const data = await res.json();
    setStats(data);
  } catch (error) {
    console.error("Failed to load dashboard:", error);
  }
}

async function loadRegistrations() {
  const params = new URLSearchParams();

  if (filters.ageGroup) {
    params.append("ageGroup", filters.ageGroup);
  }

  if (filters.playerSex) {
    params.append("playerSex", filters.playerSex);
  }

  if (filters.wwfcTeam) {
    params.append("wwfcTeam", filters.wwfcTeam);
  }

  try {
    const res = await fetch(
      `${API_URL}/api/admin/registrations?${params.toString()}`,
      {
        method: "GET",
        credentials: "include",
      }
    );

    if (res.status === 401) {
      setIsAuthenticated(false);
      setStats(null);
      setRegistrations([]);
      return;
    }

    if (!res.ok) {
      throw new Error(`Registrations request failed: ${res.status}`);
    }

    const data = await res.json();

    if (!Array.isArray(data)) {
      throw new Error("Registrations response was not an array");
    }

    setRegistrations(data);
  } catch (error) {
    console.error("Failed to load registrations:", error);
    setRegistrations([]);
  }
}
  async function deleteRegistration(id) {
    const ok = window.confirm("Delete this registration?");
    if (!ok) return;

    await fetch(`${API_URL}/api/admin/registrations/${id}`, {
  method: "DELETE",
  credentials: "include",
});

    loadDashboard();
    loadRegistrations();
  }

  async function downloadCsv() {
  try {
    const response = await fetch(
      `${API_URL}/api/admin/registrations.csv`,
      {
        method: "GET",
        credentials: "include",
      }
    );

    if (response.status === 401) {
      setIsAuthenticated(false);
      alert("Your admin session has expired. Please log in again.");
      return;
    }

    if (!response.ok) {
      throw new Error(`CSV download failed: ${response.status}`);
    }

    const blob = await response.blob();

    const disposition = response.headers.get("Content-Disposition");

    const filenameMatch = disposition?.match(
      /filename\*?=(?:UTF-8''|["']?)([^;"']+)/
    );

    const filename = filenameMatch
      ? decodeURIComponent(filenameMatch[1].replace(/["']/g, ""))
      : `wwfc-registrations-${new Date()
          .toISOString()
          .slice(0, 10)}.csv`;

    const downloadUrl = window.URL.createObjectURL(blob);
    const link = document.createElement("a");

    link.href = downloadUrl;
    link.download = filename;

    document.body.appendChild(link);
    link.click();
    link.remove();

    window.URL.revokeObjectURL(downloadUrl);
  } catch (error) {
    console.error("CSV download failed:", error);
    alert("The CSV could not be downloaded. Please try again.");
  }
} 

useEffect(() => {
  checkAuth();
}, []);

useEffect(() => {
  if (!isAuthenticated) return;
  loadDashboard();
}, [isAuthenticated]);

useEffect(() => {
  if (!isAuthenticated) return;
  loadRegistrations();
}, [filters, isAuthenticated]);

useEffect(() => {
  if (!isAuthenticated) return;

  let timeoutId;

  function resetTimer() {
    clearTimeout(timeoutId);

    timeoutId = setTimeout(() => {
      logout();
      alert("You have been logged out due to inactivity.");
    }, 15 * 60 * 1000); // 15 minutes
  }

  const events = ["mousemove", "keydown", "click", "scroll", "touchstart"];

  events.forEach((event) => {
    window.addEventListener(event, resetTimer);
  });

  resetTimer();

  return () => {
    clearTimeout(timeoutId);
    events.forEach((event) => {
      window.removeEventListener(event, resetTimer);
    });
  };
}, [isAuthenticated]);

if (isCheckingAuth) {
  return (
    <main className="admin-page">
      <section className="admin-card">
        <h1>Admin Login</h1>
        <p>Checking admin session…</p>
      </section>
    </main>
  );
}

if (!isAuthenticated) {
  return (
    <main className="admin-page">
      <section className="admin-card">
        <h1>Admin Login</h1>

        <form onSubmit={handleLogin}>
          <label>Admin password</label>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />

          {loginError && <p className="error">{loginError}</p>}

          <button type="submit">Log in</button>
        </form>
      </section>
    </main>
  );
}
  return (
  <main className="admin-page">
    <header className="admin-header">
      <img src="/wwfc-letter-head.png" alt="WWFC" className="admin-logo" />
      <h1>Player Consent Forms</h1>
        <button className="logout-btn" onClick={logout}>
    Logout
  </button>
    </header>

    <section className="admin-card">
      {stats && (
        <>
          <h2 className="section-title">Dashboard</h2>

          <div className="stats-grid">
            <Stat title="Total Forms Submitted" value={stats.total} />
            <Stat title="Male Players" value={stats.boys} percentage={percentage(stats.boys, stats.total)} />
            <Stat title="Female Players" value={stats.girls} percentage={percentage(stats.girls, stats.total)} />
            <Stat title="Development U11 & Below" value={stats.development} percentage={percentage(stats.development, stats.total)} />
            <Stat title="Competitive U12 & Over" value={stats.competitive} percentage={percentage(stats.competitive, stats.total)} />
            <Stat title="Adult Players" value={stats.adult} percentage={percentage(stats.adult, stats.total)} />
          </div>
              <div className="section-divider" />
        </>
      )}
        <h2 className="section-title no-line">
  Player Details - Summary View
  <span className="section-subtitle">
    (click on player name for full details)
  </span>
</h2>

      <div className="admin-actions">
        <select
          value={filters.ageGroup}
          onChange={(e) => setFilters((prev) => ({ ...prev, ageGroup: e.target.value }))}
        >
          <option value="">Filter by Age Group</option>
       {[
  "u7",
  "u8",
  "u9",
  "u10",
  "u11",
  "u12",
  "u13",
  "u14",
  "u15",
  "u16",
  "u17",
  "u18",
  "adult",
].map((age) => (
  <option key={age} value={age}>
    {age === "adult" ? "Adult" : age.toUpperCase()}
  </option>
))}
        </select>
<select
  value={filters.wwfcTeam}
  onChange={(e) =>
    setFilters((prev) => ({ ...prev, wwfcTeam: e.target.value }))
  }
>
  <option value="">Filter by Team</option>
  <option>Rebels</option>
  <option>Black Cats</option>
    <option>Wild Cats</option>
    <option>Panthers</option>
    <option>Rams</option>
    <option>Rhinos</option>
      <option>Rangers</option>
    <option>Rockets</option>
    <option>Dragons</option>
    <option>Thunder</option>
      <option>Foxes</option>
      <option>Lightning</option>
    <option>Wookies</option>
    <option>Warriors</option>
    <option>Magic</option>
      <option>Witches</option>
    <option>Lions</option>
    <option>Wasps</option>
    <option>Wolves</option>
      <option>Hurricanes</option>
    <option>Tornadoes</option>
    <option>Silverbacks</option>
    <option>Broncos</option>     
    <option>Wrens</option>
    <option>Ravens</option>
     <option>U18</option>
     <option>Mens</option>

        <option>Other (not listed)</option>
</select>
        <select
          value={filters.playerSex}
          onChange={(e) => setFilters((prev) => ({ ...prev, playerSex: e.target.value }))}
        >
          <option value="">Filter by Gender</option>
          <option value="Male">Boys</option>
          <option value="Female">Girls</option>
        </select>

      <button
  type="button"
  className="download-btn"
  onClick={downloadCsv}
>
  Download CSV
</button>
      </div>

        

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Player</th>
              <th>Age Group</th>
              <th>Gender</th>
              <th>DOB</th>
              <th>Parent 1</th>
              <th>Parent 2</th>
              <th>Submitted</th>
              <th></th>
            </tr>
          </thead>

          <tbody>
            {registrations.map((r) => (
              <tr key={r.id}>
                <td>
                  <button className="player-link" onClick={() => setSelectedRegistration(r)}>
                    {r.playerFirstName} {r.playerSurname}
                  </button>
                </td>
                <td>{String(r.ageGroup).toUpperCase()}</td>
                <td>{r.playerSex}</td>
                <td>{new Date(r.playerDob).toLocaleDateString("en-GB")}</td>
                <td>{r.emergencyContact1?.name || ""}</td>
                <td>{r.emergencyContact2?.name || ""}</td>
                <td>{new Date(r.createdAt).toLocaleDateString("en-GB")}</td>
                <td>
                  <button className="delete-btn" onClick={() => deleteRegistration(r.id)}>
                    Delete
                  </button>
                </td>
              </tr>
            ))}

            {registrations.length === 0 && (
              <tr>
                <td colSpan="8">No registrations found.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {selectedRegistration && (
        <div className="modal-backdrop" onClick={() => setSelectedRegistration(null)}>
          <div className="modal-card" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2>
                {selectedRegistration.playerFirstName} {selectedRegistration.playerSurname}
              </h2>
              <button className="modal-close" onClick={() => setSelectedRegistration(null)}>
                ×
              </button>
            </div>

      <ModalSection title="Player Details">
  <Detail label="WWFC Team" value={selectedRegistration.wwfcTeam} />
  <Detail label="Age Group" value={String(selectedRegistration.ageGroup).toUpperCase()} />
  <Detail label="Gender" value={selectedRegistration.playerSex} />
  <Detail label="DOB" value={new Date(selectedRegistration.playerDob).toLocaleDateString("en-GB")} />
  <Detail label="Submitted" value={new Date(selectedRegistration.createdAt).toLocaleDateString("en-GB")} />
</ModalSection>

            <ModalSection title="Parent / Emergency Contact 1">
              <Detail label="Name" value={selectedRegistration.emergencyContact1?.name} />
              <Detail label="Phone" value={selectedRegistration.emergencyContact1?.phoneNumber} />
              <Detail label="Email" value={selectedRegistration.emergencyContact1?.email} />
              <Detail label="Relationship" value={selectedRegistration.emergencyContact1?.relationship} />
              <Detail label="Postcode" value={selectedRegistration.emergencyContact1?.postcode} />
              <Detail label="House Number" value={selectedRegistration.emergencyContact1?.houseNumber} />
            </ModalSection>

            <ModalSection title="Parent / Emergency Contact 2">
              <Detail label="Name" value={selectedRegistration.emergencyContact2?.name} />
              <Detail label="Phone" value={selectedRegistration.emergencyContact2?.phoneNumber} />
              <Detail label="Email" value={selectedRegistration.emergencyContact2?.email} />
              <Detail label="Relationship" value={selectedRegistration.emergencyContact2?.relationship} />
              <Detail label="Postcode" value={selectedRegistration.emergencyContact2?.postcode} />
              <Detail label="House Number" value={selectedRegistration.emergencyContact2?.houseNumber} />
            </ModalSection>

            <ModalSection title="Medical">
              <Detail label="Medical Info" value={selectedRegistration.medicalInfo} wide />
              <Detail label="Allergies" value={selectedRegistration.allergies} wide />
            </ModalSection>

            <ModalSection title="Permissions">
              <Detail label="Contact Consent" value={selectedRegistration.consentData ? "Yes" : "No"} />
              <Detail label="Photo Consent" value={selectedRegistration.consentPhotos ? "Yes" : "No"} />
              <Detail label="Video Consent" value={selectedRegistration.consentVideos ? "Yes" : "No"} />
              <Detail
  label="Walk Home Alone Consent"
  value={
    selectedRegistration.consentWalkHome === null ||
    selectedRegistration.consentWalkHome === undefined
      ? "Not applicable"
      : selectedRegistration.consentWalkHome
        ? "Yes"
        : "No"
  }
/>
            </ModalSection>

            <ModalSection title="Signature">
              <Detail label="Signed By" value={selectedRegistration.parentName} />
              <Detail label="Signature Date" value={new Date(selectedRegistration.signatureDate).toLocaleDateString("en-GB")} />
            </ModalSection>
          </div>
        </div>
      )}
    </section>
  </main>
);
}

function percentage(value, total) {
  if (!total) return "0%";
  return `${Math.round((value / total) * 100)}%`;
}

function Stat({ title, value, percentage }) {
  return (
    <div className="stat">
      <span>{title}</span>
      <strong>{value}</strong>
      {percentage && <em>{percentage}</em>}
    </div>
  );
}

function Detail({ label, value, wide }) {
  return (
    <div className={wide ? "detail detail-wide" : "detail"}>
      <span>{label}</span>
      <strong>{value || "—"}</strong>
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