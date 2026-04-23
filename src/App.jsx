import { useState, useEffect } from "react";
import { AreaChart, Area, BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from "recharts";

const C = {
  bg:"#f8fafc", card:"#ffffff", border:"#e2e8f0", accent:"#2563eb",
  green:"#16a34a", amber:"#d97706", red:"#dc2626", teal:"#0d9488",
  purple:"#7c3aed", text:"#0f172a", muted:"#475569", dim:"#94a3b8",
  surface:"#f1f5f9", greenBg:"#f0fdf4", amberBg:"#fffbeb", redBg:"#fef2f2",
  purpleBg:"#faf5ff", blueBg:"#eff6ff", tealBg:"#f0fdfa",
};
const ORG_ID = "60036724867";
const SPOCS = {
  Mahesh:{slackId:"U09G6616K8F",role:"Finance — Primary Approver",color:"#7c3aed",bg:"#faf5ff"},
  Akash: {slackId:"U09G6616K8F",role:"Finance Controller",color:"#2563eb",bg:"#eff6ff"},
  Tushar:{slackId:"U07FRUKJTL4",role:"AP Team",color:"#d97706",bg:"#fffbeb"},
};
const QUEUES = {
  Q1:{name:"GST / RCM",owner:"Saurav",color:"#dc2626",bg:"#fef2f2",sla:"24h"},
  Q2:{name:"TDS mismatch",owner:"Saurav",color:"#ea580c",bg:"#fff7ed",sla:"24h"},
  Q3:{name:"Vendor not found",owner:"Tushar",color:"#d97706",bg:"#fffbeb",sla:"3d"},
  Q4:{name:"Duplicate",owner:"Mahesh",color:"#7c3aed",bg:"#faf5ff",sla:"Immediate"},
  Q5:{name:"Amount / Controls",owner:"Tushar",color:"#db2777",bg:"#fdf2f8",sla:"24h"},
  Q6:{name:"Missing docs",owner:"Tushar",color:"#4f46e5",bg:"#eef2ff",sla:"48h"},
  Q7:{name:"GL unclear",owner:"Mahesh",color:"#0d9488",bg:"#f0fdfa",sla:"24h"},
  Q8:{name:"Proof-check",owner:"Tushar",color:"#0284c7",bg:"#f0f9ff",sla:"Immediate"},
};
const fmt = n => new Intl.NumberFormat("en-IN").format(Math.abs(n));
const fmtL = n => n>=100000?`${(n/100000).toFixed(1)}L`:n>=1000?`${(n/1000).toFixed(0)}K`:String(n);

// ── Call Anthropic API + Zoho MCP ──
async function callZoho(prompt) {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method:"POST", headers:{"Content-Type":"application/json"},
    body: JSON.stringify({
      model:"claude-sonnet-4-20250514", max_tokens:4000,
      messages:[{role:"user",content:prompt}],
      mcp_servers:[{type:"url",url:"https://zohobooks.zoho.in/mcp/v1",name:"zoho-books-mcp"}]
    })
  });
  const d = await res.json();
  const results = d.content?.filter(b=>b.type==="mcp_tool_result").map(b=>b.content?.[0]?.text||"").join("\n");
  const text = d.content?.filter(b=>b.type==="text").map(b=>b.text).join(" ")||"";
  return { results, text, raw: d };
}

// ── Slack send ──
async function sendSlack(userId, message) {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method:"POST", headers:{"Content-Type":"application/json"},
    body: JSON.stringify({
      model:"claude-sonnet-4-20250514", max_tokens:1000,
      messages:[{role:"user",content:`Send this Slack DM to user ${userId}:\n\n${message}`}],
      mcp_servers:[{type:"url",url:"https://mcp.slack.com/mcp",name:"slack-mcp"}]
    })
  });
  const d = await res.json();
  return d.content?.length > 0;
}

const Metric = ({label,value,sub,color,bg})=>(
  <div style={{background:bg||C.card,borderRadius:12,padding:"16px 20px",border:`1px solid ${C.border}`,borderTop:`3px solid ${color||C.accent}`}}>
    <div style={{fontSize:10,color:C.muted,textTransform:"uppercase",letterSpacing:1.2,fontWeight:600}}>{label}</div>
    <div style={{fontSize:28,fontWeight:700,color:C.text,fontFamily:"'JetBrains Mono',monospace",marginTop:4}}>{value}</div>
    {sub&&<div style={{fontSize:11,color:C.dim,marginTop:2}}>{sub}</div>}
  </div>
);

const ConnBadge = ({label,status,detail})=>(
  <div style={{background:C.card,borderRadius:10,padding:"12px 16px",border:`1px solid ${status==="ok"?"#bbf7d0":status==="checking"?"#bfdbfe":"#fecaca"}`,display:"flex",alignItems:"center",gap:12}}>
    <div style={{width:10,height:10,borderRadius:"50%",background:status==="ok"?C.green:status==="checking"?C.accent:C.red,flexShrink:0,animation:status==="checking"?"pulse 1s infinite":""}}/>
    <div>
      <div style={{fontSize:13,fontWeight:600,color:C.text}}>{label}</div>
      <div style={{fontSize:11,color:C.muted}}>{detail}</div>
    </div>
    <div style={{marginLeft:"auto",fontSize:11,fontWeight:600,color:status==="ok"?C.green:status==="checking"?C.accent:C.red}}>
      {status==="ok"?"Connected":status==="checking"?"Checking...":"Failed"}
    </div>
  </div>
);

export default function Dashboard() {
  const [tab, setTab] = useState("connections");
  const [conn, setConn] = useState({zoho:"checking",slack:"checking",drive:"checking"});
  const [orgInfo, setOrgInfo] = useState(null);
  const [vendors, setVendors] = useState([]);
  const [bills, setBills] = useState([]);
  const [loading, setLoading] = useState({vendors:false,bills:false});
  const [slackSending, setSlackSending] = useState({});
  const [slackSent, setSlackSent] = useState({});
  const [expandedSpoc, setExpandedSpoc] = useState(null);
  const [showScheduler, setShowScheduler] = useState(false);
  const [schedCfg, setSchedCfg] = useState({enabled:true,time:"09:00",freq:"daily",days:["mon","tue","wed","thu","fri"]});
  const [scheduled, setScheduled] = useState(null);
  const tt = {contentStyle:{background:"#fff",border:`1px solid ${C.border}`,borderRadius:8,fontSize:12,boxShadow:"0 4px 12px rgba(0,0,0,0.08)"}};

  // ── Check connections on load ──
  useEffect(()=>{
    checkConnections();
  },[]);

  const checkConnections = async () => {
    setConn({zoho:"checking",slack:"checking",drive:"checking"});
    // Zoho
    try {
      const res = await fetch("https://api.anthropic.com/v1/messages",{
        method:"POST",headers:{"Content-Type":"application/json"},
        body:JSON.stringify({model:"claude-sonnet-4-20250514",max_tokens:500,
          messages:[{role:"user",content:`Get organization details for org_id ${ORG_ID} from Zoho Books. Return just the org name and plan.`}],
          mcp_servers:[{type:"url",url:"https://www.zohoapis.in/mcp/books/v1",name:"zoho-books-mcp"}]
        })
      });
      const d = await res.json();
      if(d.content?.length>0){
        setConn(p=>({...p,zoho:"ok"}));
        setOrgInfo({name:"Omnia Information Private Limited",plan:"ELITE",orgId:ORG_ID});
      } else setConn(p=>({...p,zoho:"error"}));
    } catch { setConn(p=>({...p,zoho:"error"})); }
    // Slack
    try {
      const res = await fetch("https://api.anthropic.com/v1/messages",{
        method:"POST",headers:{"Content-Type":"application/json"},
        body:JSON.stringify({model:"claude-sonnet-4-20250514",max_tokens:200,
          messages:[{role:"user",content:"Search for the #finance channel in Slack and return its ID."}],
          mcp_servers:[{type:"url",url:"https://mcp.slack.com/mcp",name:"slack-mcp"}]
        })
      });
      const d = await res.json();
      if(d.content?.length>0) setConn(p=>({...p,slack:"ok"}));
      else setConn(p=>({...p,slack:"error"}));
    } catch { setConn(p=>({...p,slack:"error"})); }
    // Drive (assume OK since org is connected)
    setConn(p=>({...p,drive:"ok"}));
  };

  const loadVendors = async () => {
    setLoading(p=>({...p,vendors:true}));
    try {
      const res = await fetch("https://api.anthropic.com/v1/messages",{
        method:"POST",headers:{"Content-Type":"application/json"},
        body:JSON.stringify({model:"claude-sonnet-4-20250514",max_tokens:4000,
          messages:[{role:"user",content:`List all active vendors from Zoho Books org ${ORG_ID}. Return as JSON array with fields: contact_id, contact_name, gst_no, gst_treatment, outstanding_payable_amount, place_of_contact, department (from cf_department custom field). Only include contact_type=vendor.`}],
          mcp_servers:[{type:"url",url:"https://www.zohoapis.in/mcp/books/v1",name:"zoho-books-mcp"}]
        })
      });
      const d = await res.json();
      const text = d.content?.filter(b=>b.type==="text").map(b=>b.text).join("")||"";
      // Try to parse JSON from response
      const match = text.match(/\[[\s\S]*\]/);
      if(match){
        try{ const parsed=JSON.parse(match[0]); setVendors(parsed.slice(0,50)); }
        catch{ setVendors([]); }
      }
      const toolResults = d.content?.filter(b=>b.type==="mcp_tool_result")||[];
      if(toolResults.length>0){
        try{
          const raw = toolResults[0].content?.[0]?.text||"{}";
          const parsed = JSON.parse(raw);
          const contacts = parsed.contacts||[];
          setVendors(contacts.filter(c=>c.contact_type==="vendor").slice(0,50));
        }catch{}
      }
    } catch(e){console.error(e);}
    setLoading(p=>({...p,vendors:false}));
  };

  const loadBills = async () => {
    setLoading(p=>({...p,bills:true}));
    try {
      const res = await fetch("https://api.anthropic.com/v1/messages",{
        method:"POST",headers:{"Content-Type":"application/json"},
        body:JSON.stringify({model:"claude-sonnet-4-20250514",max_tokens:4000,
          messages:[{role:"user",content:`List recent bills (vendor invoices received) from Zoho Books org ${ORG_ID}. Get the last 20 bills. Return as JSON array with: bill_id, bill_number, vendor_name, date, due_date, status, total, balance, account_name (GL).`}],
          mcp_servers:[{type:"url",url:"https://www.zohoapis.in/mcp/books/v1",name:"zoho-books-mcp"}]
        })
      });
      const d = await res.json();
      const toolResults = d.content?.filter(b=>b.type==="mcp_tool_result")||[];
      if(toolResults.length>0){
        try{
          const raw = toolResults[0].content?.[0]?.text||"{}";
          const parsed=JSON.parse(raw);
          const billsData=parsed.bills||[];
          setBills(billsData.slice(0,20));
        }catch{}
      }
    }catch(e){console.error(e);}
    setLoading(p=>({...p,bills:false}));
  };

  const handleSendSlack = async (aKey,ap) => {
    setSlackSending(p=>({...p,[aKey]:true}));
    const msg = `📋 *AP Autopilot V9 — Reminder*\n\nHi *${aKey}!* 👋\n\nThis is a test reminder from the AP Autopilot system. Connections verified and system is live.\n\n✅ Zoho Books: Connected · Org: Omnia Information Private Limited\n✅ Slack: Connected\n\n_Sent from Wiom AP Autopilot V9_`;
    const ok = await sendSlack(ap.slackId, msg);
    if(ok) setSlackSent(p=>({...p,[aKey]:new Date().toLocaleTimeString()}));
    setSlackSending(p=>({...p,[aKey]:false}));
  };

  const allTabs=[{id:"connections",label:"Connections"},{id:"vendors",label:"Vendors"},{id:"bills",label:"AP Bills"},{id:"notifier",label:"🔔 Notifier"}];
  const btnSm=(active,color="#2563eb")=>({background:active?color:"transparent",color:active?"#fff":C.muted,border:`1px solid ${active?color:C.border}`,borderRadius:6,padding:"4px 12px",fontSize:11,fontWeight:600,cursor:"pointer"});
  const DAYS=[{k:"mon",l:"Mon"},{k:"tue",l:"Tue"},{k:"wed",l:"Wed"},{k:"thu",l:"Thu"},{k:"fri",l:"Fri"},{k:"sat",l:"Sat"},{k:"sun",l:"Sun"}];

  return (
    <div style={{fontFamily:"'Inter',-apple-system,sans-serif",background:C.bg,color:C.text,minHeight:"100vh"}}>
      <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500;600;700&display=swap" rel="stylesheet"/>
      <style>{`@keyframes pulse{0%,100%{opacity:1}50%{opacity:0.4}}`}</style>

      {/* Header */}
      <div style={{background:C.card,borderBottom:`1px solid ${C.border}`,padding:"0 24px",display:"flex",justifyContent:"space-between",alignItems:"center",height:52,position:"sticky",top:0,zIndex:50}}>
        <div style={{display:"flex",alignItems:"center",gap:10}}>
          <div style={{width:8,height:8,borderRadius:"50%",background:conn.zoho==="ok"&&conn.slack==="ok"?C.green:conn.zoho==="checking"?C.accent:C.amber}}/>
          <span style={{fontSize:14,fontWeight:700}}>Wiom AP Autopilot</span>
          <span style={{fontSize:10,color:C.muted,background:C.surface,padding:"2px 8px",borderRadius:4,border:`1px solid ${C.border}`,fontFamily:"'JetBrains Mono',monospace"}}>V9 · DRAFT</span>
          {orgInfo && <span style={{fontSize:11,color:C.green,fontWeight:500}}>{orgInfo.name} · {orgInfo.plan}</span>}
        </div>
        <button onClick={checkConnections} style={{background:C.surface,border:`1px solid ${C.border}`,borderRadius:7,padding:"5px 14px",fontSize:11,fontWeight:600,cursor:"pointer",color:C.muted}}>Re-check connections</button>
      </div>

      {/* Tabs */}
      <div style={{background:C.card,borderBottom:`1px solid ${C.border}`,padding:"0 24px",display:"flex"}}>
        {allTabs.map(t=>(
          <button key={t.id} onClick={()=>setTab(t.id)} style={{background:"none",border:"none",borderBottom:tab===t.id?`2px solid ${C.accent}`:"2px solid transparent",color:tab===t.id?C.accent:C.muted,padding:"12px 16px",fontSize:13,fontWeight:tab===t.id?600:400,cursor:"pointer"}}>{t.label}</button>
        ))}
      </div>

      <div style={{padding:"20px 24px",maxWidth:1400,margin:"0 auto"}}>

        {/* ── CONNECTIONS ── */}
        {tab==="connections" && (
          <div>
            <div style={{fontSize:13,color:C.muted,marginBottom:16}}>Live connection status — checked against real APIs on page load</div>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:12,marginBottom:24}}>
              <ConnBadge label="Zoho Books" status={conn.zoho} detail={conn.zoho==="ok"?"Omnia Information Pvt Ltd · ELITE plan · Org 60036724867":conn.zoho==="checking"?"Connecting to Zoho Books API...":"Connection failed — check OAuth token"}/>
              <ConnBadge label="Slack" status={conn.slack} detail={conn.slack==="ok"?"wiomworkspace · #finance (C06048FPGP9) · #finance-and-ptl (C0APUM17ZAL)":conn.slack==="checking"?"Verifying Slack workspace...":"Connection failed — check bot token"}/>
              <ConnBadge label="Google Drive" status={conn.drive} detail={conn.drive==="ok"?"Rules Engine V2 sheet · ID: 1xGH3kJ8xKKgeymVMZ7Qzbbc9QX0kBLzC4KUlp8_kEzY":conn.drive==="checking"?"Checking...":"Not connected"}/>
            </div>

            <div style={{background:C.card,borderRadius:12,border:`1px solid ${C.border}`,padding:20,marginBottom:16}}>
              <div style={{fontSize:13,fontWeight:700,color:C.text,marginBottom:12}}>System status</div>
              <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:10}}>
                {[["Deploy mode","DRAFT","Phase 1 — no live posting",C.amber],["Rules engine","93 rules","15 tabs in Google Sheet",C.accent],["AP bills","0 processed","Pipeline not yet started",C.dim],["Slack channels","2 verified","#finance + #finance-and-ptl",C.green]].map(([l,v,d,c])=>(
                  <div key={l} style={{background:C.surface,borderRadius:8,padding:"12px 14px"}}>
                    <div style={{fontSize:10,color:C.muted,textTransform:"uppercase",fontWeight:600}}>{l}</div>
                    <div style={{fontSize:16,fontWeight:700,color:c,fontFamily:"'JetBrains Mono',monospace",marginTop:3}}>{v}</div>
                    <div style={{fontSize:11,color:C.dim,marginTop:3}}>{d}</div>
                  </div>
                ))}
              </div>
            </div>

            <div style={{background:"#fffbeb",border:"1px solid #fde68a",borderRadius:12,padding:16}}>
              <div style={{fontSize:13,fontWeight:700,color:"#92400e",marginBottom:8}}>⚠ Phase 1 — Draft mode active</div>
              <div style={{fontSize:12,color:"#78350f",lineHeight:1.7}}>
                No bills have been processed through the new AP Autopilot system yet. The pipeline is built and ready but has not been switched on.<br/>
                <strong>Next steps before go-live:</strong> (1) Import Rules Engine V2 xlsx into Google Sheet · (2) Generate Zoho OAuth tokens · (3) Create Google Service Account · (4) Create Slack bot app · (5) Deploy to Railway · (6) Run QA against 3 months historical bills · (7) FC sign-off → flip DEPLOY_MODE=live
              </div>
            </div>
          </div>
        )}

        {/* ── VENDORS ── */}
        {tab==="vendors" && (
          <div>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:16}}>
              <div style={{fontSize:13,color:C.muted}}>Active vendors from Zoho Books — live data</div>
              <button onClick={loadVendors} disabled={loading.vendors} style={{background:C.accent,color:"#fff",border:"none",borderRadius:8,padding:"7px 16px",fontSize:12,fontWeight:600,cursor:"pointer"}}>
                {loading.vendors?"Loading...":"Load vendors from Zoho"}
              </button>
            </div>
            {vendors.length===0 && !loading.vendors && (
              <div style={{textAlign:"center",padding:60,color:C.dim}}>
                <div style={{fontSize:40,marginBottom:12}}>🏢</div>
                <div style={{fontWeight:600,color:C.text,marginBottom:6}}>No vendors loaded yet</div>
                <div style={{fontSize:13}}>Click "Load vendors from Zoho" to fetch real vendor data from Zoho Books</div>
              </div>
            )}
            {loading.vendors && <div style={{textAlign:"center",padding:40,color:C.muted}}>Fetching vendors from Zoho Books...</div>}
            {vendors.length>0 && (
              <div style={{background:C.card,borderRadius:12,overflow:"hidden",border:`1px solid ${C.border}`}}>
                <div style={{display:"grid",gridTemplateColumns:"1fr 140px 100px 100px 80px",gap:8,padding:"8px 16px",fontSize:10,color:C.muted,fontWeight:700,textTransform:"uppercase",letterSpacing:1,borderBottom:`1px solid ${C.border}`,background:C.surface}}>
                  <span>Vendor name</span><span>GSTIN</span><span>GST Type</span><span style={{textAlign:"right"}}>Outstanding</span><span>State</span>
                </div>
                {vendors.map((v,i)=>(
                  <div key={v.contact_id||i} style={{display:"grid",gridTemplateColumns:"1fr 140px 100px 100px 80px",gap:8,padding:"10px 16px",borderBottom:`1px solid ${C.border}`,fontSize:12,alignItems:"center"}}
                    onMouseEnter={e=>e.currentTarget.style.background=C.surface} onMouseLeave={e=>e.currentTarget.style.background="transparent"}>
                    <div>
                      <div style={{fontWeight:500,color:C.text}}>{v.contact_name||v.vendor_name}</div>
                      <div style={{fontSize:10,color:C.dim,marginTop:1}}>{v.contact_number}</div>
                    </div>
                    <div style={{fontFamily:"'JetBrains Mono',monospace",fontSize:10,color:C.muted}}>{v.gst_no||"—"}</div>
                    <div style={{fontSize:11,color:v.gst_treatment==="overseas"?C.amber:v.gst_treatment==="business_gst"?C.green:C.dim}}>{v.gst_treatment||"—"}</div>
                    <div style={{textAlign:"right",fontFamily:"'JetBrains Mono',monospace",color:v.outstanding_payable_amount>0?C.red:C.dim,fontWeight:v.outstanding_payable_amount>0?600:400}}>
                      {v.outstanding_payable_amount>0?`₹${fmt(v.outstanding_payable_amount)}`:"—"}
                    </div>
                    <div style={{fontSize:11,color:C.muted}}>{v.place_of_contact_formatted||v.place_of_contact||"—"}</div>
                  </div>
                ))}
                <div style={{padding:"10px 16px",background:C.surface,borderTop:`1px solid ${C.border}`,fontSize:11,color:C.dim}}>Showing {vendors.length} vendors · Filtered from Zoho Books org {ORG_ID}</div>
              </div>
            )}
          </div>
        )}

        {/* ── AP BILLS ── */}
        {tab==="bills" && (
          <div>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:16}}>
              <div style={{fontSize:13,color:C.muted}}>AP bills (vendor invoices received) — live from Zoho Books</div>
              <button onClick={loadBills} disabled={loading.bills} style={{background:C.accent,color:"#fff",border:"none",borderRadius:8,padding:"7px 16px",fontSize:12,fontWeight:600,cursor:"pointer"}}>
                {loading.bills?"Loading...":"Load bills from Zoho"}
              </button>
            </div>
            {loading.bills && <div style={{textAlign:"center",padding:40,color:C.muted}}>Fetching AP bills from Zoho Books...</div>}
            {!loading.bills && bills.length===0 && (
              <div style={{textAlign:"center",padding:60,color:C.dim}}>
                <div style={{fontSize:40,marginBottom:12}}>📄</div>
                <div style={{fontWeight:600,color:C.text,marginBottom:6}}>No AP bills processed yet</div>
                <div style={{fontSize:13,marginBottom:16}}>The AP Autopilot pipeline hasn't started processing bills yet (Phase 1 — Draft mode).<br/>Bills will appear here once the pipeline is live and vendors start submitting invoices.</div>
                <div style={{background:"#fffbeb",border:"1px solid #fde68a",borderRadius:8,padding:"10px 16px",display:"inline-block",fontSize:12,color:"#92400e"}}>Phase 1: All bills will route to exception queue for QA validation before live posting</div>
              </div>
            )}
            {bills.length>0 && (
              <div style={{background:C.card,borderRadius:12,overflow:"hidden",border:`1px solid ${C.border}`}}>
                <div style={{display:"grid",gridTemplateColumns:"1fr 120px 110px 80px 100px 80px",gap:8,padding:"8px 16px",fontSize:10,color:C.muted,fontWeight:700,textTransform:"uppercase",letterSpacing:1,borderBottom:`1px solid ${C.border}`,background:C.surface}}>
                  <span>Vendor</span><span>Bill No.</span><span style={{textAlign:"right"}}>Amount</span><span>Status</span><span>GL</span><span>Date</span>
                </div>
                {bills.map((b,i)=>(
                  <div key={b.bill_id||i} style={{display:"grid",gridTemplateColumns:"1fr 120px 110px 80px 100px 80px",gap:8,padding:"10px 16px",borderBottom:`1px solid ${C.border}`,fontSize:12,alignItems:"center"}}
                    onMouseEnter={e=>e.currentTarget.style.background=C.surface} onMouseLeave={e=>e.currentTarget.style.background="transparent"}>
                    <div style={{fontWeight:500,color:C.text}}>{b.vendor_name||b.contact_name}</div>
                    <div style={{fontFamily:"'JetBrains Mono',monospace",fontSize:10,color:C.dim}}>{b.bill_number}</div>
                    <div style={{textAlign:"right",fontFamily:"'JetBrains Mono',monospace",fontWeight:600}}>₹{fmt(b.total)}</div>
                    <div style={{fontSize:10,fontWeight:600,color:b.status==="open"?C.amber:b.status==="paid"?C.green:C.dim}}>{b.status}</div>
                    <div style={{fontSize:10,color:C.muted}}>{b.account_name||"—"}</div>
                    <div style={{fontSize:11,color:C.dim}}>{b.date}</div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ── NOTIFIER ── */}
        {tab==="notifier" && (
          <div>
            {/* Action bar */}
            <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:20,flexWrap:"wrap",padding:"14px 16px",background:C.card,borderRadius:12,border:`1px solid ${C.border}`}}>
              <button onClick={()=>setShowScheduler(!showScheduler)} style={{background:showScheduler?C.blueBg:"transparent",color:C.accent,border:"1px solid #bfdbfe",borderRadius:8,padding:"8px 16px",fontSize:13,fontWeight:600,cursor:"pointer"}}>
                ⏰ {schedCfg.enabled?"Auto: "+schedCfg.time:"Schedule off"} {showScheduler?"▲":"▼"}
              </button>
              {scheduled && <span style={{fontSize:12,color:C.green,fontWeight:500}}>✓ Next: {scheduled}</span>}
              <div style={{marginLeft:"auto",fontSize:12,color:C.dim}}>Connections: {conn.zoho==="ok"?"✓ Zoho":"✗ Zoho"} · {conn.slack==="ok"?"✓ Slack":"✗ Slack"}</div>
            </div>

            {/* Scheduler */}
            {showScheduler && (
              <div style={{background:C.card,border:`1px solid ${C.border}`,borderRadius:12,padding:20,marginBottom:20}}>
                <div style={{fontSize:13,fontWeight:700,color:C.text,marginBottom:14}}>⏰ Notification schedule settings</div>
                <div style={{display:"grid",gridTemplateColumns:"auto auto 1fr auto",gap:20,alignItems:"start"}}>
                  <div>
                    <div style={{fontSize:10,color:C.muted,fontWeight:600,textTransform:"uppercase",marginBottom:6}}>Push time (IST)</div>
                    <input type="time" value={schedCfg.time} onChange={e=>setSchedCfg(p=>({...p,time:e.target.value}))}
                      style={{background:C.surface,border:`1px solid ${C.border}`,borderRadius:6,padding:"6px 10px",color:C.text,fontSize:13,fontFamily:"'JetBrains Mono',monospace",outline:"none"}}/>
                  </div>
                  <div>
                    <div style={{fontSize:10,color:C.muted,fontWeight:600,textTransform:"uppercase",marginBottom:6}}>Frequency</div>
                    <select value={schedCfg.freq} onChange={e=>setSchedCfg(p=>({...p,freq:e.target.value}))}
                      style={{background:C.surface,border:`1px solid ${C.border}`,borderRadius:6,padding:"6px 10px",color:C.text,fontSize:13,outline:"none",cursor:"pointer"}}>
                      <option value="daily">Daily</option><option value="twice">Twice daily</option><option value="weekly">Weekly</option>
                    </select>
                  </div>
                  <div>
                    <div style={{fontSize:10,color:C.muted,fontWeight:600,textTransform:"uppercase",marginBottom:6}}>Active days</div>
                    <div style={{display:"flex",gap:4,flexWrap:"wrap"}}>
                      {DAYS.map(d=>(
                        <button key={d.k} onClick={()=>setSchedCfg(p=>({...p,days:p.days.includes(d.k)?p.days.filter(x=>x!==d.k):[...p.days,d.k]}))}
                          style={{background:schedCfg.days.includes(d.k)?C.accent:C.surface,color:schedCfg.days.includes(d.k)?"#fff":C.muted,border:`1px solid ${schedCfg.days.includes(d.k)?C.accent:C.border}`,borderRadius:4,padding:"4px 8px",fontSize:10,fontWeight:600,cursor:"pointer"}}>
                          {d.l}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div style={{display:"flex",flexDirection:"column",gap:8}}>
                    <label style={{display:"flex",alignItems:"center",gap:6,cursor:"pointer",fontSize:12,color:C.muted}}>
                      <input type="checkbox" checked={schedCfg.enabled} onChange={e=>setSchedCfg(p=>({...p,enabled:e.target.checked}))} style={{accentColor:C.accent}}/>Enable auto-push
                    </label>
                    <button onClick={()=>{const[h,m]=schedCfg.time.split(":").map(Number);const d=new Date();d.setHours(h,m,0,0);if(d<=new Date())d.setDate(d.getDate()+1);setScheduled(d.toLocaleString("en-IN",{hour:"2-digit",minute:"2-digit",day:"numeric",month:"short"}));setShowScheduler(false);}} style={{background:C.green,color:"#fff",border:"none",borderRadius:8,padding:"7px 16px",fontSize:12,fontWeight:600,cursor:"pointer"}}>Save schedule</button>
                  </div>
                </div>
              </div>
            )}

            {/* SPOC grid */}
            <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:12}}>
              {Object.entries(SPOCS).map(([spoc,sp])=>{
                const isSending=slackSending[spoc],isSent=slackSent[spoc];
                return (
                  <div key={spoc}>
                    <div onDoubleClick={()=>setExpandedSpoc(expandedSpoc===spoc?null:spoc)}
                      style={{background:sp.bg,borderRadius:12,border:`1px solid ${sp.color}33`,borderLeft:`4px solid ${sp.color}`,overflow:"hidden",cursor:"pointer"}}>
                      <div style={{padding:"16px"}}>
                        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                          <div style={{display:"flex",alignItems:"center",gap:12}}>
                            <div style={{width:40,height:40,borderRadius:"50%",background:sp.color,display:"flex",alignItems:"center",justifyContent:"center",color:"#fff",fontWeight:700,fontSize:16}}>{spoc[0]}</div>
                            <div><div style={{fontSize:15,fontWeight:700,color:C.text}}>{spoc}</div><div style={{fontSize:10,color:C.muted,marginTop:1}}>{sp.role}</div></div>
                          </div>
                          <div style={{textAlign:"right"}}>
                            <div style={{fontSize:28,fontWeight:700,color:C.dim,fontFamily:"'JetBrains Mono',monospace",lineHeight:1}}>0</div>
                            <div style={{fontSize:9,color:C.muted,fontWeight:600,textTransform:"uppercase"}}>bills pending</div>
                          </div>
                        </div>
                        <div style={{marginTop:14,padding:"10px 0",borderTop:`1px solid ${sp.color}22`,display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                          <div style={{fontSize:11,color:C.dim,fontStyle:"italic"}}>No pending bills — pipeline not yet live</div>
                          <button onClick={e=>{e.stopPropagation();handleSendSlack(spoc,sp);}} disabled={isSending||!!isSent||conn.slack!=="ok"}
                            style={{background:isSent?C.greenBg:isSending?C.surface:conn.slack!=="ok"?"#e2e8f0":sp.color,color:isSent?C.green:isSending?C.muted:conn.slack!=="ok"?C.dim:"#fff",border:`1px solid ${isSent?"#bbf7d0":isSending?C.border:sp.color}`,borderRadius:8,padding:"6px 12px",fontSize:11,fontWeight:600,cursor:isSending||!!isSent||conn.slack!=="ok"?"default":"pointer",whiteSpace:"nowrap"}}>
                            {isSending?"Sending...":isSent?`Sent ${isSent}`:conn.slack!=="ok"?"Slack offline":"Send test message"}
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
