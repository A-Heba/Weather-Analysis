import { useState, useMemo, useRef } from "react";
import {
  LineChart, Line, BarChart, Bar, AreaChart, Area,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  ResponsiveContainer, ReferenceLine, ScatterChart, Scatter
} from "recharts";
import * as XLSX from "SheetJS";

// ── helpers ───────────────────────────────────────────────────────────────────
const parseNum = (v) => {
  if (v === undefined || v === null || v.toString().trim() === "") return null;
  return parseFloat(v.toString().replace(",", "."));
};

const toRecord = (row) => {
  const get = (...keys) => {
    for (const k of keys) {
      const found = Object.keys(row).find(rk => rk.toLowerCase().trim() === k.toLowerCase());
      if (found !== undefined) return row[found];
    }
    return undefined;
  };
  const rawDate = get("date");
  let d;
  if (typeof rawDate === "number") {
    d = new Date(Math.round((rawDate - 25569) * 86400 * 1000));
  } else {
    d = new Date(rawDate);
  }
  if (isNaN(d.getTime())) return null;
  return {
    label: d.toLocaleDateString("fr-DZ", { day: "2-digit", month: "short", year: "2-digit" }),
    month: d.getMonth(),
    year: d.getFullYear(),
    monthYear: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`,
    tavg: parseNum(get("tavg")),
    tmin: parseNum(get("tmin")),
    tmax: parseNum(get("tmax")),
    prcp: parseNum(get("prcp")),
    wspd: parseNum(get("wspd")),
    wpgt: parseNum(get("wpgt")),
    pres: parseNum(get("pres")),
  };
};

const parseTSVText = (text) => {
  const lines = text.trim().split("\n").filter(Boolean);
  if (lines.length < 2) return [];
  const hasHeader = lines[0].toLowerCase().includes("date");
  const dataLines = hasHeader ? lines.slice(1) : lines;
  return dataLines.map((line) => {
    const [date, tavg, tmin, tmax, prcp,, , wspd, wpgt, pres] = line.split("\t").map(s => s.trim());
    const d = new Date(date);
    if (isNaN(d.getTime())) return null;
    return {
      label: d.toLocaleDateString("fr-DZ", { day: "2-digit", month: "short", year: "2-digit" }),
      month: d.getMonth(), year: d.getFullYear(),
      monthYear: `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}`,
      tavg: parseNum(tavg), tmin: parseNum(tmin), tmax: parseNum(tmax),
      prcp: parseNum(prcp), wspd: parseNum(wspd), wpgt: parseNum(wpgt), pres: parseNum(pres),
    };
  }).filter(Boolean);
};

const monthNames = ["Jan","Fév","Mar","Avr","Mai","Jun","Jul","Aoû","Sep","Oct","Nov","Déc"];

const aggregate = (data, key) => {
  const map = {};
  data.forEach((d) => {
    if (d[key] === null) return;
    if (!map[d.monthYear]) map[d.monthYear] = { sum: 0, count: 0, label: d.monthYear };
    map[d.monthYear].sum += d[key];
    map[d.monthYear].count++;
  });
  return Object.values(map).sort((a,b) => a.label.localeCompare(b.label))
    .map(m => ({ ...m, avg: +(m.sum/m.count).toFixed(2) }));
};

const climatology = (data, key, fn = "mean") => {
  const byMonth = Array.from({ length: 12 }, () => []);
  data.forEach(d => { if (d[key] !== null) byMonth[d.month].push(d[key]); });
  return byMonth.map((vals, i) => ({
    month: monthNames[i],
    value: vals.length ? fn === "sum"
      ? +(vals.reduce((a,b)=>a+b,0) / (new Set(data.filter(d=>d.month===i).map(d=>d.year)).size||1)).toFixed(2)
      : +(vals.reduce((a,b)=>a+b,0)/vals.length).toFixed(2)
      : null,
    min: vals.length ? +Math.min(...vals).toFixed(1) : null,
    max: vals.length ? +Math.max(...vals).toFixed(1) : null,
  }));
};

const stats = (arr) => {
  const v = arr.filter(x => x !== null);
  if (!v.length) return {};
  return { mean: +(v.reduce((a,b)=>a+b,0)/v.length).toFixed(2), min: +Math.min(...v).toFixed(2), max: +Math.max(...v).toFixed(2), count: v.length };
};

// ── colours ───────────────────────────────────────────────────────────────────
const C = {
  bg:"#0d1117", surface:"#161b22", border:"#21262d", accent:"#e8b64e",
  red:"#e05252", blue:"#5299e0", teal:"#4ecece", green:"#52e08a", muted:"#8b949e", text:"#e6edf3"
};

// ── sub-components ────────────────────────────────────────────────────────────
const CustomTip = ({ active, payload, label, unit }) => {
  if (!active || !payload?.length) return null;
  return (
    <div style={{ background:C.surface, border:`1px solid ${C.border}`, borderRadius:8, padding:"10px 14px", fontSize:12, color:C.text }}>
      <div style={{ marginBottom:6, color:C.muted, fontFamily:"monospace" }}>{label}</div>
      {payload.map((p,i) => (
        <div key={i} style={{ color:p.color, marginBottom:2 }}>
          {p.name}: <strong>{p.value!=null ? `${p.value}${unit||""}` : "—"}</strong>
        </div>
      ))}
    </div>
  );
};

const StatCard = ({ label, value, unit, color, sub }) => (
  <div style={{ background:C.surface, border:`1px solid ${C.border}`, borderRadius:10, padding:"14px 18px", flex:1, minWidth:120 }}>
    <div style={{ fontSize:11, color:C.muted, textTransform:"uppercase", letterSpacing:1, marginBottom:6 }}>{label}</div>
    <div style={{ fontSize:26, fontWeight:700, color:color||C.accent, fontFamily:"monospace", lineHeight:1 }}>
      {value!=null ? value : "—"}
      <span style={{ fontSize:13, color:C.muted, marginLeft:3 }}>{unit}</span>
    </div>
    {sub && <div style={{ fontSize:11, color:C.muted, marginTop:5 }}>{sub}</div>}
  </div>
);

// ══════════════════════════════════════════════════════════════════════════════
export default function App() {
  const [tab, setTab] = useState("temperature");
  const [view, setView] = useState("monthly");
  const [data, setData] = useState([]);
  const [dataLoaded, setDataLoaded] = useState(false);
  const [fileName, setFileName] = useState("");
  const [loadError, setLoadError] = useState("");
  const [isDragging, setIsDragging] = useState(false);
  const [inputMode, setInputMode] = useState("excel");
  const [raw, setRaw] = useState("");
  const fileInputRef = useRef(null);

  // ── file handlers ─────────────────────────────────────────────────────────
  const processFile = (file) => {
    setLoadError("");
    if (!file) return;
    const ext = file.name.split(".").pop().toLowerCase();
    if (!["xlsx","xls","csv","tsv"].includes(ext)) {
      setLoadError("Format non supporté. Utilisez .xlsx, .xls, .csv ou .tsv"); return;
    }
    setFileName(file.name);
    const reader = new FileReader();
    if (ext === "tsv") {
      reader.onload = e => {
        const parsed = parseTSVText(e.target.result);
        if (!parsed.length) { setLoadError("Aucune donnée valide trouvée."); return; }
        setData(parsed); setDataLoaded(true);
      };
      reader.readAsText(file);
    } else {
      reader.onload = e => {
        try {
          const wb = XLSX.read(new Uint8Array(e.target.result), { type:"array", cellDates:false });
          const ws = wb.Sheets[wb.SheetNames[0]];
          const rows = XLSX.utils.sheet_to_json(ws, { defval:"" });
          const parsed = rows.map(toRecord).filter(Boolean);
          if (!parsed.length) { setLoadError("Aucune ligne valide trouvée. Vérifiez les noms de colonnes."); return; }
          setData(parsed); setDataLoaded(true);
        } catch(err) { setLoadError("Erreur de lecture : " + err.message); }
      };
      reader.readAsArrayBuffer(file);
    }
  };

  const handleDrop = e => { e.preventDefault(); setIsDragging(false); processFile(e.dataTransfer.files[0]); };
  const handlePasteLoad = () => {
    setLoadError("");
    const parsed = parseTSVText(raw);
    if (!parsed.length) { setLoadError("Aucune ligne valide. Vérifiez le format TSV."); return; }
    setData(parsed); setFileName("données collées"); setDataLoaded(true);
  };

  // ── computed data ─────────────────────────────────────────────────────────
  const monthlyTemp = useMemo(() => aggregate(data, "tavg"), [data]);
  const monthlyPrcp = useMemo(() => {
    const map = {};
    data.forEach(d => {
      if (d.prcp===null) return;
      if (!map[d.monthYear]) map[d.monthYear] = { sum:0, label:d.monthYear };
      map[d.monthYear].sum += d.prcp;
    });
    return Object.values(map).sort((a,b)=>a.label.localeCompare(b.label)).map(m=>({...m,avg:+m.sum.toFixed(1)}));
  }, [data]);
  const monthlyWspd = useMemo(() => aggregate(data, "wspd"), [data]);
  const climaTemp  = useMemo(() => climatology(data,"tavg"), [data]);
  const climaTmax  = useMemo(() => climatology(data,"tmax"), [data]);
  const climaTmin  = useMemo(() => climatology(data,"tmin"), [data]);
  const climaPrcp  = useMemo(() => climatology(data,"prcp","sum"), [data]);
  const climaWspd  = useMemo(() => climatology(data,"wspd"), [data]);
  const tStats = useMemo(() => stats(data.map(d=>d.tavg)), [data]);
  const pStats = useMemo(() => stats(data.map(d=>d.prcp)), [data]);
  const wStats = useMemo(() => stats(data.map(d=>d.wspd)), [data]);
  const dailySample = useMemo(() => data.length > 1000 ? data.filter((_,i)=>i%3===0) : data, [data]);

  const tabs = [
    { id:"temperature", label:"🌡 Température" },
    { id:"precipitation", label:"🌧 Précipitations" },
    { id:"wind", label:"💨 Vent" },
    { id:"overview", label:"📊 Synthèse" },
  ];
  const tabStyle = id => ({ padding:"9px 20px", borderRadius:7, border:"none", cursor:"pointer",
    fontSize:13, fontWeight:600, background:tab===id?C.accent:"transparent", color:tab===id?"#0d1117":C.muted, transition:"all .15s" });
  const viewBtnStyle = v => ({ padding:"5px 13px", borderRadius:5, border:`1px solid ${view===v?C.accent:C.border}`,
    background:view===v?`${C.accent}22`:"transparent", color:view===v?C.accent:C.muted, fontSize:12, cursor:"pointer" });

  return (
    <div style={{ background:C.bg, minHeight:"100vh", color:C.text, fontFamily:"'Trebuchet MS',Georgia,serif", padding:"0 0 40px" }}>

      {/* Header */}
      <div style={{ borderBottom:`1px solid ${C.border}`, padding:"22px 32px", display:"flex", alignItems:"center", gap:16 }}>
        <div>
          <div style={{ fontSize:22, fontWeight:800, letterSpacing:-0.5 }}>
            Analyse Climatique — <span style={{ color:C.accent }}>Wilaya de Tiaret</span>
          </div>
          <div style={{ fontSize:12, color:C.muted, marginTop:3 }}>Algérie · 2017–2025 · Température, Précipitations & Vent</div>
        </div>
        <div style={{ marginLeft:"auto", fontSize:12, color:C.muted, textAlign:"right" }}>
          {dataLoaded
            ? <span style={{ color:C.green }}>✓ {data.length} jours chargés · {fileName}</span>
            : <span style={{ color:"#e07a52" }}>⚠ Aucune donnée chargée</span>}
        </div>
      </div>

      {/* ── Import Panel ── */}
      {!dataLoaded && (
        <div style={{ margin:"28px 32px", background:C.surface, border:`1px solid ${C.border}`, borderRadius:14, padding:28 }}>
          <div style={{ fontSize:15, fontWeight:800, color:C.accent, marginBottom:4 }}>📥 Importer les données</div>
          <div style={{ fontSize:12, color:C.muted, marginBottom:20 }}>Choisissez votre méthode d'import.</div>

          {/* Mode toggle */}
          <div style={{ display:"flex", gap:6, marginBottom:24 }}>
            {[["excel","📊 Fichier Excel / CSV"],["paste","📋 Coller (TSV)"]].map(([m,label])=>(
              <button key={m} onClick={()=>setInputMode(m)} style={{
                padding:"8px 18px", borderRadius:7, border:`1.5px solid ${inputMode===m?C.accent:C.border}`,
                background:inputMode===m?`${C.accent}18`:"transparent", color:inputMode===m?C.accent:C.muted,
                fontWeight:600, fontSize:13, cursor:"pointer", transition:"all .15s"
              }}>{label}</button>
            ))}
          </div>

          {/* Excel upload */}
          {inputMode === "excel" && (
            <>
              <div
                onDrop={handleDrop}
                onDragOver={e=>{e.preventDefault();setIsDragging(true);}}
                onDragLeave={()=>setIsDragging(false)}
                onClick={()=>fileInputRef.current.click()}
                style={{
                  border:`2px dashed ${isDragging?C.accent:C.border}`, borderRadius:12,
                  padding:"52px 32px", textAlign:"center", cursor:"pointer",
                  background:isDragging?`${C.accent}0d`:"transparent", transition:"all .2s"
                }}
              >
                <div style={{ fontSize:44, marginBottom:12 }}>📂</div>
                <div style={{ fontSize:15, fontWeight:700, color:C.text, marginBottom:6 }}>Glissez votre fichier ici</div>
                <div style={{ fontSize:12, color:C.muted, marginBottom:18 }}>ou cliquez pour parcourir</div>
                <div style={{ display:"inline-block", background:C.accent, color:"#0d1117", borderRadius:7,
                  padding:"9px 26px", fontWeight:700, fontSize:13 }}>
                  Choisir un fichier
                </div>
                <div style={{ fontSize:11, color:C.muted, marginTop:16 }}>
                  Formats acceptés : <strong style={{color:C.text}}>.xlsx · .xls · .csv · .tsv</strong>
                </div>
              </div>
              <input ref={fileInputRef} type="file" accept=".xlsx,.xls,.csv,.tsv"
                onChange={e=>processFile(e.target.files[0])} style={{ display:"none" }} />

              <div style={{ marginTop:18, padding:"14px 18px", background:`${C.accent}10`,
                border:`1px solid ${C.accent}44`, borderRadius:9, fontSize:12, color:C.muted }}>
                <strong style={{color:C.accent}}>💡 Format attendu :</strong> La première ligne doit contenir les en-têtes :{" "}
                <code style={{color:C.text}}>date, tavg, tmin, tmax, prcp, wspd</code> (insensibles à la casse).
                Les décimales en virgule <code style={{color:C.text}}>2,7</code> ou en point <code style={{color:C.text}}>2.7</code> sont toutes les deux acceptées.
              </div>
            </>
          )}

          {/* Paste TSV */}
          {inputMode === "paste" && (
            <>
              <div style={{ fontSize:12, color:C.muted, marginBottom:10 }}>
                Copiez les données depuis Excel (Ctrl+A → Ctrl+C) et collez ci-dessous :
              </div>
              <textarea
                value={raw}
                onChange={e=>setRaw(e.target.value)}
                placeholder={"date\ttavg\ttmin\ttmax\tprcp\tsnow\twdir\twspd\twpgt\tpres\ttsun\n2017-01-01\t2,7\t-4\t11,6\t0\t\t\t4,7\t\t\t"}
                style={{ width:"100%", height:180, background:C.bg, border:`1px solid ${C.border}`,
                  borderRadius:8, color:C.text, fontFamily:"monospace", fontSize:12,
                  padding:12, resize:"vertical", boxSizing:"border-box" }}
              />
              <button onClick={handlePasteLoad} style={{ marginTop:12, background:C.accent, color:"#0d1117",
                border:"none", borderRadius:7, padding:"9px 28px", fontWeight:700, cursor:"pointer", fontSize:14 }}>
                Analyser →
              </button>
            </>
          )}

          {loadError && (
            <div style={{ marginTop:16, padding:"10px 16px", background:`${C.red}18`,
              border:`1px solid ${C.red}55`, borderRadius:8, color:C.red, fontSize:13 }}>
              ⚠ {loadError}
            </div>
          )}
        </div>
      )}

      {/* ── Dashboard ── */}
      {dataLoaded && (
        <>
          <div style={{ margin:"16px 32px 0", display:"flex", justifyContent:"flex-end" }}>
            <button onClick={()=>{setDataLoaded(false);setData([]);setFileName("");setRaw("");}}
              style={{ background:"transparent", color:C.muted, border:`1px solid ${C.border}`,
                borderRadius:6, padding:"5px 14px", cursor:"pointer", fontSize:12 }}>
              ← Changer de fichier
            </button>
          </div>

          <div style={{ display:"flex", gap:4, padding:"16px 32px 0", flexWrap:"wrap" }}>
            {tabs.map(t => <button key={t.id} onClick={()=>setTab(t.id)} style={tabStyle(t.id)}>{t.label}</button>)}
            <div style={{ marginLeft:"auto", display:"flex", gap:6, alignItems:"center" }}>
              {["daily","monthly","climatology"].map(v=>(
                <button key={v} onClick={()=>setView(v)} style={viewBtnStyle(v)}>
                  {v==="daily"?"Quotidien":v==="monthly"?"Mensuel":"Climatologie"}
                </button>
              ))}
            </div>
          </div>

          <div style={{ padding:"20px 32px" }}>

            {/* TEMPERATURE */}
            {tab==="temperature" && (
              <>
                <div style={{ display:"flex", gap:12, marginBottom:20, flexWrap:"wrap" }}>
                  <StatCard label="Moyenne" value={tStats.mean} unit="°C" color={C.accent}/>
                  <StatCard label="Max absolu" value={tStats.max} unit="°C" color={C.red}/>
                  <StatCard label="Min absolu" value={tStats.min} unit="°C" color={C.blue}/>
                  <StatCard label="Observations" value={tStats.count} unit="j" color={C.muted}/>
                </div>

                {view==="climatology" && (
                  <><div style={{fontSize:13,color:C.muted,marginBottom:12,fontWeight:600}}>Climatologie mensuelle — toutes années</div>
                  <ResponsiveContainer width="100%" height={320}>
                    <AreaChart data={climaTemp.map((d,i)=>({...d,tmax:climaTmax[i]?.value,tmin:climaTmin[i]?.value}))}>
                      <defs>
                        <linearGradient id="tg" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor={C.accent} stopOpacity={0.25}/>
                          <stop offset="95%" stopColor={C.accent} stopOpacity={0}/>
                        </linearGradient>
                      </defs>
                      <CartesianGrid stroke={C.border} strokeDasharray="3 3"/>
                      <XAxis dataKey="month" tick={{fill:C.muted,fontSize:11}}/>
                      <YAxis unit="°C" tick={{fill:C.muted,fontSize:11}}/>
                      <Tooltip content={<CustomTip unit="°C"/>}/>
                      <Legend wrapperStyle={{fontSize:12}}/>
                      <ReferenceLine y={0} stroke={C.border} strokeDasharray="4 4"/>
                      <Area type="monotone" dataKey="tmax" stroke={C.red} fill="transparent" name="T max" strokeWidth={1.5} dot={false}/>
                      <Area type="monotone" dataKey="value" stroke={C.accent} fill="url(#tg)" name="T moy" strokeWidth={2.5} dot={{r:4,fill:C.accent}}/>
                      <Area type="monotone" dataKey="tmin" stroke={C.blue} fill="transparent" name="T min" strokeWidth={1.5} dot={false}/>
                    </AreaChart>
                  </ResponsiveContainer></>
                )}
                {view==="monthly" && (
                  <><div style={{fontSize:13,color:C.muted,marginBottom:12,fontWeight:600}}>Température moyenne mensuelle</div>
                  <ResponsiveContainer width="100%" height={320}>
                    <LineChart data={monthlyTemp}>
                      <CartesianGrid stroke={C.border} strokeDasharray="3 3"/>
                      <XAxis dataKey="label" tick={{fill:C.muted,fontSize:9}} interval={5}/>
                      <YAxis unit="°C" tick={{fill:C.muted,fontSize:11}}/>
                      <Tooltip content={<CustomTip unit="°C"/>}/>
                      <ReferenceLine y={0} stroke={C.blue} strokeDasharray="4 4"/>
                      <Line type="monotone" dataKey="avg" stroke={C.accent} strokeWidth={2} dot={false} name="T moy"/>
                    </LineChart>
                  </ResponsiveContainer></>
                )}
                {view==="daily" && (
                  <><div style={{fontSize:13,color:C.muted,marginBottom:12,fontWeight:600}}>Températures quotidiennes (échantillon 1/3)</div>
                  <ResponsiveContainer width="100%" height={320}>
                    <LineChart data={dailySample}>
                      <CartesianGrid stroke={C.border} strokeDasharray="3 3"/>
                      <XAxis dataKey="label" tick={{fill:C.muted,fontSize:9}} interval={60}/>
                      <YAxis unit="°C" tick={{fill:C.muted,fontSize:11}}/>
                      <Tooltip content={<CustomTip unit="°C"/>}/>
                      <ReferenceLine y={0} stroke={C.blue} strokeDasharray="4 4"/>
                      <Legend wrapperStyle={{fontSize:12}}/>
                      <Line type="monotone" dataKey="tmax" stroke={C.red} strokeWidth={1} dot={false} name="T max"/>
                      <Line type="monotone" dataKey="tavg" stroke={C.accent} strokeWidth={1.5} dot={false} name="T moy"/>
                      <Line type="monotone" dataKey="tmin" stroke={C.blue} strokeWidth={1} dot={false} name="T min"/>
                    </LineChart>
                  </ResponsiveContainer></>
                )}

                <div style={{fontSize:13,color:C.muted,marginTop:28,marginBottom:12,fontWeight:600}}>Température moyenne par année</div>
                <ResponsiveContainer width="100%" height={220}>
                  <BarChart data={(() => {
                    const by={};
                    data.forEach(d=>{if(d.tavg!==null){if(!by[d.year])by[d.year]=[];by[d.year].push(d.tavg);}});
                    return Object.entries(by).map(([y,v])=>({year:y,avg:+(v.reduce((a,b)=>a+b,0)/v.length).toFixed(2)}));
                  })()}>
                    <CartesianGrid stroke={C.border} strokeDasharray="3 3"/>
                    <XAxis dataKey="year" tick={{fill:C.muted,fontSize:11}}/>
                    <YAxis unit="°C" tick={{fill:C.muted,fontSize:11}}/>
                    <Tooltip content={<CustomTip unit="°C"/>}/>
                    <Bar dataKey="avg" fill={C.accent} name="T moy ann." radius={[4,4,0,0]}/>
                  </BarChart>
                </ResponsiveContainer>
              </>
            )}

            {/* PRECIPITATION */}
            {tab==="precipitation" && (
              <>
                <div style={{display:"flex",gap:12,marginBottom:20,flexWrap:"wrap"}}>
                  <StatCard label="Total période" value={data.reduce((a,d)=>a+(d.prcp||0),0).toFixed(0)} unit="mm" color={C.blue}/>
                  <StatCard label="Moy. quotidienne" value={pStats.mean} unit="mm" color={C.teal}/>
                  <StatCard label="Max journalier" value={pStats.max} unit="mm" color={C.blue}/>
                  <StatCard label="Jours pluvieux" value={data.filter(d=>d.prcp!==null&&d.prcp>0).length} unit="j" color={C.muted}/>
                </div>
                {view==="climatology" && (
                  <><div style={{fontSize:13,color:C.muted,marginBottom:12,fontWeight:600}}>Précipitations moyennes mensuelles</div>
                  <ResponsiveContainer width="100%" height={300}>
                    <BarChart data={climaPrcp}>
                      <CartesianGrid stroke={C.border} strokeDasharray="3 3"/>
                      <XAxis dataKey="month" tick={{fill:C.muted,fontSize:11}}/>
                      <YAxis unit="mm" tick={{fill:C.muted,fontSize:11}}/>
                      <Tooltip content={<CustomTip unit=" mm"/>}/>
                      <Bar dataKey="value" fill={C.blue} name="Précip. moy." radius={[4,4,0,0]}/>
                    </BarChart>
                  </ResponsiveContainer></>
                )}
                {view==="monthly" && (
                  <><div style={{fontSize:13,color:C.muted,marginBottom:12,fontWeight:600}}>Précipitations totales mensuelles</div>
                  <ResponsiveContainer width="100%" height={300}>
                    <BarChart data={monthlyPrcp}>
                      <CartesianGrid stroke={C.border} strokeDasharray="3 3"/>
                      <XAxis dataKey="label" tick={{fill:C.muted,fontSize:9}} interval={5}/>
                      <YAxis unit="mm" tick={{fill:C.muted,fontSize:11}}/>
                      <Tooltip content={<CustomTip unit=" mm"/>}/>
                      <Bar dataKey="avg" fill={C.blue} name="Précip. totale" radius={[3,3,0,0]}/>
                    </BarChart>
                  </ResponsiveContainer></>
                )}
                {view==="daily" && (
                  <><div style={{fontSize:13,color:C.muted,marginBottom:12,fontWeight:600}}>Précipitations quotidiennes</div>
                  <ResponsiveContainer width="100%" height={300}>
                    <BarChart data={dailySample}>
                      <CartesianGrid stroke={C.border} strokeDasharray="3 3"/>
                      <XAxis dataKey="label" tick={{fill:C.muted,fontSize:9}} interval={60}/>
                      <YAxis unit="mm" tick={{fill:C.muted,fontSize:11}}/>
                      <Tooltip content={<CustomTip unit=" mm"/>}/>
                      <Bar dataKey="prcp" fill={C.blue} name="Précip."/>
                    </BarChart>
                  </ResponsiveContainer></>
                )}
                <div style={{fontSize:13,color:C.muted,marginTop:28,marginBottom:12,fontWeight:600}}>Précipitations totales annuelles</div>
                <ResponsiveContainer width="100%" height={220}>
                  <BarChart data={(() => {
                    const by={};
                    data.forEach(d=>{if(d.prcp!==null){if(!by[d.year])by[d.year]=0;by[d.year]+=d.prcp;}});
                    return Object.entries(by).map(([y,v])=>({year:y,total:+v.toFixed(1)}));
                  })()}>
                    <CartesianGrid stroke={C.border} strokeDasharray="3 3"/>
                    <XAxis dataKey="year" tick={{fill:C.muted,fontSize:11}}/>
                    <YAxis unit="mm" tick={{fill:C.muted,fontSize:11}}/>
                    <Tooltip content={<CustomTip unit=" mm"/>}/>
                    <Bar dataKey="total" fill={C.teal} name="Total annuel" radius={[4,4,0,0]}/>
                  </BarChart>
                </ResponsiveContainer>
              </>
            )}

            {/* WIND */}
            {tab==="wind" && (
              <>
                <div style={{display:"flex",gap:12,marginBottom:20,flexWrap:"wrap"}}>
                  <StatCard label="Vitesse moy." value={wStats.mean} unit=" km/h" color={C.teal}/>
                  <StatCard label="Vitesse max" value={wStats.max} unit=" km/h" color={C.red}/>
                  <StatCard label="Vitesse min" value={wStats.min} unit=" km/h" color={C.muted}/>
                  <StatCard label="Observations" value={wStats.count} unit="j" color={C.muted}/>
                </div>
                {view==="climatology" && (
                  <><div style={{fontSize:13,color:C.muted,marginBottom:12,fontWeight:600}}>Vent moyen mensuel — toutes années</div>
                  <ResponsiveContainer width="100%" height={300}>
                    <BarChart data={climaWspd}>
                      <CartesianGrid stroke={C.border} strokeDasharray="3 3"/>
                      <XAxis dataKey="month" tick={{fill:C.muted,fontSize:11}}/>
                      <YAxis unit=" km/h" tick={{fill:C.muted,fontSize:11}}/>
                      <Tooltip content={<CustomTip unit=" km/h"/>}/>
                      <Bar dataKey="value" fill={C.teal} name="Vent moy." radius={[4,4,0,0]}/>
                    </BarChart>
                  </ResponsiveContainer></>
                )}
                {view==="monthly" && (
                  <><div style={{fontSize:13,color:C.muted,marginBottom:12,fontWeight:600}}>Vitesse du vent mensuelle</div>
                  <ResponsiveContainer width="100%" height={300}>
                    <LineChart data={monthlyWspd}>
                      <CartesianGrid stroke={C.border} strokeDasharray="3 3"/>
                      <XAxis dataKey="label" tick={{fill:C.muted,fontSize:9}} interval={5}/>
                      <YAxis unit=" km/h" tick={{fill:C.muted,fontSize:11}}/>
                      <Tooltip content={<CustomTip unit=" km/h"/>}/>
                      <Line type="monotone" dataKey="avg" stroke={C.teal} strokeWidth={2} dot={false} name="Vent moy."/>
                    </LineChart>
                  </ResponsiveContainer></>
                )}
                {view==="daily" && (
                  <><div style={{fontSize:13,color:C.muted,marginBottom:12,fontWeight:600}}>Vitesse du vent quotidienne</div>
                  <ResponsiveContainer width="100%" height={300}>
                    <AreaChart data={dailySample}>
                      <defs>
                        <linearGradient id="wg" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor={C.teal} stopOpacity={0.3}/>
                          <stop offset="95%" stopColor={C.teal} stopOpacity={0}/>
                        </linearGradient>
                      </defs>
                      <CartesianGrid stroke={C.border} strokeDasharray="3 3"/>
                      <XAxis dataKey="label" tick={{fill:C.muted,fontSize:9}} interval={60}/>
                      <YAxis unit=" km/h" tick={{fill:C.muted,fontSize:11}}/>
                      <Tooltip content={<CustomTip unit=" km/h"/>}/>
                      <Area type="monotone" dataKey="wspd" stroke={C.teal} fill="url(#wg)" strokeWidth={1.5} dot={false} name="Vent"/>
                    </AreaChart>
                  </ResponsiveContainer></>
                )}
                <div style={{fontSize:13,color:C.muted,marginTop:28,marginBottom:12,fontWeight:600}}>Vent vs Température (quotidien)</div>
                <ResponsiveContainer width="100%" height={220}>
                  <ScatterChart>
                    <CartesianGrid stroke={C.border} strokeDasharray="3 3"/>
                    <XAxis type="number" dataKey="tavg" name="T moy" unit="°C" tick={{fill:C.muted,fontSize:11}}/>
                    <YAxis type="number" dataKey="wspd" name="Vent" unit=" km/h" tick={{fill:C.muted,fontSize:11}}/>
                    <Tooltip cursor={{strokeDasharray:"3 3"}} content={({active,payload})=>{
                      if(!active||!payload?.length) return null;
                      const d=payload[0]?.payload;
                      return <div style={{background:C.surface,border:`1px solid ${C.border}`,borderRadius:8,padding:"8px 12px",fontSize:12}}>
                        <div style={{color:C.muted}}>{d?.label}</div>
                        <div style={{color:C.accent}}>T: {d?.tavg}°C</div>
                        <div style={{color:C.teal}}>Vent: {d?.wspd} km/h</div>
                      </div>;
                    }}/>
                    <Scatter data={data.filter(d=>d.tavg!==null&&d.wspd!==null)} fill={C.teal} fillOpacity={0.4}/>
                  </ScatterChart>
                </ResponsiveContainer>
              </>
            )}

            {/* OVERVIEW */}
            {tab==="overview" && (
              <>
                <div style={{display:"flex",gap:12,marginBottom:24,flexWrap:"wrap"}}>
                  <StatCard label="T° moyenne" value={tStats.mean} unit="°C" color={C.accent} sub={`Min ${tStats.min}°C · Max ${tStats.max}°C`}/>
                  <StatCard label="Précip. totale" value={data.reduce((a,d)=>a+(d.prcp||0),0).toFixed(0)} unit="mm" color={C.blue} sub={`${data.filter(d=>d.prcp!==null&&d.prcp>0).length} jours pluvieux`}/>
                  <StatCard label="Vent moyen" value={wStats.mean} unit=" km/h" color={C.teal} sub={`Max ${wStats.max} km/h`}/>
                  <StatCard label="Période" value={data.length} unit=" j" color={C.muted} sub="jan 2017 – déc 2025"/>
                </div>

                <div style={{fontSize:13,color:C.muted,marginBottom:12,fontWeight:600}}>Climatologie — Température & Vent</div>
                <ResponsiveContainer width="100%" height={320}>
                  <LineChart data={climaTemp.map((d,i)=>({month:d.month,tavg:d.value,prcp:climaPrcp[i]?.value,wspd:climaWspd[i]?.value}))}>
                    <CartesianGrid stroke={C.border} strokeDasharray="3 3"/>
                    <XAxis dataKey="month" tick={{fill:C.muted,fontSize:11}}/>
                    <YAxis yAxisId="t" unit="°C" tick={{fill:C.muted,fontSize:11}}/>
                    <YAxis yAxisId="w" orientation="right" unit="km/h" tick={{fill:C.muted,fontSize:11}}/>
                    <Tooltip content={<CustomTip/>}/>
                    <Legend wrapperStyle={{fontSize:12}}/>
                    <Line yAxisId="t" type="monotone" dataKey="tavg" stroke={C.accent} strokeWidth={2.5} dot={{r:4,fill:C.accent}} name="T moy (°C)"/>
                    <Line yAxisId="w" type="monotone" dataKey="wspd" stroke={C.teal} strokeWidth={2} dot={false} name="Vent (km/h)" strokeDasharray="5 3"/>
                  </LineChart>
                </ResponsiveContainer>

                <div style={{fontSize:13,color:C.muted,marginTop:28,marginBottom:12,fontWeight:600}}>Précipitations moyennes mensuelles</div>
                <ResponsiveContainer width="100%" height={200}>
                  <BarChart data={climaPrcp}>
                    <CartesianGrid stroke={C.border} strokeDasharray="3 3"/>
                    <XAxis dataKey="month" tick={{fill:C.muted,fontSize:11}}/>
                    <YAxis unit="mm" tick={{fill:C.muted,fontSize:11}}/>
                    <Tooltip content={<CustomTip unit=" mm"/>}/>
                    <Bar dataKey="value" fill={C.blue} name="Précip. moy." radius={[4,4,0,0]}/>
                  </BarChart>
                </ResponsiveContainer>

                <div style={{fontSize:13,color:C.muted,marginTop:28,marginBottom:12,fontWeight:600}}>Résumé annuel</div>
                <div style={{overflowX:"auto"}}>
                  <table style={{width:"100%",borderCollapse:"collapse",fontSize:13}}>
                    <thead>
                      <tr style={{borderBottom:`2px solid ${C.border}`}}>
                        {["Année","T moy (°C)","T min (°C)","T max (°C)","Précip. (mm)","Vent (km/h)"].map(h=>(
                          <th key={h} style={{padding:"8px 14px",textAlign:"left",color:C.muted,fontWeight:600}}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {[...new Set(data.map(d=>d.year))].sort().map(y=>{
                        const yd=data.filter(d=>d.year===y);
                        const m=arr=>{ const v=arr.filter(x=>x!==null); return v.length?+(v.reduce((a,b)=>a+b,0)/v.length).toFixed(1):"—"; };
                        const pv=yd.map(d=>d.prcp).filter(x=>x!==null);
                        return (
                          <tr key={y} style={{borderBottom:`1px solid ${C.border}`}}>
                            <td style={{padding:"7px 14px",color:C.accent,fontWeight:700,fontFamily:"monospace"}}>{y}</td>
                            <td style={{padding:"7px 14px"}}>{m(yd.map(d=>d.tavg))}</td>
                            <td style={{padding:"7px 14px",color:C.blue}}>{m(yd.map(d=>d.tmin))}</td>
                            <td style={{padding:"7px 14px",color:C.red}}>{m(yd.map(d=>d.tmax))}</td>
                            <td style={{padding:"7px 14px",color:C.blue}}>{pv.length?pv.reduce((a,b)=>a+b,0).toFixed(0):"—"}</td>
                            <td style={{padding:"7px 14px",color:C.teal}}>{m(yd.map(d=>d.wspd))}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </div>
        </>
      )}
    </div>
  );
}
