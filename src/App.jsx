import { useState, useMemo, useEffect, useCallback, useRef } from "react";
import {
  PieChart, Pie, Cell, Tooltip, Legend, ResponsiveContainer,
  BarChart, Bar, XAxis, YAxis, CartesianGrid, LineChart, Line,
} from "recharts";

// ==================== CONSTANTS & HELPERS ====================

const STORAGE_KEY = "finance_dashboard_v1";
const NETWORTH_KEY = "finance_dashboard_networth_v1";

// All amounts stored in GBP. Display currency converts on the fly via live rates.
const CURRENCIES = {
  GBP: { code: "GBP", symbol: "£", label: "British Pound", locale: "en-GB", flag: "🇬🇧" },
  USD: { code: "USD", symbol: "$", label: "US Dollar",     locale: "en-US", flag: "🇺🇸" },
  NOK: { code: "NOK", symbol: "kr", label: "Norwegian Krone", locale: "nb-NO", flag: "🇳🇴" },
};

// Convert GBP-stored value → display currency for formatting
function fmtC(gbp, cur, rates, dec = 0) {
  const r = rates?.[cur] ?? 1;
  return new Intl.NumberFormat(CURRENCIES[cur]?.locale ?? "en-GB", {
    style: "currency", currency: cur, maximumFractionDigits: dec,
  }).format(gbp * r);
}
const fmtCFull = (gbp, cur, rates) => fmtC(gbp, cur, rates, 2);

// Convert display-currency input back to GBP for storage
function toGBP(displayAmt, cur, rates) {
  const r = rates?.[cur] ?? 1;
  return displayAmt / r;
}

// Legacy helpers kept for internal use (GBP only)
const fmt     = (n) => new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP", maximumFractionDigits: 0 }).format(n);
const fmtFull = (n) => new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP", maximumFractionDigits: 2 }).format(n);
const fmtPKR  = (n) => new Intl.NumberFormat("en-PK", { style: "currency", currency: "PKR", maximumFractionDigits: 0 }).format(n);

let nextId = 1000;

const COLORS_ASSETS = ["#3b82f6","#10b981","#8b5cf6","#f59e0b","#ec4899","#6366f1","#14b8a6","#f97316"];
const COLORS_LIAB   = ["#ef4444","#f97316","#eab308","#84cc16","#22d3ee"];
const COLORS_EXP    = ["#3b82f6","#6366f1","#8b5cf6","#a855f7","#ec4899","#f43f5e","#f97316","#eab308","#84cc16","#10b981","#14b8a6","#06b6d4","#0ea5e9","#3b82f6","#6366f1"];

const inputCss = {
  background: "#1e2535", border: "1px solid #fbbf24", borderRadius: 4,
  color: "#f9fafb", padding: "4px 8px", fontSize: 13, width: "100%",
  outline: "none", fontFamily: "inherit",
};
const btn = (color) => ({
  background: color + "22", border: `1px solid ${color}`, color,
  borderRadius: 4, padding: "3px 8px", cursor: "pointer",
  fontSize: 12, fontWeight: 600, fontFamily: "inherit",
});

const defaultData = () => ({
  monthlyIncome: 0,
  assets: [],
  liabilities: [],
  expenses: [],
  annualBills: [],
  homeValue: 0,
  mortgageRate: 0,
  investmentUnits: 0,
  investmentTicker: "VWRP.L",
  investmentName: "Vanguard FTSE Global All Cap",
  displayCurrency: "GBP",
});

// ==================== STORAGE ====================

function loadData() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return { ...defaultData(), ...JSON.parse(raw) };
  } catch (_) {}
  return defaultData();
}

function saveData(data) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(data)); } catch (_) {}
}

function loadNWHistory() {
  try {
    const raw = localStorage.getItem(NETWORTH_KEY);
    if (raw) return JSON.parse(raw);
  } catch (_) {}
  return [];
}

function saveNWHistory(history) {
  try { localStorage.setItem(NETWORTH_KEY, JSON.stringify(history)); } catch (_) {}
}

function snapshotNetWorth(netWorth, setHistory) {
  const today = new Date().toISOString().split("T")[0];
  const history = loadNWHistory();
  const idx = history.findIndex((h) => h.date === today);
  if (idx >= 0) history[idx].value = netWorth;
  else history.push({ date: today, value: netWorth });
  const trimmed = history.slice(-24);
  saveNWHistory(trimmed);
  setHistory(trimmed);
}

// ==================== HOOKS ====================

// Fetches GBP-base live rates for USD, NOK, PKR in a single call
function useRates() {
  const [rates, setRates] = useState({ GBP: 1, USD: null, NOK: null, PKR: null });
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    fetch("https://api.exchangerate-api.com/v4/latest/GBP")
      .then((r) => r.json())
      .then((d) => setRates({
        GBP: 1,
        USD: d.rates?.USD ?? null,
        NOK: d.rates?.NOK ?? null,
        PKR: d.rates?.PKR ?? null,
      }))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);
  return { rates, loading };
}

function useInvestmentPrice(ticker, units) {
  const [price, setPrice] = useState(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    if (!ticker) { setLoading(false); return; }
    fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${ticker}?interval=1d&range=1d`)
      .then((r) => r.json())
      .then((d) => {
        const p = d?.chart?.result?.[0]?.meta?.regularMarketPrice;
        setPrice(p ? p / 100 : null);
      })
      .catch(() => setPrice(null))
      .finally(() => setLoading(false));
  }, [ticker]);
  return { price, loading, value: price && units ? price * units : null };
}

// ==================== SMALL COMPONENTS ====================

function PKRBadge({ gbpAmount, rates, ratesLoading }) {
  if (ratesLoading) return <span style={{ color: "#6b7280", fontSize: 12 }}>Loading…</span>;
  if (!rates?.PKR || !gbpAmount) return null;
  return <span style={{ color: "#34d399", fontSize: 12, fontWeight: 600 }}>≈ {fmtPKR(gbpAmount * rates.PKR)}</span>;
}

function CurrencyRateBar({ currency, setCurrency, rates, ratesLoading }) {
  const rate = rates?.[currency];
  return (
    <div style={{ background: "#111827", border: "1px solid #1f2937", borderRadius: 10, padding: "12px 16px", display: "flex", alignItems: "center", gap: 12, marginBottom: 20, flexWrap: "wrap" }}>
      <span style={{ color: "#6b7280", fontSize: 12, textTransform: "uppercase", letterSpacing: 1 }}>Display Currency</span>
      <div style={{ display: "flex", gap: 6 }}>
        {Object.values(CURRENCIES).map((c) => (
          <button key={c.code} onClick={() => setCurrency(c.code)} style={{
            background: currency === c.code ? "#fbbf2422" : "transparent",
            border: `1px solid ${currency === c.code ? "#fbbf24" : "#374151"}`,
            color: currency === c.code ? "#fbbf24" : "#6b7280",
            borderRadius: 6, padding: "4px 10px", cursor: "pointer",
            fontSize: 12, fontWeight: 600, fontFamily: "inherit", transition: "all 0.15s",
          }}>{c.flag} {c.code}</button>
        ))}
      </div>
      <div style={{ marginLeft: "auto", textAlign: "right" }}>
        {ratesLoading ? (
          <span style={{ color: "#6b7280", fontSize: 13 }}>Fetching rates…</span>
        ) : currency === "GBP" ? (
          <span style={{ color: "#6b7280", fontSize: 12 }}>Base currency</span>
        ) : rate ? (
          <span style={{ color: "#fbbf24", fontWeight: 700, fontSize: 14 }}>1 GBP = {rate.toFixed(4)} {currency}</span>
        ) : (
          <span style={{ color: "#f87171", fontSize: 13 }}>Rate unavailable</span>
        )}
        {rates?.PKR && !ratesLoading && currency !== "GBP" && (
          <div style={{ color: "#6b7280", fontSize: 11 }}>1 GBP = {rates.PKR.toFixed(2)} PKR</div>
        )}
        {!ratesLoading && <div style={{ color: "#4b5563", fontSize: 10, marginTop: 2 }}>exchangerate-api.com · live</div>}
      </div>
    </div>
  );
}

function StatCard({ label, value, sub, color, big }) {
  return (
    <div style={{ background: "#111827", border: `1px solid ${color}44`, borderRadius: 12, padding: big ? "20px 22px" : "16px 18px", flex: 1, minWidth: 150 }}>
      <div style={{ color: "#9ca3af", fontSize: 12, fontWeight: 600, textTransform: "uppercase", letterSpacing: 1, marginBottom: 6 }}>{label}</div>
      <div style={{ color, fontSize: big ? 26 : 20, fontWeight: 800, letterSpacing: -0.5 }}>{value}</div>
      {sub && <div style={{ marginTop: 4 }}>{typeof sub === "string" ? <span style={{ color: "#6b7280", fontSize: 12 }}>{sub}</span> : sub}</div>}
    </div>
  );
}

// ==================== EDITABLE ROWS ====================

function EditableRow({ item, onUpdate, onDelete, fields, currency, rates }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState({ ...item });
  const startEdit = () => { setDraft({ ...item, amount: parseFloat(((rates[currency] ?? 1) * item.amount).toFixed(2)) }); setEditing(true); };
  const save = () => { onUpdate({ ...draft, amount: toGBP(parseFloat(draft.amount) || 0, currency, rates) }); setEditing(false); };
  if (editing) {
    return (
      <tr style={{ background: "rgba(250,204,21,0.08)" }}>
        {fields.map((f) => (
          <td key={f.key} style={{ padding: "6px 10px" }}>
            <input type={f.key === "amount" ? "number" : "text"} value={draft[f.key] ?? ""}
              onChange={(e) => setDraft({ ...draft, [f.key]: e.target.value })} style={inputCss} />
          </td>
        ))}
        <td style={{ padding: "6px 10px" }}>
          <div style={{ display: "flex", gap: 6 }}>
            <button onClick={save} style={btn("#22c55e")}>✓</button>
            <button onClick={() => setEditing(false)} style={btn("#6b7280")}>✕</button>
          </div>
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
          {f.key === "amount" ? fmtCFull(item[f.key], currency, rates) : (item[f.key] ?? "")}
        </td>
      ))}
      <td style={{ padding: "10px 10px" }}>
        <div style={{ display: "flex", gap: 6 }}>
          <button onClick={startEdit} style={btn("#3b82f6")}>✎</button>
          <button onClick={() => onDelete(item.id)} style={btn("#ef4444")}>✕</button>
        </div>
      </td>
    </tr>
  );
}

function SectionTable({ title, items, setItems, fields, addLabel, newItem, color, currency, rates }) {
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState(newItem());
  const update = (u) => setItems(items.map((i) => (i.id === u.id ? u : i)));
  const del = (id) => setItems(items.filter((i) => i.id !== id));
  const add = () => {
    setItems([...items, { ...draft, id: nextId++, amount: toGBP(parseFloat(draft.amount) || 0, currency, rates) }]);
    setDraft(newItem()); setAdding(false);
  };
  return (
    <div style={{ marginBottom: 24, background: "#111827", borderRadius: 12, overflow: "hidden", border: `1px solid ${color}33` }}>
      <div style={{ padding: "14px 16px", background: color + "18", borderBottom: `1px solid ${color}33`, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <span style={{ fontWeight: 700, color, fontSize: 15 }}>{title}</span>
        <button onClick={() => setAdding(true)} style={btn(color)}>{addLabel}</button>
      </div>
      <table style={{ width: "100%", borderCollapse: "collapse" }}>
        <thead>
          <tr style={{ background: "rgba(255,255,255,0.03)" }}>
            {fields.map((f) => (
              <th key={f.key} style={{ padding: "8px 10px", textAlign: "left", color: "#6b7280", fontSize: 12, fontWeight: 600, textTransform: "uppercase", letterSpacing: 0.8 }}>{f.key === "amount" ? `Amount (${CURRENCIES[currency]?.symbol})` : f.label}</th>
            ))}
            <th style={{ padding: "8px 10px", color: "#6b7280", fontSize: 12 }}>Actions</th>
          </tr>
        </thead>
        <tbody>
          {items.map((item) => <EditableRow key={item.id} item={item} onUpdate={update} onDelete={del} fields={fields} currency={currency} rates={rates} />)}
          {adding && (
            <tr style={{ background: "rgba(250,204,21,0.08)" }}>
              {fields.map((f) => (
                <td key={f.key} style={{ padding: "6px 10px" }}>
                  <input type={f.key === "amount" ? "number" : "text"} placeholder={f.label}
                    value={draft[f.key] ?? ""} onChange={(e) => setDraft({ ...draft, [f.key]: e.target.value })} style={inputCss} />
                </td>
              ))}
              <td style={{ padding: "6px 10px" }}>
                <div style={{ display: "flex", gap: 6 }}>
                  <button onClick={add} style={btn("#22c55e")}>Add</button>
                  <button onClick={() => setAdding(false)} style={btn("#6b7280")}>✕</button>
                </div>
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

// ==================== NET WORTH TREND ====================

function NetWorthTrendChart({ history, currency, rates }) {
  if (!history || history.length < 2) {
    return (
      <div style={{ background: "#111827", border: "1px solid #1f2937", borderRadius: 12, padding: "20px", marginBottom: 20, textAlign: "center" }}>
        <div style={{ color: "#f9fafb", fontSize: 15, fontWeight: 700, marginBottom: 8 }}>📈 Net Worth Trend</div>
        <div style={{ color: "#6b7280", fontSize: 13 }}>Trend will appear after your second visit — check back tomorrow!</div>
      </div>
    );
  }
  const rate = rates?.[currency] ?? 1;
  const displayHistory = history.map((h) => ({ ...h, dispVal: h.value * rate }));
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
            {change >= 0 ? "▲" : "▼"} {fmtCFull(Math.abs(change), currency, rates)} ({pct}%)
          </span>
          <div style={{ color: "#6b7280", fontSize: 11 }}>vs last snapshot</div>
        </div>
      </div>
      <ResponsiveContainer width="100%" height={120}>
        <LineChart data={displayHistory} margin={{ top: 5, right: 10, left: 0, bottom: 5 }}>
          <XAxis dataKey="date" tick={{ fill: "#6b7280", fontSize: 10 }} tickLine={false} axisLine={false} />
          <YAxis tick={{ fill: "#6b7280", fontSize: 10 }} tickLine={false} axisLine={false} tickFormatter={(v) => `£${(v/1000).toFixed(0)}k`} width={50} />
          <Tooltip formatter={(v) => [fmtCFull(v / rate, currency, rates), "Net Worth"]} contentStyle={{ background: "#1e2535", border: "1px solid #374151", borderRadius: 8, fontSize: 12 }} />
          <Line type="monotone" dataKey="dispVal" stroke="#fbbf24" strokeWidth={2} dot={{ fill: "#fbbf24", r: 3 }} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

// ==================== MORTGAGE CARD ====================

function MortgageCard({ liabilities, rates, ratesLoading, homeValue, setHomeValue, mortgageRate, setMortgageRate, currency }) {
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
        {[
          { label: "Balance", value: fmtC(balance, currency, rates), color: "#f87171", sub: null },
          { label: "Equity", value: fmtC(equity, currency, rates), color: equity >= 0 ? "#34d399" : "#f87171", sub: <PKRBadge gbpAmount={Math.abs(equity)} rates={rates} ratesLoading={ratesLoading} /> },
          { label: "LTV", value: `${ltv}%`, color: ltv > 80 ? "#f87171" : ltv > 60 ? "#fbbf24" : "#34d399", sub: "Loan to Value" },
        ].map(({ label, value, color, sub }) => (
          <div key={label} style={{ flex: 1, minWidth: 120, background: "#0b0f1a", borderRadius: 10, padding: "12px 14px" }}>
            <div style={{ color: "#6b7280", fontSize: 11, textTransform: "uppercase", letterSpacing: 1, marginBottom: 4 }}>{label}</div>
            <div style={{ color, fontSize: 18, fontWeight: 800 }}>{value}</div>
            {sub && <div style={{ marginTop: 4 }}>{typeof sub === "string" ? <span style={{ color: "#6b7280", fontSize: 11 }}>{sub}</span> : sub}</div>}
          </div>
        ))}
        <div style={{ flex: 1, minWidth: 120, background: "#0b0f1a", borderRadius: 10, padding: "12px 14px" }}>
          <div style={{ color: "#6b7280", fontSize: 11, textTransform: "uppercase", letterSpacing: 1, marginBottom: 4 }}>Home Value</div>
          {editingHome ? (
            <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
              <input type="number" value={homeDraft} onChange={(e) => setHomeDraft(e.target.value)}
                style={{ ...inputCss, width: 90 }} />
              <button onClick={() => { setHomeValue(toGBP(parseFloat(homeDraft) || 0, currency, rates)); setEditingHome(false); }} style={btn("#22c55e")}>✓</button>
            </div>
          ) : (
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <div style={{ color: "#34d399", fontSize: 18, fontWeight: 800 }}>{fmtC(homeValue, currency, rates)}</div>
              <button onClick={() => { setHomeDraft(((rates[currency] ?? 1) * homeValue).toFixed(0)); setEditingHome(true); }} style={btn("#3b82f6")}>✎</button>
            </div>
          )}
          <div style={{ marginTop: 4 }}><PKRBadge gbpAmount={homeValue} rates={rates} ratesLoading={ratesLoading} /></div>
        </div>
        <div style={{ flex: 1, minWidth: 120, background: "#0b0f1a", borderRadius: 10, padding: "12px 14px" }}>
          <div style={{ color: "#6b7280", fontSize: 11, textTransform: "uppercase", letterSpacing: 1, marginBottom: 4 }}>Rate %</div>
          {editingRate ? (
            <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
              <input type="number" value={rateDraft} onChange={(e) => setRateDraft(e.target.value)}
                style={{ ...inputCss, width: 70 }} step="0.01" />
              <button onClick={() => { setMortgageRate(parseFloat(rateDraft) || 0); setEditingRate(false); }} style={btn("#22c55e")}>✓</button>
            </div>
          ) : (
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <div style={{ color: "#fbbf24", fontSize: 18, fontWeight: 800 }}>{mortgageRate}%</div>
              <button onClick={() => { setRateDraft(mortgageRate.toString()); setEditingRate(true); }} style={btn("#3b82f6")}>✎</button>
            </div>
          )}
          <div style={{ color: "#6b7280", fontSize: 11, marginTop: 4 }}>≈ {fmtC(monthlyInterest, currency, rates)}/mo</div>
        </div>
      </div>
      <div style={{ background: "#0b0f1a", borderRadius: 8, overflow: "hidden", height: 8 }}>
        <div style={{ height: "100%", width: `${Math.min(ltv, 100)}%`, background: ltv > 80 ? "#ef4444" : ltv > 60 ? "#fbbf24" : "#34d399", borderRadius: 8, transition: "width 0.5s" }} />
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, color: "#6b7280", marginTop: 6 }}>
        <span>0% LTV</span>
        <span style={{ color: "#fb923c" }}>Home: {fmtC(homeValue, currency, rates)}</span>
        <span>100% LTV</span>
      </div>
    </div>
  );
}

// ==================== INVESTMENT CARD ====================

function InvestmentCard({ rates, ratesLoading, units, setUnits, ticker, setTicker, name, setName, onSave, currency }) {
  const { price, loading, value } = useInvestmentPrice(ticker, units);
  const [editingUnits, setEditingUnits] = useState(false);
  const [editingTicker, setEditingTicker] = useState(false);
  const [unitsDraft, setUnitsDraft] = useState(units.toString());
  const [tickerDraft, setTickerDraft] = useState(ticker);
  const [nameDraft, setNameDraft] = useState(name);

  // price is in GBP (VWRP.L price / 100); convert to display currency
  const displayPrice = price != null ? fmtCFull(price, currency, rates) : null;
  const displayValue = value != null ? fmtCFull(value, currency, rates) : null;

  const saveUnits = () => {
    const n = parseFloat(unitsDraft);
    if (!isNaN(n) && n >= 0) { setUnits(n); onSave(); }
    setEditingUnits(false);
  };
  const saveTicker = () => {
    setTicker(tickerDraft.trim().toUpperCase());
    setName(nameDraft.trim() || tickerDraft.trim().toUpperCase());
    setEditingTicker(false);
    onSave();
  };

  return (
    <div style={{ background: "#111827", border: "1px solid #c084fc33", borderRadius: 12, padding: "20px", marginBottom: 20 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16, flexWrap: "wrap", gap: 8 }}>
        <div style={{ color: "#c084fc", fontSize: 15, fontWeight: 700 }}>📊 {name || ticker}</div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <div style={{ background: "#c084fc22", border: "1px solid #c084fc44", borderRadius: 6, padding: "3px 8px", fontSize: 11, color: "#c084fc" }}>{ticker}</div>
          <button onClick={() => { setTickerDraft(ticker); setNameDraft(name); setEditingTicker(true); }} style={btn("#6b7280")}>✎ Change</button>
        </div>
      </div>
      {editingTicker && (
        <div style={{ background: "#0b0f1a", borderRadius: 10, padding: "14px", marginBottom: 16 }}>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 8 }}>
            <div style={{ flex: 1, minWidth: 120 }}>
              <div style={{ color: "#6b7280", fontSize: 11, marginBottom: 4 }}>Ticker (e.g. VWRP.L)</div>
              <input type="text" value={tickerDraft} onChange={(e) => setTickerDraft(e.target.value)} style={inputCss} placeholder="VWRP.L" />
            </div>
            <div style={{ flex: 2, minWidth: 180 }}>
              <div style={{ color: "#6b7280", fontSize: 11, marginBottom: 4 }}>Display Name</div>
              <input type="text" value={nameDraft} onChange={(e) => setNameDraft(e.target.value)} style={inputCss} placeholder="e.g. Vanguard Global All Cap" />
            </div>
          </div>
          <div style={{ display: "flex", gap: 6 }}>
            <button onClick={saveTicker} style={btn("#22c55e")}>Save</button>
            <button onClick={() => setEditingTicker(false)} style={btn("#6b7280")}>Cancel</button>
          </div>
        </div>
      )}
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
        <div style={{ flex: 1, minWidth: 120, background: "#0b0f1a", borderRadius: 10, padding: "12px 14px" }}>
          <div style={{ color: "#6b7280", fontSize: 11, textTransform: "uppercase", letterSpacing: 1, marginBottom: 4 }}>Live Price</div>
          <div style={{ color: "#c084fc", fontSize: 18, fontWeight: 800 }}>{loading ? "Loading…" : displayPrice ?? "N/A"}</div>
          <div style={{ color: "#6b7280", fontSize: 11, marginTop: 4 }}>per share · {currency}</div>
        </div>
        <div style={{ flex: 1, minWidth: 120, background: "#0b0f1a", borderRadius: 10, padding: "12px 14px" }}>
          <div style={{ color: "#6b7280", fontSize: 11, textTransform: "uppercase", letterSpacing: 1, marginBottom: 4 }}>Your Units</div>
          {editingUnits ? (
            <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
              <input type="number" value={unitsDraft} onChange={(e) => setUnitsDraft(e.target.value)}
                style={{ ...inputCss, width: 110 }} step="0.000001" />
              <button onClick={saveUnits} style={btn("#22c55e")}>✓</button>
              <button onClick={() => setEditingUnits(false)} style={btn("#6b7280")}>✕</button>
            </div>
          ) : (
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <div style={{ color: "#fde68a", fontSize: 18, fontWeight: 800 }}>{units > 0 ? units.toFixed(4) : "—"}</div>
              <button onClick={() => { setUnitsDraft(units.toString()); setEditingUnits(true); }} style={btn("#3b82f6")}>✎</button>
            </div>
          )}
          <div style={{ color: "#6b7280", fontSize: 11, marginTop: 4 }}>shares held</div>
        </div>
        <div style={{ flex: 1, minWidth: 120, background: "#0b0f1a", borderRadius: 10, padding: "12px 14px" }}>
          <div style={{ color: "#6b7280", fontSize: 11, textTransform: "uppercase", letterSpacing: 1, marginBottom: 4 }}>Live Value</div>
          <div style={{ color: "#34d399", fontSize: 18, fontWeight: 800 }}>{loading ? "Loading…" : displayValue ?? "N/A"}</div>
          {value && <div style={{ marginTop: 4 }}><PKRBadge gbpAmount={value} rates={rates} ratesLoading={ratesLoading} /></div>}
        </div>
      </div>
      {!loading && !price && (
        <div style={{ color: "#6b7280", fontSize: 12, marginTop: 12, textAlign: "center" }}>
          Live price unavailable — markets may be closed or ticker is incorrect.
        </div>
      )}
    </div>
  );
}

// ==================== EXPENSES TABLE ====================

function getSmartDueDate(due) {
  if (!due) return { label: "—", daysLeft: null, status: "normal" };
  if (due === "Monthly") return { label: "Monthly", daysLeft: null, status: "normal" };
  const match = due.toString().match(/\d+/);
  const day = match ? parseInt(match[0]) : null;
  if (!day) return { label: due, daysLeft: null, status: "normal" };
  const today = new Date();
  const month = today.getMonth(); const year = today.getFullYear();
  let dueDate = new Date(year, month, day);
  if (dueDate < today) dueDate = new Date(year, month + 1, day);
  const daysLeft = Math.ceil((dueDate - today) / (1000 * 60 * 60 * 24));
  const monthName = dueDate.toLocaleDateString("en-GB", { month: "short" });
  const label = `${day} ${monthName}`;
  let status = "normal";
  if (daysLeft <= 0) status = "overdue";
  else if (daysLeft <= 3) status = "urgent";
  else if (daysLeft <= 7) status = "soon";
  return { label, daysLeft, status };
}

const STATUS_COLORS = { overdue: "#f87171", urgent: "#ef4444", soon: "#fbbf24", normal: "#34d399" };
const STATUS_BG     = { overdue: "#f8717122", urgent: "#ef444422", soon: "#fbbf2422", normal: "#34d39922" };

function ExpenseRow({ item, onUpdate, onDelete, currency, rates }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState({ ...item });
  const { label, daysLeft, status } = getSmartDueDate(item.due);
  const sc = STATUS_COLORS[status]; const sb = STATUS_BG[status];
  const startEdit = () => { setDraft({ ...item, amount: parseFloat(((rates[currency] ?? 1) * item.amount).toFixed(2)) }); setEditing(true); };
  const save = () => { onUpdate({ ...draft, amount: toGBP(parseFloat(draft.amount) || 0, currency, rates) }); setEditing(false); };

  if (editing) {
    return (
      <tr style={{ background: "rgba(250,204,21,0.08)" }}>
        <td style={{ padding: "6px 10px" }}><input type="text" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} style={inputCss} /></td>
        <td style={{ padding: "6px 10px" }}><input type="number" value={draft.amount} onChange={(e) => setDraft({ ...draft, amount: e.target.value })} style={inputCss} /></td>
        <td style={{ padding: "6px 10px" }}><input type="text" value={draft.due ?? ""} onChange={(e) => setDraft({ ...draft, due: e.target.value })} style={inputCss} placeholder="e.g. 1st, 15th" /></td>
        <td style={{ padding: "6px 10px" }}>
          <div style={{ display: "flex", gap: 6 }}>
            <button onClick={save} style={btn("#22c55e")}>✓</button>
            <button onClick={() => setEditing(false)} style={btn("#6b7280")}>✕</button>
          </div>
        </td>
      </tr>
    );
  }
  return (
    <tr style={{ borderBottom: "1px solid rgba(255,255,255,0.05)" }}
      onMouseEnter={(e) => (e.currentTarget.style.background = "rgba(255,255,255,0.03)")}
      onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}>
      <td style={{ padding: "10px 10px", color: "#d1d5db", fontSize: 14 }}>{item.name}</td>
      <td style={{ padding: "10px 10px", color: "#fde68a", fontSize: 14, fontWeight: 600 }}>{fmtCFull(item.amount, currency, rates)}</td>
      <td style={{ padding: "10px 10px" }}>
        <div style={{ display: "inline-flex", flexDirection: "column", gap: 2 }}>
          <span style={{ background: sb, color: sc, border: `1px solid ${sc}44`, borderRadius: 6, padding: "2px 8px", fontSize: 12, fontWeight: 700 }}>{label}</span>
          {daysLeft !== null && <span style={{ color: sc, fontSize: 11 }}>{daysLeft === 0 ? "Today" : daysLeft < 0 ? "Overdue" : `${daysLeft}d away`}</span>}
        </div>
      </td>
      <td style={{ padding: "10px 10px" }}>
        <div style={{ display: "flex", gap: 6 }}>
          <button onClick={startEdit} style={btn("#3b82f6")}>✎</button>
          <button onClick={() => onDelete(item.id)} style={btn("#ef4444")}>✕</button>
        </div>
      </td>
    </tr>
  );
}

function ExpensesTable({ expenses, setExpenses, currency, rates }) {
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState({ name: "", amount: 0, due: "" });
  const update = (u) => setExpenses(expenses.map((i) => (i.id === u.id ? u : i)));
  const del = (id) => setExpenses(expenses.filter((i) => i.id !== id));
  const add = () => {
    setExpenses([...expenses, { ...draft, id: nextId++, amount: toGBP(parseFloat(draft.amount) || 0, currency, rates) }]);
    setDraft({ name: "", amount: 0, due: "" }); setAdding(false);
  };
  const sorted = [...expenses].sort((a, b) => {
    const da = getSmartDueDate(a.due).daysLeft ?? 999;
    const db = getSmartDueDate(b.due).daysLeft ?? 999;
    return da - db;
  });
  return (
    <div style={{ marginBottom: 24, background: "#111827", borderRadius: 12, overflow: "hidden", border: "1px solid #f59e0b33" }}>
      <div style={{ padding: "14px 16px", background: "#f59e0b18", borderBottom: "1px solid #f59e0b33", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <span style={{ fontWeight: 700, color: "#f59e0b", fontSize: 15 }}>Monthly Expenses</span>
        <button onClick={() => setAdding(true)} style={btn("#f59e0b")}>+ Add Expense</button>
      </div>
      <table style={{ width: "100%", borderCollapse: "collapse" }}>
        <thead>
          <tr style={{ background: "rgba(255,255,255,0.03)" }}>
            {["Expense","Amount","Due","Actions"].map((h) => (
              <th key={h} style={{ padding: "8px 10px", textAlign: "left", color: "#6b7280", fontSize: 12, fontWeight: 600, textTransform: "uppercase", letterSpacing: 0.8 }}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sorted.map((item) => <ExpenseRow key={item.id} item={item} onUpdate={update} onDelete={del} currency={currency} rates={rates} />)}
          {adding && (
            <tr style={{ background: "rgba(250,204,21,0.08)" }}>
              <td style={{ padding: "6px 10px" }}><input type="text" placeholder="Expense name" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} style={inputCss} /></td>
              <td style={{ padding: "6px 10px" }}><input type="number" placeholder="Amount" value={draft.amount} onChange={(e) => setDraft({ ...draft, amount: e.target.value })} style={inputCss} /></td>
              <td style={{ padding: "6px 10px" }}><input type="text" placeholder="e.g. 1st, 15th" value={draft.due} onChange={(e) => setDraft({ ...draft, due: e.target.value })} style={inputCss} /></td>
              <td style={{ padding: "6px 10px" }}>
                <div style={{ display: "flex", gap: 6 }}>
                  <button onClick={add} style={btn("#22c55e")}>Add</button>
                  <button onClick={() => setAdding(false)} style={btn("#6b7280")}>✕</button>
                </div>
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

// ==================== ANNUAL BILLS TABLE ====================

function AnnualBillRow({ item, onUpdate, onDelete, currency, rates }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState({ ...item });
  const startEditBill = () => { setDraft({ ...item, amount: parseFloat(((rates[currency] ?? 1) * item.amount).toFixed(2)) }); setEditing(true); };
  const save = () => { onUpdate({ ...draft, amount: toGBP(parseFloat(draft.amount) || 0, currency, rates) }); setEditing(false); };

  if (editing) {
    return (
      <tr style={{ background: "rgba(250,204,21,0.08)" }}>
        <td style={{ padding: "6px 10px" }}><input type="text" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} style={inputCss} /></td>
        <td style={{ padding: "6px 10px" }}><input type="number" value={draft.amount} onChange={(e) => setDraft({ ...draft, amount: e.target.value })} style={inputCss} /></td>
        <td style={{ padding: "6px 10px" }}><input type="text" value={draft.month ?? ""} onChange={(e) => setDraft({ ...draft, month: e.target.value })} style={inputCss} placeholder="e.g. Jan" /></td>
        <td style={{ padding: "6px 10px", textAlign: "center" }}>
          <input type="checkbox" checked={draft.inBudget ?? false} onChange={(e) => setDraft({ ...draft, inBudget: e.target.checked })} />
        </td>
        <td style={{ padding: "6px 10px" }}>
          <div style={{ display: "flex", gap: 6 }}>
            <button onClick={save} style={btn("#22c55e")}>✓</button>
            <button onClick={() => setEditing(false)} style={btn("#6b7280")}>✕</button>
          </div>
        </td>
      </tr>
    );
  }
  return (
    <tr style={{ borderBottom: "1px solid rgba(255,255,255,0.05)" }}
      onMouseEnter={(e) => (e.currentTarget.style.background = "rgba(255,255,255,0.03)")}
      onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}>
      <td style={{ padding: "10px 10px", color: "#d1d5db", fontSize: 14 }}>{item.name}</td>
      <td style={{ padding: "10px 10px", color: "#fde68a", fontSize: 14, fontWeight: 600 }}>{fmtCFull(item.amount, currency, rates)}</td>
      <td style={{ padding: "10px 10px", color: "#9ca3af", fontSize: 13 }}>{item.month || "—"}</td>
      <td style={{ padding: "10px 10px", textAlign: "center" }}>
        <span style={{ color: item.inBudget ? "#34d399" : "#f87171", fontSize: 12, fontWeight: 700 }}>{item.inBudget ? "✓ Yes" : "✕ No"}</span>
      </td>
      <td style={{ padding: "10px 10px" }}>
        <div style={{ display: "flex", gap: 6 }}>
          <button onClick={startEditBill} style={btn("#3b82f6")}>✎</button>
          <button onClick={() => onDelete(item.id)} style={btn("#ef4444")}>✕</button>
        </div>
      </td>
    </tr>
  );
}

function AnnualTable({ annualBills, setAnnualBills, currency, rates }) {
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState({ name: "", amount: 0, month: "", inBudget: false });
  const update = (u) => setAnnualBills(annualBills.map((i) => (i.id === u.id ? u : i)));
  const del = (id) => setAnnualBills(annualBills.filter((i) => i.id !== id));
  const add = () => {
    setAnnualBills([...annualBills, { ...draft, id: nextId++, amount: toGBP(parseFloat(draft.amount) || 0, currency, rates) }]);
    setDraft({ name: "", amount: 0, month: "", inBudget: false }); setAdding(false);
  };
  return (
    <div style={{ marginBottom: 24, background: "#111827", borderRadius: 12, overflow: "hidden", border: "1px solid #c084fc33" }}>
      <div style={{ padding: "14px 16px", background: "#c084fc18", borderBottom: "1px solid #c084fc33", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <span style={{ fontWeight: 700, color: "#c084fc", fontSize: 15 }}>Annual Bills</span>
        <button onClick={() => setAdding(true)} style={btn("#c084fc")}>+ Add Bill</button>
      </div>
      <table style={{ width: "100%", borderCollapse: "collapse" }}>
        <thead>
          <tr style={{ background: "rgba(255,255,255,0.03)" }}>
            {["Bill","Amount","Month","In Budget","Actions"].map((h) => (
              <th key={h} style={{ padding: "8px 10px", textAlign: "left", color: "#6b7280", fontSize: 12, fontWeight: 600, textTransform: "uppercase", letterSpacing: 0.8 }}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {annualBills.map((item) => <AnnualBillRow key={item.id} item={item} onUpdate={update} onDelete={del} currency={currency} rates={rates} />)}
          {adding && (
            <tr style={{ background: "rgba(250,204,21,0.08)" }}>
              <td style={{ padding: "6px 10px" }}><input type="text" placeholder="Bill name" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} style={inputCss} /></td>
              <td style={{ padding: "6px 10px" }}><input type="number" placeholder="Amount" value={draft.amount} onChange={(e) => setDraft({ ...draft, amount: e.target.value })} style={inputCss} /></td>
              <td style={{ padding: "6px 10px" }}><input type="text" placeholder="Month" value={draft.month} onChange={(e) => setDraft({ ...draft, month: e.target.value })} style={inputCss} /></td>
              <td style={{ padding: "6px 10px", textAlign: "center" }}>
                <input type="checkbox" checked={draft.inBudget} onChange={(e) => setDraft({ ...draft, inBudget: e.target.checked })} />
              </td>
              <td style={{ padding: "6px 10px" }}>
                <div style={{ display: "flex", gap: 6 }}>
                  <button onClick={add} style={btn("#22c55e")}>Add</button>
                  <button onClick={() => setAdding(false)} style={btn("#6b7280")}>✕</button>
                </div>
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

// ==================== CHARTS TAB ====================

const CustomTooltip = ({ active, payload }) => {
  if (active && payload && payload.length) {
    return (
      <div style={{ background: "#1e2535", border: "1px solid #374151", borderRadius: 8, padding: "8px 12px" }}>
        <div style={{ color: "#f9fafb", fontSize: 13, fontWeight: 600 }}>{payload[0].name}</div>
        <div style={{ color: "#fde68a", fontSize: 13 }}>{fmtCFull(payload[0].value, currency, rates)}</div>
        {payload[0].payload?.pct && <div style={{ color: "#9ca3af", fontSize: 12 }}>{payload[0].payload.pct}%</div>}
      </div>
    );
  }
  return null;
};

const RADIAN = Math.PI / 180;
function PieLabel({ cx, cy, midAngle, innerRadius, outerRadius, percent }) {
  if (percent < 0.05) return null;
  const radius = innerRadius + (outerRadius - innerRadius) * 0.5;
  const x = cx + radius * Math.cos(-midAngle * RADIAN);
  const y = cy + radius * Math.sin(-midAngle * RADIAN);
  return <text x={x} y={y} fill="white" textAnchor="middle" dominantBaseline="central" fontSize={11} fontWeight={700}>{`${(percent * 100).toFixed(0)}%`}</text>;
}

function ChartsTab({ assets, liabilities, expenses, totalAssets, totalLiabilities, income, totalExpenses, currency, rates }) {
  const netWorthData = [{ name: "Assets", value: totalAssets }, { name: "Liabilities", value: totalLiabilities }];
  const budgetData = [{ name: "Expenses", value: totalExpenses }, { name: "Headroom", value: Math.max(income - totalExpenses, 0) }];
  const expensesBarData = [...expenses].sort((a, b) => b.amount - a.amount).map((e) => ({
    name: e.name.length > 22 ? e.name.substring(0, 22) + "…" : e.name,
    amount: e.amount,
    pct: totalExpenses > 0 ? ((e.amount / totalExpenses) * 100).toFixed(1) : "0",
  }));
  const assetsWithPct = assets.map((a) => ({ name: a.name, value: a.amount, pct: totalAssets > 0 ? ((a.amount / totalAssets) * 100).toFixed(1) : "0" }));
  const liabWithPct = liabilities.map((l) => ({ name: l.name, value: l.amount, pct: totalLiabilities > 0 ? ((l.amount / totalLiabilities) * 100).toFixed(1) : "0" }));

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
          <div style={{ color: "#fde68a", fontSize: 13 }}>{fmtCFull(payload[0].value, currency, rates)}</div>
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
      {liabWithPct.length > 0 && chartBox("Liabilities Breakdown",
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
      {expensesBarData.length > 0 && chartBox("Monthly Expenses",
        <ResponsiveContainer width="100%" height={Math.max(200, expensesBarData.length * 38 + 60)}>
          <BarChart data={expensesBarData} layout="vertical" margin={{ left: 10, right: 60 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" />
            <XAxis type="number" tick={{ fill: "#6b7280", fontSize: 11 }} tickFormatter={(v) => `${CURRENCIES[currency]?.symbol ?? ""}${Math.round(v * (rates[currency] ?? 1))}`} />
            <YAxis type="category" dataKey="name" tick={{ fill: "#9ca3af", fontSize: 11 }} width={150} />
            <Tooltip content={<BarTooltip />} />
            <Bar dataKey="amount" radius={[0, 4, 4, 0]}>
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
  const parts = {};
  new Intl.DateTimeFormat("en-TN-u-ca-islamic-umalqura", { day: "numeric", month: "numeric", year: "numeric" })
    .formatToParts(date).forEach((p) => { parts[p.type] = parseInt(p.value); });
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

function getMoonPhase() {
  const now = new Date();
  const knownNew = new Date("2000-01-06T18:14:00Z");
  const synodic = 29.53058867;
  const elapsed = (now - knownNew) / (1000 * 60 * 60 * 24);
  const phase = ((elapsed % synodic) + synodic) % synodic;
  const dayPhase = Math.round(phase);
  const emojis = ["🌑","🌒","🌒","🌓","🌓","🌔","🌔","🌕","🌕","🌕","🌕","🌖","🌖","🌗","🌗","🌘","🌘","🌑","🌑","🌑","🌑","🌑","🌒","🌒","🌓","🌔","🌔","🌕","🌔","🌔"];
  return { emoji: emojis[dayPhase] || "🌙", phase: dayPhase, name: dayPhase < 7 ? "Waxing" : dayPhase < 15 ? "Gibbous" : dayPhase < 22 ? "Waning" : "New" };
}

function ZakatTab({ assets, rates, ratesLoading, currency }) {
  const hijriToday = getHijriDate();
  const moon = getMoonPhase();
  const [zakatMonth, setZakatMonth] = useState(8);
  const [zakatDay, setZakatDay] = useState(15);
  const nextZakatDate = getNextHijriDate(zakatMonth, zakatDay);
  const days = nextZakatDate ? daysUntil(new Date(nextZakatDate)) : null;
  const isZakatDay = hijriToday.month === zakatMonth && hijriToday.day === zakatDay;
  const [pkrAccountInput, setPkrAccountInput] = useState("");
  const pkrAccountGBP = rates?.PKR && pkrAccountInput ? parseFloat(pkrAccountInput) / rates.PKR : 0;

  const cashAccounts = assets.filter((a) => {
    const n = a.name.toLowerCase();
    return n.includes("account") || n.includes("current") || n.includes("saving");
  });
  const investments = assets.filter((a) => {
    const n = a.name.toLowerCase();
    return n.includes("vanguard") || n.includes("ftse") || n.includes("global") || n.includes("invest");
  });

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
      {box(<div style={{ textAlign: "center" }}>
        <div style={{ fontSize: 48, marginBottom: 4 }}>{moon.emoji}</div>
        <div style={{ color: "#6b7280", fontSize: 12, marginBottom: 12 }}>{moon.name} · Day {moon.phase} of lunar cycle</div>
        <div style={{ fontSize: 22, fontWeight: 800, color: "#f9fafb", marginBottom: 4 }}>☪️ Zakat Calculator</div>
        <div style={{ color: "#6b7280", fontSize: 13 }}>Zakat calculated in GBP · displayed in {CURRENCIES[currency]?.flag} {currency}</div>
      </div>)}

      {box(<div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
        <div style={{ flex: 1, minWidth: 130, background: "#0b0f1a", borderRadius: 10, padding: "14px 16px", textAlign: "center" }}>
          <div style={{ color: "#6b7280", fontSize: 11, textTransform: "uppercase", letterSpacing: 1, marginBottom: 6 }}>Today (Hijri)</div>
          <div style={{ color: "#fde68a", fontSize: 18, fontWeight: 700 }}>{hijriToday.day}/{hijriToday.month}/{hijriToday.year} AH</div>
          <div style={{ color: "#6b7280", fontSize: 11, marginTop: 4 }}>{HIJRI_MONTHS[hijriToday.month] || ""}</div>
        </div>
        <div style={{ flex: 1, minWidth: 130, background: "#0b0f1a", borderRadius: 10, padding: "14px 16px", textAlign: "center" }}>
          <div style={{ color: "#6b7280", fontSize: 11, textTransform: "uppercase", letterSpacing: 1, marginBottom: 8 }}>My Zakat Date</div>
          <div style={{ display: "flex", gap: 6, justifyContent: "center", flexWrap: "wrap", marginBottom: 8 }}>
            <select value={zakatMonth} onChange={(e) => setZakatMonth(parseInt(e.target.value))}
              style={{ background: "#1e2535", border: "1px solid #fbbf24", borderRadius: 6, color: "#fde68a", padding: "4px 6px", fontSize: 12, fontFamily: "inherit", cursor: "pointer" }}>
              {HIJRI_MONTHS.slice(1).map((m, i) => <option key={i+1} value={i+1}>{m}</option>)}
            </select>
            <select value={zakatDay} onChange={(e) => setZakatDay(parseInt(e.target.value))}
              style={{ background: "#1e2535", border: "1px solid #fbbf24", borderRadius: 6, color: "#fde68a", padding: "4px 6px", fontSize: 12, fontFamily: "inherit", cursor: "pointer", width: 60 }}>
              {Array.from({length: 30}, (_, i) => i + 1).map(d => <option key={d} value={d}>{d}</option>)}
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
        <div style={{ flex: 1, minWidth: 130, background: "#0b0f1a", borderRadius: 10, padding: "14px 16px", textAlign: "center" }}>
          <div style={{ color: "#6b7280", fontSize: 11, textTransform: "uppercase", letterSpacing: 1, marginBottom: 6 }}>Nisab</div>
          <div style={{ color: aboveNisab ? "#34d399" : "#f87171", fontSize: 18, fontWeight: 700 }}>{aboveNisab ? "✓ Above" : "✕ Below"}</div>
          <div style={{ color: "#6b7280", fontSize: 11, marginTop: 4 }}>~{fmtCFull(nisab, currency, rates)} (85g gold)</div>
        </div>
      </div>)}

      {box(<>
        <div style={{ color: "#f9fafb", fontSize: 15, fontWeight: 700, marginBottom: 16 }}>Zakatable Assets</div>
        <div style={{ color: "#60a5fa", fontSize: 12, fontWeight: 600, textTransform: "uppercase", letterSpacing: 1, marginBottom: 8 }}>Cash Accounts</div>
        {cashAccounts.map((a) => (
          <div key={a.id} style={{ display: "flex", justifyContent: "space-between", marginBottom: 8, padding: "8px 12px", background: "#0b0f1a", borderRadius: 8 }}>
            <span style={{ color: "#9ca3af", fontSize: 13 }}>{a.name}</span>
            <span style={{ color: "#fde68a", fontSize: 13, fontWeight: 600 }}>{fmtCFull(a.amount, currency, rates)}</span>
          </div>
        ))}
        {cashAccounts.length === 0 && <div style={{ color: "#6b7280", fontSize: 13, marginBottom: 12 }}>No cash accounts found — add assets with "account" or "savings" in the name.</div>}

        <div style={{ color: "#c084fc", fontSize: 12, fontWeight: 600, textTransform: "uppercase", letterSpacing: 1, marginBottom: 8, marginTop: 14 }}>Investments</div>
        {investments.map((a) => (
          <div key={a.id} style={{ display: "flex", justifyContent: "space-between", marginBottom: 8, padding: "8px 12px", background: "#0b0f1a", borderRadius: 8 }}>
            <span style={{ color: "#9ca3af", fontSize: 13 }}>{a.name}</span>
            <span style={{ color: "#fde68a", fontSize: 13, fontWeight: 600 }}>{fmtCFull(a.amount, currency, rates)}</span>
          </div>
        ))}
        {investments.length === 0 && <div style={{ color: "#6b7280", fontSize: 13, marginBottom: 12 }}>No investments found — add assets with "invest", "vanguard", or "global" in the name.</div>}

        <div style={{ color: "#34d399", fontSize: 12, fontWeight: 600, textTransform: "uppercase", letterSpacing: 1, marginBottom: 8, marginTop: 14 }}>🇵🇰 Pakistani Bank Account (PKR)</div>
        <div style={{ background: "#0b0f1a", borderRadius: 8, padding: "12px 14px", marginBottom: 8 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            <span style={{ color: "#9ca3af", fontSize: 13 }}>₨</span>
            <input type="number" placeholder="Enter amount in PKR" value={pkrAccountInput}
              onChange={(e) => setPkrAccountInput(e.target.value)} style={{ ...inputCss, flex: 1, minWidth: 140 }} />
            {pkrAccountGBP > 0 && <span style={{ color: "#34d399", fontSize: 13, fontWeight: 700 }}>= {fmtCFull(pkrAccountGBP, currency, rates)}</span>}
          </div>
          {rates?.PKR && <div style={{ color: "#6b7280", fontSize: 11, marginTop: 6 }}>Rate: 1 GBP = {rates.PKR.toFixed(2)} PKR</div>}
        </div>

        <div style={{ borderTop: "1px solid #1f2937", marginTop: 16, paddingTop: 16 }}>
          <div style={{ display: "flex", justifyContent: "space-between", borderTop: "1px solid #374151", paddingTop: 10, marginTop: 6 }}>
            <span style={{ color: "#f9fafb", fontSize: 14, fontWeight: 700 }}>Total Zakatable</span>
            <span style={{ color: "#34d399", fontSize: 14, fontWeight: 700 }}>{fmtCFull(totalZakatable, currency, rates)}</span>
          </div>
        </div>
      </>)}

      {box(<div style={{ textAlign: "center" }}>
        <div style={{ color: "#9ca3af", fontSize: 13, marginBottom: 8 }}>Zakat Due (2.5%)</div>
        <div style={{ color: aboveNisab ? "#fbbf24" : "#6b7280", fontSize: 42, fontWeight: 800, letterSpacing: -1 }}>{fmtCFull(zakatDue, currency, rates)}</div>
        <div style={{ marginTop: 8 }}><PKRBadge gbpAmount={zakatDue} rates={rates} ratesLoading={ratesLoading} /></div>
        {!aboveNisab && <div style={{ color: "#f87171", fontSize: 13, marginTop: 8 }}>⚠ Below Nisab threshold</div>}
        <div style={{ color: "#6b7280", fontSize: 12, marginTop: 12 }}>Property and liabilities excluded. Consult a scholar for personalised guidance.</div>
      </div>, { border: "1px solid #fbbf2444" })}
    </div>
  );
}

// ==================== MAIN APP ====================

const TABS = ["overview", "assets", "liabilities", "expenses", "annual", "charts", "zakat"];

export default function App() {
  const [income, setIncome] = useState(0);
  const [editingIncome, setEditingIncome] = useState(false);
  const [incomeDraft, setIncomeDraft] = useState("");
  const [assets, setAssets] = useState([]);
  const [liabilities, setLiabilities] = useState([]);
  const [expenses, setExpenses] = useState([]);
  const [annualBills, setAnnualBills] = useState([]);
  const [homeValue, setHomeValueState] = useState(0);
  const [mortgageRate, setMortgageRateState] = useState(0);
  const [investmentUnits, setInvestmentUnits] = useState(0);
  const [investmentTicker, setInvestmentTicker] = useState("VWRP.L");
  const [investmentName, setInvestmentName] = useState("Vanguard FTSE Global All Cap");
  const [tab, setTab] = useState("overview");
  const [nwHistory, setNwHistory] = useState([]);
  const [initialised, setInitialised] = useState(false);

  const { rates, loading: ratesLoading } = useRates();
  const [displayCurrency, setDisplayCurrencyState] = useState("GBP");

  useEffect(() => {
    const d = loadData();
    setIncome(d.monthlyIncome);
    setAssets(d.assets);
    setLiabilities(d.liabilities);
    setExpenses(d.expenses);
    setAnnualBills(d.annualBills);
    setHomeValueState(d.homeValue || 0);
    setMortgageRateState(d.mortgageRate || 0);
    setInvestmentUnits(d.investmentUnits || 0);
    setInvestmentTicker(d.investmentTicker || "VWRP.L");
    setInvestmentName(d.investmentName || "Vanguard FTSE Global All Cap");
    setDisplayCurrencyState(d.displayCurrency || "GBP");
    setNwHistory(loadNWHistory());
    setInitialised(true);
  }, []);

  const persist = useCallback(() => {
    if (!initialised) return;
    saveData({ monthlyIncome: income, assets, liabilities, expenses, annualBills, homeValue, mortgageRate, investmentUnits, investmentTicker, investmentName, displayCurrency });
  }, [initialised, income, assets, liabilities, expenses, annualBills, homeValue, mortgageRate, investmentUnits, investmentTicker, investmentName, displayCurrency]);

  useEffect(() => { if (initialised) persist(); }, [income, assets, liabilities, expenses, annualBills, homeValue, mortgageRate, investmentUnits, investmentTicker, investmentName, displayCurrency, initialised]);

  const setDisplayCurrency = (c) => {
    setDisplayCurrencyState(c);
  };

  const totalAssets = useMemo(() => assets.reduce((s, a) => s + a.amount, 0), [assets]);
  const totalLiabilities = useMemo(() => liabilities.reduce((s, a) => s + a.amount, 0), [liabilities]);
  const netWorth = totalAssets - totalLiabilities;
  const totalExpenses = useMemo(() => expenses.reduce((s, a) => s + a.amount, 0), [expenses]);
  const headroom = income - totalExpenses;
  const readyCash = assets.filter((a) => { const n = a.name.toLowerCase(); return n.includes("account") || n.includes("current") || n.includes("saving"); }).reduce((s, a) => s + a.amount, 0);
  const annualUnbudgeted = annualBills.filter((b) => !b.inBudget).reduce((s, b) => s + b.amount, 0);

  useEffect(() => {
    if (!initialised || totalAssets === 0) return;
    snapshotNetWorth(netWorth, setNwHistory);
  }, [initialised]);

  const setHomeValue = (val) => {
    setHomeValueState(val);
    setAssets((prev) => prev.map((a) => (a.name.toLowerCase().includes("home") || a.name.toLowerCase().includes("property")) ? { ...a, amount: val } : a));
  };
  const setMortgageRate = (val) => setMortgageRateState(val);

  const exportData = () => {
    const d = { monthlyIncome: income, assets, liabilities, expenses, annualBills, homeValue, mortgageRate, investmentUnits, investmentTicker, investmentName, displayCurrency, exportedAt: new Date().toISOString() };
    const blob = new Blob([JSON.stringify(d, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `finance-backup-${new Date().toISOString().split("T")[0]}.json`; a.click();
    URL.revokeObjectURL(url);
  };

  const importData = (e) => {
    const file = e.target.files[0]; if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const d = JSON.parse(ev.target.result);
        if (d.monthlyIncome !== undefined) setIncome(d.monthlyIncome);
        if (d.assets) setAssets(d.assets);
        if (d.liabilities) setLiabilities(d.liabilities);
        if (d.expenses) setExpenses(d.expenses);
        if (d.annualBills) setAnnualBills(d.annualBills);
        if (d.homeValue !== undefined) setHomeValueState(d.homeValue);
        if (d.mortgageRate !== undefined) setMortgageRateState(d.mortgageRate);
        if (d.investmentUnits !== undefined) setInvestmentUnits(d.investmentUnits);
        if (d.investmentTicker) setInvestmentTicker(d.investmentTicker);
        if (d.investmentName) setInvestmentName(d.investmentName);
        if (d.displayCurrency) setDisplayCurrencyState(d.displayCurrency);
        alert("✅ Data restored successfully!");
      } catch (_) { alert("❌ Invalid backup file."); }
    };
    reader.readAsText(file);
    e.target.value = "";
  };

  const tabLabel = (t) => {
    if (t === "annual") return "Annual";
    if (t === "charts") return "📊 Charts";
    if (t === "zakat") return "☪️ Zakat";
    return t.charAt(0).toUpperCase() + t.slice(1);
  };

  return (
    <div style={{ background: "#0b0f1a", minHeight: "100vh", fontFamily: "'DM Mono', 'Courier New', monospace", color: "#f9fafb", padding: "24px 16px" }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=DM+Mono:wght@300;400;500&family=Syne:wght@700;800&display=swap');
        * { box-sizing: border-box; }
        input:focus { outline: 1px solid #fbbf24 !important; }
        select:focus { outline: 1px solid #fbbf24 !important; }
        ::-webkit-scrollbar { width: 4px; }
        ::-webkit-scrollbar-track { background: #0b0f1a; }
        ::-webkit-scrollbar-thumb { background: #374151; border-radius: 4px; }
      `}</style>

      <div style={{ maxWidth: 860, margin: "0 auto" }}>
        {/* HEADER */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 28, flexWrap: "wrap", gap: 12 }}>
          <div>
            <div style={{ fontFamily: "'Syne', sans-serif", fontSize: 26, fontWeight: 800, color: "#f9fafb", letterSpacing: -0.5 }}>Financial Profile</div>
            <div style={{ color: "#6b7280", fontSize: 12, marginTop: 2 }}>Data saved locally · All figures in {CURRENCIES[displayCurrency]?.flag} {displayCurrency}</div>
          </div>
          <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, background: "#111827", border: "1px solid #1f2937", borderRadius: 10, padding: "10px 16px" }}>
              <span style={{ color: "#6b7280", fontSize: 12, textTransform: "uppercase", letterSpacing: 1 }}>Monthly Income</span>
              {editingIncome ? (
                <>
                  <input type="number" value={incomeDraft} onChange={(e) => setIncomeDraft(e.target.value)} style={{ ...inputCss, width: 100 }} />
                  <button onClick={() => { setIncome(toGBP(parseFloat(incomeDraft) || 0, displayCurrency, rates) || income); setEditingIncome(false); }} style={btn("#22c55e")}>✓</button>
                </>
              ) : (
                <>
                  <span style={{ color: "#34d399", fontWeight: 700, fontSize: 18 }}>{fmtCFull(income, displayCurrency, rates)}</span>
                  <button onClick={() => { setIncomeDraft(((rates[displayCurrency] ?? 1) * income).toFixed(2)); setEditingIncome(true); }} style={btn("#3b82f6")}>✎</button>
                </>
              )}
            </div>
            <button onClick={exportData} style={{ ...btn("#34d399"), padding: "10px 16px", fontSize: 13 }}>⬇ Export</button>
            <label style={{ background: "#60a5fa22", border: "1px solid #60a5fa", color: "#60a5fa", borderRadius: 4, padding: "10px 16px", fontSize: 13, fontWeight: 600, cursor: "pointer", fontFamily: "inherit", display: "inline-flex", alignItems: "center" }}>
              ⬆ Import
              <input type="file" accept=".json" style={{ display: "none" }} onChange={importData} />
            </label>
          </div>
        </div>

        {/* TABS */}
        <div style={{ display: "flex", gap: 4, marginBottom: 24, background: "#111827", borderRadius: 10, padding: 4, border: "1px solid #1f2937", overflowX: "auto" }}>
          {TABS.map((t) => (
            <button key={t} onClick={() => setTab(t)} style={{
              flex: 1, padding: "8px 4px", borderRadius: 7, border: "none", cursor: "pointer", fontSize: 12,
              fontWeight: 600, textTransform: "capitalize", letterSpacing: 0.5, transition: "all 0.2s",
              background: tab === t ? "#1e2535" : "transparent",
              color: tab === t ? "#fde68a" : "#6b7280",
              fontFamily: "inherit", whiteSpace: "nowrap",
            }}>{tabLabel(t)}</button>
          ))}
        </div>

        {/* OVERVIEW */}
        {tab === "overview" && (
          <>
            <CurrencyRateBar currency={displayCurrency} setCurrency={setDisplayCurrency} rates={rates} ratesLoading={ratesLoading} />
            <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 20 }}>
              <StatCard label="Net Worth" value={fmtC(netWorth, displayCurrency, rates)} color="#fbbf24" big sub={<PKRBadge gbpAmount={netWorth} rates={rates} ratesLoading={ratesLoading} />} />
              <StatCard label="Total Assets" value={fmtC(totalAssets, displayCurrency, rates)} color="#34d399" sub={<PKRBadge gbpAmount={totalAssets} rates={rates} ratesLoading={ratesLoading} />} />
              <StatCard label="Total Liabilities" value={fmtC(totalLiabilities, displayCurrency, rates)} color="#f87171" sub={<PKRBadge gbpAmount={totalLiabilities} rates={rates} ratesLoading={ratesLoading} />} />
            </div>
            <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 20 }}>
              <StatCard label="Monthly Headroom" value={fmtC(headroom, displayCurrency, rates)} sub={<PKRBadge gbpAmount={Math.abs(headroom)} rates={rates} ratesLoading={ratesLoading} />} color={headroom >= 0 ? "#34d399" : "#f87171"} />
              <StatCard label="Ready Cash" value={fmtC(readyCash, displayCurrency, rates)} sub={<PKRBadge gbpAmount={readyCash} rates={rates} ratesLoading={ratesLoading} />} color="#60a5fa" />
              <StatCard label="Annual Unbudgeted" value={fmtC(annualUnbudgeted, displayCurrency, rates)} sub={<PKRBadge gbpAmount={annualUnbudgeted} rates={rates} ratesLoading={ratesLoading} />} color="#c084fc" />
            </div>
            <div style={{ background: "#111827", borderRadius: 12, padding: "18px 20px", border: "1px solid #1f2937", marginBottom: 20 }}>
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 10 }}>
                <span style={{ color: "#9ca3af", fontSize: 13, fontWeight: 600 }}>Monthly Budget Utilisation</span>
                <span style={{ color: "#fde68a", fontSize: 13, fontWeight: 700 }}>{income > 0 ? Math.round((totalExpenses / income) * 100) : 0}%</span>
              </div>
              <div style={{ background: "#1f2937", borderRadius: 100, height: 10, overflow: "hidden" }}>
                <div style={{ height: "100%", width: `${income > 0 ? Math.min((totalExpenses / income) * 100, 100) : 0}%`, background: headroom >= 0 ? "linear-gradient(90deg, #34d399, #fbbf24)" : "#ef4444", borderRadius: 100, transition: "width 0.5s ease" }} />
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", marginTop: 8, fontSize: 12, color: "#6b7280" }}>
                <span>Expenses: {fmtCFull(totalExpenses, displayCurrency, rates)}</span>
                <span>Income: {fmtCFull(income, displayCurrency, rates)}</span>
              </div>
            </div>
            <NetWorthTrendChart history={nwHistory} currency={displayCurrency} rates={rates} />
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              <div style={{ background: "#111827", borderRadius: 12, padding: "16px", border: "1px solid #1f2937" }}>
                <div style={{ color: "#34d399", fontSize: 13, fontWeight: 700, marginBottom: 12 }}>Top Assets</div>
                {[...assets].sort((a, b) => b.amount - a.amount).slice(0, 5).map((a) => (
                  <div key={a.id} style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
                    <span style={{ color: "#9ca3af", fontSize: 13 }}>{a.name}</span>
                    <span style={{ color: "#fde68a", fontSize: 13, fontWeight: 600 }}>{fmtC(a.amount, displayCurrency, rates)}</span>
                  </div>
                ))}
                {assets.length === 0 && <div style={{ color: "#6b7280", fontSize: 13 }}>No assets yet</div>}
              </div>
              <div style={{ background: "#111827", borderRadius: 12, padding: "16px", border: "1px solid #1f2937" }}>
                <div style={{ color: "#f87171", fontSize: 13, fontWeight: 700, marginBottom: 12 }}>Top Expenses</div>
                {[...expenses].sort((a, b) => b.amount - a.amount).slice(0, 5).map((e) => (
                  <div key={e.id} style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
                    <span style={{ color: "#9ca3af", fontSize: 13 }}>{e.name}</span>
                    <span style={{ color: "#fde68a", fontSize: 13, fontWeight: 600 }}>{fmtC(e.amount, displayCurrency, rates)}</span>
                  </div>
                ))}
                {expenses.length === 0 && <div style={{ color: "#6b7280", fontSize: 13 }}>No expenses yet</div>}
              </div>
            </div>
          </>
        )}

        {/* ASSETS */}
        {tab === "assets" && (
          <>
            <div style={{ display: "flex", gap: 12, marginBottom: 20, flexWrap: "wrap" }}>
              <StatCard label="Total Assets" value={fmtC(totalAssets, displayCurrency, rates)} color="#34d399" big sub={<PKRBadge gbpAmount={totalAssets} rates={rates} ratesLoading={ratesLoading} />} />
              <StatCard label="Cash" value={fmtC(readyCash, displayCurrency, rates)} sub={<PKRBadge gbpAmount={readyCash} rates={rates} ratesLoading={ratesLoading} />} color="#fbbf24" />
            </div>
            <InvestmentCard
              rates={rates} ratesLoading={ratesLoading}
              units={investmentUnits} setUnits={setInvestmentUnits}
              ticker={investmentTicker} setTicker={setInvestmentTicker}
              name={investmentName} setName={setInvestmentName}
              onSave={persist} currency={displayCurrency}
            />
            <SectionTable title="Assets" items={assets} setItems={setAssets}
              fields={[{ key: "name", label: "Asset" }, { key: "amount", label: "Amount" }]}
              addLabel="+ Add Asset" newItem={() => ({ name: "", amount: 0 })} color="#34d399"
              currency={displayCurrency} rates={rates} />
          </>
        )}

        {/* LIABILITIES */}
        {tab === "liabilities" && (
          <>
            <div style={{ display: "flex", gap: 12, marginBottom: 20, flexWrap: "wrap" }}>
              <StatCard label="Total Liabilities" value={fmtC(totalLiabilities, displayCurrency, rates)} color="#f87171" big sub={<PKRBadge gbpAmount={totalLiabilities} rates={rates} ratesLoading={ratesLoading} />} />
            </div>
            <MortgageCard liabilities={liabilities} rates={rates} ratesLoading={ratesLoading} homeValue={homeValue} setHomeValue={setHomeValue} mortgageRate={mortgageRate} setMortgageRate={setMortgageRateState} currency={displayCurrency} />
            <SectionTable title="Liabilities" items={liabilities} setItems={setLiabilities}
              fields={[{ key: "name", label: "Liability" }, { key: "amount", label: "Amount" }]}
              addLabel="+ Add Liability" newItem={() => ({ name: "", amount: 0 })} color="#f87171"
              currency={displayCurrency} rates={rates} />
          </>
        )}

        {/* EXPENSES */}
        {tab === "expenses" && (
          <>
            <div style={{ display: "flex", gap: 12, marginBottom: 20, flexWrap: "wrap" }}>
              <StatCard label="Total Monthly" value={fmtC(totalExpenses, displayCurrency, rates)} color="#f59e0b" big sub={<PKRBadge gbpAmount={totalExpenses} rates={rates} ratesLoading={ratesLoading} />} />
              <StatCard label="Headroom" value={fmtC(headroom, displayCurrency, rates)} color={headroom >= 0 ? "#34d399" : "#f87171"} sub={<PKRBadge gbpAmount={Math.abs(headroom)} rates={rates} ratesLoading={ratesLoading} />} />
            </div>
            <ExpensesTable expenses={expenses} setExpenses={setExpenses} currency={displayCurrency} rates={rates} />
          </>
        )}

        {/* ANNUAL */}
        {tab === "annual" && (
          <>
            <div style={{ display: "flex", gap: 12, marginBottom: 20, flexWrap: "wrap" }}>
              <StatCard label="Total Annual" value={fmtC(annualBills.reduce((s, b) => s + b.amount, 0), displayCurrency, rates)} color="#c084fc" big sub={<PKRBadge gbpAmount={annualBills.reduce((s, b) => s + b.amount, 0)} rates={rates} ratesLoading={ratesLoading} />} />
              <StatCard label="Not In Budget" value={fmtC(annualUnbudgeted, displayCurrency, rates)} sub={<PKRBadge gbpAmount={annualUnbudgeted} rates={rates} ratesLoading={ratesLoading} />} color="#f87171" />
            </div>
            <AnnualTable annualBills={annualBills} setAnnualBills={setAnnualBills} currency={displayCurrency} rates={rates} />
          </>
        )}

        {/* CHARTS */}
        {tab === "charts" && (
          <ChartsTab assets={assets} liabilities={liabilities} expenses={expenses}
            totalAssets={totalAssets} totalLiabilities={totalLiabilities}
            income={income} totalExpenses={totalExpenses}
            currency={displayCurrency} rates={rates} />
        )}

        {/* ZAKAT */}
        {tab === "zakat" && <ZakatTab assets={assets} rates={rates} ratesLoading={ratesLoading} currency={displayCurrency} />}
      </div>
    </div>
  );
}
