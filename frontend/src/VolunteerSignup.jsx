import { useEffect, useState } from "react";
import "./Volunteers.css";
const API = (import.meta.env.VITE_API_URL || "").replace(/\/$/, "");
export default function VolunteerSignup() {
  const token = window.location.pathname.match(/^\/volunteers\/accept\/([a-f0-9]{64})\/?$/)?.[1];
  const [config, setConfig] = useState(null), [error, setError] = useState(""), [done, setDone] = useState(false), [busy, setBusy] = useState(false);
  const [form, setForm] = useState({ firstName:"", lastName:"", email:"", phone:"", team:"", requestedRoles:[] });
  const [accepted, setAccepted] = useState({});
  useEffect(() => {
    let active = true;
    fetch(`${API}/api/volunteers/${token ? `accept/${token}` : "configuration"}`)
      .then(async r => { const data = await r.json(); if (!r.ok) throw new Error(data.error); return data; })
      .then(data => { if(active) setConfig(data); }).catch(e => { if(active) setError(e.message); });
    return () => {active = false;};
  }, [token]);
  const required = token ? config?.required || [] : ["VOLUNTEER", ...(form.requestedRoles.some(r => config?.footballRoles.includes(r)) ? ["COACH"] : [])];
  const docs = config?.agreements || [];
  const ready = config && required.every(key => docs.some(d => d.key === key));
  async function submit(e) {
    e.preventDefault(); setError(""); setBusy(true);
    try {
      const acceptances = Object.fromEntries(docs.filter(d => required.includes(d.key) && accepted[d.key]).map(d => [d.key, d.version]));
      const r = await fetch(`${API}/api/volunteers/${token ? `accept/${token}` : ""}`, {method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify(token ? {acceptances} : {...form,acceptances})});
      const data = await r.json(); if(!r.ok) throw new Error(data.error);
      setDone(true);
    } catch(e) {setError(e.message);} finally {setBusy(false);}
  }
  return <main className="volunteer-ui"><p className="v-muted">WROUGHTON & WICHELSTOWE FC</p><h1>{token ? "Complete your volunteer agreements" : "Volunteer with our club"}</h1><p>{token ? "Please review and accept the agreements below." : "Help our club thrive. Tell us how you would like to get involved."}</p>
    {error && <p role="alert" className="v-error">{error}</p>}
    {done ? <div role="status" className="v-card v-success">{token ? "Your agreement acceptance has been saved. The club can now review your role." : "Thank you for volunteering. The club will review your application. If you have already registered, contact the club to update your details."}</div> : !config ? <p>Loading…</p> : <form onSubmit={submit}>
    {!token && <><section className="v-card"><h2>Your details</h2><div className="v-grid">{[["firstName","First name","text"],["lastName","Last name","text"],["email","Email address","email"],["phone","Telephone","tel"],["team","Team (if applicable)","text"]].map(([key,label,type]) => <label key={key}>{label}<input type={type} required={key !== "team"} maxLength={key === "phone" ? 30 : key === "email" ? 200 : 80} value={form[key]} onChange={e => setForm({...form,[key]:e.target.value})}/></label>)}</div></section>
    <section className="v-card"><h2>How would you like to help?</h2><p className="v-muted">Select one or more roles. The club will confirm appointments after reviewing your application.</p><div className="v-grid">{config.roles.map(role => <label className="v-check" key={role}><input type="checkbox" checked={form.requestedRoles.includes(role)} onChange={e => setForm({...form,requestedRoles:e.target.checked ? [...form.requestedRoles,role] : form.requestedRoles.filter(r=>r!==role)})}/>{role}</label>)}</div></section></>}
    {required.map(key => {const doc=docs.find(d=>d.key===key); return <section className="v-card" key={key}><h2>{key === "COACH" ? "Coach Code of Conduct" : "Volunteer Agreement"}</h2>{doc ? <><p className="v-muted">Version {doc.version}{doc.downloadPath && <> · <a href={doc.downloadPath} download>Download a copy</a></>}</p><div className="v-agreement" tabIndex={0}>{doc.content}</div><label className="v-check"><input type="checkbox" required checked={!!accepted[key]} onChange={e=>setAccepted({...accepted,[key]:e.target.checked})}/>{doc.acknowledgement || `I have read and accept this ${doc.title}.`}</label></> : <p className="v-error">The club is preparing this agreement. Signup will open once the required documents are published.</p>}</section>;})}
    <p className="v-muted">The club will use these details to review your application and manage your volunteering. Contact the club to request changes to your details.</p><button disabled={busy || !ready || (!token && !form.requestedRoles.length) || !required.every(k=>accepted[k])}>{busy ? "Saving…" : token ? "Save acceptance" : "Submit volunteer application"}</button>
    </form>}
    {done && docs.some(d => d.downloadPath) && <section className="v-card"><h2>Your agreement copies</h2>{docs.filter(d => required.includes(d.key) && d.downloadPath).map(d => <p key={d.key}><a href={d.downloadPath} download>{d.title} · Version {d.version}</a></p>)}</section>}
  </main>;
}
