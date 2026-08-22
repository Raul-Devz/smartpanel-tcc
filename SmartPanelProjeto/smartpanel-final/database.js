/**
 * SmartPanel — Database (SQLite)
 */
require("dotenv").config();
const Database = require("better-sqlite3");
const bcrypt   = require("bcryptjs");
const path     = require("path");
const fs       = require("fs");

const DATA_DIR = path.join(__dirname, "data");
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const db = new Database(path.join(DATA_DIR, "smartpanel.db"));
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

// ── Tabelas ──────────────────────────────────────────────
db.exec(`
  CREATE TABLE IF NOT EXISTS usuarios (
    id        INTEGER PRIMARY KEY AUTOINCREMENT,
    nome      TEXT    NOT NULL,
    email     TEXT    NOT NULL UNIQUE,
    senha     TEXT    NOT NULL,
    role      TEXT    NOT NULL DEFAULT 'viewer',
    ativo     INTEGER NOT NULL DEFAULT 1,
    criado_em TEXT    NOT NULL DEFAULT (datetime('now','localtime'))
  );
  CREATE TABLE IF NOT EXISTS avisos (
    id        INTEGER PRIMARY KEY AUTOINCREMENT,
    setor     TEXT    NOT NULL,
    msg       TEXT    NOT NULL,
    autor     TEXT    NOT NULL DEFAULT 'sistema',
    ativo     INTEGER NOT NULL DEFAULT 1,
    criado_em TEXT    NOT NULL DEFAULT (datetime('now','localtime'))
  );
  CREATE TABLE IF NOT EXISTS tickets (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    descricao    TEXT    NOT NULL,
    setor        TEXT    NOT NULL,
    prioridade   TEXT    NOT NULL DEFAULT 'media',
    status       TEXT    NOT NULL DEFAULT 'aberto',
    solicitante  TEXT,
    resolvido_em TEXT,
    criado_em    TEXT    NOT NULL DEFAULT (datetime('now','localtime'))
  );
  CREATE TABLE IF NOT EXISTS visitantes (
    id        INTEGER PRIMARY KEY AUTOINCREMENT,
    nome      TEXT    NOT NULL,
    empresa   TEXT,
    destino   TEXT,
    entrada   TEXT    NOT NULL DEFAULT (time('now','localtime')),
    saida     TEXT,
    status    TEXT    NOT NULL DEFAULT 'aguardando',
    qr_token  TEXT    UNIQUE,
    data      TEXT    NOT NULL DEFAULT (date('now','localtime')),
    criado_em TEXT    NOT NULL DEFAULT (datetime('now','localtime'))
  );
  CREATE TABLE IF NOT EXISTS logs (
    id        INTEGER PRIMARY KEY AUTOINCREMENT,
    tipo      TEXT    NOT NULL,
    setor     TEXT,
    msg       TEXT    NOT NULL,
    autor     TEXT,
    criado_em TEXT    NOT NULL DEFAULT (datetime('now','localtime'))
  );
  CREATE TABLE IF NOT EXISTS agendamentos (
    id        INTEGER PRIMARY KEY AUTOINCREMENT,
    setor     TEXT    NOT NULL,
    titulo    TEXT    NOT NULL,
    conteudo  TEXT    NOT NULL,
    hora_ini  TEXT    NOT NULL,
    hora_fim  TEXT    NOT NULL,
    dias      TEXT    NOT NULL DEFAULT '1,2,3,4,5',
    ativo     INTEGER NOT NULL DEFAULT 1,
    criado_em TEXT    NOT NULL DEFAULT (datetime('now','localtime'))
  );
  CREATE TABLE IF NOT EXISTS uploads (
    id        INTEGER PRIMARY KEY AUTOINCREMENT,
    nome      TEXT    NOT NULL,
    arquivo   TEXT    NOT NULL,
    setor     TEXT,
    tipo      TEXT    NOT NULL DEFAULT 'imagem',
    criado_em TEXT    NOT NULL DEFAULT (datetime('now','localtime'))
  );
  CREATE TABLE IF NOT EXISTS emails_log (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    destinatario TEXT    NOT NULL,
    assunto      TEXT    NOT NULL,
    corpo        TEXT    NOT NULL,
    status       TEXT    NOT NULL DEFAULT 'enviado',
    criado_em    TEXT    NOT NULL DEFAULT (datetime('now','localtime'))
  );
  CREATE TABLE IF NOT EXISTS senhas (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    numero     INTEGER NOT NULL,
    prefixo    TEXT    NOT NULL DEFAULT 'A',
    tipo       TEXT    NOT NULL DEFAULT 'geral',
    status     TEXT    NOT NULL DEFAULT 'aguardando',
    guiche     TEXT,
    data       TEXT    NOT NULL DEFAULT (date('now','localtime')),
    chamada_em TEXT,
    criado_em  TEXT    NOT NULL DEFAULT (datetime('now','localtime'))
  );
  CREATE TABLE IF NOT EXISTS guiches (
    id   INTEGER PRIMARY KEY AUTOINCREMENT,
    nome TEXT    NOT NULL,
    ativo INTEGER NOT NULL DEFAULT 1
  );
`);

// ── Seed ─────────────────────────────────────────────────
function seed() {
  if (!db.prepare("SELECT id FROM usuarios WHERE email=?").get("admin@smartpanel.com")) {
    db.prepare("INSERT INTO usuarios (nome,email,senha,role) VALUES (?,?,?,?)")
      .run("Administrador", "admin@smartpanel.com", bcrypt.hashSync("admin123", 10), "admin");
    db.prepare("INSERT INTO usuarios (nome,email,senha,role) VALUES (?,?,?,?)")
      .run("Editor TI", "ti@smartpanel.com", bcrypt.hashSync("ti123", 10), "editor");
    console.log("  ✅ Usuários criados: admin@smartpanel.com / admin123");
  }

  const avisosIni = {
    recepcao:       "👋 Bem-vindo! Retire sua senha e aguarde o atendimento.",
    ti:             "🖥 Todos os sistemas operando normalmente.",
    escritorio:     "📋 Reunião geral às 14h — Sala de Reunião A.",
    administrativo: "📊 Relatório mensal deve ser entregue até sexta-feira.",
    rh:             "🎉 Aniversariantes da semana: Ana Paula, Lucas e Mariana!",
  };
  Object.entries(avisosIni).forEach(([s, m]) => {
    if (!db.prepare("SELECT id FROM avisos WHERE setor=? AND ativo=1").get(s))
      db.prepare("INSERT INTO avisos (setor,msg,autor) VALUES (?,?,?)").run(s, m, "sistema");
  });

  if (!db.prepare("SELECT id FROM tickets LIMIT 1").get()) {
    [
      ["Impressora não responde na sala 3",   "ti",            "alta",  "aberto",   "Escritório"],
      ["Acesso negado ao sistema ERP",         "administrativo","alta",  "andamento","ADM"],
      ["Painel da recepção travou",            "recepcao",      "media", "resolvido","Recepção"],
      ["Monitor sem sinal — sala reunião",     "escritorio",    "media", "aberto",   "Escritório"],
      ["Wi-Fi instável corredor B",            "ti",            "media", "resolvido","RH"],
      ["Nobreak sem carga",                    "ti",            "alta",  "aberto",   "TI"],
    ].forEach(t => db.prepare("INSERT INTO tickets (descricao,setor,prioridade,status,solicitante) VALUES (?,?,?,?,?)").run(...t));
  }

  if (!db.prepare("SELECT id FROM visitantes LIMIT 1").get()) {
    [
      ["Carlos Mendes", "Fornecedora X", "Compras",    "aguardando"],
      ["Beatriz Lima",  "Auditoria Sul", "Financeiro", "atendimento"],
      ["Rafael Costa",  "Externo",       "RH",         "liberado"],
      ["Juliana Souza", "TechParts",     "TI",         "aguardando"],
    ].forEach(v => db.prepare("INSERT INTO visitantes (nome,empresa,destino,status) VALUES (?,?,?,?)").run(...v));
  }

  if (!db.prepare("SELECT id FROM agendamentos LIMIT 1").get()) {
    [
      ["recepcao",       "Horário de Almoço",   "🍽 Cantina aberta das 12h às 14h. Frango grelhado, arroz integral e suco.", "12:00","14:00","1,2,3,4,5"],
      ["ti",             "Janela de Manutenção","⚙ Manutenção do servidor principal às 23h desta sexta.",                   "22:30","23:59","5"],
      ["rh",             "Reunião Semanal",      "📅 Reunião semanal de RH às 09h — Sala B.",                               "08:50","10:00","2"],
    ].forEach(a => db.prepare("INSERT INTO agendamentos (setor,titulo,conteudo,hora_ini,hora_fim,dias) VALUES (?,?,?,?,?,?)").run(...a));
  }

  if (!db.prepare("SELECT id FROM guiches LIMIT 1").get()) {
    ["Guichê 1","Guichê 2","Guichê 3"].forEach(g =>
      db.prepare("INSERT INTO guiches (nome) VALUES (?)").run(g));
  }
}
seed();

// ── DAO ──────────────────────────────────────────────────
const dao = {
  // Usuários
  getUsuario:      (email) => db.prepare("SELECT * FROM usuarios WHERE email=? AND ativo=1").get(email),
  getUsuarioById:  (id)    => db.prepare("SELECT id,nome,email,role,criado_em FROM usuarios WHERE id=?").get(id),
  listarUsuarios:  ()      => db.prepare("SELECT id,nome,email,role,ativo,criado_em FROM usuarios ORDER BY id").all(),
  criarUsuario:    (nome,email,senha,role) => db.prepare("INSERT INTO usuarios (nome,email,senha,role) VALUES (?,?,?,?)").run(nome,email,bcrypt.hashSync(senha,10),role),
  atualizarUsuario:(id,nome,role)          => db.prepare("UPDATE usuarios SET nome=?,role=? WHERE id=?").run(nome,role,id),
  trocarSenha:     (id,senha)              => db.prepare("UPDATE usuarios SET senha=? WHERE id=?").run(bcrypt.hashSync(senha,10),id),
  desativarUsuario:(id)                    => db.prepare("UPDATE usuarios SET ativo=0 WHERE id=?").run(id),

  // Avisos
  getAviso:       (setor) => db.prepare("SELECT * FROM avisos WHERE setor=? AND ativo=1 ORDER BY id DESC LIMIT 1").get(setor),
  getTodosAvisos: ()      => {
    const rows = db.prepare("SELECT setor,msg FROM avisos WHERE ativo=1 GROUP BY setor HAVING MAX(id)").all();
    return rows.reduce((acc,r) => { acc[r.setor]=r.msg; return acc; }, {});
  },
  setAviso:       (setor,msg,autor) => {
    db.prepare("UPDATE avisos SET ativo=0 WHERE setor=?").run(setor);
    return db.prepare("INSERT INTO avisos (setor,msg,autor) VALUES (?,?,?)").run(setor,msg,autor);
  },
  historicoAvisos:(setor,limit=20) => db.prepare("SELECT * FROM avisos WHERE setor=? ORDER BY id DESC LIMIT ?").all(setor,limit),

  // Tickets
  listarTickets: (f={}) => {
    let q="SELECT * FROM tickets WHERE 1=1", p=[];
    if(f.setor)  { q+=" AND setor=?";  p.push(f.setor);  }
    if(f.status) { q+=" AND status=?"; p.push(f.status); }
    q+=" ORDER BY id DESC";
    if(f.limit)  { q+=" LIMIT ?"; p.push(Number(f.limit)); }
    return db.prepare(q).all(...p);
  },
  getTicket:     (id)                     => db.prepare("SELECT * FROM tickets WHERE id=?").get(id),
  criarTicket:   (desc,setor,prio,sol)    => db.prepare("INSERT INTO tickets (descricao,setor,prioridade,solicitante) VALUES (?,?,?,?)").run(desc,setor,prio,sol),
  atualizarTicket:(id,status)             => {
    const res = status==="resolvido" ? new Date().toLocaleString("pt-BR") : null;
    return db.prepare("UPDATE tickets SET status=?,resolvido_em=? WHERE id=?").run(status,res,id);
  },

  // Visitantes
  listarVisitantesHoje: () => db.prepare("SELECT * FROM visitantes WHERE data=date('now','localtime') ORDER BY id DESC").all(),
  criarVisitante:       (nome,empresa,destino,token) => db.prepare("INSERT INTO visitantes (nome,empresa,destino,qr_token) VALUES (?,?,?,?)").run(nome,empresa,destino,token),
  atualizarVisitante:   (id,status) => {
    const saida = status==="liberado" ? new Date().toLocaleTimeString("pt-BR",{hour:"2-digit",minute:"2-digit"}) : null;
    return db.prepare("UPDATE visitantes SET status=?,saida=? WHERE id=?").run(status,saida,id);
  },
  getVisitantePorToken: (token) => db.prepare("SELECT * FROM visitantes WHERE qr_token=?").get(token),

  // Logs
  addLog:     (tipo,setor,msg,autor) => db.prepare("INSERT INTO logs (tipo,setor,msg,autor) VALUES (?,?,?,?)").run(tipo,setor||"sistema",msg,autor||"sistema"),
  listarLogs: (limit=50) => db.prepare("SELECT * FROM logs ORDER BY id DESC LIMIT ?").all(limit),

  // Agendamentos
  listarAgendamentos:   ()                            => db.prepare("SELECT * FROM agendamentos ORDER BY id DESC").all(),
  getAgendamentosAtivos:(setor,hora,dia)              => db.prepare("SELECT * FROM agendamentos WHERE setor=? AND ativo=1 AND hora_ini<=? AND hora_fim>=? AND (','||dias||',') LIKE ('%,'||?||',%')").all(setor,hora,hora,String(dia)),
  criarAgendamento:     (setor,titulo,conteudo,ini,fim,dias) => db.prepare("INSERT INTO agendamentos (setor,titulo,conteudo,hora_ini,hora_fim,dias) VALUES (?,?,?,?,?,?)").run(setor,titulo,conteudo,ini,fim,dias),
  toggleAgendamento:    (id,ativo)                    => db.prepare("UPDATE agendamentos SET ativo=? WHERE id=?").run(ativo,id),
  deletarAgendamento:   (id)                          => db.prepare("DELETE FROM agendamentos WHERE id=?").run(id),

  // Uploads
  listarUploads: (setor) => setor ? db.prepare("SELECT * FROM uploads WHERE setor=? ORDER BY id DESC").all(setor) : db.prepare("SELECT * FROM uploads ORDER BY id DESC").all(),
  salvarUpload:  (nome,arquivo,setor,tipo) => db.prepare("INSERT INTO uploads (nome,arquivo,setor,tipo) VALUES (?,?,?,?)").run(nome,arquivo,setor,tipo),
  deletarUpload: (id) => db.prepare("DELETE FROM uploads WHERE id=?").run(id),

  // Emails
  addEmail:    (dest,assunto,corpo,status="enviado") => db.prepare("INSERT INTO emails_log (destinatario,assunto,corpo,status) VALUES (?,?,?,?)").run(dest,assunto,corpo,status),
  listarEmails:(limit=30) => db.prepare("SELECT * FROM emails_log ORDER BY id DESC LIMIT ?").all(limit),

  // Fila / Senhas
  proximoNumero:  (prefixo) => (db.prepare("SELECT MAX(numero) as m FROM senhas WHERE data=date('now','localtime') AND prefixo=?").get(prefixo)?.m||0)+1,
  emitirSenha:    (prefixo="A",tipo="geral") => {
    const n = dao.proximoNumero(prefixo);
    const r = db.prepare("INSERT INTO senhas (numero,prefixo,tipo) VALUES (?,?,?)").run(n,prefixo,tipo);
    return db.prepare("SELECT * FROM senhas WHERE id=?").get(r.lastInsertRowid);
  },
  chamarSenha:    (id,guiche) => {
    db.prepare("UPDATE senhas SET status='chamando',guiche=?,chamada_em=datetime('now','localtime') WHERE id=?").run(guiche,id);
    return db.prepare("SELECT * FROM senhas WHERE id=?").get(id);
  },
  chamarProxima:  (prefixo="A",guiche) => {
    const s = db.prepare("SELECT * FROM senhas WHERE status='aguardando' AND prefixo=? AND data=date('now','localtime') ORDER BY numero ASC LIMIT 1").get(prefixo);
    return s ? dao.chamarSenha(s.id,guiche) : null;
  },
  listarFilaHoje: () => db.prepare("SELECT * FROM senhas WHERE data=date('now','localtime') ORDER BY criado_em ASC").all(),
  listarGuiches:  () => db.prepare("SELECT * FROM guiches WHERE ativo=1").all(),
  resetarFila:    () => db.prepare("UPDATE senhas SET status='encerrado' WHERE data=date('now','localtime') AND status='aguardando'").run(),

  // Stats
  getStats: () => ({
    ticketsAbertos:  db.prepare("SELECT COUNT(*) as n FROM tickets WHERE status!='resolvido'").get().n,
    alertasCriticos: db.prepare("SELECT COUNT(*) as n FROM tickets WHERE status='aberto' AND prioridade='alta'").get().n,
    visitantesHoje:  db.prepare("SELECT COUNT(*) as n FROM visitantes WHERE data=date('now','localtime')").get().n,
    filaAguardando:  db.prepare("SELECT COUNT(*) as n FROM senhas WHERE data=date('now','localtime') AND status='aguardando'").get().n,
  }),
};

module.exports = { db, dao };
