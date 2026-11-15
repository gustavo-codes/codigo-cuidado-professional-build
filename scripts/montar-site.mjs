// Monta o site estático pronto para publicar em dist/ (Vercel, Netlify, Cloudflare, nginx...).
// Mesmo arquivo nos 3 builds (paciente, profissional, combinado). Só usa módulos do Node.
//
//   node scripts/montar-site.mjs
//
// O que faz:
//  1. copia o site para dist/ (sem .git, scripts, docker, *.md, fontes de build)
//  2. index_.html (fonte editável) -> dist/index.html, com ?v=<versão do build> nas URLs do Build/
//  3. grava no index.html o tamanho de cada arquivo do Build/ (TAMANHOS_UNITY) e ajusta o loader da
//     Unity para usar esse número na barra de carregamento: assim ela fica exata em qualquer host,
//     com ou sem Content-Length (proxy comprimindo), sem depender de header do servidor
//  4. ServiceWorker.canonical.js -> dist/ServiceWorker.js, com cacheName que muda sozinho a cada mudança no site
//  5. confere tudo e FALHA (exit 1) se algo não bater, para não publicar site quebrado
//
// Os arquivos .unityweb (brotli) são servidos COMO ESTÃO, sem Content-Encoding: com
// "Decompression Fallback" (Player Settings) o próprio loader descomprime num Web Worker. Funciona em
// qualquer host, mesmo se ele comprimir por cima (o navegador tira essa camada e o loader tira a dele).

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dist = path.join(raiz, 'dist');

const erro = (msg) => { console.error('ERRO: ' + msg); process.exit(1); };
const ok = (cond, msg) => { if (!cond) erro(msg); };

// Fora do site publicado
const IGNORAR = new Set(['.git', '.github', '.vercel', 'dist', 'scripts', 'docker', 'node_modules',
  'Dockerfile', '.dockerignore', '.gitignore', '.gitattributes', 'nginx.conf', 'vercel.json',
  'index.html', 'index_.html', 'ServiceWorker.js', 'ServiceWorker.canonical.js']);
const ignorar = (nome) => IGNORAR.has(nome) || nome.endsWith('.md') || nome === '.DS_Store' || nome === 'Thumbs.db';

// 1. dist/ limpo
ok(path.basename(dist) === 'dist' && dist.startsWith(raiz + path.sep), 'pasta dist inesperada: ' + dist);
fs.rmSync(dist, { recursive: true, force: true });
fs.mkdirSync(dist);
for (const nome of fs.readdirSync(raiz)) {
  if (ignorar(nome)) continue;
  fs.cpSync(path.join(raiz, nome), path.join(dist, nome), { recursive: true });
}

// Build da Unity
const pastaBuild = path.join(dist, 'Build');
ok(fs.existsSync(pastaBuild), 'pasta Build/ não encontrada');
const arquivosBuild = fs.readdirSync(pastaBuild);
const loader = arquivosBuild.find((f) => f.endsWith('.loader.js'));
ok(loader, 'loader (*.loader.js) não encontrado em Build/');
const nome = loader.slice(0, -'.loader.js'.length);
const comprimidos = arquivosBuild.filter((f) => f.endsWith('.unityweb'));
ok(comprimidos.length >= 3, `esperava os arquivos .unityweb do build (data, framework, wasm); achei: ${arquivosBuild.join(', ')}`);
ok(!arquivosBuild.some((f) => f.endsWith('.br')),
  'há arquivos .br em Build/: o build foi feito sem "Decompression Fallback" (Player Settings > WebGL > Publishing)');

// 3. ajusta o loader: tamanho total vem de TAMANHOS_UNITY (gravado no index.html)
const caminhoLoader = path.join(pastaBuild, loader);
let js = fs.readFileSync(caminhoLoader, 'utf8');
let trocas = 0;
js = js.replace(/(\w)=void 0!==(\w)\.headers\.get\("Content-Length"\)/g, (m, d, r) => {
  trocas++; return `${d}=void 0!==${r}.headers.get("Content-Length")||__tamanhoUnity(${r})>0`;
});
ok(trocas === 1, `loader: esperava 1 ponto de "Content-Length", achei ${trocas} (versão da Unity mudou?)`);
trocas = 0;
js = js.replace(/function\((\w),(\w)\)\{if\(!\2\)return 0;/g, (m, r, t) => {
  trocas++; return `function(${r},${t}){var __t=__tamanhoUnity(${r});if(__t>0)return __t;if(!${t})return 0;`;
});
ok(trocas === 1, `loader: esperava 1 cálculo de tamanho, achei ${trocas} (versão da Unity mudou?)`);
js = 'function __tamanhoUnity(r){try{var t=window.TAMANHOS_UNITY;return t&&t[new URL(r.url).pathname.split("/").pop()]||0}catch(e){return 0}}\n' + js;
fs.writeFileSync(caminhoLoader, js);

// Tamanhos (os .unityweb chegam ao loader do jeito que estão no disco)
const tamanhos = {};
for (const f of comprimidos) tamanhos[f] = fs.statSync(path.join(pastaBuild, f)).size;

// Versão do build: hash do conteúdo (muda se qualquer arquivo do Build/ mudar)
const hash = crypto.createHash('sha1');
for (const f of [...arquivosBuild].sort()) { hash.update(f); hash.update(fs.readFileSync(path.join(pastaBuild, f))); }
const versao = hash.digest('hex').slice(0, 12);

// 2. index_.html -> index.html
let html = fs.readFileSync(path.join(raiz, 'index_.html'), 'utf8');
const antes = html;
html = html.replace(/\?v=[0-9A-Za-z]+/g, '?v=' + versao);
ok(html !== antes && html.includes('?v=' + versao), 'index_.html sem ?v= nas URLs do Build/');
// productVersion = versão base + versão do build: a cada build a Unity apaga do IndexedDB do navegador o build
// anterior (o cache dela só limpa entradas de outro productVersion; sem isso acumulava até 1 GB por jogador)
let trocasVersao = 0;
html = html.replace(/(productVersion:\s*")([^"+]*)(?:\+[0-9a-f]+)?(")/, (m, a1, base, a3) => { trocasVersao++; return `${a1}${base}+${versao}${a3}`; });
ok(trocasVersao === 1, 'index_.html sem productVersion: "..." na config da Unity');
ok(/cacheControl:\s*function/.test(html), 'index_.html sem cacheControl na config da Unity (o F5 baixaria o .wasm de novo)');
const script = `<script>window.TAMANHOS_UNITY=${JSON.stringify(tamanhos)};</script>`;
ok(/<head[^>]*>/i.test(html), 'index_.html sem <head>');
html = html.replace(/<head[^>]*>/i, (m) => m + '\n    ' + script);
// Todo arquivo do Build/ citado no index precisa existir
const citados = [...html.matchAll(new RegExp(nome.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '[\\w.]*', 'g'))].map((m) => m[0]);
for (const c of new Set(citados)) {
  if (c.endsWith('.unityweb') || c.endsWith('.js')) ok(arquivosBuild.includes(c), `index_.html cita Build/${c}, que não existe`);
}
ok(citados.some((c) => c.endsWith('.data.unityweb')), 'index_.html não cita o .data.unityweb (ainda aponta para .br?)');
fs.writeFileSync(path.join(dist, 'index.html'), html);

// 4. Service worker: o cacheName ganha um código calculado do conteúdo de TODO o site publicado.
//    Mudou qualquer arquivo (CSS, JS, imagem, minijogo, build) -> código novo -> o navegador instala o
//    service worker novo, que apaga o cache antigo (evento activate). Sem mudança, o código é o mesmo.
//    O ServiceWorker.canonical.js do repositório não muda; só a cópia em dist/.
const hashSite = crypto.createHash('sha1');
const percorrer = (pasta) => {
  for (const item of fs.readdirSync(pasta, { withFileTypes: true }).sort((x, y) => (x.name < y.name ? -1 : 1))) {
    const caminho = path.join(pasta, item.name);
    if (item.isDirectory()) { percorrer(caminho); continue; }
    hashSite.update(path.relative(dist, caminho).split(path.sep).join('/'));
    hashSite.update(fs.readFileSync(caminho));
  }
};
percorrer(dist);
const versaoSite = hashSite.digest('hex').slice(0, 12);
let sw = fs.readFileSync(path.join(raiz, 'ServiceWorker.canonical.js'), 'utf8');
let trocasSw = 0;
sw = sw.replace(/(const cacheName\s*=\s*")([^"]*)(")/, (m, a1, nomeCache, a3) => { trocasSw++; return `${a1}${nomeCache}-${versaoSite}${a3}`; });
ok(trocasSw === 1, 'ServiceWorker.canonical.js sem a linha const cacheName = "..."');
fs.writeFileSync(path.join(dist, 'ServiceWorker.js'), sw);

const mb = (n) => (n / 1048576).toFixed(1) + ' MB';
console.log(`Site montado em dist/ — ${nome}, versão do jogo ${versao}, versão do site (cache do service worker) ${versaoSite}`);
for (const [f, t] of Object.entries(tamanhos)) console.log(`  Build/${f}  ${mb(t)}`);
console.log(`  download do jogo: ${mb(Object.values(tamanhos).reduce((a, b) => a + b, 0) - (tamanhos[nome + '.astc.data.unityweb'] || 0))} (sem o pacote ASTC de teste)`);
