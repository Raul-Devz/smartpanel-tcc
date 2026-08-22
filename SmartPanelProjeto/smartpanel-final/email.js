/**
 * SmartPanel — Email Simulado
 */
const { dao } = require("./database");

const C = { R:"\x1b[0m", CY:"\x1b[36m", YE:"\x1b[33m", GR:"\x1b[32m", RE:"\x1b[31m", BO:"\x1b[1m" };
const W = 48;
const pad   = (s,w) => { s=String(s||""); return s.length>w ? s.slice(0,w-1)+"…" : s.padEnd(w); };
const wrap  = (txt,w) => {
  const words=txt.replace(/\n/g," ").split(" "); const lines=[]; let cur="";
  for(const wd of words){ const n=cur?cur+" "+wd:wd; if(n.length>w){if(cur)lines.push(cur);cur=wd.slice(0,w);}else cur=n; }
  if(cur)lines.push(cur); return lines.length?lines:[""];
};

async function enviarEmail({ para, assunto, corpo, tipo="info" }) {
  const cor={info:C.CY,alerta:C.YE,critico:C.RE,sucesso:C.GR}[tipo]||C.CY;
  await new Promise(r=>setTimeout(r,120));
  const sep="─".repeat(W);
  console.log(`\n${cor}${C.BO}┌${sep}┐`);
  console.log(`│ ${"📧 E-MAIL SIMULADO".padEnd(W-1)}│`);
  console.log(`├${sep}┤${C.R}${cor}`);
  console.log(`│ ${pad("Para:    "+para,W-2)} │`);
  console.log(`│ ${pad("Assunto: "+assunto,W-2)} │`);
  console.log(`│ ${pad("Tipo:    "+tipo,W-2)} │`);
  console.log(`├${sep}┤`);
  wrap(corpo,W).forEach(l=>console.log(`│ ${pad(l,W-2)} │`));
  console.log(`└${sep}┘${C.R}\n`);
  dao.addEmail(para, assunto, corpo, "enviado");
  return { ok:true };
}

const notificarTicketCritico  = (t)     => enviarEmail({ para:"admin@smartpanel.com",  assunto:`🚨 Ticket Crítico #${t.id} — ${t.setor.toUpperCase()}`, corpo:`Ticket ALTA PRIORIDADE aberto! Setor: ${t.setor}. Desc: ${t.descricao}. Solicitante: ${t.solicitante||"N/A"}. ${new Date().toLocaleString("pt-BR")}`, tipo:"critico" });
const notificarTicketResolvido = (t)    => enviarEmail({ para:`${(t.solicitante||"sol").toLowerCase().replace(/\s/g,".")}@empresa.com`, assunto:`✅ Ticket #${t.id} Resolvido`, corpo:`Chamado #${t.id} resolvido em ${new Date().toLocaleString("pt-BR")}: ${t.descricao}`, tipo:"sucesso" });
const notificarVisitante       = (v)    => enviarEmail({ para:"recepcao@empresa.com",  assunto:`👤 Novo Visitante — ${v.nome}`, corpo:`Visitante: ${v.nome}. Empresa: ${v.empresa||"N/A"}. Destino: ${v.destino||"N/A"}. ${new Date().toLocaleString("pt-BR")}`, tipo:"info" });
const notificarSenhaChamada    = (n,g)  => enviarEmail({ para:"recepcao@empresa.com",  assunto:`🔔 Senha ${n} chamada — ${g}`, corpo:`Senha ${n} chamada para ${g} às ${new Date().toLocaleTimeString("pt-BR")}.`, tipo:"alerta" });

module.exports = { enviarEmail, notificarTicketCritico, notificarTicketResolvido, notificarVisitante, notificarSenhaChamada };
