import { useState, useMemo, useEffect, useCallback } from "react";
import { supabase } from "./supabase";
import {
  PieChart, Pie, Cell, Tooltip, Legend, ResponsiveContainer,
  BarChart, Bar, XAxis, YAxis, CartesianGrid
} from "recharts";

const initialData = {
  monthlyIncome: 0,
  assets: [],
  liabilities: [],
  expenses: [],
  annualBills: [],
};

const fmt = (n) => new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP", maximumFractionDigits: 0 }).format(n);
const fmtFull = (n) => new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP", maximumFractionDigits: 2 }).format(n);
const fmtPKR = (n) => new Intl.NumberFormat("en-PK", { style: "currency", currency: "PKR", maximumFractionDigits: 0 }).format(n);

let nextId = 200;
const VANGUARD_UNITS = 0;
const HOME_VALUE = 0;
const MORTGAGE_RATE = 0;

const COLORS_ASSETS = ["#3b82f6","#10b981","#8b5cf6","#f59e0b","#ec4899","#6366f1","#14b8a6","#f97316"];
const COLORS_LIAB = ["#ef4444","#f97316","#eab308","#84cc16","#22d3ee"];
const COLORS_EXP = ["#3b82f6","#6366f1","#8b5cf6","#a855f7","#ec4899","#f43f5e","#f97316","#eab308","#84cc16","#10b981","#14b8a6","#06b6d4","#0ea5e9","#3b82f6","#6366f1"];

const inputStyle = {
  background: "#1e2535", border: "1px solid #fbbf24", borderRadius: 4,
  color: "#f9fafb", padding: "4px 8px", fontSize: 13, width: "100%",
  outline: "none", fontFamily: "inherit",
};

const btnStyle = (color) => ({
  background: color + "22", border: `1px solid ${color}`, color,
  borderRadius: 4, padding: "3px 8px", cursor: "pointer",
  fontSize: 12, fontWeight: 600, fontFamily: "inherit",
});

// ==================== HOOKS ====================

function usePKRRate() {
  const [rate, setRate] = useState(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    fetch("https://api.exchangerate-api.com/v4/latest/GBP")
      .then((r) => r.json())
      .then((d) => setRate(d.rates.PKR))
      .catch((_e) => setRate(null))
      .finally(() => setLoading(false));
  }, []);
  return { rate, loading };
}

function useVanguardPrice(units) {
  const [price, setPrice] = useState(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    fetch("https://query1.finance.yahoo.com/v8/finance/chart/VWRP.L?interval=1d&range=1d")
      .then((r) => r.json())
      .then((d) => {
        const p = d?.chart?.result?.[0]?.meta?.regularMarketPrice;
        setPrice(p ? p / 100 : null);
      })
      .catch((_e) => setPrice(null))
      .finally(() => setLoading(false));
  }, []);
  return { price, loading, value: price ? price * units : null };
}

function useNetWorthHistory() {
  const [history, setHistory] = useState([]);
  useEffect(() => {
    supabase.from("financial_data").select("data").eq("id", DEVICE_ID + "_networth").single()
      .then(({ data }) => { if (data?.data?.history) setHistory(data.data.history); })
      .catch((_e) => {});
  }, []);
  return { history, setHistory };
}

async function saveNetWorthSnapshot(netWorth, setHistory) {
  const today = new Date().toISOString().split("T")[0];
  const { data } = await supabase.from("financial_data").select("data").eq("id", DEVICE_ID + "_networth").single().catch(() => ({ data: null }));
  const history = data?.data?.history || [];
  const existing = history.findIndex((h) => h.date === today);
  if (existing >= 0) history[existing].value = netWorth;
  else history.push({ date: today, value: netWorth });
  const trimmed = history.slice(-24);
  await supabase.from("financial_data").upsert({ id: DEVICE_ID + "_networth", data: { history: trimmed }, updated_at: new Date().toISOString() });
  setHistory(trimmed);
}

// ==================== SMALL COMPONENTS ====================

function PKRBadge({ gbp, rate, loading }) {
  if (loading) return <span style={{ color: "#6b7280", fontSize: 12 }}>Loading…</span>;
  if (!rate) return null;
  return <span style={{ color: "#34d399", fontSize: 13, fontWeight: 600 }}>≈ {fmtPKR(gbp * rate)}</span>;
}

function PKRRateBar({ rate, loading }) {
  return (
    <div style={{ background: "#111827", border: "1px solid #1f2937", borderRadius: 10, padding: "10px 16px", display: "flex", alignItems: "center", gap: 10, marginBottom: 20, flexWrap: "wrap" }}>
      <span style={{ fontSize: 16 }}>💱</span>
      <span style={{ color: "#6b7280", fontSize: 12, textTransform: "uppercase", letterSpacing: 1 }}>Live GBP → PKR</span>
      {loading ? <span style={{ color: "#6b7280", fontSize: 13 }}>Fetching…</span>
        : rate ? <span style={{ color: "#fbbf24", fontWeight: 700, fontSize: 15 }}>1 GBP = {rate.toFixed(2)} PKR</span>
        : <span style={{ color: "#f87171", fontSize: 13 }}>Unavailable</span>}
      {rate && !loading && <span style={{ color: "#6b7280", fontSize: 11, marginLeft: "auto" }}>exchangerate-api.com</span>}
    </div>
  );
}

function StatCard({ label, value, sub, color, big }) {
  return (
    <div style={{ background: "#111827", border: `1px solid ${color}44`, borderRadius: 12, padding: big ? "20px 22px" : "16px 18px", flex: 1, minWidth: 160 }}>
      <div style={{ color: "#9ca3af", fontSize: 12, fontWeight: 600, textTransform: "uppercase", letterSpacing: 1, marginBottom: 6 }}>{label}</div>
      <div style={{ color, fontSize: big ? 28 : 22, fontWeight: 800, letterSpacing: -0.5 }}>{value}</div>
      {sub && <div style={{ marginTop: 4 }}>{typeof sub === "string" ? <span style={{ color: "#6b7280", fontSize: 12 }}>{sub}</span> : sub}</div>}
    </div>
  );
}

function EditableRow({ item, onUpdate, onDelete, fields }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState({ ...item });
  const save = () => { onUpdate({ ...draft, amount: parseFloat(draft.amount) || 0 }); setEditing(false); };
  if (editing) {
    return (
      <tr style={{ background: "rgba(250,204,21,0.08)" }}>
        {fields.map((f) => (
          <td key={f.key} style={{ padding: "6px 10px" }}>
            <input type={f.key === "amount" ? "number" : "text"} value={draft[f.key] ?? ""}
              onChange={(e) => setDraft({ ...draft, [f.key]: e.target.value })} style={inputStyle} />
          </td>
        ))}
        <td style={{ padding: "6px 10px", display: "flex", gap: 6 }}>
          <button onClick={save} style={btnStyle("#22c55e")}>✓</button>
          <button onClick={() => setEditing(false)} style={btnStyle("#6b7280")}>✕</button>
        </td>
      </tr>
    );
  }
  return (
    <tr style={{ borderBottom: "1px solid rgba(255,255,255,0.05)" }}
      onMouseEnter={(e) => (e.currentTarget.style.background = "rgba(255,255,255,0.03)")}
      onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}>
      {fields.map((f) => (
        <td key={f.key} style={{ padding: "10px 10px", color: f.key === "amount" ? "#fde68a" : "#d1d5db", fontSize: 14 }}>
          {f.key === "amount" ? fmtFull(item[f.key]) : (item[f.key] ?? "")}
        </td>
      ))}
      <td style={{ padding: "10px 10px", display: "flex", gap: 6 }}>
        <button onClick={() => setEditing(true)} style={btnStyle("#3b82f6")}>✎</button>
        <button onClick={() => onDelete(item.id)} style={btnStyle("#ef4444")}>✕</button>
      </td>
    </tr>
  );
}

function SectionTable({ title, items, setItems, fields, addLabel, newItem, color }) {
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState(newItem());
  const update = (updated) => setItems(items.map((i) => (i.id === updated.id ? updated : i)));
  const del = (id) => setItems(items.filter((i) => i.id !== id));
  const add = () => { setItems([...items, { ...draft, id: nextId++, amount: parseFloat(draft.amount) || 0 }]); setDraft(newItem()); setAdding(false); };
  return (
    <div style={{ marginBottom: 32, background: "#111827", borderRadius: 12, overflow: "hidden", border: `1px solid ${color}33` }}>
      <div style={{ padding: "14px 16px", background: color + "18", borderBottom: `1px solid ${color}33`, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <span style={{ fontWeight: 700, color, fontSize: 15 }}>{title}</span>
        <button onClick={() => setAdding(true)} style={btnStyle(color)}>{addLabel}</button>
      </div>
      <table style={{ width: "100%", borderCollapse: "collapse" }}>
        <thead>
          <tr style={{ background: "rgba(255,255,255,0.03)" }}>
            {fields.map((f) => (
              <th key={f.key} style={{ padding: "8px 10px", textAlign: "left", color: "#6b7280", fontSize: 12, fontWeight: 600, textTransform: "uppercase", letterSpacing: 0.8 }}>{f.label}</th>
            ))}
            <th style={{ padding: "8px 10px", color: "#6b7280", fontSize: 12 }}>Actions</th>
          </tr>
        </thead>
        <tbody>
          {items.map((item) => <EditableRow key={item.id} item={item} onUpdate={update} onDelete={del} fields={fields} />)}
          {adding && (
            <tr style={{ background: "rgba(250,204,21,0.08)" }}>
              {fields.map((f) => (
                <td key={f.key} style={{ padding: "6px 10px" }}>
                  <input type={f.key === "amount" ? "number" : "text"} placeholder={f.label}
                    value={draft[f.key] ?? ""} onChange={(e) => setDraft({ ...draft, [f.key]: e.target.value })} style={inputStyle} />
                </td>
              ))}
              <td style={{ padding: "6px 10px", display: "flex", gap: 6 }}>
                <button onClick={add} style={btnStyle("#22c55e")}>Add</button>
                <button onClick={() => setAdding(false)} style={btnStyle("#6b7280")}>✕</button>
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

// ==================== NET WORTH TREND ====================

function NetWorthTrendChart({ history }) {
  if (!history || history.length < 2) {
    return (
      <div style={{ background: "#111827", border: "1px solid #1f2937", borderRadius: 12, padding: "20px", marginBottom: 20, textAlign: "center" }}>
        <div style={{ color: "#f9fafb", fontSize: 15, fontWeight: 700, marginBottom: 8 }}>📈 Net Worth Trend</div>
        <div style={{ color: "#6b7280", fontSize: 13 }}>Trend will appear after your second visit — check back tomorrow!</div>
      </div>
    );
  }
  const min = Math.min(...history.map((h) => h.value));
  const max = Math.max(...history.map((h) => h.value));
  const range = max - min || 1;
  const W = 100; const H = 60;
  const pts = history.map((h, i) => {
    const x = (i / (history.length - 1)) * W;
    const y = H - ((h.value - min) / range) * H;
    return `${x},${y}`;
  }).join(" ");
  const latest = history[history.length - 1];
  const previous = history[history.length - 2];
  const change = latest.value - previous.value;
  const pct = ((change / Math.abs(previous.value)) * 100).toFixed(1);
  return (
    <div style={{ background: "#111827", border: "1px solid #1f2937", borderRadius: 12, padding: "20px", marginBottom: 20 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
        <div style={{ color: "#f9fafb", fontSize: 15, fontWeight: 700 }}>📈 Net Worth Trend</div>
        <div style={{ textAlign: "right" }}>
          <span style={{ color: change >= 0 ? "#34d399" : "#f87171", fontSize: 13, fontWeight: 700 }}>
            {change >= 0 ? "▲" : "▼"} {fmtFull(Math.abs(change))} ({pct}%)
          </span>
          <div style={{ color: "#6b7280", fontSize: 11 }}>vs last snapshot</div>
        </div>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", height: 120, overflow: "visible" }}>
        <defs>
          <linearGradient id="trendGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#fbbf24" stopOpacity="0.3" />
            <stop offset="100%" stopColor="#fbbf24" stopOpacity="0" />
          </linearGradient>
        </defs>
        <polyline points={pts} fill="none" stroke="#fbbf24" strokeWidth="1.5" strokeLinejoin="round" />
        <polygon points={`0,${H} ${pts} ${W},${H}`} fill="url(#trendGrad)" />
        {history.map((h, i) => {
          const x = (i / (history.length - 1)) * W;
          const y = H - ((h.value - min) / range) * H;
          return <circle key={i} cx={x} cy={y} r="1.5" fill="#fbbf24" />;
        })}
      </svg>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, color: "#6b7280", marginTop: 4 }}>
        <span>{history[0]?.date}</span>
        <span>{history[history.length - 1]?.date}</span>
      </div>
    </div>
  );
}

// ==================== MORTGAGE CARD ====================

function MortgageCard({ liabilities, pkrRate, pkrLoading, homeValue, setHomeValue, mortgageRate, setMortgageRate }) {
  const mortgage = liabilities.find((l) => l.name.toLowerCase().includes("mortgage"));
  const balance = mortgage?.amount || 0;
  const [editingHome, setEditingHome] = useState(false);
  const [editingRate, setEditingRate] = useState(false);
  const [homeDraft, setHomeDraft] = useState(homeValue.toString());
  const [rateDraft, setRateDraft] = useState(mortgageRate.toString());
  const ltv = homeValue > 0 ? ((balance / homeValue) * 100).toFixed(1) : 0;
  const equity = homeValue - balance;
  const monthlyInterest = (balance * (mortgageRate / 100)) / 12;
  return (
    <div style={{ background: "#111827", border: "1px solid #fb923c33", borderRadius: 12, padding: "20px", marginBottom: 20 }}>
      <div style={{ color: "#fb923c", fontSize: 15, fontWeight: 700, marginBottom: 16 }}>🏠 Mortgage Details</div>
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 16 }}>
        <div style={{ flex: 1, minWidth: 130, background: "#0b0f1a", borderRadius: 10, padding: "12px 14px" }}>
          <div style={{ color: "#6b7280", fontSize: 11, textTransform: "uppercase", letterSpacing: 1, marginBottom: 4 }}>Balance</div>
          <div style={{ color: "#f87171", fontSize: 18, fontWeight: 800 }}>{fmt(balance)}</div>
          <div style={{ color: "#6b7280", fontSize: 11, marginTop: 4 }}>From liabilities</div>
        </div>
        <div style={{ flex: 1, minWidth: 130, background: "#0b0f1a", borderRadius: 10, padding: "12px 14px" }}>
          <div style={{ color: "#6b7280", fontSize: 11, textTransform: "uppercase", letterSpacing: 1, marginBottom: 4 }}>Home Value</div>
          {editingHome ? (
            <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
              <input type="number" value={homeDraft} onChange={(e) => setHomeDraft(e.target.value)}
                style={{ background: "#1e2535", border: "1px solid #fbbf24", borderRadius: 4, color: "#f9fafb", padding: "4px 8px", fontSize: 13, width: 90, outline: "none", fontFamily: "inherit" }} />
              <button onClick={() => { setHomeValue(parseFloat(homeDraft) || 0); setEditingHome(false); }} style={{ background: "#22c55e22", border: "1px solid #22c55e", color: "#22c55e", borderRadius: 4, padding: "3px 8px", cursor: "pointer", fontSize: 12, fontWeight: 600, fontFamily: "inherit" }}>✓</button>
            </div>
          ) : (
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <div style={{ color: "#34d399", fontSize: 18, fontWeight: 800 }}>{fmt(homeValue)}</div>
              <button onClick={() => { setHomeDraft(homeValue.toString()); setEditingHome(true); }} style={{ background: "#3b82f622", border: "1px solid #3b82f6", color: "#3b82f6", borderRadius: 4, padding: "3px 8px", cursor: "pointer", fontSize: 12, fontWeight: 600, fontFamily: "inherit" }}>✎</button>
            </div>
          )}
          <div style={{ marginTop: 4 }}><PKRBadge gbp={homeValue} rate={pkrRate} loading={pkrLoading} /></div>
        </div>
        <div style={{ flex: 1, minWidth: 130, background: "#0b0f1a", borderRadius: 10, padding: "12px 14px" }}>
          <div style={{ color: "#6b7280", fontSize: 11, textTransform: "uppercase", letterSpacing: 1, marginBottom: 4 }}>Equity</div>
          <div style={{ color: equity >= 0 ? "#34d399" : "#f87171", fontSize: 18, fontWeight: 800 }}>{fmt(equity)}</div>
          <div style={{ marginTop: 4 }}><PKRBadge gbp={Math.abs(equity)} rate={pkrRate} loading={pkrLoading} /></div>
        </div>
        <div style={{ flex: 1, minWidth: 130, background: "#0b0f1a", borderRadius: 10, padding: "12px 14px" }}>
          <div style={{ color: "#6b7280", fontSize: 11, textTransform: "uppercase", letterSpacing: 1, marginBottom: 4 }}>LTV</div>
          <div style={{ color: ltv > 80 ? "#f87171" : ltv > 60 ? "#fbbf24" : "#34d399", fontSize: 18, fontWeight: 800 }}>{ltv}%</div>
          <div style={{ color: "#6b7280", fontSize: 11, marginTop: 4 }}>Loan to Value</div>
        </div>
        <div style={{ flex: 1, minWidth: 130, background: "#0b0f1a", borderRadius: 10, padding: "12px 14px" }}>
          <div style={{ color: "#6b7280", fontSize: 11, textTransform: "uppercase", letterSpacing: 1, marginBottom: 4 }}>Rate %</div>
          {editingRate ? (
            <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
              <input type="number" value={rateDraft} onChange={(e) => setRateDraft(e.target.value)}
                style={{ background: "#1e2535", border: "1px solid #fbbf24", borderRadius: 4, color: "#f9fafb", padding: "4px 8px", fontSize: 13, width: 70, outline: "none", fontFamily: "inherit" }} step="0.01" />
              <button onClick={() => { setMortgageRate(parseFloat(rateDraft) || 0); setEditingRate(false); }} style={{ background: "#22c55e22", border: "1px solid #22c55e", color: "#22c55e", borderRadius: 4, padding: "3px 8px", cursor: "pointer", fontSize: 12, fontWeight: 600, fontFamily: "inherit" }}>✓</button>
            </div>
          ) : (
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <div style={{ color: "#fbbf24", fontSize: 18, fontWeight: 800 }}>{mortgageRate}%</div>
              <button onClick={() => { setRateDraft(mortgageRate.toString()); setEditingRate(true); }} style={{ background: "#3b82f622", border: "1px solid #3b82f6", color: "#3b82f6", borderRadius: 4, padding: "3px 8px", cursor: "pointer", fontSize: 12, fontWeight: 600, fontFamily: "inherit" }}>✎</button>
            </div>
          )}
          <div style={{ color: "#6b7280", fontSize: 11, marginTop: 4 }}>≈ {fmt(monthlyInterest)}/mo interest</div>
        </div>
      </div>
      <div style={{ background: "#0b0f1a", borderRadius: 8, overflow: "hidden", height: 8 }}>
        <div style={{ height: "100%", width: `${Math.min(ltv, 100)}%`, background: ltv > 80 ? "#ef4444" : ltv > 60 ? "#fbbf24" : "#34d399", borderRadius: 8, transition: "width 0.5s" }} />
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, color: "#6b7280", marginTop: 6 }}>
        <span>0% LTV</span>
        <span style={{ color: "#fb923c" }}>Home: {fmt(homeValue)}</span>
        <span>100% LTV</span>
      </div>
    </div>
  );
}

// ==================== VANGUARD CARD ====================

function VanguardCard({ pkrRate, pkrLoading, units, setUnits, onSaveUnits }) {
  const { price, loading, value } = useVanguardPrice(units);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(units.toString());

  const save = () => {
    const n = parseFloat(draft);
    if (!isNaN(n) && n > 0) { setUnits(n); onSaveUnits(n); }
    setEditing(false);
  };

  return (
    <div style={{ background: "#111827", border: "1px solid #c084fc33", borderRadius: 12, padding: "20px", marginBottom: 20 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
        <div style={{ color: "#c084fc", fontSize: 15, fontWeight: 700 }}>📊 Vanguard FTSE Global All Cap</div>
        <div style={{ background: "#c084fc22", border: "1px solid #c084fc44", borderRadius: 6, padding: "3px 8px", fontSize: 11, color: "#c084fc" }}>VWRP.L</div>
      </div>
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
        <div style={{ flex: 1, minWidth: 130, background: "#0b0f1a", borderRadius: 10, padding: "12px 14px" }}>
          <div style={{ color: "#6b7280", fontSize: 11, textTransform: "uppercase", letterSpacing: 1, marginBottom: 4 }}>Live Price</div>
          <div style={{ color: "#c084fc", fontSize: 18, fontWeight: 800 }}>{loading ? "Loading…" : price ? fmtFull(price) : "N/A"}</div>
          <div style={{ color: "#6b7280", fontSize: 11, marginTop: 4 }}>per share</div>
        </div>
        <div style={{ flex: 1, minWidth: 130, background: "#0b0f1a", borderRadius: 10, padding: "12px 14px" }}>
          <div style={{ color: "#6b7280", fontSize: 11, textTransform: "uppercase", letterSpacing: 1, marginBottom: 4 }}>Your Units</div>
          {editing ? (
            <div style={{ display: "flex", gap: 6, alignItems: "center", marginTop: 2 }}>
              <input type="number" value={draft} onChange={(e) => setDraft(e.target.value)}
                style={{ ...inputStyle, fontSize: 14, width: 110 }} step="0.000001" />
              <button onClick={save} style={btnStyle("#22c55e")}>✓</button>
              <button onClick={() => setEditing(false)} style={btnStyle("#6b7280")}>✕</button>
            </div>
          ) : (
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <div style={{ color: "#fde68a", fontSize: 18, fontWeight: 800 }}>{units.toFixed(6)}</div>
              <button onClick={() => { setDraft(units.toString()); setEditing(true); }} style={btnStyle("#3b82f6")}>✎</button>
            </div>
          )}
          <div style={{ color: "#6b7280", fontSize: 11, marginTop: 4 }}>shares held</div>
        </div>
        <div style={{ flex: 1, minWidth: 130, background: "#0b0f1a", borderRadius: 10, padding: "12px 14px" }}>
          <div style={{ color: "#6b7280", fontSize: 11, textTransform: "uppercase", letterSpacing: 1, marginBottom: 4 }}>Live Value</div>
          <div style={{ color: "#34d399", fontSize: 18, fontWeight: 800 }}>{loading ? "Loading…" : value ? fmtFull(value) : "N/A"}</div>
          {value && <div style={{ marginTop: 4 }}><PKRBadge gbp={value} rate={pkrRate} loading={pkrLoading} /></div>}
        </div>
      </div>
      {!loading && !price && (
        <div style={{ color: "#6b7280", fontSize: 12, marginTop: 12, textAlign: "center" }}>
          Live price unavailable — markets may be closed.
        </div>
      )}
    </div>
  );
}

// ==================== CHARTS TAB ====================

const CustomTooltip = ({ active, payload }) => {
  if (active && payload && payload.length) {
    return (
      <div style={{ background: "#1e2535", border: "1px solid #374151", borderRadius: 8, padding: "8px 12px" }}>
        <div style={{ color: "#f9fafb", fontSize: 13, fontWeight: 600 }}>{payload[0].name}</div>
        <div style={{ color: "#fde68a", fontSize: 13 }}>{fmtFull(payload[0].value)}</div>
        {payload[0].payload?.pct && <div style={{ color: "#9ca3af", fontSize: 12 }}>{payload[0].payload.pct}%</div>}
      </div>
    );
  }
  return null;
};

const RADIAN = Math.PI / 180;
function PieLabel({ cx, cy, midAngle, innerRadius, outerRadius, percent, value }) {
  if (percent < 0.05) return null;
  const radius = innerRadius + (outerRadius - innerRadius) * 0.5;
  const x = cx + radius * Math.cos(-midAngle * RADIAN);
  const y = cy + radius * Math.sin(-midAngle * RADIAN);
  return (
    <text x={x} y={y} fill="white" textAnchor="middle" dominantBaseline="central" fontSize={11} fontWeight={700}>
      {`${(percent * 100).toFixed(0)}%`}
    </text>
  );
}

function ChartsTab({ assets, liabilities, expenses, totalAssets, totalLiabilities, income, totalExpenses }) {
  const netWorthData = [{ name: "Assets", value: totalAssets }, { name: "Liabilities", value: totalLiabilities }];
  const budgetData = [{ name: "Expenses", value: totalExpenses }, { name: "Headroom", value: Math.max(income - totalExpenses, 0) }];
  const expensesBarData = [...expenses].sort((a, b) => b.amount - a.amount).map((e) => ({
    name: e.name.length > 20 ? e.name.substring(0, 20) + "…" : e.name,
    amount: e.amount,
    pct: ((e.amount / totalExpenses) * 100).toFixed(1),
  }));
  const assetsWithPct = assets.map((a) => ({ name: a.name, value: a.amount, pct: ((a.amount / totalAssets) * 100).toFixed(1) }));
  const liabWithPct = liabilities.map((l) => ({ name: l.name, value: l.amount, pct: ((l.amount / totalLiabilities) * 100).toFixed(1) }));

  const chartBox = (title, children) => (
    <div style={{ background: "#111827", border: "1px solid #1f2937", borderRadius: 12, padding: "20px", marginBottom: 20 }}>
      <div style={{ color: "#f9fafb", fontSize: 15, fontWeight: 700, marginBottom: 16 }}>{title}</div>
      {children}
    </div>
  );

  const BarTooltip = ({ active, payload }) => {
    if (active && payload && payload.length) {
      return (
        <div style={{ background: "#1e2535", border: "1px solid #374151", borderRadius: 8, padding: "8px 12px" }}>
          <div style={{ color: "#f9fafb", fontSize: 13, fontWeight: 600 }}>{payload[0].payload.name}</div>
          <div style={{ color: "#fde68a", fontSize: 13 }}>{fmtFull(payload[0].value)}</div>
          <div style={{ color: "#9ca3af", fontSize: 12 }}>{payload[0].payload.pct}% of total</div>
        </div>
      );
    }
    return null;
  };

  return (
    <div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
        <div>{chartBox("Net Worth Breakdown",
          <ResponsiveContainer width="100%" height={260}>
            <PieChart>
              <Pie data={netWorthData} cx="50%" cy="50%" innerRadius={60} outerRadius={100} dataKey="value" paddingAngle={3} labelLine={false} label={PieLabel}>
                <Cell fill="#10b981" /><Cell fill="#ef4444" />
              </Pie>
              <Tooltip content={<CustomTooltip />} />
              <Legend formatter={(v) => <span style={{ color: "#9ca3af", fontSize: 12 }}>{v}</span>} />
            </PieChart>
          </ResponsiveContainer>
        )}</div>
        <div>{chartBox("Monthly Budget Split",
          <ResponsiveContainer width="100%" height={260}>
            <PieChart>
              <Pie data={budgetData} cx="50%" cy="50%" innerRadius={60} outerRadius={100} dataKey="value" paddingAngle={3} labelLine={false} label={PieLabel}>
                <Cell fill="#ef4444" /><Cell fill="#10b981" />
              </Pie>
              <Tooltip content={<CustomTooltip />} />
              <Legend formatter={(v) => <span style={{ color: "#9ca3af", fontSize: 12 }}>{v}</span>} />
            </PieChart>
          </ResponsiveContainer>
        )}</div>
      </div>
      {chartBox("Asset Allocation",
        <ResponsiveContainer width="100%" height={260}>
          <PieChart>
            <Pie data={assetsWithPct} cx="50%" cy="50%" outerRadius={100} dataKey="value" paddingAngle={2} labelLine={false} label={PieLabel}>
              {assetsWithPct.map((_, i) => <Cell key={i} fill={COLORS_ASSETS[i % COLORS_ASSETS.length]} />)}
            </Pie>
            <Tooltip content={<CustomTooltip />} />
            <Legend formatter={(v) => <span style={{ color: "#9ca3af", fontSize: 11 }}>{v}</span>} />
          </PieChart>
        </ResponsiveContainer>
      )}
      {chartBox("Liabilities Breakdown",
        <ResponsiveContainer width="100%" height={220}>
          <PieChart>
            <Pie data={liabWithPct} cx="50%" cy="50%" outerRadius={90} dataKey="value" paddingAngle={2} labelLine={false} label={PieLabel}>
              {liabWithPct.map((_, i) => <Cell key={i} fill={COLORS_LIAB[i % COLORS_LIAB.length]} />)}
            </Pie>
            <Tooltip content={<CustomTooltip />} />
            <Legend formatter={(v) => <span style={{ color: "#9ca3af", fontSize: 11 }}>{v}</span>} />
          </PieChart>
        </ResponsiveContainer>
      )}
      {chartBox("Monthly Expenses",
        <ResponsiveContainer width="100%" height={380}>
          <BarChart data={expensesBarData} layout="vertical" margin={{ left: 10, right: 60 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" />
            <XAxis type="number" tick={{ fill: "#6b7280", fontSize: 11 }} tickFormatter={(v) => `£${v}`} />
            <YAxis type="category" dataKey="name" tick={{ fill: "#9ca3af", fontSize: 11 }} width={160} />
            <Tooltip content={<BarTooltip />} />
            <Bar dataKey="amount" radius={[0, 4, 4, 0]} label={{ position: "right", formatter: (v) => `${((v/totalExpenses)*100).toFixed(0)}%`, fill: "#6b7280", fontSize: 11 }}>
              {expensesBarData.map((_, i) => <Cell key={i} fill={COLORS_EXP[i % COLORS_EXP.length]} />)}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      )}
    </div>
  );
}

// ==================== ZAKAT TAB ====================

function getHijriDate(date = new Date()) {
  const hijri = new Intl.DateTimeFormat("en-TN-u-ca-islamic-umalqura", { day: "numeric", month: "numeric", year: "numeric" }).formatToParts(date);
  const parts = {};
  hijri.forEach((p) => { parts[p.type] = parseInt(p.value); });
  return { day: parts.day, month: parts.month, year: parts.year };
}

function getNextHijriDate(targetMonth, targetDay) {
  const today = new Date();
  for (let i = 0; i <= 400; i++) {
    const candidate = new Date(today);
    candidate.setDate(today.getDate() + i);
    const h = getHijriDate(candidate);
    if (h.month === targetMonth && h.day === targetDay) return candidate;
  }
  return null;
}

function daysUntil(date) {
  const today = new Date(); today.setHours(0,0,0,0); date.setHours(0,0,0,0);
  return Math.round((date - today) / (1000 * 60 * 60 * 24));
}

const HIJRI_MONTHS = ["","Muharram","Safar","Rabi al-Awwal","Rabi al-Thani","Jumada al-Awwal","Jumada al-Thani","Rajab","Sha'ban","Ramadan","Shawwal","Dhu al-Qi'dah","Dhu al-Hijjah"];

function ZakatTab({ assets, pkrRate, pkrLoading }) {
  const hijriToday = getHijriDate();
  const moon = getMoonPhase();

  const [zakatMonth, setZakatMonth] = useState(8); // Default Sha'ban
  const [zakatDay, setZakatDay] = useState(15);

  const nextZakatDate = getNextHijriDate(zakatMonth, zakatDay);
  const days = nextZakatDate ? daysUntil(new Date(nextZakatDate)) : null;
  const isZakatDay = hijriToday.month === zakatMonth && hijriToday.day === zakatDay;

  const [pkrAccountInput, setPkrAccountInput] = useState("");
  const pkrAccountGBP = pkrRate && pkrAccountInput ? parseFloat(pkrAccountInput) / pkrRate : 0;

  const cashAccounts = assets.filter((a) => {
    const n = a.name.toLowerCase();
    return n.includes("account") || n.includes("current") || n.includes("saving") || n.includes("savings");
  });
  const investments = assets.filter((a) => a.name.toLowerCase().includes("vanguard") || a.name.toLowerCase().includes("ftse") || a.name.toLowerCase().includes("global"));
  const totalZakatableBase = [...cashAccounts, ...investments].reduce((s, a) => s + a.amount, 0);
  const totalZakatable = totalZakatableBase + pkrAccountGBP;
  const zakatDue = totalZakatable * 0.025;
  const nisab = 85 * 65;
  const aboveNisab = totalZakatable >= nisab;

  const box = (children, style = {}) => (
    <div style={{ background: "#111827", border: "1px solid #1f2937", borderRadius: 12, padding: "20px", marginBottom: 16, ...style }}>{children}</div>
  );

  return (
    <div>
      {/* Header with moon */}
      {box(<div style={{ textAlign: "center" }}>
        <div style={{ fontSize: 48, marginBottom: 4 }}>{moon.emoji}</div>
        <div style={{ color: "#6b7280", fontSize: 12, marginBottom: 12 }}>{moon.name} · Day {moon.phase} of lunar cycle</div>
        <div style={{ fontFamily: "'Syne', sans-serif", fontSize: 22, fontWeight: 800, color: "#f9fafb", marginBottom: 4 }}>☪️ Zakat Calculator</div>
        <div style={{ color: "#6b7280", fontSize: 13 }}>Select your Zakat month and day from the Islamic calendar</div>
      </div>)}

      {/* Hijri Date, Countdown, Nisab */}
      {box(<div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
        <div style={{ flex: 1, minWidth: 140, background: "#0b0f1a", borderRadius: 10, padding: "14px 16px", textAlign: "center" }}>
          <div style={{ color: "#6b7280", fontSize: 11, textTransform: "uppercase", letterSpacing: 1, marginBottom: 6 }}>Today (Hijri)</div>
          <div style={{ color: "#fde68a", fontSize: 18, fontWeight: 700 }}>{hijriToday.day}/{hijriToday.month}/{hijriToday.year} AH</div>
          <div style={{ color: "#6b7280", fontSize: 11, marginTop: 4 }}>{HIJRI_MONTHS[hijriToday.month] || ""}</div>
        </div>
        <div style={{ flex: 1, minWidth: 140, background: "#0b0f1a", borderRadius: 10, padding: "14px 16px", textAlign: "center" }}>
          <div style={{ color: "#6b7280", fontSize: 11, textTransform: "uppercase", letterSpacing: 1, marginBottom: 8 }}>My Zakat Date</div>
          <div style={{ display: "flex", gap: 6, justifyContent: "center", flexWrap: "wrap", marginBottom: 8 }}>
            <select value={zakatMonth} onChange={(e) => setZakatMonth(parseInt(e.target.value))}
              style={{ background: "#1e2535", border: "1px solid #fbbf24", borderRadius: 6, color: "#fde68a", padding: "4px 6px", fontSize: 12, fontFamily: "inherit", cursor: "pointer" }}>
              {HIJRI_MONTHS.slice(1).map((m, i) => (
                <option key={i+1} value={i+1}>{m}</option>
              ))}
            </select>
            <select value={zakatDay} onChange={(e) => setZakatDay(parseInt(e.target.value))}
              style={{ background: "#1e2535", border: "1px solid #fbbf24", borderRadius: 6, color: "#fde68a", padding: "4px 6px", fontSize: 12, fontFamily: "inherit", cursor: "pointer", width: 60 }}>
              {Array.from({length: 30}, (_, i) => i + 1).map(d => (
                <option key={d} value={d}>{d}</option>
              ))}
            </select>
          </div>
          <div style={{ color: isZakatDay ? "#34d399" : "#c084fc", fontSize: 16, fontWeight: 700 }}>
            {isZakatDay ? "🎯 Today!" : days !== null ? `${days} days` : "…"}
          </div>
          {nextZakatDate && !isZakatDay && (
            <div style={{ color: "#6b7280", fontSize: 11, marginTop: 4 }}>
              {nextZakatDate.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" })}
            </div>
          )}
        </div>
        <div style={{ flex: 1, minWidth: 140, background: "#0b0f1a", borderRadius: 10, padding: "14px 16px", textAlign: "center" }}>
          <div style={{ color: "#6b7280", fontSize: 11, textTransform: "uppercase", letterSpacing: 1, marginBottom: 6 }}>Nisab</div>
          <div style={{ color: aboveNisab ? "#34d399" : "#f87171", fontSize: 18, fontWeight: 700 }}>{aboveNisab ? "✓ Above" : "✕ Below"}</div>
          <div style={{ color: "#6b7280", fontSize: 11, marginTop: 4 }}>~{fmtFull(nisab)} (85g gold)</div>
        </div>
      </div>)}

      {/* Zakatable Assets */}
      {box(<>
        <div style={{ color: "#f9fafb", fontSize: 15, fontWeight: 700, marginBottom: 16 }}>Zakatable Assets</div>

        <div style={{ color: "#60a5fa", fontSize: 12, fontWeight: 600, textTransform: "uppercase", letterSpacing: 1, marginBottom: 8 }}>UK Cash Accounts</div>
        {cashAccounts.map((a) => (
          <div key={a.id} style={{ display: "flex", justifyContent: "space-between", marginBottom: 8, padding: "8px 12px", background: "#0b0f1a", borderRadius: 8 }}>
            <span style={{ color: "#9ca3af", fontSize: 13 }}>{a.name}</span>
            <span style={{ color: "#fde68a", fontSize: 13, fontWeight: 600 }}>{fmtFull(a.amount)}</span>
          </div>
        ))}

        <div style={{ color: "#c084fc", fontSize: 12, fontWeight: 600, textTransform: "uppercase", letterSpacing: 1, marginBottom: 8, marginTop: 14 }}>Investments</div>
        {investments.map((a) => (
          <div key={a.id} style={{ display: "flex", justifyContent: "space-between", marginBottom: 8, padding: "8px 12px", background: "#0b0f1a", borderRadius: 8 }}>
            <span style={{ color: "#9ca3af", fontSize: 13 }}>{a.name}</span>
            <span style={{ color: "#fde68a", fontSize: 13, fontWeight: 600 }}>{fmtFull(a.amount)}</span>
          </div>
        ))}

        {/* Pakistani Bank Account */}
        <div style={{ color: "#34d399", fontSize: 12, fontWeight: 600, textTransform: "uppercase", letterSpacing: 1, marginBottom: 8, marginTop: 14 }}>🇵🇰 Pakistani Bank Account</div>
        <div style={{ background: "#0b0f1a", borderRadius: 8, padding: "12px 14px", marginBottom: 8 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            <span style={{ color: "#9ca3af", fontSize: 13, minWidth: 30 }}>₨</span>
            <input
              type="number"
              placeholder="Enter amount in PKR"
              value={pkrAccountInput}
              onChange={(e) => setPkrAccountInput(e.target.value)}
              style={{ ...inputStyle, flex: 1, minWidth: 140 }}
            />
            {pkrAccountGBP > 0 && (
              <span style={{ color: "#34d399", fontSize: 13, fontWeight: 700, whiteSpace: "nowrap" }}>
                = {fmtFull(pkrAccountGBP)}
              </span>
            )}
          </div>
          {!pkrRate && <div style={{ color: "#f87171", fontSize: 12, marginTop: 8 }}>⚠ Live rate unavailable — cannot convert</div>}
          {pkrRate && <div style={{ color: "#6b7280", fontSize: 11, marginTop: 6 }}>Rate: 1 GBP = {pkrRate.toFixed(2)} PKR</div>}
        </div>

        <div style={{ borderTop: "1px solid #1f2937", marginTop: 16, paddingTop: 16 }}>
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
            <span style={{ color: "#9ca3af", fontSize: 13 }}>UK accounts + investments</span>
            <span style={{ color: "#fde68a", fontSize: 13, fontWeight: 600 }}>{fmtFull(totalZakatableBase)}</span>
          </div>
          {pkrAccountGBP > 0 && (
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
              <span style={{ color: "#9ca3af", fontSize: 13 }}>Pakistani account (converted)</span>
              <span style={{ color: "#34d399", fontSize: 13, fontWeight: 600 }}>+ {fmtFull(pkrAccountGBP)}</span>
            </div>
          )}
          <div style={{ display: "flex", justifyContent: "space-between", borderTop: "1px solid #374151", paddingTop: 10, marginTop: 6 }}>
            <span style={{ color: "#f9fafb", fontSize: 14, fontWeight: 700 }}>Total Zakatable</span>
            <span style={{ color: "#34d399", fontSize: 14, fontWeight: 700 }}>{fmtFull(totalZakatable)}</span>
          </div>
        </div>
      </>)}

      {/* Zakat Due */}
      {box(<div style={{ textAlign: "center" }}>
        <div style={{ color: "#9ca3af", fontSize: 13, marginBottom: 8 }}>Zakat Due (2.5%)</div>
        <div style={{ color: aboveNisab ? "#fbbf24" : "#6b7280", fontSize: 42, fontWeight: 800, letterSpacing: -1 }}>{fmtFull(zakatDue)}</div>
        <div style={{ marginTop: 8 }}><PKRBadge gbp={zakatDue} rate={pkrRate} loading={pkrLoading} /></div>
        {pkrAccountGBP > 0 && (
          <div style={{ marginTop: 12, background: "#34d39922", border: "1px solid #34d39944", borderRadius: 8, padding: "8px 12px", display: "inline-block" }}>
            <div style={{ color: "#34d399", fontSize: 12 }}>Includes Pakistani account contribution:</div>
            <div style={{ color: "#34d399", fontSize: 14, fontWeight: 700 }}>{fmtFull(pkrAccountGBP * 0.025)} GBP · {pkrRate ? fmtPKR(parseFloat(pkrAccountInput) * 0.025) : ""} PKR</div>
          </div>
        )}
        {!aboveNisab && <div style={{ color: "#f87171", fontSize: 13, marginTop: 8 }}>⚠ Below Nisab threshold</div>}
        <div style={{ color: "#6b7280", fontSize: 12, marginTop: 12 }}>Property and liabilities excluded. Consult a scholar for personalised guidance.</div>
      </div>, { border: "1px solid #fbbf2444" })}
    </div>
  );
}

// ==================== EXPENSES TABLE WITH SMART DATES ====================

function parseDueDay(due) {
  if (!due) return null;
  const match = due.toString().match(/\d+/);
  return match ? parseInt(match[0]) : null;
}

function getSmartDueDate(due) {
  if (!due) return { label: "—", daysLeft: null, status: "normal" };
  if (due === "Monthly") return { label: "Monthly", daysLeft: null, status: "normal" };

  const day = parseDueDay(due);
  if (!day) return { label: due, daysLeft: null, status: "normal" };

  const today = new Date();
  const todayDay = today.getDate();
  const month = today.getMonth();
  const year = today.getFullYear();

  // Work out next occurrence
  let dueDate = new Date(year, month, day);
  if (dueDate < today) {
    // Already passed this month — move to next month
    dueDate = new Date(year, month + 1, day);
  }

  const diffMs = dueDate - today;
  const daysLeft = Math.ceil(diffMs / (1000 * 60 * 60 * 24));
  const monthName = dueDate.toLocaleDateString("en-GB", { month: "short" });
  const label = `${day} ${monthName}`;

  let status = "normal";
  if (daysLeft <= 0) status = "overdue";
  else if (daysLeft <= 3) status = "urgent";
  else if (daysLeft <= 7) status = "soon";

  return { label, daysLeft, status };
}

function ExpensesTable({ expenses, setExpenses }) {
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState({ name: "", amount: 0, due: "" });

  const update = (updated) => setExpenses(expenses.map((i) => (i.id === updated.id ? updated : i)));
  const del = (id) => setExpenses(expenses.filter((i) => i.id !== id));
  const add = () => {
    setExpenses([...expenses, { ...draft, id: nextId++, amount: parseFloat(draft.amount) || 0 }]);
    setDraft({ name: "", amount: 0, due: "" });
    setAdding(false);
  };

  const statusColors = {
    overdue: "#f87171",
    urgent: "#ef4444",
    soon: "#fbbf24",
    normal: "#34d399",
  };

  const statusBg = {
    overdue: "#f8717122",
    urgent: "#ef444422",
    soon: "#fbbf2422",
    normal: "#34d39922",
  };

  // Sort by days left
  const sorted = [...expenses].sort((a, b) => {
    const da = getSmartDueDate(a.due).daysLeft ?? 999;
    const db = getSmartDueDate(b.due).daysLeft ?? 999;
    return da - db;
  });

  return (
    <div style={{ marginBottom: 32, background: "#111827", borderRadius: 12, overflow: "hidden", border: "1px solid #f59e0b33" }}>
      <div style={{ padding: "14px 16px", background: "#f59e0b18", borderBottom: "1px solid #f59e0b33", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <span style={{ fontWeight: 700, color: "#f59e0b", fontSize: 15 }}>Monthly Expenses</span>
        <button onClick={() => setAdding(true)} style={btnStyle("#f59e0b")}>+ Add Expense</button>
      </div>
      <table style={{ width: "100%", borderCollapse: "collapse" }}>
        <thead>
          <tr style={{ background: "rgba(255,255,255,0.03)" }}>
            <th style={{ padding: "8px 10px", textAlign: "left", color: "#6b7280", fontSize: 12, fontWeight: 600, textTransform: "uppercase", letterSpacing: 0.8 }}>Expense</th>
            <th style={{ padding: "8px 10px", textAlign: "left", color: "#6b7280", fontSize: 12, fontWeight: 600, textTransform: "uppercase", letterSpacing: 0.8 }}>Amount</th>
            <th style={{ padding: "8px 10px", textAlign: "left", color: "#6b7280", fontSize: 12, fontWeight: 600, textTransform: "uppercase", letterSpacing: 0.8 }}>Due</th>
            <th style={{ padding: "8px 10px", color: "#6b7280", fontSize: 12 }}>Actions</th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((item) => {
            const { label, daysLeft, status } = getSmartDueDate(item.due);
            return (
              <ExpenseRow key={item.id} item={item} onUpdate={update} onDelete={del}
                dueLabel={label} daysLeft={daysLeft} status={status}
                statusColor={statusColors[status]} statusBg={statusBg[status]} />
            );
          })}
          {adding && (
            <tr style={{ background: "rgba(250,204,21,0.08)" }}>
              <td style={{ padding: "6px 10px" }}>
                <input type="text" placeholder="Expense name" value={draft.name}
                  onChange={(e) => setDraft({ ...draft, name: e.target.value })} style={inputStyle} />
              </td>
              <td style={{ padding: "6px 10px" }}>
                <input type="number" placeholder="Amount" value={draft.amount}
                  onChange={(e) => setDraft({ ...draft, amount: e.target.value })} style={inputStyle} />
              </td>
              <td style={{ padding: "6px 10px" }}>
                <input type="text" placeholder="e.g. 1st, 15th" value={draft.due}
                  onChange={(e) => setDraft({ ...draft, due: e.target.value })} style={inputStyle} />
              </td>
              <td style={{ padding: "6px 10px", display: "flex", gap: 6 }}>
                <button onClick={add} style={btnStyle("#22c55e")}>Add</button>
                <button onClick={() => setAdding(false)} style={btnStyle("#6b7280")}>✕</button>
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

function ExpenseRow({ item, onUpdate, onDelete, dueLabel, daysLeft, status, statusColor, statusBg }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState({ ...item });
  const save = () => { onUpdate({ ...draft, amount: parseFloat(draft.amount) || 0 }); setEditing(false); };

  if (editing) {
    return (
      <tr style={{ background: "rgba(250,204,21,0.08)" }}>
        <td style={{ padding: "6px 10px" }}><input type="text" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} style={inputStyle} /></td>
        <td style={{ padding: "6px 10px" }}><input type="number" value={draft.amount} onChange={(e) => setDraft({ ...draft, amount: e.target.value })} style={inputStyle} /></td>
        <td style={{ padding: "6px 10px" }}><input type="text" value={draft.due ?? ""} onChange={(e) => setDraft({ ...draft, due: e.target.value })} style={inputStyle} /></td>
        <td style={{ padding: "6px 10px", display: "flex", gap: 6 }}>
          <button onClick={save} style={btnStyle("#22c55e")}>✓</button>
          <button onClick={() => setEditing(false)} style={btnStyle("#6b7280")}>✕</button>
        </td>
      </tr>
    );
  }

  return (
    <tr style={{ borderBottom: "1px solid rgba(255,255,255,0.05)" }}
      onMouseEnter={(e) => (e.currentTarget.style.background = "rgba(255,255,255,0.03)")}
      onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}>
      <td style={{ padding: "10px 10px", color: "#d1d5db", fontSize: 14 }}>{item.name}</td>
      <td style={{ padding: "10px 10px", color: "#fde68a", fontSize: 14, fontWeight: 600 }}>{fmtFull(item.amount)}</td>
      <td style={{ padding: "10px 10px" }}>
        <div style={{ display: "inline-flex", flexDirection: "column", alignItems: "flex-start", gap: 2 }}>
          <span style={{ background: statusBg, color: statusColor, border: `1px solid ${statusColor}44`, borderRadius: 6, padding: "2px 8px", fontSize: 12, fontWeight: 700 }}>
            {dueLabel}
          </span>
          {daysLeft !== null && (
            <span style={{ color: statusColor, fontSize: 11 }}>
              {daysLeft === 0 ? "Due today!" : daysLeft < 0 ? `${Math.abs(daysLeft)}d overdue` : `in ${daysLeft}d`}
            </span>
          )}
        </div>
      </td>
      <td style={{ padding: "10px 10px", display: "flex", gap: 6 }}>
        <button onClick={() => setEditing(true)} style={btnStyle("#3b82f6")}>✎</button>
        <button onClick={() => onDelete(item.id)} style={btnStyle("#ef4444")}>✕</button>
      </td>
    </tr>
  );
}

// ==================== ANNUAL TABLE WITH SMART DATES ====================

function getSmartAnnualDate(timing) {
  if (!timing) return { label: "—", daysLeft: null, status: "normal" };
  const today = new Date();
  const currentYear = today.getFullYear();

  // Try to parse month names like "March", "15 April", "1 October"
  const months = ["january","february","march","april","may","june","july","august","september","october","november","december"];
  const lower = timing.toLowerCase();
  const monthIndex = months.findIndex((m) => lower.includes(m));
  if (monthIndex === -1) return { label: timing, daysLeft: null, status: "normal" };

  const dayMatch = timing.match(/\d+/);
  const day = dayMatch ? parseInt(dayMatch[0]) : 1;

  let dueDate = new Date(currentYear, monthIndex, day);
  if (dueDate < today) dueDate = new Date(currentYear + 1, monthIndex, day);

  const daysLeft = Math.ceil((dueDate - today) / (1000 * 60 * 60 * 24));
  const label = dueDate.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });

  let status = "normal";
  if (daysLeft <= 7) status = "urgent";
  else if (daysLeft <= 30) status = "soon";
  else if (daysLeft <= 90) status = "upcoming";

  return { label, daysLeft, status };
}

function AnnualTable({ annualBills, setAnnualBills }) {
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState({ name: "", amount: 0, timing: "", inBudget: false });

  const update = (updated) => setAnnualBills(annualBills.map((i) => (i.id === updated.id ? updated : i)));
  const del = (id) => setAnnualBills(annualBills.filter((i) => i.id !== id));
  const add = () => {
    setAnnualBills([...annualBills, { ...draft, id: nextId++, amount: parseFloat(draft.amount) || 0 }]);
    setDraft({ name: "", amount: 0, timing: "", inBudget: false });
    setAdding(false);
  };

  const statusColors = { urgent: "#ef4444", soon: "#fbbf24", upcoming: "#60a5fa", normal: "#6b7280" };
  const statusBg = { urgent: "#ef444422", soon: "#fbbf2422", upcoming: "#60a5fa22", normal: "#6b728022" };
  const statusLabel = { urgent: "⚠ Very soon", soon: "Coming up", upcoming: "Upcoming", normal: "" };

  const sorted = [...annualBills].sort((a, b) => {
    const da = getSmartAnnualDate(a.timing).daysLeft ?? 9999;
    const db = getSmartAnnualDate(b.timing).daysLeft ?? 9999;
    return da - db;
  });

  return (
    <div style={{ marginBottom: 32, background: "#111827", borderRadius: 12, overflow: "hidden", border: "1px solid #c084fc33" }}>
      <div style={{ padding: "14px 16px", background: "#c084fc18", borderBottom: "1px solid #c084fc33", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <span style={{ fontWeight: 700, color: "#c084fc", fontSize: 15 }}>Annual Bills</span>
        <button onClick={() => setAdding(true)} style={btnStyle("#c084fc")}>+ Add Annual Bill</button>
      </div>
      <table style={{ width: "100%", borderCollapse: "collapse" }}>
        <thead>
          <tr style={{ background: "rgba(255,255,255,0.03)" }}>
            {["Payment", "Amount", "Due Date", "Actions"].map((h) => (
              <th key={h} style={{ padding: "8px 10px", textAlign: "left", color: "#6b7280", fontSize: 12, fontWeight: 600, textTransform: "uppercase", letterSpacing: 0.8 }}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sorted.map((item) => {
            const { label, daysLeft, status } = getSmartAnnualDate(item.timing);
            return <AnnualRow key={item.id} item={item} onUpdate={update} onDelete={del}
              dueLabel={label} daysLeft={daysLeft} status={status}
              statusColor={statusColors[status]} statusBg={statusBg[status]} statusText={statusLabel[status]} />;
          })}
          {adding && (
            <tr style={{ background: "rgba(192,132,252,0.08)" }}>
              {["name","amount","timing"].map((f) => (
                <td key={f} style={{ padding: "6px 10px" }}>
                  <input type={f === "amount" ? "number" : "text"} placeholder={f === "timing" ? "e.g. 15 April" : f}
                    value={draft[f]} onChange={(e) => setDraft({ ...draft, [f]: e.target.value })} style={inputStyle} />
                </td>
              ))}
              <td style={{ padding: "6px 10px", display: "flex", gap: 6 }}>
                <button onClick={add} style={btnStyle("#22c55e")}>Add</button>
                <button onClick={() => setAdding(false)} style={btnStyle("#6b7280")}>✕</button>
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

function AnnualRow({ item, onUpdate, onDelete, dueLabel, daysLeft, status, statusColor, statusBg, statusText }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState({ ...item });
  const save = () => { onUpdate({ ...draft, amount: parseFloat(draft.amount) || 0 }); setEditing(false); };

  if (editing) {
    return (
      <tr style={{ background: "rgba(192,132,252,0.08)" }}>
        <td style={{ padding: "6px 10px" }}><input type="text" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} style={inputStyle} /></td>
        <td style={{ padding: "6px 10px" }}><input type="number" value={draft.amount} onChange={(e) => setDraft({ ...draft, amount: e.target.value })} style={inputStyle} /></td>
        <td style={{ padding: "6px 10px" }}><input type="text" value={draft.timing ?? ""} onChange={(e) => setDraft({ ...draft, timing: e.target.value })} style={inputStyle} /></td>
        <td style={{ padding: "6px 10px", display: "flex", gap: 6 }}>
          <button onClick={save} style={btnStyle("#22c55e")}>✓</button>
          <button onClick={() => setEditing(false)} style={btnStyle("#6b7280")}>✕</button>
        </td>
      </tr>
    );
  }

  return (
    <tr style={{ borderBottom: "1px solid rgba(255,255,255,0.05)" }}
      onMouseEnter={(e) => (e.currentTarget.style.background = "rgba(255,255,255,0.03)")}
      onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}>
      <td style={{ padding: "10px 10px", color: "#d1d5db", fontSize: 14 }}>{item.name}</td>
      <td style={{ padding: "10px 10px" }}>
        <div style={{ color: "#fde68a", fontSize: 14, fontWeight: 600 }}>{fmtFull(item.amount)}</div>
        <div style={{ color: "#6b7280", fontSize: 11, marginTop: 2 }}>≈ {fmtFull(item.amount / 12)}/mo</div>
      </td>
      <td style={{ padding: "10px 10px" }}>
        <div style={{ display: "inline-flex", flexDirection: "column", gap: 2 }}>
          <span style={{ background: statusBg, color: statusColor, border: `1px solid ${statusColor}44`, borderRadius: 6, padding: "2px 8px", fontSize: 12, fontWeight: 700 }}>
            {dueLabel}
          </span>
          {daysLeft !== null && (
            <span style={{ color: statusColor, fontSize: 11 }}>
              {daysLeft === 0 ? "Due today!" : daysLeft < 0 ? `${Math.abs(daysLeft)}d overdue` : `in ${daysLeft}d`}
              {statusText ? ` · ${statusText}` : ""}
            </span>
          )}
        </div>
      </td>
      <td style={{ padding: "10px 10px", display: "flex", gap: 6 }}>
        <button onClick={() => setEditing(true)} style={btnStyle("#3b82f6")}>✎</button>
        <button onClick={() => onDelete(item.id)} style={btnStyle("#ef4444")}>✕</button>
      </td>
    </tr>
  );
}

// ==================== MOON PHASE ====================

function getMoonPhase() {
  const now = new Date();
  const known = new Date(2000, 0, 6, 18, 14, 0); // Known new moon
  const diff = (now - known) / (1000 * 60 * 60 * 24);
  const cycle = 29.53058867;
  const phase = ((diff % cycle) + cycle) % cycle;
  const pct = phase / cycle;

  let name, emoji;
  if (phase < 1.85) { name = "New Moon"; emoji = "🌑"; }
  else if (phase < 7.38) { name = "Waxing Crescent"; emoji = "🌒"; }
  else if (phase < 9.22) { name = "First Quarter"; emoji = "🌓"; }
  else if (phase < 14.77) { name = "Waxing Gibbous"; emoji = "🌔"; }
  else if (phase < 16.61) { name = "Full Moon"; emoji = "🌕"; }
  else if (phase < 22.15) { name = "Waning Gibbous"; emoji = "🌖"; }
  else if (phase < 23.99) { name = "Last Quarter"; emoji = "🌗"; }
  else if (phase < 29.53) { name = "Waning Crescent"; emoji = "🌘"; }
  else { name = "New Moon"; emoji = "🌑"; }

  return { name, emoji, phase: phase.toFixed(1), pct };
}

// ==================== MAIN APP ====================

// Generate or retrieve a unique device ID for this user
function getDeviceId() {
  let id = localStorage.getItem("finance_device_id");
  if (!id) {
    id = "user_" + Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
    localStorage.setItem("finance_device_id", id);
  }
  return id;
}

const DEVICE_ID = getDeviceId();

export default function App() {
  const [income, setIncome] = useState(initialData.monthlyIncome);
  const [editingIncome, setEditingIncome] = useState(false);
  const [incomeDraft, setIncomeDraft] = useState(income);
  const [assets, setAssets] = useState(initialData.assets);
  const [liabilities, setLiabilities] = useState(initialData.liabilities);
  const [expenses, setExpenses] = useState(initialData.expenses);
  const [annualBills, setAnnualBills] = useState(initialData.annualBills);
  const [tab, setTab] = useState("overview");
  const [saveStatus, setSaveStatus] = useState("saved");
  const [loading, setLoading] = useState(true);

  const { rate: pkrRate, loading: pkrLoading } = usePKRRate();
  const { history: nwHistory, setHistory: setNwHistory } = useNetWorthHistory();
  const [vanguardUnits, setVanguardUnits] = useState(VANGUARD_UNITS);
  const [homeValue, setHomeValueState] = useState(0);
  const [mortgageRate, setMortgageRateState] = useState(0);

  useEffect(() => {
    async function load() {
      const { data, error } = await supabase.from("financial_data").select("data").eq("id", DEVICE_ID).single();
      if (!error && data?.data && Object.keys(data.data).length > 0) {
        const d = data.data;
        if (d.monthlyIncome) setIncome(d.monthlyIncome);
        if (d.assets) setAssets(d.assets);
        if (d.liabilities) setLiabilities(d.liabilities);
        if (d.expenses) setExpenses(d.expenses);
        if (d.annualBills) setAnnualBills(d.annualBills);
        if (d.vanguardUnits) setVanguardUnits(d.vanguardUnits);
        if (d.homeValue) setHomeValueState(d.homeValue);
        if (d.mortgageRate !== undefined) setMortgageRateState(d.mortgageRate);
      }
      setLoading(false);
    }
    load();
  }, []);

  const save = useCallback(async (payload) => {
    setSaveStatus("saving");
    const { error } = await supabase.from("financial_data").upsert({ id: DEVICE_ID, data: payload, updated_at: new Date().toISOString() });
    setSaveStatus(error ? "unsaved" : "saved");
  }, []);

  useEffect(() => {
    if (loading) return;
    setSaveStatus("unsaved");
    const t = setTimeout(() => { save({ monthlyIncome: income, assets, liabilities, expenses, annualBills, vanguardUnits, homeValue, mortgageRate }); }, 1500);
    return () => clearTimeout(t);
  }, [income, assets, liabilities, expenses, annualBills, vanguardUnits, homeValue, mortgageRate, loading, save]);

  const setHomeValue = (val) => {
    setHomeValueState(val);
    setAssets(prev => prev.map(a =>
      a.name.toLowerCase().includes("home") || a.name.toLowerCase().includes("property")
        ? { ...a, amount: val } : a
    ));
  };

  const setMortgageRate = (val) => setMortgageRateState(val);

  const totalAssets = useMemo(() => assets.reduce((s, a) => s + a.amount, 0), [assets]);
  const totalLiabilities = useMemo(() => liabilities.reduce((s, a) => s + a.amount, 0), [liabilities]);
  const netWorth = totalAssets - totalLiabilities;
  const totalExpenses = useMemo(() => expenses.reduce((s, a) => s + a.amount, 0), [expenses]);
  const headroom = income - totalExpenses;
  const readyCash = assets.filter((a) => { const n = a.name.toLowerCase(); return n.includes("account") || n.includes("current") || n.includes("saving") || n.includes("savings"); }).reduce((s, a) => s + a.amount, 0);
  const annualUnbudgeted = annualBills.filter((b) => !b.inBudget).reduce((s, b) => s + b.amount, 0);

  useEffect(() => {
    if (loading || totalAssets === 0) return;
    saveNetWorthSnapshot(netWorth, setNwHistory).catch((_e) => {});
  }, [loading]);

  const tabs = ["overview", "assets", "liabilities", "expenses", "annual", "charts", "zakat"];
  const statusColor = { saved: "#34d399", saving: "#fbbf24", unsaved: "#f87171" };
  const statusLabel = { saved: "✓ Saved", saving: "Saving…", unsaved: "Unsaved" };

  if (loading) return (
    <div style={{ background: "#0b0f1a", minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "monospace", color: "#6b7280" }}>
      Loading your profile…
    </div>
  );

  return (
    <div style={{ background: "#0b0f1a", minHeight: "100vh", fontFamily: "'DM Mono', 'Courier New', monospace", color: "#f9fafb", padding: "24px 16px" }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=DM+Mono:wght@300;400;500&family=Syne:wght@700;800&display=swap');
        * { box-sizing: border-box; }
        input:focus { outline: 1px solid #fbbf24 !important; }
        ::-webkit-scrollbar { width: 4px; }
        ::-webkit-scrollbar-track { background: #0b0f1a; }
        ::-webkit-scrollbar-thumb { background: #374151; border-radius: 4px; }
      `}</style>

      <div style={{ maxWidth: 820, margin: "0 auto" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 28, flexWrap: "wrap", gap: 12 }}>
          <div>
            <div style={{ fontFamily: "'Syne', sans-serif", fontSize: 26, fontWeight: 800, color: "#f9fafb", letterSpacing: -0.5 }}>Financial Profile</div>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 4 }}>
              <div style={{ width: 6, height: 6, borderRadius: "50%", background: statusColor[saveStatus] }} />
              <span style={{ color: statusColor[saveStatus], fontSize: 12 }}>{statusLabel[saveStatus]}</span>
            </div>
          </div>
          <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, background: "#111827", border: "1px solid #1f2937", borderRadius: 10, padding: "10px 16px" }}>
              <span style={{ color: "#6b7280", fontSize: 12, textTransform: "uppercase", letterSpacing: 1 }}>Monthly Income</span>
              {editingIncome ? (
                <>
                  <input type="number" value={incomeDraft} onChange={(e) => setIncomeDraft(e.target.value)} style={{ ...inputStyle, width: 100 }} />
                  <button onClick={() => { setIncome(parseFloat(incomeDraft) || income); setEditingIncome(false); }} style={btnStyle("#22c55e")}>✓</button>
                </>
              ) : (
                <>
                  <span style={{ color: "#34d399", fontWeight: 700, fontSize: 18 }}>{fmtFull(income)}</span>
                  <button onClick={() => { setIncomeDraft(income); setEditingIncome(true); }} style={btnStyle("#3b82f6")}>✎</button>
                </>
              )}
            </div>
            <button onClick={() => {
              const d = { monthlyIncome: income, assets, liabilities, expenses, annualBills, exportedAt: new Date().toISOString() };
              const blob = new Blob([JSON.stringify(d, null, 2)], { type: "application/json" });
              const url = URL.createObjectURL(blob);
              const a = document.createElement("a");
              a.href = url; a.download = `financial-backup-${new Date().toISOString().split("T")[0]}.json`; a.click();
              URL.revokeObjectURL(url);
            }} style={{ ...btnStyle("#34d399"), padding: "10px 16px", fontSize: 13 }}>⬇ Export</button>
          </div>
        </div>

        <div style={{ display: "flex", gap: 4, marginBottom: 24, background: "#111827", borderRadius: 10, padding: 4, border: "1px solid #1f2937", overflowX: "auto" }}>
          {tabs.map((t) => (
            <button key={t} onClick={() => setTab(t)} style={{
              flex: 1, padding: "8px 4px", borderRadius: 7, border: "none", cursor: "pointer", fontSize: 12,
              fontWeight: 600, textTransform: "capitalize", letterSpacing: 0.5, transition: "all 0.2s",
              background: tab === t ? "#1e2535" : "transparent",
              color: tab === t ? "#fde68a" : "#6b7280",
              fontFamily: "inherit", whiteSpace: "nowrap",
            }}>
              {t === "annual" ? "Annual" : t === "charts" ? "📊 Charts" : t === "zakat" ? "☪️ Zakat" : t.charAt(0).toUpperCase() + t.slice(1)}
            </button>
          ))}
        </div>

        {tab === "overview" && (
          <>
            <PKRRateBar rate={pkrRate} loading={pkrLoading} />
            <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 20 }}>
              <StatCard label="Net Worth" value={fmt(netWorth)} color="#fbbf24" big sub={<PKRBadge gbp={netWorth} rate={pkrRate} loading={pkrLoading} />} />
              <StatCard label="Total Assets" value={fmt(totalAssets)} color="#34d399" sub={<PKRBadge gbp={totalAssets} rate={pkrRate} loading={pkrLoading} />} />
              <StatCard label="Total Liabilities" value={fmt(totalLiabilities)} color="#f87171" sub={<PKRBadge gbp={totalLiabilities} rate={pkrRate} loading={pkrLoading} />} />
            </div>
            <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 20 }}>
              <StatCard label="Monthly Headroom" value={fmt(headroom)} sub={<PKRBadge gbp={headroom} rate={pkrRate} loading={pkrLoading} />} color={headroom >= 0 ? "#34d399" : "#f87171"} />
              <StatCard label="Ready Cash" value={fmt(readyCash)} sub={<PKRBadge gbp={readyCash} rate={pkrRate} loading={pkrLoading} />} color="#60a5fa" />
              <StatCard label="Annual Unbudgeted" value={fmt(annualUnbudgeted)} sub={<PKRBadge gbp={annualUnbudgeted} rate={pkrRate} loading={pkrLoading} />} color="#c084fc" />
            </div>
            <div style={{ background: "#111827", borderRadius: 12, padding: "18px 20px", border: "1px solid #1f2937", marginBottom: 20 }}>
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 10 }}>
                <span style={{ color: "#9ca3af", fontSize: 13, fontWeight: 600 }}>Monthly Budget Utilisation</span>
                <span style={{ color: "#fde68a", fontSize: 13, fontWeight: 700 }}>{Math.round((totalExpenses / income) * 100)}%</span>
              </div>
              <div style={{ background: "#1f2937", borderRadius: 100, height: 10, overflow: "hidden" }}>
                <div style={{ height: "100%", width: `${Math.min((totalExpenses / income) * 100, 100)}%`, background: headroom >= 0 ? "linear-gradient(90deg, #34d399, #fbbf24)" : "#ef4444", borderRadius: 100, transition: "width 0.5s ease" }} />
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", marginTop: 8, fontSize: 12, color: "#6b7280" }}>
                <span>Expenses: {fmtFull(totalExpenses)}</span>
                <span>Income: {fmtFull(income)}</span>
              </div>
            </div>
            <NetWorthTrendChart history={nwHistory} />
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              <div style={{ background: "#111827", borderRadius: 12, padding: "16px", border: "1px solid #1f2937" }}>
                <div style={{ color: "#34d399", fontSize: 13, fontWeight: 700, marginBottom: 12 }}>Top Assets</div>
                {[...assets].sort((a, b) => b.amount - a.amount).slice(0, 4).map((a) => (
                  <div key={a.id} style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
                    <span style={{ color: "#9ca3af", fontSize: 13 }}>{a.name}</span>
                    <span style={{ color: "#fde68a", fontSize: 13, fontWeight: 600 }}>{fmt(a.amount)}</span>
                  </div>
                ))}
              </div>
              <div style={{ background: "#111827", borderRadius: 12, padding: "16px", border: "1px solid #1f2937" }}>
                <div style={{ color: "#f87171", fontSize: 13, fontWeight: 700, marginBottom: 12 }}>Top Expenses</div>
                {[...expenses].sort((a, b) => b.amount - a.amount).slice(0, 4).map((e) => (
                  <div key={e.id} style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
                    <span style={{ color: "#9ca3af", fontSize: 13 }}>{e.name}</span>
                    <span style={{ color: "#fde68a", fontSize: 13, fontWeight: 600 }}>{fmt(e.amount)}</span>
                  </div>
                ))}
              </div>
            </div>
          </>
        )}

        {tab === "assets" && (
          <>
            <div style={{ display: "flex", gap: 12, marginBottom: 20, flexWrap: "wrap" }}>
              <StatCard label="Total Assets" value={fmt(totalAssets)} color="#34d399" big sub={<PKRBadge gbp={totalAssets} rate={pkrRate} loading={pkrLoading} />} />
              <StatCard label="Property" value={fmt(homeValue)} sub={<PKRBadge gbp={homeValue} rate={pkrRate} loading={pkrLoading} />} color="#60a5fa" />
              <StatCard label="Cash" value={fmt(readyCash)} sub={<PKRBadge gbp={readyCash} rate={pkrRate} loading={pkrLoading} />} color="#fbbf24" />
              <StatCard label="Investments" value={fmt(assets.filter((a) => a.name.toLowerCase().includes("vanguard") || a.name.toLowerCase().includes("global") || a.name.toLowerCase().includes("ftse")).reduce((s, a) => s + a.amount, 0))} sub={<PKRBadge gbp={assets.filter((a) => a.name.toLowerCase().includes("vanguard") || a.name.toLowerCase().includes("global") || a.name.toLowerCase().includes("ftse")).reduce((s, a) => s + a.amount, 0)} rate={pkrRate} loading={pkrLoading} />} color="#c084fc" />
            </div>
            <VanguardCard pkrRate={pkrRate} pkrLoading={pkrLoading} units={vanguardUnits} setUnits={setVanguardUnits} onSaveUnits={(n) => save({ monthlyIncome: income, assets, liabilities, expenses, annualBills, vanguardUnits: n })} />
            <SectionTable title="Assets" items={assets} setItems={setAssets}
              fields={[{ key: "name", label: "Asset" }, { key: "amount", label: "Amount (£)" }]}
              addLabel="+ Add Asset" newItem={() => ({ name: "", amount: 0 })} color="#34d399" />
          </>
        )}

        {tab === "liabilities" && (
          <>
            <div style={{ display: "flex", gap: 12, marginBottom: 20, flexWrap: "wrap" }}>
              <StatCard label="Total Liabilities" value={fmt(totalLiabilities)} color="#f87171" big sub={<PKRBadge gbp={totalLiabilities} rate={pkrRate} loading={pkrLoading} />} />
              <StatCard label="Mortgage" value={fmt(liabilities.filter((l) => l.name.toLowerCase().includes("mortgage")).reduce((s, l) => s + l.amount, 0))} sub={<PKRBadge gbp={liabilities.filter((l) => l.name.toLowerCase().includes("mortgage")).reduce((s, l) => s + l.amount, 0)} rate={pkrRate} loading={pkrLoading} />} color="#fb923c" />
              <StatCard label="Loans" value={fmt(liabilities.filter((l) => l.name.toLowerCase().includes("loan")).reduce((s, l) => s + l.amount, 0))} sub={<PKRBadge gbp={liabilities.filter((l) => l.name.toLowerCase().includes("loan")).reduce((s, l) => s + l.amount, 0)} rate={pkrRate} loading={pkrLoading} />} color="#fbbf24" />
              <StatCard label="Credit" value={fmt(liabilities.filter((l) => l.name.toLowerCase().includes("credit") || l.name.toLowerCase().includes("flex")).reduce((s, l) => s + l.amount, 0))} sub={<PKRBadge gbp={liabilities.filter((l) => l.name.toLowerCase().includes("credit") || l.name.toLowerCase().includes("flex")).reduce((s, l) => s + l.amount, 0)} rate={pkrRate} loading={pkrLoading} />} color="#f43f5e" />
            </div>
            <MortgageCard liabilities={liabilities} pkrRate={pkrRate} pkrLoading={pkrLoading} homeValue={homeValue} setHomeValue={setHomeValue} mortgageRate={mortgageRate} setMortgageRate={setMortgageRate} />
            <SectionTable title="Liabilities" items={liabilities} setItems={setLiabilities}
              fields={[{ key: "name", label: "Liability" }, { key: "amount", label: "Amount (£)" }]}
              addLabel="+ Add Liability" newItem={() => ({ name: "", amount: 0 })} color="#f87171" />
          </>
        )}

        {tab === "expenses" && (
          <>
            <div style={{ display: "flex", gap: 12, marginBottom: 20, flexWrap: "wrap" }}>
              <StatCard label="Total Monthly" value={fmt(totalExpenses)} color="#f59e0b" big sub={<PKRBadge gbp={totalExpenses} rate={pkrRate} loading={pkrLoading} />} />
              <StatCard label="Headroom" value={fmt(headroom)} color={headroom >= 0 ? "#34d399" : "#f87171"} sub={<PKRBadge gbp={headroom} rate={pkrRate} loading={pkrLoading} />} />
            </div>
            <ExpensesTable expenses={expenses} setExpenses={setExpenses} />
          </>
        )}

        {tab === "annual" && (
          <>
            <div style={{ display: "flex", gap: 12, marginBottom: 20, flexWrap: "wrap" }}>
              <StatCard label="Total Annual" value={fmt(annualBills.reduce((s, b) => s + b.amount, 0))} color="#c084fc" big sub={<PKRBadge gbp={annualBills.reduce((s, b) => s + b.amount, 0)} rate={pkrRate} loading={pkrLoading} />} />
              <StatCard label="Not In Budget" value={fmt(annualUnbudgeted)} sub={<PKRBadge gbp={annualUnbudgeted} rate={pkrRate} loading={pkrLoading} />} color="#f87171" />
            </div>
            <AnnualTable annualBills={annualBills} setAnnualBills={setAnnualBills} />
          </>
        )}

        {tab === "charts" && (
          <ChartsTab assets={assets} liabilities={liabilities} expenses={expenses}
            totalAssets={totalAssets} totalLiabilities={totalLiabilities}
            income={income} totalExpenses={totalExpenses} />
        )}

        {tab === "zakat" && (
          <ZakatTab assets={assets} pkrRate={pkrRate} pkrLoading={pkrLoading} />
        )}
      </div>
    </div>
  );
}
