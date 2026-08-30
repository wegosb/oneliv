# AURA Studio — servidor de geracao

Servidor sem dependencias (so Node >= 18). Serve a aplicacao e expoe a API de geracao.
**A chave do fornecedor fica sempre no servidor.** Nunca vai para o browser.

## Correr localmente

    cd server
    cp .env.example .env        # e preencha
    PROVIDER=mock node server.js

Abra http://localhost:8787 — a aplicacao ja vem servida pelo proprio servidor.

## Fornecedores suportados

| PROVIDER | Variaveis necessarias | Notas |
|---|---|---|
| `mock` | nenhuma | simula a geracao, nao gasta nada. Serve para testar. |
| `fal` | `API_KEY` | fal.ai — video e imagem |
| `replicate` | `API_KEY`, `REPLICATE_VERSION` | qualquer modelo do Replicate |
| `kling` | `KLING_ACCESS_KEY`, `KLING_SECRET_KEY` | API oficial, autenticacao JWT |

## Endpoints

    GET  /health                -> estado, fornecedor, se ha chave
    POST /v1/generate           -> cria o trabalho, devolve { id, cost }
    GET  /v1/jobs/:id           -> { status, progress, output, error }
    GET  /v1/jobs               -> ultimos 50 trabalhos

## Ligar a aplicacao

Na aplicacao, botao **Servidor** no topo -> colar o endereco -> **Testar ligacao** -> **Guardar**.
Sem servidor configurado a aplicacao fica em **modo local** (geracoes simuladas).

## IMPORTANTE — HTTPS

Se a aplicacao estiver em HTTPS (por exemplo no GitHub Pages), o servidor **tambem tem de estar
em HTTPS**. O browser bloqueia chamadas de uma pagina segura para um endereco `http://`.
Ponha o servidor atras de um proxy com certificado (Caddy, Nginx, Cloudflare) ou aloje-o
num servico que ja de HTTPS.

## Alojar

- **Servidor proprio**: `docker build -t aura . && docker run -p 8787:8787 --env-file server/.env aura`
- **Render / Railway / Fly.io**: apontar para este repositorio, comando `node server/server.js`
- **VPS com Caddy**: `reverse_proxy localhost:8787` no Caddyfile, HTTPS automatico

## Seguranca

- Defina `ALLOWED_ORIGINS` com o seu dominio. Nao deixe `*` em producao.
- Ha limite de 30 pedidos por minuto por IP.
- Prompts limitados a 2500 caracteres; corpo do pedido a 1 MB.
- Os trabalhos sao apagados da memoria ao fim de 6 horas.
