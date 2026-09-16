/**
 * SmartPanel v4.0 — Servidor Principal
 */
require("dotenv").config();

const express    = require("express");
const http       = require("http");
const { Server } = require("socket.io");
const path       = require("path");
const cors       = require("cors");
const rateLimit  = require("express-rate-limit");

const { dao, init: initDB }    = require("./database");
const { verificarTokenSocket } = require("./auth");
const { notificarTicketCritico, notificarTicketResolvido } = require("./email");
const { iniciar: iniciarScheduler } = require("./scheduler");
const { router: apiRouter, setIO: setApiIO, snap, buildFila } = require("./routes/api");
const { router: uploadRouter, setIO: setUploadIO } = require("./routes/upload");

const app    = express();
const server = http.createServer(app);
const io     = new Server(server, {
  cors: { origin: "*", methods:["GET","POST"] },
  pingTimeout: 10000, pingInterval: 5000,
});

// ── Middleware ────────────────────────────────────────────
app.use(cors());
app.use(express.json({ limit:"10mb" }));
app.use(express.urlencoded({ extended:true }));
app.use(express.static(path.join(__dirname, "public")));
app.use("/uploads", express.static(path.join(__dirname, "uploads")));

// Rate limit no login — máx 20 tentativas por 15min por IP
app.use("/api/auth/login", rateLimit({
  windowMs: 15*60*1000, max:20,
  message: { erro:"Muitas tentativas. Aguarde 15 minutos." },
  standardHeaders:true, legacyHeaders:false,
}));

// ── Rotas ─────────────────────────────────────────────────
setApiIO(io); setUploadIO(io);
app.use("/api",        apiRouter);
app.use("/api/upload", uploadRouter);

app.get("/admin",        (_,res) => res.sendFile(path.join(__dirname,"public","admin","index.html")));
app.get("/tv",           (_,res) => res.sendFile(path.join(__dirname,"public","tv","index.html")));
app.get("/fila",         (_,res) => res.sendFile(path.join(__dirname,"public","fila","index.html")));
app.get("/checkin",      (_,res) => res.sendFile(path.join(__dirname,"public","checkin.html")));
app.get("/checkin/:t",   (_,res) => res.sendFile(path.join(__dirname,"public","checkin.html")));

// Middleware de erro global
app.use((err,req,res,_next) => {
  console.error("[ERRO]", err.message);
  res.status(err.status||500).json({ erro: err.message||"Erro interno do servidor" });
});

// ── Estado de dispositivos ────────────────────────────────
let dispositivos = {};

// ── Socket.IO Auth ────────────────────────────────────────
io.use((socket, next) => {
  const tipo  = socket.handshake.query?.tipo || "tv";
  // TVs e tela pública não precisam de JWT
  if (tipo === "tv" || tipo === "publico") return next();
  const token = socket.handshake.auth?.token || socket.handshake.query?.token;
  if (!token) return next(new Error("TOKEN_REQUIRED"));
  const user = verificarTokenSocket(token);
  if (!user)  return next(new Error("TOKEN_INVALID"));
  socket.user = user;
  next();
});

// ── Socket.IO Conexões ────────────────────────────────────
io.on("connection", (socket) => {
  const setor = socket.handshake.query.setor || "admin";
  const tipo  = socket.handshake.query.tipo  || "admin";
  const nome  = socket.user?.nome || socket.handshake.query.nome || `Painel-${socket.id.slice(0,4)}`;

  dispositivos[socket.id] = {
    id: socket.id, nome, setor, tipo, online:true,
    ip: socket.handshake.address,
    conectadoEm: new Date().toLocaleString("pt-BR"),
    lastPing: new Date(),
  };

  console.log(`  [+] ${tipo.toUpperCase()} — setor:${setor} | ${nome}`);
  dao.addLog("dispositivo", setor, `${nome} conectou (${tipo})`, nome);

  if (tipo === "admin")   socket.join("admins");
  if (tipo === "tv")      socket.join(`setor:${setor}`);
  if (tipo === "publico") socket.join("fila-publica");

  socket.emit("snapshot", snap(dispositivos));
  io.to("admins").emit("devices:update", dispositivos);

  // ── Avisos ──────────────────────────────────────────────
  socket.on("aviso:enviar", ({ setor:s, msg, autor }) => {
    if (!s||!msg) return;
    dao.setAviso(s, msg, autor||nome);
    dao.addLog("aviso", s, msg, autor||nome);
    io.to(`setor:${s}`).emit("aviso:novo", { setor:s, msg });
    io.to("admins").emit("aviso:novo", { setor:s, msg });
    io.to("admins").emit("logs:entry", dao.listarLogs(1)[0]);
  });

  socket.on("aviso:broadcast", ({ msg, autor }) => {
    ["recepcao","ti","escritorio","administrativo","rh"].forEach(s => dao.setAviso(s, msg, autor||nome));
    dao.addLog("aviso","todos",`BROADCAST: ${msg}`, autor||nome);
    io.emit("aviso:novo", { setor:"todos", msg });
    io.to("admins").emit("logs:entry", dao.listarLogs(1)[0]);
  });

  // ── Tickets ─────────────────────────────────────────────
  socket.on("ticket:novo", async ({ desc, setor:s, prioridade, solicitante }) => {
    if (!desc||!s) return;
    try {
      const result = dao.criarTicket(desc, s, prioridade||"media", solicitante||nome);
      const ticket = dao.getTicket(result.lastInsertRowid);
      dao.addLog("ticket", s, `Ticket #${ticket.id}: ${desc}`, solicitante||nome);
      io.to("admins").emit("ticket:criado", ticket);
      io.to("admins").emit("tickets:update", dao.listarTickets());
      io.to(`setor:${s}`).emit("ticket:criado", ticket);
      io.to("admins").emit("logs:entry", dao.listarLogs(1)[0]);
      socket.emit("ticket:criado", ticket);
      if (ticket.prioridade==="alta") await notificarTicketCritico(ticket);
    } catch(e) { console.error("ticket:novo", e.message); }
  });

  socket.on("ticket:status", async ({ id, status, autor }) => {
    try {
      const ticket = dao.getTicket(id);
      if (!ticket) return;
      dao.atualizarTicket(id, status);
      dao.addLog("ticket", ticket.setor, `Ticket #${id} → ${status}`, autor||nome);
      io.to("admins").emit("tickets:update", dao.listarTickets());
      io.to("admins").emit("logs:entry", dao.listarLogs(1)[0]);
      if (status==="resolvido") await notificarTicketResolvido(dao.getTicket(id));
    } catch(e) { console.error("ticket:status", e.message); }
  });

  // ── Visitantes ──────────────────────────────────────────
  socket.on("visitante:novo", async ({ nome:n, empresa, destino }) => {
    if (!n) return;
    try {
      const token = `${Date.now()}-${Math.random().toString(36).slice(2,6).toUpperCase()}`;
      dao.criarVisitante(n, empresa, destino, token);
      dao.addLog("visitante","recepcao",`${n} chegou`,"Recepção");
      const lista = dao.listarVisitantesHoje();
      io.to("admins").emit("visitantes:update", lista);
      io.to("setor:recepcao").emit("visitantes:update", lista);
      io.to("fila-publica").emit("fila:update", buildFila());
      socket.emit("visitante:registrado", { nome:n, token });
    } catch(e) { console.error("visitante:novo", e.message); }
  });

  socket.on("visitante:status", ({ id, status }) => {
    dao.atualizarVisitante(id, status);
    const lista = dao.listarVisitantesHoje();
    io.to("admins").emit("visitantes:update", lista);
    io.to("setor:recepcao").emit("visitantes:update", lista);
    io.to("fila-publica").emit("fila:update", buildFila());
  });

  // ── Keepalive ────────────────────────────────────────────
  socket.on("ping:tv", () => {
    if (dispositivos[socket.id]) {
      dispositivos[socket.id].lastPing = new Date();
      dispositivos[socket.id].online   = true;
    }
    socket.emit("pong:tv");
  });

  socket.on("snapshot:request", () => socket.emit("snapshot", snap(dispositivos)));

  // ── Disconnect ───────────────────────────────────────────
  socket.on("disconnect", () => {
    const d = dispositivos[socket.id];
    if (!d) return;
    d.online = false;
    dao.addLog("dispositivo", d.setor, `${d.nome} desconectou`, d.nome);
    io.to("admins").emit("devices:update", dispositivos);
    setTimeout(() => { delete dispositivos[socket.id]; io.to("admins").emit("devices:update", dispositivos); }, 30000);
    console.log(`  [-] ${d.tipo?.toUpperCase()} desconectou — ${d.setor}`);
  });
});

// ── Métricas TI (simuladas, atualiza a cada 8s) ───────────
let metricas = { cpu:42, ram:91, disco:78 };
setInterval(() => {
  const rand = (b,d) => Math.min(100, Math.max(0, b+(Math.random()-.5)*d));
  metricas = { cpu:Math.round(rand(metricas.cpu,8)), ram:Math.round(rand(metricas.ram,4)), disco:Math.round(rand(metricas.disco,2)) };
  io.emit("metricas:update", { ti:metricas });
}, 8000);

// ── Start ─────────────────────────────────────────────────
// Iniciar tudo após o banco estar pronto
async function start() {
  await initDB();
  iniciarScheduler(io);
  const PORT = process.env.PORT || 3000;
  server.listen(PORT, "0.0.0.0", () => {
  console.log(`\n🚀 SmartPanel v4.0 — porta ${PORT}`);
  console.log(`\n   🖥  Admin:  http://localhost:${PORT}/admin`);
  console.log(`   📺  TV Box: http://localhost:${PORT}/tv?setor=recepcao`);
  console.log(`   🎫  Fila:   http://localhost:${PORT}/fila`);
  console.log(`   📡  API:    http://localhost:${PORT}/api/status`);
  console.log(`\n   Login: admin@smartpanel.com / admin123\n`);
  });
}

start().catch(e => { console.error('Erro ao iniciar:', e); process.exit(1); });
