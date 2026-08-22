/**
 * SmartPanel — REST API
 */
const express = require("express");
const router  = express.Router();
const { dao } = require("../database");
const { login, requireAuth, requireRole } = require("../auth");
const { notificarTicketCritico, notificarTicketResolvido } = require("../email");

let io = null;
const setIO = (i) => { io = i; };

// ── Helpers ───────────────────────────────────────────────
function snap(dispositivos={}) {
  return {
    avisos:       dao.getTodosAvisos(),
    tickets:      dao.listarTickets({ limit:50 }),
    visitantes:   dao.listarVisitantesHoje(),
    logs:         dao.listarLogs(30),
    agendamentos: dao.listarAgendamentos(),
    uploads:      dao.listarUploads(),
    fila:         buildFila(),
    stats:        { ...dao.getStats(), tvsOnline: Object.values(dispositivos).filter(d=>d.online).length },
    dispositivos,
  };
}

function buildFila() {
  const hoje = dao.listarFilaHoje();
  return {
    aguardando:  hoje.filter(s=>s.status==="aguardando"),
    atendimento: hoje.filter(s=>s.status==="chamando"),
    total:       hoje.length,
  };
}

// ── Auth ─────────────────────────────────────────────────
router.post("/auth/login", async (req,res) => {
  try {
    const { email, senha } = req.body;
    if (!email||!senha) return res.status(400).json({ erro:"Email e senha obrigatórios" });
    res.json(await login(email, senha));
  } catch(e) { res.status(401).json({ erro:e.message }); }
});
router.get("/auth/me", requireAuth, (req,res) => res.json(dao.getUsuarioById(req.user.id)));

// ── Status ────────────────────────────────────────────────
router.get("/status", (_,res) => res.json({ ok:true, uptime:process.uptime(), ts:new Date().toLocaleString("pt-BR") }));
router.get("/snapshot", requireAuth, (req,res) => res.json(snap()));

// ── Avisos ────────────────────────────────────────────────
router.get("/avisos", requireAuth, (_,res) => res.json(dao.getTodosAvisos()));
router.get("/avisos/:setor/historico", requireAuth, (req,res) => res.json(dao.historicoAvisos(req.params.setor)));
router.put("/avisos/:setor", requireAuth, (req,res) => {
  const { setor } = req.params; const { msg } = req.body;
  if (!msg) return res.status(400).json({ erro:"msg obrigatório" });
  dao.setAviso(setor, msg, req.user.nome);
  dao.addLog("aviso", setor, msg, req.user.nome);
  io?.to(`setor:${setor}`).emit("aviso:novo", { setor, msg });
  io?.to("admins").emit("aviso:novo", { setor, msg });
  res.json({ ok:true });
});

// ── Tickets ───────────────────────────────────────────────
router.get("/tickets", requireAuth, (req,res) => res.json(dao.listarTickets(req.query)));
router.post("/tickets", requireAuth, async (req,res) => {
  const { desc, setor, prioridade, solicitante } = req.body;
  if (!desc||!setor) return res.status(400).json({ erro:"desc e setor obrigatórios" });
  const result = dao.criarTicket(desc, setor, prioridade||"media", solicitante||req.user.nome);
  const ticket = dao.getTicket(result.lastInsertRowid);
  dao.addLog("ticket", setor, `Ticket #${ticket.id}: ${desc}`, req.user.nome);
  io?.to("admins").emit("ticket:criado", ticket);
  io?.to("admins").emit("tickets:update", dao.listarTickets());
  io?.to(`setor:${setor}`).emit("ticket:criado", ticket);
  if (ticket.prioridade==="alta") await notificarTicketCritico(ticket);
  res.status(201).json(ticket);
});
router.patch("/tickets/:id", requireAuth, async (req,res) => {
  const ticket = dao.getTicket(req.params.id);
  if (!ticket) return res.status(404).json({ erro:"Ticket não encontrado" });
  dao.atualizarTicket(ticket.id, req.body.status);
  dao.addLog("ticket", ticket.setor, `Ticket #${ticket.id} → ${req.body.status}`, req.user.nome);
  const atualizado = dao.getTicket(ticket.id);
  io?.to("admins").emit("tickets:update", dao.listarTickets());
  if (req.body.status==="resolvido") await notificarTicketResolvido(atualizado);
  res.json(atualizado);
});

// ── Visitantes ────────────────────────────────────────────
router.get("/visitantes", requireAuth, (_,res) => res.json(dao.listarVisitantesHoje()));
router.patch("/visitantes/:id", requireAuth, (req,res) => {
  dao.atualizarVisitante(req.params.id, req.body.status);
  const lista = dao.listarVisitantesHoje();
  io?.to("admins").emit("visitantes:update", lista);
  io?.to("setor:recepcao").emit("visitantes:update", lista);
  io?.to("fila-publica").emit("fila:update", buildFila());
  res.json({ ok:true });
});
router.get("/visitantes/qr/:token", (req,res) => {
  const v = dao.getVisitantePorToken(req.params.token);
  if (!v) return res.status(404).json({ erro:"QR inválido" });
  res.json({ ok:true, visitante:v });
});
router.post("/visitantes/qr/:token/checkin", (req,res) => {
  const v = dao.getVisitantePorToken(req.params.token);
  if (!v) return res.status(404).json({ erro:"QR inválido" });
  dao.atualizarVisitante(v.id, "atendimento");
  dao.addLog("visitante","recepcao",`Check-in QR: ${v.nome}`,"qr");
  const lista = dao.listarVisitantesHoje();
  io?.to("admins").emit("visitantes:update", lista);
  io?.to("setor:recepcao").emit("visitantes:update", lista);
  io?.to("fila-publica").emit("fila:update", buildFila());
  res.json({ ok:true, visitante:{...v,status:"atendimento"} });
});

// ── Agendamentos ──────────────────────────────────────────
router.get("/agendamentos", requireAuth, (_,res) => res.json(dao.listarAgendamentos()));
router.post("/agendamentos", requireAuth, (req,res) => {
  const { setor,titulo,conteudo,hora_ini,hora_fim,dias } = req.body;
  if (!setor||!titulo||!conteudo||!hora_ini||!hora_fim) return res.status(400).json({ erro:"Campos obrigatórios faltando" });
  const r = dao.criarAgendamento(setor,titulo,conteudo,hora_ini,hora_fim,dias||"1,2,3,4,5");
  dao.addLog("agendamento",setor,`Criado: ${titulo}`,req.user.nome);
  res.status(201).json({ id:r.lastInsertRowid,...req.body });
});
router.patch("/agendamentos/:id", requireAuth, (req,res) => {
  dao.toggleAgendamento(req.params.id, req.body.ativo?1:0);
  res.json({ ok:true });
});
router.delete("/agendamentos/:id", requireAuth, requireRole("admin"), (req,res) => {
  dao.deletarAgendamento(req.params.id);
  res.json({ ok:true });
});

// ── Uploads ───────────────────────────────────────────────
router.get("/uploads", requireAuth, (req,res) => res.json(dao.listarUploads(req.query.setor)));
router.delete("/uploads/:id", requireAuth, (req,res) => {
  const up = dao.listarUploads().find(u=>u.id==req.params.id);
  if (!up) return res.status(404).json({ erro:"Não encontrado" });
  const fs=require("fs"), path=require("path");
  const fp = path.join(__dirname,"..","uploads",path.basename(up.arquivo));
  if (fs.existsSync(fp)) fs.unlinkSync(fp);
  dao.deletarUpload(req.params.id);
  res.json({ ok:true });
});

// ── Logs / Emails ─────────────────────────────────────────
router.get("/logs",   requireAuth, (req,res) => res.json(dao.listarLogs(req.query.limit||50)));
router.get("/emails", requireAuth, requireRole("admin"), (_,res) => res.json(dao.listarEmails()));

// ── Usuários ─────────────────────────────────────────────
router.get("/usuarios", requireAuth, requireRole("admin"), (_,res) => res.json(dao.listarUsuarios()));
router.post("/usuarios", requireAuth, requireRole("admin"), (req,res) => {
  const { nome,email,senha,role } = req.body;
  if (!nome||!email||!senha) return res.status(400).json({ erro:"Campos obrigatórios" });
  try { dao.criarUsuario(nome,email,senha,role||"viewer"); res.status(201).json({ ok:true }); }
  catch { res.status(400).json({ erro:"Email já cadastrado" }); }
});
router.patch("/usuarios/:id", requireAuth, requireRole("admin"), (req,res) => {
  const { nome,role,senha } = req.body;
  if (nome||role) dao.atualizarUsuario(req.params.id, nome||"", role||"viewer");
  if (senha)      dao.trocarSenha(req.params.id, senha);
  res.json({ ok:true });
});
router.delete("/usuarios/:id", requireAuth, requireRole("admin"), (req,res) => {
  if (req.params.id == req.user.id) return res.status(400).json({ erro:"Não pode remover a si mesmo" });
  dao.desativarUsuario(req.params.id);
  res.json({ ok:true });
});

// ── Fila ─────────────────────────────────────────────────
router.get("/fila", (_,res) => res.json(buildFila()));
router.get("/guiches", (_,res) => res.json(dao.listarGuiches()));

router.post("/fila/emitir", requireAuth, (req,res) => {
  const senha = dao.emitirSenha(req.body.prefixo||"A", req.body.tipo||"geral");
  const num   = `${senha.prefixo}${String(senha.numero).padStart(3,"0")}`;
  dao.addLog("fila","recepcao",`Senha emitida: ${num}`,req.user.nome);
  io?.to("fila-publica").emit("senha:nova", senha);
  io?.to("admins").emit("fila:update", buildFila());
  io?.to("fila-publica").emit("fila:update", buildFila());
  res.status(201).json({ ...senha, numFmt:num });
});
router.post("/fila/chamar", requireAuth, async (req,res) => {
  const { id, prefixo="A", guiche="Guichê 1" } = req.body;
  const senha = id ? dao.chamarSenha(id,guiche) : dao.chamarProxima(prefixo,guiche);
  if (!senha) return res.status(404).json({ erro:"Nenhuma senha na fila" });
  const numFmt = `${senha.prefixo}${String(senha.numero).padStart(3,"0")}`;
  dao.addLog("fila","recepcao",`Senha ${numFmt} → ${guiche}`,req.user.nome);
  io?.to("fila-publica").emit("senha:chamada", { senha, guiche, numFmt });
  io?.to("admins").emit("senha:chamada", { senha, guiche, numFmt });
  io?.to("fila-publica").emit("fila:update", buildFila());
  io?.to("admins").emit("fila:update", buildFila());
  const { notificarSenhaChamada } = require("../email");
  await notificarSenhaChamada(numFmt, guiche);
  res.json({ ok:true, numFmt, guiche });
});
router.post("/fila/reset", requireAuth, requireRole("admin"), (_,res) => {
  dao.resetarFila();
  io?.to("fila-publica").emit("fila:update", buildFila());
  io?.to("admins").emit("fila:update", buildFila());
  res.json({ ok:true });
});

module.exports = { router, setIO, snap, buildFila };
