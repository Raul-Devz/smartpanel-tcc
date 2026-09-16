/**
 * SmartPanel — Auth (JWT)
 */
require("dotenv").config();
const jwt    = require("jsonwebtoken");
const bcrypt = require("bcryptjs");
const { dao } = require("./database");

const SECRET  = process.env.JWT_SECRET  || "smartpanel_dev_secret";
const EXPIRES = process.env.JWT_EXPIRES || "8h";

function gerarToken(usuario) {
  return jwt.sign(
    { id: usuario.id, email: usuario.email, role: usuario.role, nome: usuario.nome },
    SECRET, { expiresIn: EXPIRES }
  );
}

async function login(email, senha) {
  const usuario = dao.getUsuario(email);
  if (!usuario)                            throw new Error("Usuário não encontrado");
  if (!bcrypt.compareSync(senha, usuario.senha)) throw new Error("Senha incorreta");
  dao.addLog("sistema", "auth", `Login: ${usuario.nome} (${usuario.role})`, usuario.email);
  return {
    token: gerarToken(usuario),
    usuario: { id: usuario.id, nome: usuario.nome, email: usuario.email, role: usuario.role },
    expiresIn: EXPIRES,
  };
}

function requireAuth(req, res, next) {
  const h = req.headers.authorization;
  if (!h?.startsWith("Bearer ")) return res.status(401).json({ erro: "Token não fornecido" });
  try { req.user = jwt.verify(h.split(" ")[1], SECRET); next(); }
  catch { res.status(401).json({ erro: "Token inválido ou expirado" }); }
}

function requireRole(...roles) {
  return (req, res, next) => {
    if (!roles.includes(req.user?.role)) return res.status(403).json({ erro: "Permissão negada" });
    next();
  };
}

function verificarTokenSocket(token) {
  try { return jwt.verify(token, SECRET); } catch { return null; }
}

module.exports = { login, gerarToken, requireAuth, requireRole, verificarTokenSocket };
