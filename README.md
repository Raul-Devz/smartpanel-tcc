# SmartPanel v4.0 — Painel Inteligente para TV Box

> TCC — Sistema Corporativo de Painéis com TV Box  
> Centro Universitário Salesiano de São Paulo – UNISAL

---

## 🚀 Instalação

```bash
# 1. Instalar dependências
npm install

# 2. Configurar variáveis de ambiente
cp .env.example .env
# Gere um segredo e cole a linha no .env (o sistema NÃO inicia sem JWT_SECRET forte)
npm run gerar-secret

# 3. Rodar em desenvolvimento
npm run dev

# 4. Rodar em produção
npm start
```

> **Banco de dados** criado automaticamente em `data/smartpanel.db`  
> **Uploads** salvos em `uploads/`

---

## 🔑 Primeiro acesso

Na primeira execução são criadas duas contas iniciais (`admin@smartpanel.com` e `ti@smartpanel.com`)
com **senha provisória**, que não é divulgada neste README (consulte o responsável pela instalação).

- No primeiro login, o sistema **obriga a troca da senha** antes de liberar qualquer funcionalidade.
- Usuários criados por um admin, ou que tiverem a senha redefinida por um admin, também precisam trocá-la no próximo login.
- Regras da nova senha: mínimo de 8 caracteres, com letras e números, diferente da atual e de senhas comuns.

---

## 📁 Estrutura do Projeto

```
smartpanel/
├── .env.example        # Variáveis de ambiente (copie para .env)
├── .gitignore          # Arquivos ignorados pelo Git
├── server.js           # Servidor principal
├── database.js         # SQLite — tabelas e DAO
├── auth.js             # JWT — login e middleware
├── email.js            # E-mail simulado
├── scheduler.js        # Agendamentos automáticos
├── routes/
│   ├── api.js          # REST API completa
│   └── upload.js       # Upload de imagens + QR Code
├── data/               # Banco SQLite (gerado automaticamente)
├── uploads/            # Imagens enviadas
└── public/
    ├── admin/          # Painel do Administrador (login JWT)
    ├── tv/             # Painel da TV Box por setor ✅
    ├── fila/           # Painel público da fila de atendimento
    └── checkin.html    # Página de check-in via QR Code
```

---

## 🌐 URLs

| Tela                  | URL                                              |
|-----------------------|--------------------------------------------------|
| Admin                 | `http://IP:3000/admin`                           |
| TV — Recepção         | `http://IP:3000/tv?setor=recepcao`               |
| TV — TI               | `http://IP:3000/tv?setor=ti`                     |
| TV — Escritório       | `http://IP:3000/tv?setor=escritorio`             |
| TV — Administrativo   | `http://IP:3000/tv?setor=administrativo`         |
| TV — RH               | `http://IP:3000/tv?setor=rh`                     |
| Fila Pública          | `http://IP:3000/fila`                            |
| Check-in QR           | `http://IP:3000/checkin?token=TOKEN`             |
| API Status            | `http://IP:3000/api/status`                      |

---

## 📺 Configurar TV Box

```bash
# Abrir no TV Box em modo quiosque (tela cheia, sem barra do browser)
chromium-browser --kiosk http://192.168.1.100:3000/tv?setor=recepcao

# Outros setores:
chromium-browser --kiosk http://192.168.1.100:3000/tv?setor=ti
chromium-browser --kiosk http://192.168.1.100:3000/fila
```

---

## 🔒 Segurança implementada

- JWT com expiração de 8h e secret via variável de ambiente
- Rate limiting no login (20 tentativas / 15 min por IP)
- Roles: admin, editor, viewer
- TVs e fila pública não precisam de autenticação (somente leitura)
- .gitignore protege banco, uploads e .env do controle de versão

---

## 📡 API principais

| Método | Rota                          | Auth  | Descrição                    |
|--------|-------------------------------|-------|------------------------------|
| POST   | /api/auth/login               | —     | Login → JWT                  |
| GET    | /api/snapshot                 | ✓     | Estado completo              |
| PUT    | /api/avisos/:setor            | ✓     | Atualizar aviso              |
| GET    | /api/tickets                  | ✓     | Listar tickets               |
| POST   | /api/tickets                  | ✓     | Criar ticket                 |
| PATCH  | /api/tickets/:id              | ✓     | Atualizar status             |
| GET    | /api/visitantes               | ✓     | Visitantes de hoje           |
| POST   | /api/upload/visitante         | ✓     | Registrar + gerar QR Code    |
| POST   | /api/fila/emitir              | ✓     | Emitir nova senha            |
| POST   | /api/fila/chamar              | ✓     | Chamar próxima senha         |
| GET    | /api/agendamentos             | ✓     | Listar agendamentos          |
| POST   | /api/agendamentos             | ✓     | Criar agendamento            |
| POST   | /api/upload                   | ✓     | Upload de imagem             |

---

## ⚡ Eventos Socket.IO

| Evento (admin → server) | Descrição                          |
|-------------------------|------------------------------------|
| aviso:enviar            | Envia aviso para setor específico  |
| aviso:broadcast         | Envia aviso para todos os setores  |
| ticket:novo             | Abre novo ticket                   |
| ticket:status           | Atualiza status do ticket          |
| visitante:novo          | Registra visitante                 |
| visitante:status        | Atualiza status do visitante       |

| Evento (server → clientes) | Descrição                       |
|----------------------------|---------------------------------|
| snapshot                   | Estado completo ao conectar     |
| aviso:novo                 | Novo aviso emitido              |
| tickets:update             | Lista de tickets atualizada     |
| visitantes:update          | Visitantes atualizados          |
| metricas:update            | Métricas de TI (a cada 8s)     |
| senha:chamada              | Senha chamada na fila           |
| fila:update                | Fila de senhas atualizada       |
