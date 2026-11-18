# Preços

Memória de preços da casa, para iPhone: escaneia o código de barras (ou busca pelo nome), mostra a última compra e o menor preço já visto, e registra "Comprei" ou "Só vi".

Endereço: https://deangeli-william.github.io/app-precos/

- **App:** HTML, CSS e JavaScript, publicado pelo GitHub Pages
- **Dados e login:** Supabase (plano gratuito); só os e-mails liberados criam conta
- **Leitura do código:** html5-qrcode (ZXing)

## Arquivos

| Arquivo | Para que serve |
| --- | --- |
| `index.html`, `style.css`, `app.js` | O app |
| `config.js` | Endereço e chave pública do Supabase (a chave pública pode ficar no código) |
| `manifest.webmanifest`, `icones/gerar.py` | Nome e ícone na Tela de Início (os ícones são desenhados na publicação) |
| `supabase/001_estrutura.sql` | Estrutura e regras de segurança do banco (já aplicada) |
| `.github/workflows/publicar.yml` | Publica o app a cada alteração |
