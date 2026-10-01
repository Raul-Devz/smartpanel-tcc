/**
 * SmartPanel — Database (sql.js — puro JS, sem compilação)
 * Compatível com qualquer versão do Node e qualquer OS
 */
require("dotenv").config();
const initSqlJs = require("sql.js");
const bcrypt    = require("bcryptjs");
const path      = require("path");
const fs        = require("fs");

const DATA_DIR = path.join(__dirname, "data");
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const DB_FILE = path.join(DATA_DIR, "smartpanel.db");

let DB = null; // instância do banco

// ── Salvar banco em disco a cada operação de escrita ──────
function salvar() {
  try {
    const data = DB.export();
    fs.writeFileSync(DB_FILE, Buffer.from(data));
  } catch (e) {
    console.error("[DB] Erro ao salvar:", e.message);
  }
}

// ── Wrapper de compatibilidade (imita better-sqlite3) ─────
function makeDb(sqlJs) {
  const db = fs.existsSync(DB_FILE)
    ? new sqlJs.Database(fs.readFileSync(DB_FILE))
    : new sqlJs.Database();

  // run — executa sem retorno (INSERT, UPDATE, DELETE, CREATE)
  db.run2 = function(sql, params = []) {
    this.run(sql, params);
    salvar();
    // pegar lastInsertRowid
    const r = this.exec("SELECT last_insert_rowid() as id");
    return { lastInsertRowid: r[0]?.values[0][0] ?? null };
  };

  // get — retorna primeira linha como objeto
  db.get2 = function(sql, params = []) {
    const res = this.exec(sql, params);
    if (!res.length || !res[0].values.length) return undefined;
    const cols = res[0].columns;
    const vals = res[0].values[0];
    return Object.fromEntries(cols.map((c, i) => [c, vals[i]]));
  };

  // all — retorna todas as linhas como array de objetos
  db.all2 = function(sql, params = []) {
    const res = this.exec(sql, params);
    if (!res.length) return [];
    const cols = res[0].columns;
    return res[0].values.map(row => Object.fromEntries(cols.map((c, i) => [c, row[i]])));
  };

  // exec2 — executa múltiplos statements (CREATE TABLE etc)
  db.exec2 = function(sql) {
    this.run(sql);
    salvar();
  };

  return db;
}

// ── Inicializar banco (async) ─────────────────────────────
async function init() {
  const SQL = await initSqlJs();
  DB = makeDb(SQL);
  criarTabelas();
  migrar();
  seed();
  console.log("  ✅ Banco de dados iniciado (sql.js)");
}

function criarTabelas() {
  DB.run(`
    CREATE TABLE IF NOT EXISTS usuarios (
      id        INTEGER PRIMARY KEY AUTOINCREMENT,
      nome      TEXT    NOT NULL,
      email     TEXT    NOT NULL UNIQUE,
      senha     TEXT    NOT NULL,
      role      TEXT    NOT NULL DEFAULT 'viewer',
      ativo     INTEGER NOT NULL DEFAULT 1,
      trocar_senha INTEGER NOT NULL DEFAULT 0,
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
  salvar();
}

// Bancos criados antes desta versão não têm a coluna trocar_senha
function migrar() {
  const cols = DB.all2("PRAGMA table_info(usuarios)").map(c => c.name);
  if (!cols.includes("trocar_senha")) {
    DB.run2("ALTER TABLE usuarios ADD COLUMN trocar_senha INTEGER NOT NULL DEFAULT 0");
    console.log("  🔧 Migração: coluna trocar_senha adicionada");
  }
}

// Qualquer conta que ainda use a senha padrão conhecida é obrigada a trocá-la
function marcarSenhasPadrao() {
  [["admin@smartpanel.com","admin123"],["ti@smartpanel.com","ti123"]].forEach(([email, padrao]) => {
    const u = DB.get2("SELECT id,senha,trocar_senha FROM usuarios WHERE email=?", [email]);
    if (u && !u.trocar_senha && bcrypt.compareSync(padrao, u.senha)) {
      DB.run2("UPDATE usuarios SET trocar_senha=1 WHERE id=?", [u.id]);
      console.log(`  🔐 ${email} usa a senha padrão — troca obrigatória no próximo login`);
    }
  });
}

function seed() {
  if (!DB.get2("SELECT id FROM usuarios WHERE email=?", ["admin@smartpanel.com"])) {
    DB.run2("INSERT INTO usuarios (nome,email,senha,role,trocar_senha) VALUES (?,?,?,?,1)",
      ["Administrador","admin@smartpanel.com", bcrypt.hashSync("admin123",10),"admin"]);
    DB.run2("INSERT INTO usuarios (nome,email,senha,role,trocar_senha) VALUES (?,?,?,?,1)",
      ["Editor TI","ti@smartpanel.com", bcrypt.hashSync("ti123",10),"editor"]);
    console.log("  ✅ Usuários iniciais criados (troca de senha obrigatória no primeiro login)");
  }
  marcarSenhasPadrao();

  const avisosIni = {
    recepcao:       "👋 Bem-vindo! Retire sua senha e aguarde o atendimento.",
    ti:             "🖥 Todos os sistemas operando normalmente.",
    escritorio:     "📋 Reunião geral às 14h — Sala de Reunião A.",
    administrativo: "📊 Relatório mensal deve ser entregue até sexta-feira.",
    rh:             "🎉 Aniversariantes da semana: Ana Paula, Lucas e Mariana!",
  };
  Object.entries(avisosIni).forEach(([s,m]) => {
    if (!DB.get2("SELECT id FROM avisos WHERE setor=? AND ativo=1", [s]))
      DB.run2("INSERT INTO avisos (setor,msg,autor) VALUES (?,?,?)", [s,m,"sistema"]);
  });

  if (!DB.get2("SELECT id FROM tickets LIMIT 1")) {
    [
      ["Impressora não responde na sala 3","ti","alta","aberto","Escritório"],
      ["Acesso negado ao sistema ERP","administrativo","alta","andamento","ADM"],
      ["Painel da recepção travou","recepcao","media","resolvido","Recepção"],
      ["Monitor sem sinal — sala reunião","escritorio","media","aberto","Escritório"],
      ["Wi-Fi instável corredor B","ti","media","resolvido","RH"],
      ["Nobreak sem carga","ti","alta","aberto","TI"],
    ].forEach(t => DB.run2("INSERT INTO tickets (descricao,setor,prioridade,status,solicitante) VALUES (?,?,?,?,?)", t));
  }

  if (!DB.get2("SELECT id FROM visitantes LIMIT 1")) {
    [
      ["Carlos Mendes","Fornecedora X","Compras","aguardando"],
      ["Beatriz Lima","Auditoria Sul","Financeiro","atendimento"],
      ["Rafael Costa","Externo","RH","liberado"],
      ["Juliana Souza","TechParts","TI","aguardando"],
    ].forEach(v => DB.run2("INSERT INTO visitantes (nome,empresa,destino,status) VALUES (?,?,?,?)", v));
  }

  if (!DB.get2("SELECT id FROM agendamentos LIMIT 1")) {
    [
      ["recepcao","Horário de Almoço","🍽 Cantina aberta das 12h às 14h. Frango grelhado, arroz integral e suco.","12:00","14:00","1,2,3,4,5"],
      ["ti","Janela de Manutenção","⚙ Manutenção do servidor principal às 23h desta sexta.","22:30","23:59","5"],
      ["rh","Reunião Semanal","📅 Reunião semanal de RH às 09h — Sala B.","08:50","10:00","2"],
    ].forEach(a => DB.run2("INSERT INTO agendamentos (setor,titulo,conteudo,hora_ini,hora_fim,dias) VALUES (?,?,?,?,?,?)", a));
  }

  if (!DB.get2("SELECT id FROM guiches LIMIT 1")) {
    ["Guichê 1","Guichê 2","Guichê 3"].forEach(g =>
      DB.run2("INSERT INTO guiches (nome) VALUES (?)", [g]));
  }
}

// ── DAO ──────────────────────────────────────────────────
function getDb() {
  if (!DB) throw new Error("Banco não inicializado. Aguarde init().");
  return DB;
}

const dao = {
  // Usuários
  getUsuario:      (email)      => getDb().get2("SELECT * FROM usuarios WHERE email=? AND ativo=1", [email]),
  getUsuarioById:  (id)         => getDb().get2("SELECT id,nome,email,role,ativo,trocar_senha,criado_em FROM usuarios WHERE id=?", [id]),
  listarUsuarios:  ()           => getDb().all2("SELECT id,nome,email,role,ativo,trocar_senha,criado_em FROM usuarios ORDER BY id"),
  criarUsuario:    (n,e,s,r)    => getDb().run2("INSERT INTO usuarios (nome,email,senha,role,trocar_senha) VALUES (?,?,?,?,1)", [n,e,bcrypt.hashSync(s,10),r]),
  atualizarUsuario:(id,n,r)     => getDb().run2("UPDATE usuarios SET nome=?,role=? WHERE id=?", [n,r,id]),
  // Redefinição feita por um admin: a senha vira provisória e o usuário deve trocá-la
  redefinirSenha:  (id,s)       => getDb().run2("UPDATE usuarios SET senha=?,trocar_senha=1 WHERE id=?", [bcrypt.hashSync(s,10),id]),
  // Troca feita pelo próprio usuário: remove a obrigatoriedade
  definirSenha:    (id,s)       => getDb().run2("UPDATE usuarios SET senha=?,trocar_senha=0 WHERE id=?", [bcrypt.hashSync(s,10),id]),
  desativarUsuario:(id)         => getDb().run2("UPDATE usuarios SET ativo=0 WHERE id=?", [id]),

  // Avisos
  getTodosAvisos: () => {
    const rows = getDb().all2("SELECT setor, msg FROM avisos WHERE ativo=1 GROUP BY setor");
    return rows.reduce((acc,r) => { acc[r.setor]=r.msg; return acc; }, {});
  },
  setAviso: (setor,msg,autor) => {
    getDb().run2("UPDATE avisos SET ativo=0 WHERE setor=?", [setor]);
    return getDb().run2("INSERT INTO avisos (setor,msg,autor) VALUES (?,?,?)", [setor,msg,autor]);
  },
  historicoAvisos: (setor,limit=20) => getDb().all2("SELECT * FROM avisos WHERE setor=? ORDER BY id DESC LIMIT ?", [setor,limit]),

  // Tickets
  listarTickets: (f={}) => {
    let q="SELECT * FROM tickets WHERE 1=1", p=[];
    if(f.setor)  { q+=" AND setor=?";  p.push(f.setor); }
    if(f.status) { q+=" AND status=?"; p.push(f.status); }
    q+=" ORDER BY id DESC";
    if(f.limit)  { q+=" LIMIT ?"; p.push(Number(f.limit)); }
    return getDb().all2(q, p);
  },
  getTicket:      (id)         => getDb().get2("SELECT * FROM tickets WHERE id=?", [id]),
  criarTicket:    (d,s,p,sol)  => getDb().run2("INSERT INTO tickets (descricao,setor,prioridade,solicitante) VALUES (?,?,?,?)", [d,s,p,sol]),
  atualizarTicket:(id,status)  => {
    const res = status==="resolvido" ? new Date().toLocaleString("pt-BR") : null;
    return getDb().run2("UPDATE tickets SET status=?,resolvido_em=? WHERE id=?", [status,res,id]);
  },

  // Visitantes
  listarVisitantesHoje: () => {
    const hoje = new Date().toLocaleDateString("pt-BR").split("/").reverse().join("-");
    return getDb().all2("SELECT * FROM visitantes WHERE data=? ORDER BY id DESC", [hoje]);
  },
  criarVisitante:     (n,e,d,t)  => getDb().run2("INSERT INTO visitantes (nome,empresa,destino,qr_token) VALUES (?,?,?,?)", [n,e,d,t]),
  atualizarVisitante: (id,status)=> {
    const saida = status==="liberado" ? new Date().toLocaleTimeString("pt-BR",{hour:"2-digit",minute:"2-digit"}) : null;
    return getDb().run2("UPDATE visitantes SET status=?,saida=? WHERE id=?", [status,saida,id]);
  },
  getVisitantePorToken: (token) => getDb().get2("SELECT * FROM visitantes WHERE qr_token=?", [token]),

  // Logs
  addLog:     (tipo,setor,msg,autor) => getDb().run2("INSERT INTO logs (tipo,setor,msg,autor) VALUES (?,?,?,?)", [tipo,setor||"sistema",msg,autor||"sistema"]),
  listarLogs: (limit=50) => getDb().all2("SELECT * FROM logs ORDER BY id DESC LIMIT ?", [limit]),

  // Agendamentos
  listarAgendamentos:   ()                     => getDb().all2("SELECT * FROM agendamentos ORDER BY id DESC"),
  getAgendamentosAtivos:(setor,hora,dia)       => getDb().all2(
    "SELECT * FROM agendamentos WHERE setor=? AND ativo=1 AND hora_ini<=? AND hora_fim>=? AND (','||dias||',') LIKE ('%,'||?||',%')",
    [setor,hora,hora,String(dia)]
  ),
  criarAgendamento:     (s,t,c,i,f,d) => getDb().run2("INSERT INTO agendamentos (setor,titulo,conteudo,hora_ini,hora_fim,dias) VALUES (?,?,?,?,?,?)", [s,t,c,i,f,d]),
  toggleAgendamento:    (id,ativo)     => getDb().run2("UPDATE agendamentos SET ativo=? WHERE id=?", [ativo,id]),
  deletarAgendamento:   (id)           => getDb().run2("DELETE FROM agendamentos WHERE id=?", [id]),

  // Uploads
  listarUploads: (setor) => setor
    ? getDb().all2("SELECT * FROM uploads WHERE setor=? ORDER BY id DESC", [setor])
    : getDb().all2("SELECT * FROM uploads ORDER BY id DESC"),
  salvarUpload:  (n,a,s,t) => getDb().run2("INSERT INTO uploads (nome,arquivo,setor,tipo) VALUES (?,?,?,?)", [n,a,s,t]),
  deletarUpload: (id)      => getDb().run2("DELETE FROM uploads WHERE id=?", [id]),

  // Emails
  addEmail:    (d,a,c,s="enviado") => getDb().run2("INSERT INTO emails_log (destinatario,assunto,corpo,status) VALUES (?,?,?,?)", [d,a,c,s]),
  listarEmails:(limit=30)          => getDb().all2("SELECT * FROM emails_log ORDER BY id DESC LIMIT ?", [limit]),

  // Fila / Senhas
  proximoNumero: (prefixo) => {
    const hoje = new Date().toLocaleDateString("pt-BR").split("/").reverse().join("-");
    const r = getDb().get2("SELECT MAX(numero) as m FROM senhas WHERE data=? AND prefixo=?", [hoje,prefixo]);
    return (r?.m || 0) + 1;
  },
  emitirSenha: (prefixo="A",tipo="geral") => {
    const n = dao.proximoNumero(prefixo);
    const r = getDb().run2("INSERT INTO senhas (numero,prefixo,tipo) VALUES (?,?,?)", [n,prefixo,tipo]);
    return getDb().get2("SELECT * FROM senhas WHERE id=?", [r.lastInsertRowid]);
  },
  chamarSenha: (id,guiche) => {
    getDb().run2("UPDATE senhas SET status='chamando',guiche=?,chamada_em=datetime('now','localtime') WHERE id=?", [guiche,id]);
    return getDb().get2("SELECT * FROM senhas WHERE id=?", [id]);
  },
  chamarProxima: (prefixo="A",guiche) => {
    const hoje = new Date().toLocaleDateString("pt-BR").split("/").reverse().join("-");
    const s = getDb().get2("SELECT * FROM senhas WHERE status='aguardando' AND prefixo=? AND data=? ORDER BY numero ASC LIMIT 1", [prefixo,hoje]);
    return s ? dao.chamarSenha(s.id,guiche) : null;
  },
  listarFilaHoje: () => {
    const hoje = new Date().toLocaleDateString("pt-BR").split("/").reverse().join("-");
    return getDb().all2("SELECT * FROM senhas WHERE data=? ORDER BY criado_em ASC", [hoje]);
  },
  listarGuiches: () => getDb().all2("SELECT * FROM guiches WHERE ativo=1"),
  resetarFila:   () => {
    const hoje = new Date().toLocaleDateString("pt-BR").split("/").reverse().join("-");
    return getDb().run2("UPDATE senhas SET status='encerrado' WHERE data=? AND status='aguardando'", [hoje]);
  },

  // Stats
  getStats: () => {
    const hoje = new Date().toLocaleDateString("pt-BR").split("/").reverse().join("-");
    return {
      ticketsAbertos:  getDb().get2("SELECT COUNT(*) as n FROM tickets WHERE status!='resolvido'")?.n || 0,
      alertasCriticos: getDb().get2("SELECT COUNT(*) as n FROM tickets WHERE status='aberto' AND prioridade='alta'")?.n || 0,
      visitantesHoje:  getDb().get2("SELECT COUNT(*) as n FROM visitantes WHERE data=?", [hoje])?.n || 0,
      filaAguardando:  getDb().get2("SELECT COUNT(*) as n FROM senhas WHERE data=? AND status='aguardando'", [hoje])?.n || 0,
    };
  },
};

module.exports = { init, dao };
