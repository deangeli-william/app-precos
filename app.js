(() => {
  const $ = (id) => document.getElementById(id);
  const brl = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
  const dinheiro = (v) => brl.format(Number(v));
  const CFG = window.PRECOS_CONFIG;
  const CHAVE_LUGAR = 'precos-ultimo-lugar';

  if (!window.supabase || !CFG) {
    $('tela-carregando').textContent = 'Não consegui carregar o app. Verifique a internet e abra de novo.';
    return;
  }
  // Link do e-mail "Esqueci a senha": chega com #...type=recovery (ou #error=... se venceu).
  const RECUPERANDO = /type=recovery/.test(location.hash);
  const LINK_VENCIDO = /error_code=|[#&]error=/.test(location.hash);
  const sb = window.supabase.createClient(CFG.supabaseUrl, CFG.supabaseKey, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
  });
  const limparEndereco = () => { try { history.replaceState(null, '', location.pathname); } catch (_) { /* sem histórico */ } };

  // ---------- utilidades ----------
  function el(tag, classe, texto) {
    const e = document.createElement(tag);
    if (classe) e.className = classe;
    if (texto !== undefined && texto !== null) e.textContent = texto;
    return e;
  }
  // Cada palavra com a primeira letra maiúscula; "de, da, do, das, dos, e" minúsculas no meio.
  const MINUSCULAS = ['de', 'da', 'do', 'das', 'dos', 'e'];
  const capitalizar = (s) => (s || '').trim().replace(/\s+/g, ' ').toLowerCase().split(' ')
    .map((w, i) => (i > 0 && MINUSCULAS.includes(w)) ? w : w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
  const semAcento = (s) => (s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  function quando(iso) {
    const d = new Date(iso);
    return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getFullYear()).slice(2)}`;
  }
  const lerLocal = (k) => { try { return localStorage.getItem(k); } catch (_) { return null; } };
  const gravarLocal = (k, v) => { try { localStorage.setItem(k, v); } catch (_) { /* sem armazenamento */ } };

  let toastTimer;
  function toast(msg) { const t = $('toast'); t.textContent = msg; t.hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => { t.hidden = true; }, 2800); }
  function mensagemErro(e) {
    if (!navigator.onLine) return 'Sem internet. Tente de novo quando tiver sinal.';
    return 'Não consegui gravar. Tente de novo.' + (e && e.message ? ` (${e.message})` : '');
  }

  let telaAtual = null;
  function mostrar(id) {
    if (telaAtual === 'tela-scanner' && id !== 'tela-scanner') desligarCamera();
    telaAtual = id;
    $('tela-carregando').hidden = true;
    document.querySelectorAll('.tela').forEach((s) => { s.hidden = s.id !== id; });
    document.body.classList.toggle('escuro', id === 'tela-scanner');
    window.scrollTo(0, 0);
  }

  // ---------- dados (cópia local, atualizada ao vivo) ----------
  const db = { eu: null, perfis: new Map(), produtos: new Map(), lugares: new Map(), registros: new Map() };
  const nProduto = (p) => ({ id: p.id, codigo: p.codigo, produto: p.produto, marca: p.marca || '', vendido_por: p.vendido_por, tamanho: p.tamanho || '' });
  const nRegistro = (r) => ({ id: r.id, produto_id: r.produto_id, lugar_id: r.lugar_id, preco: Number(r.preco), comprou: r.comprou, quando: r.quando, usuario_id: r.usuario_id });
  const ordemRegistros = (a, b) => (b.quando < a.quando ? -1 : b.quando > a.quando ? 1 : b.id - a.id);
  const registrosDe = (pid) => [...db.registros.values()].filter((r) => r.produto_id === pid).sort(ordemRegistros);
  const nomeLugar = (id) => db.lugares.get(id)?.nome || '';
  const nomePessoa = (id) => db.perfis.get(id) || '';

  async function todos(tabela, colunas) {
    const out = []; const passo = 1000;
    for (let de = 0; ; de += passo) {
      const { data, error } = await sb.from(tabela).select(colunas).order('id').range(de, de + passo - 1);
      if (error) throw error;
      out.push(...data);
      if (data.length < passo) break;
    }
    return out;
  }

  async function carregarPerfis() {
    const ps = await todos('perfis', 'id,nome');
    db.perfis = new Map(ps.map((p) => [p.id, p.nome]));
  }

  async function carregarTudo() {
    const [produtos, lugares, registros] = await Promise.all([
      todos('produtos', 'id,codigo,produto,marca,vendido_por,tamanho'),
      todos('lugares', 'id,nome'),
      todos('registros', 'id,produto_id,lugar_id,preco,comprou,quando,usuario_id'),
      carregarPerfis(),
    ]);
    db.produtos = new Map(produtos.map((p) => [p.id, nProduto(p)]));
    db.lugares = new Map(lugares.map((l) => [l.id, l]));
    db.registros = new Map(registros.map((r) => [r.id, nRegistro(r)]));
  }

  // O que o outro registra aparece na hora.
  let canal = null;
  function assinarMudancas() {
    if (canal) return;
    const aplicar = (tabela) => async (ev) => {
      const mapa = db[tabela];
      if (ev.eventType === 'DELETE') mapa.delete(ev.old.id);
      else if (tabela === 'produtos') mapa.set(ev.new.id, nProduto(ev.new));
      else if (tabela === 'registros') {
        mapa.set(ev.new.id, nRegistro(ev.new));
        if (!db.perfis.has(ev.new.usuario_id)) { try { await carregarPerfis(); } catch (_) {} }
      } else mapa.set(ev.new.id, { id: ev.new.id, nome: ev.new.nome });
      redesenhar();
    };
    canal = sb.channel('mudancas')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'registros' }, aplicar('registros'))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'produtos' }, aplicar('produtos'))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'lugares' }, aplicar('lugares'))
      .subscribe();
  }

  // Ao voltar para o app (o iPhone pausa a conexão em segundo plano), busca tudo de novo.
  document.addEventListener('visibilitychange', async () => {
    if (document.visibilityState !== 'visible' || !db.eu || !db.perfis.has(db.eu)) return;
    try { await carregarTudo(); redesenhar(); } catch (_) { /* tenta na próxima vez */ }
  });

  function redesenhar() {
    if (telaAtual === 'tela-inicio') irParaInicio(false);
    else if (telaAtual === 'tela-scanner' && $('busca-input').value.trim()) buscar();
    else if (telaAtual === 'tela-produto' && estado.produto && !estado.editando) {
      const p = db.produtos.get(estado.produto.id);
      if (!p) { toast('Este produto foi apagado.'); irParaInicio(); return; }
      estado.produto = p;
      preencherCabecalho(); montarReferencias(); montarHistorico(); comparar();
    }
  }

  // ---------- login ----------
  let modoCriar = false;
  function ajustarLogin() {
    $('btn-entrar').textContent = modoCriar ? 'Criar senha e entrar' : 'Entrar';
    $('btn-alternar-login').textContent = modoCriar ? 'Já tenho senha. Entrar' : 'Primeiro acesso? Criar minha senha';
    $('login-senha').autocomplete = modoCriar ? 'new-password' : 'current-password';
    $('login-senha').placeholder = modoCriar ? 'Mínimo de 6 caracteres' : '';
    $('login-erro').hidden = true; $('login-ok').hidden = true;
  }
  $('btn-alternar-login').addEventListener('click', () => { modoCriar = !modoCriar; ajustarLogin(); });

  $('form-login').addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = $('login-email').value.trim().toLowerCase();
    const senha = $('login-senha').value;
    const erro = (m) => { $('login-erro').textContent = m; $('login-erro').hidden = false; };
    $('login-erro').hidden = true; $('btn-entrar').disabled = true;
    try {
      if (modoCriar) {
        const { data, error } = await sb.auth.signUp({ email, password: senha });
        if (error) {
          if (/already registered|already exists/i.test(error.message)) return erro('Este e-mail já tem senha. Toque em "Já tenho senha. Entrar".');
          if (/database error|não tem acesso/i.test(error.message)) return erro('Este e-mail não tem acesso ao app.');
          if (/password/i.test(error.message)) return erro('A senha precisa ter pelo menos 6 caracteres.');
          return erro(error.message);
        }
        if (!data.session) {
          const r = await sb.auth.signInWithPassword({ email, password: senha });
          if (r.error) return erro('Senha criada, mas não consegui entrar. Toque em "Já tenho senha. Entrar".');
        }
      } else {
        const { error } = await sb.auth.signInWithPassword({ email, password: senha });
        if (error) return erro(/invalid/i.test(error.message) ? 'E-mail ou senha incorretos.' : error.message);
      }
      const { data: { session } } = await sb.auth.getSession();
      await iniciarSessao(session);
    } catch (err) {
      erro(mensagemErro(err));
    } finally {
      $('btn-entrar').disabled = false;
    }
  });

  // Esqueci a senha: manda um e-mail com link para criar outra.
  $('btn-esqueci').addEventListener('click', async () => {
    const email = $('login-email').value.trim().toLowerCase();
    const erro = (m) => { $('login-erro').textContent = m; $('login-erro').hidden = false; };
    $('login-erro').hidden = true; $('login-ok').hidden = true;
    if (!email) { erro('Escreva seu e-mail no campo acima e toque de novo em "Esqueci a senha".'); $('login-email').focus(); return; }
    $('btn-esqueci').disabled = true;
    try {
      const { error } = await sb.auth.resetPasswordForEmail(email, { redirectTo: location.origin + location.pathname });
      if (error) {
        if (/rate limit|seconds|too many/i.test(error.message)) return erro('Muitos pedidos seguidos. Espere alguns minutos e tente de novo.');
        return erro(error.message);
      }
      $('login-ok').textContent = 'Pronto! Abra o e-mail (olhe também no spam) e toque no link. Ele abre no Safari para você criar a senha nova.';
      $('login-ok').hidden = false;
    } catch (err) {
      erro(navigator.onLine ? 'Não consegui pedir o e-mail. Tente de novo.' : 'Sem internet. Tente de novo quando tiver sinal.');
    } finally {
      $('btn-esqueci').disabled = false;
    }
  });

  $('form-nova-senha').addEventListener('submit', async (e) => {
    e.preventDefault();
    const erro = (m) => { $('nova-senha-erro').textContent = m; $('nova-senha-erro').hidden = false; };
    $('nova-senha-erro').hidden = true; $('btn-nova-senha').disabled = true;
    try {
      const { error } = await sb.auth.updateUser({ password: $('nova-senha').value });
      if (error) {
        if (/different|same/i.test(error.message)) return erro('A senha nova precisa ser diferente da antiga.');
        if (/at least|characters|weak/i.test(error.message)) return erro('A senha precisa ter pelo menos 6 caracteres.');
        if (/session|expired|jwt/i.test(error.message)) return erro('O link venceu. Volte ao app e peça outro em "Esqueci a senha".');
        return erro(error.message);
      }
      limparEndereco();
      toast('Senha nova salva. No ícone do app, entre com ela.');
      const { data: { session } } = await sb.auth.getSession();
      await iniciarSessao(session);
    } catch (err) {
      erro(navigator.onLine ? 'Não consegui salvar. Tente de novo.' : 'Sem internet. Tente de novo quando tiver sinal.');
    } finally {
      $('btn-nova-senha').disabled = false;
    }
  });

  $('form-nome').addEventListener('submit', async (e) => {
    e.preventDefault();
    const nome = capitalizar($('nome-input').value);
    if (!nome) return;
    const { error } = await sb.from('perfis').insert({ id: db.eu, nome });
    if (error) { $('nome-erro').textContent = mensagemErro(error); $('nome-erro').hidden = false; return; }
    db.perfis.set(db.eu, nome);
    await entrarNoApp();
  });

  let confirmaSair = false;
  $('btn-quem').addEventListener('click', async (e) => {
    if (!confirmaSair) {
      confirmaSair = true; e.target.textContent = 'Sair? Toque de novo';
      setTimeout(() => { confirmaSair = false; e.target.textContent = nomePessoa(db.eu); }, 3500);
      return;
    }
    await sb.auth.signOut();
    location.reload();
  });

  async function iniciarSessao(session) {
    if (!session) { ajustarLogin(); mostrar('tela-login'); return; }
    db.eu = session.user.id;
    await carregarPerfis();
    if (!db.perfis.has(db.eu)) { mostrar('tela-nome'); $('nome-input').focus(); return; }
    await entrarNoApp();
  }
  async function entrarNoApp() {
    await carregarTudo();
    assinarMudancas();
    irParaInicio();
  }

  // ---------- principal ----------
  const titulo = (p) => p.marca ? `${p.produto} · ${p.marca}` : p.produto;
  const ABREV = { kg: 'kg', g: 'g', litro: 'L', ml: 'ml', pacote: 'pct', unidade: 'un', caixa: 'cx' };
  const porMedida = (v) => ['kg', 'g', 'litro', 'ml'].includes(v);
  const abrev = (v) => ABREV[v] || v;
  const sufixo = (p) => ' /' + abrev(p.vendido_por);
  const embalagem = (p) => porMedida(p.vendido_por) ? '' : (p.tamanho || '');
  const etiqueta = (r) => { const d = el('div', 'c2'); d.append(el('span', r.comprou ? 'tag comprei' : 'tag', r.comprou ? 'Comprei' : 'Só vi')); return d; };

  function irParaInicio(rolarTopo = true) {
    if (rolarTopo || telaAtual !== 'tela-inicio') mostrar('tela-inicio');
    $('btn-quem').textContent = nomePessoa(db.eu);
    const lista = $('lista-recentes');
    lista.replaceChildren();
    const regs = [...db.registros.values()].sort(ordemRegistros).slice(0, 30);
    $('recentes-vazio').hidden = regs.length > 0;
    regs.forEach((r) => {
      const p = db.produtos.get(r.produto_id); if (!p) return;
      const li = el('li', 'clicavel linha');
      const partes = [embalagem(p), nomeLugar(r.lugar_id), quando(r.quando), nomePessoa(r.usuario_id)].filter(Boolean);
      const preco = el('div', 'item-preco c2', dinheiro(r.preco)); preco.append(el('span', 'unid', sufixo(p)));
      li.append(el('div', 'item-nome c1', titulo(p)), preco, el('div', 'item-detalhe c1', partes.join(' · ')), etiqueta(r));
      li.addEventListener('click', () => abrirProduto({ id: p.id }));
      lista.append(li);
    });
  }

  // ---------- câmera e busca ----------
  // Leitor: zxing-cpp (WebAssembly). Lê o quadro inteiro que aparece na tela, sem precisar enquadrar.
  const FORMATOS = ['EAN-13', 'EAN-8', 'UPC-A', 'UPC-E', 'Code128'];
  const OPC_VIVO = { formats: FORMATOS, tryHarder: true, tryRotate: true, tryInvert: false, tryDownscale: true, maxNumberOfSymbols: 1 };
  const OPC_FOTO = { formats: FORMATOS, tryHarder: true, tryRotate: true, tryInvert: true, tryDownscale: true, maxNumberOfSymbols: 4 };
  const temLeitor = () => typeof ZXingWASM !== 'undefined';
  // já baixa o leitor ao abrir o app, para a câmera ler de primeira
  if (temLeitor()) { try { Promise.resolve(ZXingWASM.prepareZXingModule({ fireImmediately: true })).catch(() => {}); } catch (_) { /* tenta na hora */ } }

  const quadro = document.createElement('canvas');
  const ctxQuadro = quadro.getContext('2d', { willReadFrequently: true });
  let fluxo = null;
  let sessao = 0;
  let lido = false;

  $('btn-escanear').addEventListener('click', () => {
    mostrar('tela-scanner');
    $('busca-input').value = ''; $('resultados').replaceChildren();
    $('scanner-erro').hidden = true; $('lendo').hidden = true;
    $('dica-camera').textContent = 'Aponte para o código de barras, com o celular a uns 20 cm. Se ficar borrado, afaste mais.';
    ligarCamera();
  });
  $('btn-cancelar').addEventListener('click', () => irParaInicio());

  // O iPhone desliga a câmera quando o app vai para segundo plano: religa ao voltar.
  document.addEventListener('visibilitychange', () => {
    if (telaAtual !== 'tela-scanner') return;
    if (document.visibilityState === 'visible') ligarCamera(); else desligarCamera();
  });

  async function ligarCamera() {
    desligarCamera();
    const minha = ++sessao;
    lido = false;
    $('leitor').classList.remove('achou');
    if (!temLeitor()) { $('dica-camera').textContent = 'O leitor não carregou. Confira a internet, use a foto ou busque pelo nome.'; return; }
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) { $('dica-camera').textContent = 'Este navegador não liga a câmera. Use a foto ou busque pelo nome.'; return; }
    try {
      const s = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } },
      });
      if (minha !== sessao || telaAtual !== 'tela-scanner') { s.getTracks().forEach((t) => t.stop()); return; }
      fluxo = s;
      const v = $('video');
      v.srcObject = s;
      try { await v.play(); } catch (_) { /* autoplay mudo já toca */ }
      ajustarCamera(s.getVideoTracks()[0]);
      varrer(minha);
    } catch (_) {
      if (minha !== sessao) return;
      $('dica-camera').textContent = 'Não consegui ligar a câmera. Permita o acesso à câmera (Ajustes do iPhone › Apps › Safari › Câmera), fotografe o código ou busque pelo nome.';
    }
  }

  function desligarCamera() {
    sessao++;
    if (fluxo) { fluxo.getTracks().forEach((t) => t.stop()); fluxo = null; }
    const v = $('video');
    if (v) v.srcObject = null;
    $('btn-lanterna').hidden = true; $('btn-lanterna').classList.remove('on');
    $('btn-zoom').hidden = true;
  }

  function ajustarCamera(trilha) {
    if (!trilha) return;
    let cap = {};
    try { cap = trilha.getCapabilities ? trilha.getCapabilities() : {}; } catch (_) { /* sem informações */ }
    const extra = {};
    if (Array.isArray(cap.focusMode) && cap.focusMode.includes('continuous')) extra.focusMode = 'continuous';
    // iPhones novos (ex.: 16 Plus) não focam de perto: com zoom 2x dá para ler segurando a ~20 cm.
    zoomMax = cap.zoom && cap.zoom.max ? Math.min(2, cap.zoom.max) : 1;
    if (zoomMax >= 1.5) { extra.zoom = zoomMax; $('btn-zoom').hidden = false; $('btn-zoom').textContent = '1x'; }
    if (Object.keys(extra).length) trilha.applyConstraints({ advanced: [extra] }).catch(() => {});
    if (cap.torch) $('btn-lanterna').hidden = false;
  }
  let zoomMax = 1;
  $('btn-zoom').addEventListener('click', async () => {
    const t = fluxo && fluxo.getVideoTracks()[0];
    if (!t) return;
    const ir = $('btn-zoom').textContent === '1x' ? 1 : zoomMax;
    try { await t.applyConstraints({ advanced: [{ zoom: ir }] }); $('btn-zoom').textContent = ir === 1 ? `${zoomMax}x` : '1x'; } catch (_) { /* sem zoom */ }
  });
  $('btn-lanterna').addEventListener('click', async () => {
    const t = fluxo && fluxo.getVideoTracks()[0];
    if (!t) return;
    const ligar = !$('btn-lanterna').classList.contains('on');
    try { await t.applyConstraints({ advanced: [{ torch: ligar }] }); $('btn-lanterna').classList.toggle('on', ligar); } catch (_) { /* sem lanterna */ }
  });

  // Recorta a parte do vídeo que aparece na tela (o quadro inteiro, não só a mira).
  // Com "meio", lê só o centro em resolução cheia: ajuda quando o código aparece pequeno (celular afastado).
  function lerQuadro(v, meio) {
    const w = v.videoWidth, h = v.videoHeight;
    const caixa = $('leitor').getBoundingClientRect();
    const aCaixa = caixa.width && caixa.height ? caixa.width / caixa.height : 4 / 3;
    let sw = w, sh = h;
    if (w / h > aCaixa) sw = Math.round(h * aCaixa); else sh = Math.round(w / aCaixa);
    if (meio) { sw = Math.round(sw * 0.55); sh = Math.round(sh * 0.55); }
    const sx = Math.round((w - sw) / 2), sy = Math.round((h - sh) / 2);
    const k = Math.min(1, 1280 / Math.max(sw, sh));
    const cw = Math.round(sw * k), ch = Math.round(sh * k);
    if (quadro.width !== cw || quadro.height !== ch) { quadro.width = cw; quadro.height = ch; }
    ctxQuadro.drawImage(v, sx, sy, sw, sh, 0, 0, cw, ch);
    return ctxQuadro.getImageData(0, 0, cw, ch);
  }

  const proximoQuadro = () => new Promise((ok) => (window.requestAnimationFrame ? requestAnimationFrame(() => ok()) : setTimeout(ok, 30)));

  async function varrer(minha) {
    const v = $('video');
    let meio = false;
    while (minha === sessao && !lido) {
      await proximoQuadro();
      if (minha !== sessao || lido) return;
      if (v.readyState < 2 || !v.videoWidth) continue;
      meio = !meio;
      let achados = [];
      try { achados = await ZXingWASM.readBarcodes(lerQuadro(v, meio), OPC_VIVO); } catch (_) { await new Promise((ok) => setTimeout(ok, 300)); continue; }
      if (minha !== sessao || lido) return;
      const c = codigoDe(achados);
      if (!c) continue;
      lido = true;
      $('leitor').classList.add('achou');
      if (navigator.vibrate) navigator.vibrate(60);
      setTimeout(() => { if (telaAtual === 'tela-scanner') abrirPorCodigo(c); }, 200);
      return;
    }
  }

  function codigoDe(achados) {
    for (const a of achados || []) {
      const c = String(a.text || '').trim();
      if ((a.isValid === undefined || a.isValid) && codigoValido(c)) return c;
    }
    return null;
  }

  function abrirPorCodigo(c) {
    const p = [...db.produtos.values()].find((x) => x.codigo === c);
    abrirProduto(p ? { id: p.id } : { codigo: c });
  }

  function codigoValido(c) {
    if (!/^\d+$/.test(c)) return false;
    if (![8, 12, 13].includes(c.length)) return c.length >= 6 && c.length <= 14;
    const d = c.split('').map(Number); const v = d.pop(); let s = 0;
    d.reverse().forEach((n, i) => { s += n * (i % 2 === 0 ? 3 : 1); });
    return (10 - (s % 10)) % 10 === v;
  }

  // Reserva: ler o código por foto (tenta em tamanhos diferentes).
  function carregarImagem(arquivo) {
    return new Promise((ok, falha) => {
      const img = new Image();
      img.onload = () => ok(img);
      img.onerror = () => falha(new Error('imagem'));
      img.src = URL.createObjectURL(arquivo);
    });
  }
  function pixels(img, max) {
    const k = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
    const c = document.createElement('canvas');
    c.width = Math.round(img.naturalWidth * k); c.height = Math.round(img.naturalHeight * k);
    const g = c.getContext('2d', { willReadFrequently: true });
    g.drawImage(img, 0, 0, c.width, c.height);
    return g.getImageData(0, 0, c.width, c.height);
  }
  $('foto-input').addEventListener('change', async (e) => {
    const arq = e.target.files && e.target.files[0];
    e.target.value = '';
    if (!arq) return;
    $('scanner-erro').hidden = true; $('lendo').hidden = false;
    let img = null;
    try {
      if (!temLeitor()) throw new Error('leitor');
      img = await carregarImagem(arq);
      let c = null;
      for (const max of [1600, 2600, 1000]) {
        c = codigoDe(await ZXingWASM.readBarcodes(pixels(img, max), OPC_FOTO));
        if (c) break;
      }
      if (!c) throw new Error('codigo');
      $('lendo').hidden = true;
      abrirPorCodigo(c);
    } catch (_) {
      $('lendo').hidden = true;
      $('scanner-erro').textContent = 'Não consegui ler o código nessa foto. Tente de novo com o código inteiro aparecendo, ou busque pelo nome.';
      $('scanner-erro').hidden = false;
    } finally {
      if (img) URL.revokeObjectURL(img.src);
    }
  });

  function ultimoPreco(pid) {
    const regs = registrosDe(pid);
    if (!regs.length) return null;
    const c = regs.find((r) => r.comprou);
    return c ? { r: c, rotulo: 'última compra' } : { r: regs[0], rotulo: 'só visto' };
  }

  function buscar() {
    const original = $('busca-input').value.trim();
    const q = semAcento(original);
    const ul = $('resultados'); ul.replaceChildren();
    if (!q) return;
    [...db.produtos.values()]
      .filter((p) => semAcento(`${p.produto} ${p.marca}`).includes(q))
      .sort((a, b) => titulo(a).localeCompare(titulo(b), 'pt-BR'))
      .forEach((p) => {
        const li = el('li', 'linha');
        const u = ultimoPreco(p.id);
        const pr = el('div', 'r-preco c2', u ? dinheiro(u.r.preco) : ''); if (u) pr.append(el('span', 'unid', sufixo(p)));
        li.append(el('div', 'r-nome c1', titulo(p)), pr,
          el('div', 'r-det c1', [embalagem(p), u ? u.rotulo : 'sem preço ainda'].filter(Boolean).join(' · ')), el('div', 'c2'));
        li.addEventListener('click', () => abrirProduto({ id: p.id }));
        ul.append(li);
      });
    const novo = el('li'); novo.append(el('div', 'novo', `+ Cadastrar “${capitalizar(original)}” sem código de barras`));
    novo.addEventListener('click', () => abrirProduto({ nomeInicial: original }));
    ul.append(novo);
  }
  $('busca-input').addEventListener('input', buscar);

  // ---------- produto ----------
  const estado = { produto: null, codigo: null, centavos: 0, vendidoPor: 'pacote', editando: false, gravando: false };

  $('btn-voltar').addEventListener('click', () => irParaInicio());
  $('f-vendido').addEventListener('click', (e) => {
    const b = e.target.closest('button'); if (!b) return;
    estado.vendidoPor = b.dataset.v; atualizarVendido();
  });
  function atualizarVendido() {
    document.querySelectorAll('#f-vendido button').forEach((b) => b.classList.toggle('on', b.dataset.v === estado.vendidoPor));
    $('campo-tamanho').hidden = porMedida(estado.vendidoPor);
    $('rotulo-preco').textContent = `Preço agora (/${abrev(estado.vendidoPor)})`;
  }

  function preencherCabecalho() {
    const p = estado.produto;
    $('p-nome').textContent = p.produto;
    $('p-marca').textContent = [p.marca, embalagem(p)].filter(Boolean).join(' · ');
    $('rotulo-preco').textContent = `Preço agora (/${abrev(p.vendido_por)})`;
  }

  function abrirProduto({ id, codigo, nomeInicial }) {
    const p = id ? db.produtos.get(id) : null;
    Object.assign(estado, { produto: p, codigo: p ? p.codigo : (codigo || null), centavos: 0, editando: false });
    mostrar('tela-produto');
    $('produto-codigo').textContent = estado.codigo || 'sem código de barras';
    $('preco-input').value = ''; $('comparacao').hidden = true; $('registro-erro').hidden = true;
    $('novo-lugar-input').value = '';
    $('bloco-novo').hidden = !!p; $('bloco-conhecido').hidden = !p;
    $('acoes-edicao').hidden = true; $('cartao-registro').hidden = false;
    $('aviso-produto').textContent = 'Produto novo. Preencha uma vez só.';
    if (p) {
      estado.vendidoPor = p.vendido_por;
      preencherCabecalho(); montarReferencias();
    } else {
      $('f-produto').value = capitalizar(nomeInicial || '');
      $('f-marca').value = ''; $('f-tamanho').value = '';
      estado.vendidoPor = estado.codigo ? 'pacote' : 'kg';
      atualizarVendido();
    }
    montarLugares(); montarHistorico();
  }

  // Corrigir o cadastro do produto (qualquer um dos dois pode).
  $('btn-corrigir-produto').addEventListener('click', () => {
    const p = estado.produto; if (!p) return;
    estado.editando = true;
    $('f-produto').value = p.produto; $('f-marca').value = p.marca; $('f-tamanho').value = p.tamanho;
    estado.vendidoPor = p.vendido_por; atualizarVendido();
    $('aviso-produto').textContent = 'Corrigindo o produto. A correção vale para todos os registros dele. Para trocar o lugar ou o preço, toque em "Corrigir" no registro, lá embaixo.';
    $('bloco-novo').hidden = false; $('bloco-conhecido').hidden = true; $('cartao-registro').hidden = true;
    $('acoes-edicao').hidden = false;
  });
  $('btn-cancelar-edicao').addEventListener('click', () => abrirProduto({ id: estado.produto.id }));
  $('btn-salvar-produto').addEventListener('click', async (e) => {
    const p = estado.produto; const nome = capitalizar($('f-produto').value);
    if (!nome) { toast('Escreva o nome do produto.'); return; }
    const mud = { produto: nome, marca: capitalizar($('f-marca').value), vendido_por: estado.vendidoPor, tamanho: porMedida(estado.vendidoPor) ? '' : $('f-tamanho').value.trim() };
    e.target.disabled = true;
    const { data, error } = await sb.from('produtos').update(mud).eq('id', p.id).select('id,codigo,produto,marca,vendido_por,tamanho').single();
    e.target.disabled = false;
    if (error) { toast(mensagemErro(error)); return; }
    db.produtos.set(data.id, nProduto(data));
    toast('Produto corrigido.'); abrirProduto({ id: p.id });
  });

  function referencias() {
    if (!estado.produto) return null;
    const regs = registrosDe(estado.produto.id); if (!regs.length) return null;
    const c = regs.find((r) => r.comprou); const base = c || regs[0];
    let menor = regs[0]; regs.forEach((r) => { if (r.preco < menor.preco) menor = r; });
    return { base, comprou: !!c, menor };
  }
  const detalhe = (r) => [nomeLugar(r.lugar_id), quando(r.quando), nomePessoa(r.usuario_id)].filter(Boolean).join(' · ');

  function montarReferencias() {
    const ref = referencias(); $('bloco-referencia').hidden = !ref; if (!ref) return;
    const s = sufixo(estado.produto);
    $('ref1-titulo').textContent = ref.comprou ? 'Última compra' : 'Último preço visto';
    const precoCom = (id, v) => { $(id).replaceChildren(dinheiro(v), el('span', 'unid', s)); };
    precoCom('ref1-preco', ref.base.preco); $('ref1-detalhe').textContent = detalhe(ref.base);
    precoCom('ref2-preco', ref.menor.preco); $('ref2-detalhe').textContent = detalhe(ref.menor);
  }

  const lugaresOrdenados = () => [...db.lugares.values()].sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));
  function montarLugares() {
    const sel = $('onde-select'); sel.replaceChildren();
    const vazio = el('option', null, 'Escolha onde'); vazio.value = ''; sel.append(vazio);
    lugaresOrdenados().forEach((l) => { const o = el('option', null, l.nome); o.value = String(l.id); sel.append(o); });
    const n = el('option', null, '+ Novo lugar…'); n.value = '__novo'; sel.append(n);
    const ult = lerLocal(CHAVE_LUGAR);
    if (ult && db.lugares.has(Number(ult))) sel.value = ult;
    $('campo-novo-lugar').hidden = sel.value !== '__novo';
  }
  $('onde-select').addEventListener('change', (e) => { $('campo-novo-lugar').hidden = e.target.value !== '__novo'; if (e.target.value === '__novo') $('novo-lugar-input').focus(); });

  function montarHistorico() {
    const ul = $('lista-historico');
    // não apaga um editor aberto quando chega uma mudança do outro
    const aberto = ul.querySelector('.editor');
    if (aberto) return;
    ul.replaceChildren();
    const regs = estado.produto ? registrosDe(estado.produto.id).slice(0, 30) : [];
    $('titulo-historico').hidden = regs.length === 0;
    regs.forEach((r) => {
      const li = el('li', 'linha');
      const pr = el('div', 'item-preco c1', dinheiro(r.preco)); pr.append(el('span', 'unid', sufixo(estado.produto)));
      const acao = el('div', 'c2');
      if (r.usuario_id === db.eu) {
        const b = el('button', 'corrigir', 'Corrigir');
        b.addEventListener('click', () => { if (!li.querySelector('.editor')) li.append(editorRegistro(r)); });
        acao.append(b);
      }
      li.append(pr, etiqueta(r), el('div', 'item-detalhe c1', detalhe(r)), acao);
      ul.append(li);
    });
  }

  function atualizarProdutoNaTela() { montarReferencias(); montarHistorico(); comparar(); }

  // Corrigir ou apagar um registro.
  function editorRegistro(r) {
    const box = el('div', 'editor');
    let centavos = Math.round(r.preco * 100), comprou = r.comprou;
    const preco = el('input', 'preco'); preco.inputMode = 'numeric'; preco.value = dinheiro(r.preco);
    preco.addEventListener('input', () => { const d = preco.value.replace(/\D/g, '').replace(/^0+/, '').slice(0, 8); centavos = Number(d || 0); preco.value = centavos ? dinheiro(centavos / 100) : ''; });
    const sel = el('select');
    lugaresOrdenados().forEach((l) => { const o = el('option', null, l.nome); o.value = String(l.id); sel.append(o); });
    const optNovo = el('option', null, '+ Novo lugar…'); optNovo.value = '__novo'; sel.append(optNovo);
    sel.value = String(r.lugar_id);
    const novoLugar = el('input'); novoLugar.type = 'text'; novoLugar.maxLength = 40; novoLugar.placeholder = 'Ex.: Balani, feira de sábado';
    novoLugar.addEventListener('blur', () => { novoLugar.value = capitalizar(novoLugar.value); });
    const campoNovo = el('label', 'campo', 'Nome do lugar'); campoNovo.append(novoLugar); campoNovo.hidden = true;
    sel.addEventListener('change', () => { campoNovo.hidden = sel.value !== '__novo'; if (!campoNovo.hidden) novoLugar.focus(); });
    const par = el('div', 'par'); const bc = el('button', null, 'Comprei'); const bv = el('button', null, 'Só vi');
    const marcar = () => { bc.classList.toggle('on', comprou); bv.classList.toggle('on', !comprou); };
    bc.addEventListener('click', () => { comprou = true; marcar(); }); bv.addEventListener('click', () => { comprou = false; marcar(); }); marcar();
    par.append(bc, bv);
    const fechar = () => { box.remove(); atualizarProdutoNaTela(); };
    const acoes = el('div', 'acoes'); const salvar = el('button', 'btn primario', 'Salvar'); const cancelar = el('button', 'btn', 'Cancelar');
    salvar.addEventListener('click', async () => {
      if (!centavos) { toast('Digite o preço.'); return; }
      const nome = capitalizar(novoLugar.value);
      if (sel.value === '__novo' && !nome) { toast('Escreva o nome do lugar.'); return; }
      salvar.disabled = true;
      let lugarId;
      try { lugarId = await obterLugar(sel.value, nome); } catch (err) { salvar.disabled = false; toast(mensagemErro(err)); return; }
      const { data, error } = await sb.from('registros').update({ preco: centavos / 100, lugar_id: lugarId, comprou })
        .eq('id', r.id).select('id,produto_id,lugar_id,preco,comprou,quando,usuario_id').single();
      salvar.disabled = false;
      if (error) { toast(mensagemErro(error)); return; }
      db.registros.set(data.id, nRegistro(data));
      toast('Registro corrigido.'); fechar();
    });
    cancelar.addEventListener('click', fechar);
    acoes.append(salvar, cancelar);
    const apagar = el('button', 'apagar', 'Apagar este registro'); let conf = false;
    apagar.addEventListener('click', async () => {
      if (!conf) { conf = true; apagar.textContent = 'Toque de novo para apagar'; setTimeout(() => { conf = false; apagar.textContent = 'Apagar este registro'; }, 3000); return; }
      apagar.disabled = true;
      const { error } = await sb.from('registros').delete().eq('id', r.id);
      apagar.disabled = false;
      if (error) { toast(mensagemErro(error)); return; }
      db.registros.delete(r.id);
      toast('Registro apagado.'); fechar();
    });
    const rot = (t, c) => { const l = el('label', 'campo', t); l.append(c); return l; };
    box.append(rot('Preço', preco), rot('Onde', sel), campoNovo, par, acoes, apagar);
    return box;
  }

  // Digita só números e o preço preenche da direita: 2 5 9 0 vira R$ 25,90.
  $('preco-input').addEventListener('input', (e) => {
    const dig = e.target.value.replace(/\D/g, '').replace(/^0+/, '').slice(0, 8);
    estado.centavos = Number(dig || 0);
    e.target.value = estado.centavos ? dinheiro(estado.centavos / 100) : '';
    comparar();
  });

  function comparar() {
    const p = $('comparacao'); const ref = referencias();
    if (!ref || !estado.centavos) { p.hidden = true; return; }
    const agora = estado.centavos / 100, antes = ref.base.preco;
    const diff = Math.round((agora - antes) * 100) / 100;
    const pct = (Math.round(Math.abs(diff) / antes * 1000) / 10).toLocaleString('pt-BR');
    const contra = ref.comprou ? 'que a última compra' : 'que o último preço visto';
    p.classList.remove('mais-barato', 'mais-caro');
    if (diff < 0) { p.textContent = `${dinheiro(-diff)} mais barato ${contra} (−${pct}%)`; p.classList.add('mais-barato'); }
    else if (diff > 0) { p.textContent = `${dinheiro(diff)} mais caro ${contra} (+${pct}%)`; p.classList.add('mais-caro'); }
    else p.textContent = `Mesmo preço ${contra}`;
    p.hidden = false;
  }

  $('btn-comprei').addEventListener('click', () => registrar(true));
  $('btn-so-vi').addEventListener('click', () => registrar(false));
  function erro(msg) { $('registro-erro').textContent = msg; $('registro-erro').hidden = false; }

  async function obterProduto() {
    if (estado.produto) return estado.produto;
    const novo = {
      codigo: estado.codigo, produto: capitalizar($('f-produto').value), marca: capitalizar($('f-marca').value),
      vendido_por: estado.vendidoPor, tamanho: porMedida(estado.vendidoPor) ? '' : $('f-tamanho').value.trim(),
    };
    const { data, error } = await sb.from('produtos').insert(novo).select('id,codigo,produto,marca,vendido_por,tamanho').single();
    if (error && error.code === '23505' && estado.codigo) {
      // O outro cadastrou o mesmo código quase junto: vale o primeiro cadastro.
      const r = await sb.from('produtos').select('id,codigo,produto,marca,vendido_por,tamanho').eq('codigo', estado.codigo).single();
      if (r.error) throw r.error;
      toast(`Já estava cadastrado como “${titulo(r.data)}”. Usei esse cadastro.`);
      return nProduto(r.data);
    }
    if (error) throw error;
    return nProduto(data);
  }

  async function obterLugar(sel, novoLugar) {
    if (sel !== '__novo') return Number(sel);
    const existe = [...db.lugares.values()].find((l) => semAcento(l.nome) === semAcento(novoLugar));
    if (existe) return existe.id;
    const { data, error } = await sb.from('lugares').insert({ nome: novoLugar }).select('id,nome').single();
    if (error && error.code === '23505') {
      const lugares = await todos('lugares', 'id,nome');
      db.lugares = new Map(lugares.map((l) => [l.id, l]));
      const achou = lugares.find((l) => l.nome.toLowerCase() === novoLugar.toLowerCase());
      if (achou) return achou.id;
    }
    if (error) throw error;
    db.lugares.set(data.id, data);
    return data.id;
  }

  async function registrar(comprou) {
    if (estado.gravando) return;
    $('registro-erro').hidden = true;
    if (!estado.produto && !$('f-produto').value.trim()) return erro('Escreva o nome do produto.');
    if (!estado.centavos) return erro('Digite o preço.');
    const sel = $('onde-select').value;
    const novoLugar = capitalizar($('novo-lugar-input').value);
    if (!sel || (sel === '__novo' && !novoLugar)) return erro('Escolha onde, ou cadastre o lugar.');

    estado.gravando = true;
    $('btn-comprei').disabled = true; $('btn-so-vi').disabled = true;
    try {
      const p = await obterProduto();
      db.produtos.set(p.id, p); estado.produto = p;
      const lugarId = await obterLugar(sel, novoLugar);
      const { data, error } = await sb.from('registros')
        .insert({ produto_id: p.id, lugar_id: lugarId, preco: estado.centavos / 100, comprou })
        .select('id,produto_id,lugar_id,preco,comprou,quando,usuario_id').single();
      if (error) throw error;
      db.registros.set(data.id, nRegistro(data));
      gravarLocal(CHAVE_LUGAR, String(lugarId));
      toast(`${comprou ? 'Comprei' : 'Só vi'}: ${dinheiro(estado.centavos / 100)}${sufixo(p)} registrado`);
      irParaInicio();
    } catch (err) {
      erro(mensagemErro(err));
    } finally {
      estado.gravando = false;
      $('btn-comprei').disabled = false; $('btn-so-vi').disabled = false;
    }
  }

  ['f-produto', 'f-marca', 'novo-lugar-input', 'nome-input'].forEach((id) => $(id).addEventListener('blur', (e) => { e.target.value = capitalizar(e.target.value); }));

  // ---------- começo ----------
  (async () => {
    try {
      const { data: { session } } = await sb.auth.getSession();
      if (RECUPERANDO && session) { mostrar('tela-nova-senha'); $('nova-senha').focus(); return; }
      if (LINK_VENCIDO && !session) {
        limparEndereco(); ajustarLogin(); mostrar('tela-login');
        $('login-erro').textContent = 'O link do e-mail venceu ou já foi usado. Escreva seu e-mail e peça outro em "Esqueci a senha".';
        $('login-erro').hidden = false;
        return;
      }
      await iniciarSessao(session);
    } catch (err) {
      $('tela-carregando').hidden = false;
      $('tela-carregando').textContent = 'Não consegui abrir o app. Verifique a internet e abra de novo.';
    }
  })();
})();
