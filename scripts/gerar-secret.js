// Gera um JWT_SECRET forte e imprime a linha pronta para colar no .env
// Uso: npm run gerar-secret
console.log("JWT_SECRET=" + require("crypto").randomBytes(64).toString("hex"));
