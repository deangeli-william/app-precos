# Preços

App de iPhone para lembrar o preço dos produtos do mercado: escaneia o código de barras, mostra a última compra e o menor preço já visto, e registra "Comprei" ou "Só vi".

- **App:** HTML, CSS e JavaScript, publicado pelo GitHub Pages
- **Dados e login:** Supabase (plano gratuito)
- **Leitura do código:** html5-qrcode (ZXing)

## Arquivos

| Arquivo | Para que serve |
| --- | --- |
| `index.html`, `style.css`, `app.js` | O app |
| `config.js` | Endereço e chave pública do Supabase |
| `supabase/schema.sql` | Estrutura do banco; rodar uma vez no SQL Editor do Supabase |
| `icones/` | Ícones do app (em base64; viram PNG na publicação) |
| `.github/workflows/publicar.yml` | Publica o app no GitHub Pages a cada alteração |
| `.github/workflows/manter-supabase-ativo.yml` | Acesso automático 2x por semana para o Supabase não pausar |

## Observação

O GitHub desliga tarefas agendadas de repositórios sem nenhuma alteração por 60 dias e avisa por e-mail. Se chegar esse aviso, é só entrar em **Actions → Manter Supabase ativo → Enable workflow**.
