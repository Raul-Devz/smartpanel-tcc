/**
 * SmartPanel — Auth (JWT) + troca obrigatória de senha
 */
require("dotenv").config();
const jwt    = require("jsonwebtoken");
const bcrypt = require("bcryptjs");
const { dao } = require("./database");

const SECRET  = process.env.JWT_SECRET  || "smartpanel_dev_secret";
const EXPIRES = process.env.JWT_EXPIRES || "8h";

// ── Política de senha ─────────────────────────────────────
const SENHAS_FRACAS = [
  "admin123","admin1234","ti123","12345678","123456789","1234567890",
  "senha123","senha1234","password","password1","qwerty123","mudar123",
  "smartpanel","smartpanel123","trocar123",
];

// Retorna uma mensagem de erro, ou null se a senha for aceitável
function validarNovaSenha(nova, atual, email) {
  if (typeof nova !== "string" || nova.length < 8) return "A nova senha deve ter pelo menos 8 caracteres";
  if (Buffer.byteLength(nova) > 72)                return "A nova senha deve ter no máximo 72 caracteres";
  if (!/[A-Za-zÀ-ÿ]/.test(nova) || !/\d/.test(nova)) return "A nova senha deve conter letras e números";
  if (nova === atual)                              return "A nova senha deve ser diferente da senha atual";
  if (SENHAS_FRACAS.includes(nova.toLowerCase()))  return "Essa senha é muito comum. Escolha outra";
  const parteEmail = String(email || "").split("@")[0].toLowerCase();
  if (parteEmail.length >= 4 && nova.toLowerCase().includes(parteEmail))
    return "A senha não pode conter o seu usuário/e-mail";
  return null;
}

function gerarToken(usuario) {
  return jwt.sign(
    { id: usuario.id, email: usuario.email, role: usuario.role, nome: usuario.nome },
    SECRET, { expiresIn: EXPIRES }
  );
}

function respostaLogin(usuario) {
  return {
    token: gerarToken(usuario),
    usuario: { id: usuario.id, nome: usuario.nome, email: usuario.email, role: usuario.role },
    trocarSenha: !!usuario.trocar_senha,
    expiresIn: EXPIRES,
  };
}

async function login(email, senha) {
  const usuario = dao.getUsuario(email);
  if (!usuario)                                  throw new Error("Usuário não encontrado");
  if (!bcrypt.compareSync(senha, usuario.senha)) throw new Error("Senha incorreta");
  dao.addLog("sistema", "auth", `Login: ${usuario.nome} (${usuario.role})`, usuario.email);
  return respostaLogin(usuario);
}

// Troca feita pelo próprio usuário (obrigatória no primeiro acesso ou voluntária)
function trocarSenha(userId, email, senhaAtual, novaSenha) {
  const usuario = dao.getUsuario(email);
  if (!usuario || usuario.id !== userId)             throw new Error("Usuário não encontrado");
  if (!senhaAtual || !bcrypt.compareSync(senhaAtual, usuario.senha)) throw new Error("Senha atual incorreta");
  const erro = validarNovaSenha(novaSenha, senhaAtual, usuario.email);
  if (erro) throw new Error(erro);

  dao.definirSenha(usuario.id, novaSenha);
  dao.addLog("sistema", "auth", `Senha alterada: ${usuario.nome}`, usuario.email); // nunca registrar a senha
  return respostaLogin({ ...usuario, trocar_senha: 0 });
}

/**
 * Autenticação. O estado "precisa trocar a senha" é lido do banco a cada
 * requisição (e não do token), então o bloqueio vale no servidor e passa a
 * valer imediatamente quando um admin redefine a senha de alguém.
 * Só as rotas criadas com permitirTroca=true funcionam enquanto a troca está pendente.
 */
function autenticar(permitirTroca) {
  return (req, res, next) => {
    const h = req.headers.authorization;
    if (!h?.startsWith("Bearer ")) return res.status(401).json({ erro: "Token não fornecido" });
    let payload;
    try { payload = jwt.verify(h.split(" ")[1], SECRET); }
    catch { return res.status(401).json({ erro: "Token inválido ou expirado" }); }

    const u = dao.getUsuarioById(payload.id);
    if (!u || !u.ativo) return res.status(401).json({ erro: "Usuário inativo ou inexistente" });
    if (u.trocar_senha && !permitirTroca)
      return res.status(403).json({ erro: "É necessário trocar a senha antes de continuar", codigo: "TROCAR_SENHA" });

    req.user = payload;
    next();
  };
}

const requireAuth          = autenticar(false); // uso normal: bloqueia se a troca estiver pendente
const requireAuthSemTroca  = autenticar(true);  // apenas /auth/me e /auth/trocar-senha

function requireRole(...roles) {
  return (req, res, next) => {
    if (!roles.includes(req.user?.role)) return res.status(403).json({ erro: "Permissão negada" });
    next();
  };
}

// Socket.IO: quem ainda precisa trocar a senha não recebe conexão autenticada
function verificarTokenSocket(token) {
  try {
    const p = jwt.verify(token, SECRET);
    const u = dao.getUsuarioById(p.id);
    if (!u || !u.ativo || u.trocar_senha) return null;
    return p;
  } catch { return null; }
}

module.exports = { login, trocarSenha, validarNovaSenha, gerarToken, requireAuth, requireAuthSemTroca, requireRole, verificarTokenSocket };
