# ONELIV · Ferramentas

Ferramentas web da ONELIV Properties. Ficheiros estaticos, sem dependencias externas.

## Simulador Portugal <-> Dubai

Compara o rendimento de um imovel arrendado em Portugal com o mesmo capital investido no Dubai.
Inclui os tres cenarios fiscais, calculo passo a passo, recomendacoes personalizadas e captura de leads.

- Pagina: `index.html` (tambem em `simulador/index.html`)
- Cambio de referencia: 1 EUR = 4,2749 AED (27/08/2026), editavel pelo utilizador

### Ligar os leads ao CRM

No ficheiro, substituir `console.log('LEAD ->',lead)` por um `fetch()` para o endpoint pretendido.
O objecto `lead` inclui nome, telefone, email, capital investivel, yields, ganho anual e regime de IRS.

### WhatsApp

Substituir `wa.me/971500000000` pelo numero real.
