import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';
import { SUPABASE_URL, SUPABASE_KEY } from './config.js';

const sb = createClient(SUPABASE_URL, SUPABASE_KEY);

// ---------- utilidades ----------
const $ = (id) => document.getElementById(id);
const brl = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const dinheiro = (v) => brl.format(Number(v));

function el(tag, classe, texto) {
  const e = document.createElement(tag);
  if (classe) e.className = classe;
  if (texto !== undefined && texto !== null) e.textContent = texto;
  return e;
}

function quando(iso) {
  const d = new Date(iso);
  const hoje = new Date();
  const dia = (x) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = Math.round((dia(hoje) - dia(d)) / 86400000);
  if (diff === 0) return 'hoje';
  if (diff === 1) return 'ontem';
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  return d.getFullYear() === hoje.getFullYear() ? `${dd}/${mm}` : `${dd}/${mm}/${String(d.getFullYear()).slice(2)}`;
}

let toastTimer;
function toast(msg) {
  const t = $('toast');
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, 2600);
}

function mostrar(idTela) {
  document.querySelectorAll('.tela').forEach((s) => { s.hidden = s.id !== idTela; });
  document.body.classList.toggle('escuro', idTela === 'tela-scanner');
  window.scrollTo(0, 0);
}

// Confere o dígito verificador de EAN-8, UPC-A (12) e EAN-13, para descartar leituras erradas.
function codigoValido(c) {
  if (!/^\d+$/.test(c)) return false;
  if (![8, 12, 13].includes(c.length)) return c.length >= 6; // outros formatos: aceita sem conferir
  const digitos = c.split('').map(Number);
  const verificador = digitos.pop();
  let soma = 0;
  digitos.reverse().forEach((n, i) => { soma += n * (i % 2 === 0 ? 3 : 1); });
  return (10 - (soma % 10)) % 10 === verificador;
}

// ---------- estado ----------
const estado = {
  usuario: null,
  nome: '',
  codigo: null,
  produto: null,
  registros: [],
  mercados: [],
  precoCentavos: 0,
  salvando: false,
};

// ---------- login ----------
$('form-login').addEventListener('submit', async (e) => {
  e.preventDefault();
  const erro = $('login-erro');
  erro.hidden = true;
  const { error } = await sb.auth.signInWithPassword({
    email: $('login-email').value.trim(),
    password: $('login-senha').value,
  });
  if (error) {
    erro.textContent = /invalid/i.test(error.message) ? 'E-mail ou senha incorretos.' : `Não consegui entrar: ${error.message}`;
    erro.hidden = false;
    return;
  }
  await iniciar();
});

$('form-nome').addEventListener('submit', async (e) => {
  e.preventDefault();
  const nome = $('nome-input').value.trim();
  if (!nome) return;
  const { data, error } = await sb.auth.updateUser({ data: { nome } });
  if (error) { toast('Não consegui salvar o nome. Tente de novo.'); return; }
  estado.usuario = data.user;
  estado.nome = nome;
  irParaInicio();
});

$('btn-sair').addEventListener('click', async () => {
  if (!confirm('Sair da sua conta neste iPhone?')) return;
  await sb.auth.signOut();
  estado.usuario = null;
  mostrar('tela-login');
});

async function iniciar() {
  const { data } = await sb.auth.getSession();
  const sessao = data.session;
  if (!sessao) { mostrar('tela-login'); return; }
  estado.usuario = sessao.user;
  estado.nome = sessao.user.user_metadata?.nome || '';
  if (!estado.nome) { mostrar('tela-nome'); return; }
  irParaInicio();
}

// ---------- início ----------
function irParaInicio() {
  mostrar('tela-inicio');
  carregarRecentes();
  ligarTempoReal();
}

async function carregarRecentes() {
  const { data, error } = await sb
    .from('registros')
    .select('id, codigo, preco, comprou, criado_em, registrado_por_nome, produtos(nome), mercados(nome)')
    .order('criado_em', { ascending: false })
    .limit(30);
  const lista = $('lista-recentes');
  lista.replaceChildren();
  if (error) { toast('Sem conexão com o banco agora.'); return; }
  $('recentes-vazio').hidden = data.length > 0;
  data.forEach((r) => {
    const li = el('li', 'clicavel');
    const esq = el('div');
    esq.append(el('div', 'item-nome', r.produtos?.nome || r.codigo));
    esq.append(el('div', 'item-detalhe', `${r.mercados?.nome || ''} · ${quando(r.criado_em)} · ${r.registrado_por_nome || ''}`));
    const dir = el('div', 'item-direita');
    dir.append(el('div', 'item-preco', dinheiro(r.preco)));
    dir.append(el('span', r.comprou ? 'tag comprei' : 'tag', r.comprou ? 'Comprei' : 'Só vi'));
    li.append(esq, dir);
    li.addEventListener('click', () => abrirProduto(r.codigo));
    lista.append(li);
  });
}

let canal;
function ligarTempoReal() {
  if (canal) return;
  canal = sb
    .channel('registros')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'registros' }, () => {
      if (!$('tela-inicio').hidden) carregarRecentes();
    })
    .subscribe();
}

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && !$('tela-inicio').hidden) carregarRecentes();
});

// ---------- scanner ----------
let leitor = null;
let lendo = false;

$('btn-escanear').addEventListener('click', abrirScanner);
$('btn-digitar').addEventListener('click', async () => {
  await abrirScanner({ semCamera: true });
  $('codigo-input').focus();
});
$('btn-cancelar-scan').addEventListener('click', async () => { await pararScanner(); irParaInicio(); });

$('form-codigo').addEventListener('submit', async (e) => {
  e.preventDefault();
  const c = $('codigo-input').value.replace(/\D/g, '');
  if (c.length < 6) { toast('Código muito curto.'); return; }
  await pararScanner();
  abrirProduto(c);
});

async function abrirScanner(opcoes = {}) {
  mostrar('tela-scanner');
  $('codigo-input').value = '';
  $('scanner-erro').hidden = true;
  lendo = false;
  if (opcoes.semCamera) return;
  try {
    const F = Html5QrcodeSupportedFormats;
    leitor = new Html5Qrcode('leitor', {
      formatsToSupport: [F.EAN_13, F.EAN_8, F.UPC_A, F.UPC_E, F.CODE_128],
      experimentalFeatures: { useBarCodeDetectorIfSupported: true },
      verbose: false,
    });
    await leitor.start(
      { facingMode: 'environment' },
      { fps: 12, qrbox: (w, h) => ({ width: Math.floor(w * 0.85), height: Math.floor(Math.min(h, w) * 0.45) }) },
      aoLer,
      () => {},
    );
  } catch (err) {
    $('scanner-erro').textContent = 'Não consegui abrir a câmera. Permita o acesso à câmera nos Ajustes ou digite o código abaixo.';
    $('scanner-erro').hidden = false;
  }
}

async function aoLer(texto) {
  if (lendo) return;
  const c = String(texto).trim();
  if (!codigoValido(c)) return; // leitura ruim: continua tentando
  lendo = true;
  await pararScanner();
  abrirProduto(c);
}

async function pararScanner() {
  if (!leitor) return;
  try { if (leitor.isScanning) await leitor.stop(); leitor.clear(); } catch (_) { /* já parado */ }
  leitor = null;
}

// ---------- produto ----------
$('btn-voltar').addEventListener('click', irParaInicio);

async function abrirProduto(codigo) {
  estado.codigo = codigo;
  estado.precoCentavos = 0;
  mostrar('tela-produto');
  $('produto-codigo').textContent = codigo;
  $('preco-input').value = '';
  $('comparacao').hidden = true;
  $('registro-erro').hidden = true;
  $('produto-nome-input').value = '';
  $('novo-mercado-input').value = '';
  $('bloco-novo').hidden = true;
  $('produto-nome').hidden = true;
  $('bloco-referencia').hidden = true;
  $('lista-historico').replaceChildren();
  $('titulo-historico').hidden = true;

  const [p, r, m] = await Promise.all([
    sb.from('produtos').select('codigo, nome').eq('codigo', codigo).maybeSingle(),
    sb.from('registros')
      .select('id, preco, comprou, criado_em, registrado_por, registrado_por_nome, mercados(nome)')
      .eq('codigo', codigo)
      .order('criado_em', { ascending: false })
      .limit(200),
    sb.from('mercados').select('id, nome').order('nome'),
  ]);
  if (p.error || r.error || m.error) { toast('Sem conexão com o banco agora.'); }
  if (estado.codigo !== codigo) return; // usuário já saiu desta tela

  estado.produto = p.data || null;
  estado.registros = r.data || [];
  estado.mercados = m.data || [];

  if (estado.produto) {
    $('produto-nome').textContent = estado.produto.nome;
    $('produto-nome').hidden = false;
  } else {
    $('bloco-novo').hidden = false;
  }
  montarReferencias();
  montarMercados();
  montarHistorico();
}

function referencias() {
  const regs = estado.registros;
  if (!regs.length) return null;
  const ultimaCompra = regs.find((x) => x.comprou);
  const base = ultimaCompra || regs[0];
  let menor = regs[0];
  regs.forEach((x) => { if (Number(x.preco) < Number(menor.preco)) menor = x; });
  return { base, comprou: Boolean(ultimaCompra), menor };
}

const detalhe = (x) => `${x.mercados?.nome || ''} · ${quando(x.criado_em)} · ${x.registrado_por_nome || ''}`;

function montarReferencias() {
  const ref = referencias();
  if (!ref) return;
  $('bloco-referencia').hidden = false;
  $('ref1-titulo').textContent = ref.comprou ? 'Última compra' : 'Último preço visto';
  $('ref1-preco').textContent = dinheiro(ref.base.preco);
  $('ref1-detalhe').textContent = detalhe(ref.base);
  $('ref2-preco').textContent = dinheiro(ref.menor.preco);
  $('ref2-detalhe').textContent = detalhe(ref.menor);
}

function montarMercados() {
  const sel = $('mercado-select');
  sel.replaceChildren();
  const vazio = el('option', null, estado.mercados.length ? 'Escolha o mercado' : 'Cadastre o primeiro mercado');
  vazio.value = '';
  sel.append(vazio);
  estado.mercados.forEach((m) => {
    const o = el('option', null, m.nome);
    o.value = String(m.id);
    sel.append(o);
  });
  const novo = el('option', null, '+ Novo mercado…');
  novo.value = '__novo';
  sel.append(novo);

  const ultimo = localStorage.getItem('ultimoMercado');
  if (ultimo && estado.mercados.some((m) => String(m.id) === ultimo)) sel.value = ultimo;
  else if (!estado.mercados.length) sel.value = '__novo';
  $('campo-novo-mercado').hidden = sel.value !== '__novo';
}

$('mercado-select').addEventListener('change', (e) => {
  $('campo-novo-mercado').hidden = e.target.value !== '__novo';
  if (e.target.value === '__novo') $('novo-mercado-input').focus();
});

function montarHistorico() {
  const lista = $('lista-historico');
  lista.replaceChildren();
  const regs = estado.registros.slice(0, 20);
  $('titulo-historico').hidden = regs.length === 0;
  regs.forEach((r) => {
    const li = el('li');
    const esq = el('div');
    esq.append(el('div', 'item-preco', dinheiro(r.preco)));
    esq.append(el('div', 'item-detalhe', detalhe(r)));
    const dir = el('div', 'item-direita');
    dir.append(el('span', r.comprou ? 'tag comprei' : 'tag', r.comprou ? 'Comprei' : 'Só vi'));
    if (r.registrado_por === estado.usuario?.id) {
      const apagar = el('button', 'apagar', 'Apagar');
      apagar.addEventListener('click', () => apagarRegistro(r.id));
      dir.append(el('br'), apagar);
    }
    li.append(esq, dir);
    lista.append(li);
  });
}

async function apagarRegistro(id) {
  if (!confirm('Apagar este registro de preço?')) return;
  const { error } = await sb.from('registros').delete().eq('id', id);
  if (error) { toast('Não consegui apagar.'); return; }
  estado.registros = estado.registros.filter((x) => x.id !== id);
  $('bloco-referencia').hidden = true;
  montarReferencias();
  montarHistorico();
  atualizarComparacao();
  toast('Registro apagado.');
}

// ---------- preço ----------
// Digita só números e o app preenche da direita: 2 5 9 0 vira R$ 25,90.
$('preco-input').addEventListener('input', (e) => {
  const digitos = e.target.value.replace(/\D/g, '').replace(/^0+/, '').slice(0, 8);
  estado.precoCentavos = Number(digitos || 0);
  e.target.value = estado.precoCentavos ? dinheiro(estado.precoCentavos / 100) : '';
  atualizarComparacao();
});

function atualizarComparacao() {
  const p = $('comparacao');
  const ref = referencias();
  if (!ref || !estado.precoCentavos) { p.hidden = true; return; }
  const agora = estado.precoCentavos / 100;
  const antes = Number(ref.base.preco);
  const diff = Math.round((agora - antes) * 100) / 100;
  const pct = antes ? Math.round((Math.abs(diff) / antes) * 1000) / 10 : 0;
  const pctTxt = pct.toLocaleString('pt-BR', { maximumFractionDigits: 1 });
  const contra = ref.comprou ? 'que a última compra' : 'que o último preço visto';
  p.classList.remove('mais-barato', 'mais-caro');
  if (diff < 0) {
    p.textContent = `${dinheiro(-diff)} mais barato ${contra} (−${pctTxt}%)`;
    p.classList.add('mais-barato');
  } else if (diff > 0) {
    p.textContent = `${dinheiro(diff)} mais caro ${contra} (+${pctTxt}%)`;
    p.classList.add('mais-caro');
  } else {
    p.textContent = `Mesmo preço ${contra}`;
  }
  p.hidden = false;
}

// ---------- salvar ----------
$('btn-comprei').addEventListener('click', () => salvar(true));
$('btn-so-vi').addEventListener('click', () => salvar(false));

function erroRegistro(msg) {
  const e = $('registro-erro');
  e.textContent = msg;
  e.hidden = false;
}

async function garantirMercado() {
  const valor = $('mercado-select').value;
  if (valor && valor !== '__novo') return Number(valor);
  if (valor !== '__novo') return null;
  const nome = $('novo-mercado-input').value.trim();
  if (!nome) return null;
  const { data, error } = await sb.from('mercados').insert({ nome }).select('id').single();
  if (!error) return data.id;
  // Já existe (talvez cadastrado agora pela outra pessoa): busca pelo nome.
  const { data: todos } = await sb.from('mercados').select('id, nome');
  const igual = (todos || []).find((m) => m.nome.trim().toLowerCase() === nome.toLowerCase());
  return igual ? igual.id : null;
}

async function salvar(comprou) {
  if (estado.salvando) return;
  $('registro-erro').hidden = true;
  const novo = !estado.produto;
  const nomeProduto = $('produto-nome-input').value.trim();
  if (novo && !nomeProduto) { erroRegistro('Dê um nome para o produto.'); return; }
  if (!estado.precoCentavos) { erroRegistro('Digite o preço.'); return; }
  const sel = $('mercado-select').value;
  if (!sel || (sel === '__novo' && !$('novo-mercado-input').value.trim())) { erroRegistro('Escolha ou cadastre o mercado.'); return; }

  estado.salvando = true;
  $('btn-comprei').disabled = true;
  $('btn-so-vi').disabled = true;
  try {
    if (novo) {
      // Se a outra pessoa cadastrou o mesmo código agora, vale o primeiro nome.
      const { error } = await sb.from('produtos')
        .upsert({ codigo: estado.codigo, nome: nomeProduto }, { onConflict: 'codigo', ignoreDuplicates: true });
      if (error) throw error;
    }
    const mercadoId = await garantirMercado();
    if (!mercadoId) throw new Error('mercado');
    const { error } = await sb.from('registros').insert({
      codigo: estado.codigo,
      mercado_id: mercadoId,
      preco: estado.precoCentavos / 100,
      comprou,
      registrado_por_nome: estado.nome,
    });
    if (error) throw error;
    localStorage.setItem('ultimoMercado', String(mercadoId));
    toast(`${comprou ? 'Comprei' : 'Só vi'}: ${dinheiro(estado.precoCentavos / 100)} registrado`);
    irParaInicio();
  } catch (err) {
    erroRegistro('Não consegui registrar. Confira a internet e tente de novo.');
  } finally {
    estado.salvando = false;
    $('btn-comprei').disabled = false;
    $('btn-so-vi').disabled = false;
  }
}

// ---------- começo ----------
sb.auth.onAuthStateChange((evento) => {
  if (evento === 'SIGNED_OUT') mostrar('tela-login');
});
iniciar();
