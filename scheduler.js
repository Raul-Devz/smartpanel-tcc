/**
 * SmartPanel — Scheduler (node-cron)
 */
const cron = require("node-cron");
const { dao } = require("./database");

let io = null;
const disparado = {};

function iniciar(ioInstance) {
  io = ioInstance;
  cron.schedule("* * * * *", verificar);
  console.log("  ⏰ Scheduler iniciado");
}

function verificar() {
  if (!io) return;
  const agora    = new Date();
  const hora     = agora.toLocaleTimeString("pt-BR", { hour:"2-digit", minute:"2-digit", hour12:false });
  const dia      = agora.getDay();
  const SETORES  = ["recepcao","ti","escritorio","administrativo","rh"];

  SETORES.forEach(setor => {
    const ags = dao.getAgendamentosAtivos(setor, hora, dia);
    if (!ags.length) return;
    const ag  = ags[0];
    const key = `${setor}:${ag.id}:${hora}`;
    if (disparado[key]) return;
    disparado[key] = Date.now();
    // Limpar cache antigo
    Object.keys(disparado).forEach(k => { if (Date.now()-disparado[k] > 120000) delete disparado[k]; });

    const msg = `📅 ${ag.titulo}: ${ag.conteudo}`;
    dao.setAviso(setor, msg, "scheduler");
    dao.addLog("agendamento", setor, `Ativado: ${ag.titulo}`, "scheduler");
    io.to(`setor:${setor}`).emit("aviso:novo", { setor, msg, agendado:true });
    io.to("admins").emit("aviso:novo", { setor, msg, agendado:true });
    console.log(`  ⏰ Agendamento → [${setor}] ${ag.titulo}`);
  });
}

module.exports = { iniciar };
