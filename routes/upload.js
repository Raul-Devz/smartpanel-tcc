/**
 * SmartPanel — Upload + QR Code
 */
const express  = require("express");
const router   = express.Router();
const multer   = require("multer");
const path     = require("path");
const fs       = require("fs");
const QRCode   = require("qrcode");
const { dao }  = require("../database");
const { requireAuth } = require("../auth");
const { notificarVisitante } = require("../email");
const os       = require("os");

let io = null;
const setIO = (i) => { io = i; };

const UPLOAD_DIR = path.join(__dirname, "..", "uploads");
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const storage = multer.diskStorage({
  destination: (_,__,cb) => cb(null, UPLOAD_DIR),
  filename:    (_,file,cb) => cb(null, `${Date.now()}-${Math.random().toString(36).slice(2)}${path.extname(file.originalname).toLowerCase()}`),
});
const upload = multer({
  storage,
  fileFilter: (_,file,cb) => cb(null, [".jpg",".jpeg",".png",".gif",".webp",".svg"].includes(path.extname(file.originalname).toLowerCase())),
  limits: { fileSize: 5*1024*1024 },
});

// POST /api/upload
router.post("/", requireAuth, upload.single("imagem"), (req,res) => {
  if (!req.file) return res.status(400).json({ erro:"Nenhuma imagem enviada" });
  const { setor,tipo,nome } = req.body;
  const nomeDisplay = nome || req.file.originalname;
  const url = `/uploads/${req.file.filename}`;
  dao.salvarUpload(nomeDisplay, url, setor||null, tipo||"imagem");
  dao.addLog("upload", setor||"sistema", `Upload: ${nomeDisplay}`, req.user.nome);
  io?.to("admins").emit("upload:novo", { nome:nomeDisplay, arquivo:url, setor, tipo });
  if (setor) io?.to(`setor:${setor}`).emit("upload:novo", { nome:nomeDisplay, arquivo:url, setor, tipo });
  res.status(201).json({ ok:true, arquivo:url, nome:nomeDisplay });
});

// Endereço usado no QR Code. Se o Admin foi aberto por "localhost", o celular não alcançaria o servidor;
// nesse caso usa-se o IP do servidor na rede local. A variável HOST_PUBLICO (.env) sobrepõe tudo.
function baseUrl(req) {
  if (process.env.HOST_PUBLICO) return process.env.HOST_PUBLICO.replace(/\/$/, "");
  const host = req.get("host") || "";
  const nomeHost = host.replace(/:\d+$/, "").replace(/^\[|\]$/g, "");
  if (["localhost", "127.0.0.1", "::1"].includes(nomeHost)) {
    const porta = process.env.PORT || 3000;
    // prefere endereços de rede local (192.168.x.x, 10.x.x.x, 172.16–31.x.x) a outros (VPN, adaptadores virtuais)
    const prioridade = ip => /^192\.168\./.test(ip) ? 0 : /^10\./.test(ip) ? 1 : /^172\.(1[6-9]|2\d|3[01])\./.test(ip) ? 2 : 3;
    const ips = Object.values(os.networkInterfaces()).flat().filter(i => i && i.family === "IPv4" && !i.internal).map(i => i.address).sort((a, b) => prioridade(a) - prioridade(b));
    if (ips.length) return `${req.protocol}://${ips[0]}:${porta}`;
  }
  return `${req.protocol}://${host}`;
}

// POST /api/upload/visitante — registra visitante e gera QR
router.post("/visitante", requireAuth, async (req,res) => {
  try {
    const { nome, empresa, destino } = req.body;
    if (!nome) return res.status(400).json({ erro:"Nome obrigatório" });
    const token = `${Date.now()}-${Math.random().toString(36).slice(2,8).toUpperCase()}`;
    const result = dao.criarVisitante(nome, empresa||"", destino||"", token);
    const visitante = { id:result.lastInsertRowid, nome, empresa:empresa||"", destino:destino||"", token };
    const host = baseUrl(req);
    const urlCheckin = `${host}/checkin?token=${token}`;
    let qrCode = null;
    try { qrCode = await QRCode.toDataURL(urlCheckin, { width:300, margin:2, color:{ dark:"#0d0f14", light:"#ffffff" } }); }
    catch(e) { console.error("QR error:", e.message); }
    dao.addLog("visitante","recepcao",`QR registrado: ${nome}`,req.user.nome);
    const lista = dao.listarVisitantesHoje();
    io?.to("admins").emit("visitantes:update", lista);
    io?.to("setor:recepcao").emit("visitantes:update", lista);
    const { buildFila } = require("./api");
    io?.to("fila-publica").emit("fila:update", buildFila());
    await notificarVisitante(visitante);
    res.status(201).json({ ok:true, visitante, token, urlCheckin, qrCode });
  } catch(e) {
    console.error("Erro /visitante:", e);
    res.status(500).json({ erro:"Erro interno", detalhe:e.message });
  }
});

module.exports = { router, setIO };
