# SMShop V4

Loja afiliada premium, leve e modular, criada com HTML5, CSS3, JavaScript ES Modules, Node.js e Express. O projeto foi pensado para VPS Hostinger com Ubuntu 24.04 LTS, PM2 e NGINX.

## Visão geral

SMShop V4 é uma vitrine afiliada premium para tecnologia, gadgets, smartwatches, fones e casa inteligente. A home foi criada para branding, confiança e conversão. O catálogo fica nas páginas de produtos e categorias, com cards espaçosos, modal de galeria, favoritos persistentes e links afiliados.

O projeto não usa React, Next, Vue, Netlify Functions ou `netlify.toml`.

## Stack

- HTML5
- CSS3
- JavaScript ES Modules
- Node.js
- Express.js
- PM2
- NGINX
- Ubuntu 24.04 LTS
- GitHub
- Hostinger VPS

## Estrutura

```text
Smshop-V4/
├── imagens/
│   ├── logo/logo.png
│   └── tecnologia/001/...
├── referencias/
├── public/
│   └── index.html
├── src/
│   ├── css/
│   ├── js/
│   ├── data/
│   ├── components/
│   ├── pages/
│   ├── utils/
│   └── api/
├── server/
│   ├── routes/
│   ├── controllers/
│   ├── services/
│   ├── middleware/
│   └── app.js
├── ecosystem.config.js
├── nginx.conf
├── package.json
├── README.md
└── .gitignore
```

Algumas pastas em `src/components`, `src/pages` e `src/utils` ficam reservadas para crescimento futuro. A V4 usa módulos centrais em `src/js` para manter o carregamento simples e rápido.

## Instalação local

```bash
npm install
npm run dev
```

Acesse:

```text
http://localhost:3000
```

Para produção local:

```bash
npm start
```

## Rotas

- `/`
- `/produtos`
- `/categoria/tecnologia`
- `/favoritos`
- `/ofertas`
- `/contato`
- `/sobre`
- `/politica`
- `/termos`
- `/api/products`
- `/api/products/summary`
- `/sitemap.xml`
- `/robots.txt`

## Sistema automático de produtos

Cada pasta dentro de `imagens/tecnologia` representa um produto:

```text
imagens/tecnologia/001/
imagens/tecnologia/002/
imagens/tecnologia/003/
```

Dentro de cada pasta, coloque as imagens:

```text
01.webp
02.webp
03.webp
```

O servidor detecta automaticamente:

- pastas de produto
- imagens `.webp`, `.png`, `.jpg`, `.jpeg` e `.avif`
- ordem numérica das pastas
- ordem numérica das imagens
- galeria do modal
- thumbnail
- imagem hero do card

## Links afiliados

Os links oficiais estão em:

```text
src/data/affiliate-links.js
```

A ordem é aplicada diretamente à ordem das pastas:

```text
001 -> primeiro link
002 -> segundo link
003 -> terceiro link
```

Para alterar um link, edite apenas o item correspondente no array. Não reordene as pastas se a intenção for manter os links atuais.

## Quantidade de produtos e links

O catálogo oficial atual possui 37 produtos cadastrados em `src/data/product-catalog.js`, seguindo exatamente a ordem das pastas `001` a `037`. A lista de links afiliados possui 39 URLs; os 2 links extras ficam preservados em `src/data/affiliate-links.js`, mas não são exibidos porque não fazem parte da lista oficial de produtos desta etapa.

Verificação:

```bash
npm run products:check
```

## Como adicionar produto

1. Crie uma nova pasta com o próximo número:

```text
imagens/tecnologia/042/
```

2. Coloque as imagens:

```text
imagens/tecnologia/042/01.webp
imagens/tecnologia/042/02.webp
```

3. Adicione o link afiliado no final de:

```text
src/data/affiliate-links.js
```

4. Opcionalmente, adicione um nome em:

```text
src/data/product-names.js
```

5. Reinicie o app em produção:

```bash
pm2 restart smshop-v4
```

## Favortios, tema e leads

Favoritos usam `localStorage` e sincronizam entre cards, modal e contador.

Tema dark/light usa `localStorage` e funciona entre páginas porque a navegação é controlada por JavaScript modular.

Leads e contato usam endpoints Express:

```text
POST /api/leads
POST /api/contact
```

Hoje esses endpoints validam e respondem. Para produção real, conecte com SMTP, CRM, Google Sheets, Brevo, Mailchimp ou outro serviço.

## SEO

Incluído:

- meta tags
- Open Graph
- Twitter Card
- favicon com a logo
- JSON-LD Organization
- `robots.txt`
- `sitemap.xml`

Configure a variável `SITE_URL` no PM2 para gerar sitemap com domínio final.

## Deploy em VPS Hostinger Ubuntu 24.04

### 1. Acessar VPS

```bash
ssh root@IP_DA_VPS
```

### 2. Atualizar Ubuntu

```bash
sudo apt update
sudo apt upgrade -y
```

### 3. Instalar Node.js LTS

Opção via NodeSource:

```bash
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs
node -v
npm -v
```

### 4. Instalar Git, NGINX e PM2

```bash
sudo apt install -y git nginx
sudo npm install -g pm2
```

### 5. Clonar pelo GitHub

```bash
cd /var/www
sudo git clone https://github.com/SEU_USUARIO/Smshop-V4.git smshop-v4
sudo chown -R $USER:$USER /var/www/smshop-v4
cd /var/www/smshop-v4
```

### 6. Instalar dependências

```bash
npm install --omit=dev
```

### 7. Configurar PM2

Edite `ecosystem.config.js` e ajuste:

```js
SITE_URL: "https://seudominio.com.br"
```

Inicie:

```bash
mkdir -p logs
pm2 start ecosystem.config.js
pm2 save
pm2 startup
```

O comando `pm2 startup` mostrará uma linha para copiar e executar com `sudo`.

### 8. Configurar NGINX

Copie a configuração:

```bash
sudo cp nginx.conf /etc/nginx/sites-available/smshop-v4
sudo ln -s /etc/nginx/sites-available/smshop-v4 /etc/nginx/sites-enabled/smshop-v4
sudo nginx -t
sudo systemctl reload nginx
```

Antes disso, edite `server_name` em `nginx.conf`:

```nginx
server_name seudominio.com.br www.seudominio.com.br;
```

### 9. Apontar domínio

No painel do registrador ou Hostinger:

- Crie registro `A` para `@` apontando ao IP da VPS
- Crie registro `A` ou `CNAME` para `www`
- Aguarde propagação DNS

### 10. SSL com Certbot

```bash
sudo apt install -y certbot python3-certbot-nginx
sudo certbot --nginx -d seudominio.com.br -d www.seudominio.com.br
```

Teste renovação:

```bash
sudo certbot renew --dry-run
```

## Deploy por atualização Git

```bash
cd /var/www/smshop-v4
git pull origin main
npm install --omit=dev
pm2 restart smshop-v4
```

## Comandos úteis

Ver logs:

```bash
pm2 logs smshop-v4
```

Status:

```bash
pm2 status
```

Restart:

```bash
pm2 restart smshop-v4
```

Recarregar NGINX:

```bash
sudo nginx -t
sudo systemctl reload nginx
```

## Troubleshooting

### Site não abre

Verifique app:

```bash
pm2 status
pm2 logs smshop-v4
```

Verifique NGINX:

```bash
sudo nginx -t
sudo systemctl status nginx
```

### Imagens não aparecem

Confirme se a estrutura é:

```text
imagens/tecnologia/001/01.webp
```

Arquivos `.DS_Store` são ignorados pelo serviço.

### Favoritos não sincronizam

Limpe o `localStorage` do navegador e teste novamente. A chave usada é:

```text
smshop:v4:favorites
```

### Tema não persiste

A chave usada é:

```text
smshop:v4:theme
```

### API não lista produtos

Teste:

```bash
curl http://localhost:3000/api/products
```

Se falhar, verifique permissões da pasta `imagens`.

## Performance

Implementado:

- lazy loading de imagens
- preload das primeiras imagens hero
- cache headers via Express e NGINX
- gzip no NGINX
- compression no Express
- skeleton loading
- debounce em busca e filtros
- CSS e JS leves, sem framework pesado

## Aviso afiliado

Alguns links deste site podem gerar comissão para nossa loja sem custo adicional para você. Preços, disponibilidade, frete e checkout são definidos pelo Mercado Livre ou vendedor parceiro no momento da compra.
