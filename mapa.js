/* =====================================================================
 * mapa.js — MAPAS DO RELATÓRIO (Leaflet)
 * ---------------------------------------------------------------------
 *  • Formulário: mapa com a posição do GPS EM TEMPO REAL (o pino segue
 *    o aparelho). Tocar no mapa ou arrastar o pino fixa o local exato e
 *    para o acompanhamento — o botão "Retomar GPS" volta ao vivo.
 *  • Detalhe: mapa do local + "Abrir no Google Maps".
 *  • PDF: miniatura do mapa montada a partir das imagens do mapa.
 *
 * Duas camadas: "Mapa" (OpenStreetMap) e "Satélite" (Esri).
 * SEM INTERNET (v1.5.0): o GPS funciona normalmente; as imagens do mapa
 * da região já vista ficam guardadas no aparelho (pré-carregadas em
 * volta de cada posição do GPS enquanto há sinal). Onde não houver
 * imagem guardada, o PDF recebe um mapa esquemático com o ponto e as
 * coordenadas — a localização nunca fica de fora.
 * ===================================================================== */

const MAPA = (function () {

  const CENTRO_PADRAO = [-7.5, -44.5];   // região dos lotes (PI / MA / GO / TO)
  const ZOOM_PADRAO = 5;
  const COR_OK = '#1F9E8F', COR_NC = '#D64545';

  const CAMADAS = {
    mapa: {
      url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
      opcoes: { maxZoom: 19, crossOrigin: true,
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>' }
    },
    satelite: {
      url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
      opcoes: { maxZoom: 19, crossOrigin: true, attribution: 'Imagens &copy; Esri, Maxar, Earthstar Geographics' }
    }
  };

  const disponivel = () => typeof window.L !== 'undefined';
  const temCoord = (r) => r && r.latitude !== null && r.latitude !== undefined && r.longitude !== null && r.longitude !== undefined;
  const fmt = (v) => Number(v).toFixed(6);

  function linkGoogle(lat, lng) {
    return 'https://www.google.com/maps/search/?api=1&query=' + fmt(lat) + ',' + fmt(lng);
  }

  function novoMapa(el, opcoes) {
    const m = L.map(el, Object.assign({ zoomControl: true, attributionControl: true, scrollWheelZoom: false }, opcoes || {}));
    m.attributionControl.setPrefix('');
    const ruas = L.tileLayer(CAMADAS.mapa.url, CAMADAS.mapa.opcoes);
    const sat = L.tileLayer(CAMADAS.satelite.url, CAMADAS.satelite.opcoes);
    ruas.addTo(m);
    L.control.layers({ 'Mapa': ruas, 'Satélite': sat }, null, { position: 'topright' }).addTo(m);
    let avisou = false;
    [ruas, sat].forEach(c => c.on('tileerror', () => {
      if (avisou) return; avisou = true;
      const box = el.parentNode && el.parentNode.querySelector('.mapa-offline');
      if (box) box.hidden = false;
    }));
    m.whenReady(() => setTimeout(() => m.invalidateSize(), 60));
    return m;
  }

  function pino(cor, aoVivo) {
    return L.divIcon({
      className: 'pino-mapa' + (aoVivo ? ' ao-vivo' : ''),
      html: '<span style="--cor:' + (cor || COR_OK) + '"></span>',
      iconSize: [26, 34], iconAnchor: [13, 32], popupAnchor: [0, -28]
    });
  }

  /* ===================================================================
   * 1) FORMULÁRIO — posição ao vivo e ajuste manual
   * =================================================================== */
  const form = { mapa: null, marcador: null, circulo: null, aoMudar: null, centrado: false };

  /**
   * Mostra / atualiza o mapa do formulário.
   * @param {object} reg       registro em edição (latitude, longitude, precisaoGps, ajusteManual)
   * @param {function} aoMudar callback(lat, lng) quando o usuário fixa o ponto manualmente
   */
  function formulario(reg, aoMudar) {
    const el = document.getElementById('mapa-form');
    if (!el) return;
    form.aoMudar = aoMudar;
    if (!disponivel()) { el.parentNode.hidden = true; return; }
    el.parentNode.hidden = false;
    if (!form.mapa) {
      form.mapa = novoMapa(el, { tap: true });
      form.mapa.on('click', (e) => posicionarManual(e.latlng.lat, e.latlng.lng));
    }
    const box = el.parentNode.querySelector('.mapa-offline');
    if (box) box.hidden = navigator.onLine;
    setTimeout(() => form.mapa.invalidateSize(), 80);
    form.centrado = false;
    if (temCoord(reg)) {
      colocarPino(reg.latitude, reg.longitude, reg.precisaoGps, !reg.ajusteManual);
      form.mapa.setView([reg.latitude, reg.longitude], 17);
      form.centrado = true;
    } else {
      limparPino();
      form.mapa.setView(CENTRO_PADRAO, ZOOM_PADRAO);
    }
  }

  /** Nova leitura do GPS ao vivo: move o pino e acompanha. */
  function seguir(lat, lng, precisao) {
    if (!form.mapa) return;
    colocarPino(lat, lng, precisao, true);
    if (!form.centrado) { form.mapa.setView([lat, lng], 17); form.centrado = true; }
    else form.mapa.panTo([lat, lng], { animate: true });
  }

  function colocarPino(lat, lng, precisao, aoVivo) {
    if (!form.marcador) {
      form.marcador = L.marker([lat, lng], { draggable: true, icon: pino(COR_OK, aoVivo), autoPan: true }).addTo(form.mapa);
      form.marcador.on('dragend', () => {
        const p = form.marcador.getLatLng();
        posicionarManual(p.lat, p.lng);
      });
    } else {
      form.marcador.setLatLng([lat, lng]);
      form.marcador.setIcon(pino(COR_OK, aoVivo));
    }
    if (form.circulo) { form.mapa.removeLayer(form.circulo); form.circulo = null; }
    if (precisao) {
      form.circulo = L.circle([lat, lng], { radius: precisao, color: COR_OK, weight: 1, fillOpacity: 0.08 }).addTo(form.mapa);
    }
  }
  function limparPino() {
    if (form.marcador) { form.mapa.removeLayer(form.marcador); form.marcador = null; }
    if (form.circulo) { form.mapa.removeLayer(form.circulo); form.circulo = null; }
  }

  function posicionarManual(lat, lng) {
    lat = Number(fmt(lat)); lng = Number(fmt(lng));
    colocarPino(lat, lng, null, false);
    if (form.aoMudar) form.aoMudar(lat, lng, true);
  }

  /* ===================================================================
   * 2) DETALHE — mapa do local, somente leitura
   * =================================================================== */
  let mapaDetalhe = null;
  function detalhe(el, reg, nc) {
    if (!el) return;
    if (mapaDetalhe) { mapaDetalhe.remove(); mapaDetalhe = null; }
    if (!disponivel() || !temCoord(reg)) { if (el.parentNode) el.parentNode.hidden = true; return; }
    el.parentNode.hidden = false;
    const box = el.parentNode.querySelector('.mapa-offline');
    if (box) box.hidden = navigator.onLine;
    mapaDetalhe = novoMapa(el, { dragging: true });
    L.marker([reg.latitude, reg.longitude], { icon: pino(nc ? COR_NC : COR_OK) }).addTo(mapaDetalhe);
    if (reg.precisaoGps) L.circle([reg.latitude, reg.longitude], { radius: reg.precisaoGps, color: nc ? COR_NC : COR_OK, weight: 1, fillOpacity: 0.08 }).addTo(mapaDetalhe);
    mapaDetalhe.setView([reg.latitude, reg.longitude], 16);
    setTimeout(() => mapaDetalhe && mapaDetalhe.invalidateSize(), 120);
  }

  function redimensionar() { [form.mapa, mapaDetalhe].forEach(m => { if (m) m.invalidateSize(); }); }

  /* ===================================================================
   * 3) IMAGEM ESTÁTICA PARA O PDF (tiles desenhados em canvas)
   * =================================================================== */
  function lon2x(lon, z) { return (lon + 180) / 360 * Math.pow(2, z) * 256; }
  function lat2y(lat, z) {
    const r = lat * Math.PI / 180;
    return (1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2 * Math.pow(2, z) * 256;
  }
  function carregarImg(url) {
    return new Promise((ok, falha) => {
      const img = new Image(); img.crossOrigin = 'anonymous';
      const t = setTimeout(() => falha(new Error('tempo')), 8000);
      img.onload = () => { clearTimeout(t); ok(img); };
      img.onerror = () => { clearTimeout(t); falha(new Error('imagem')); };
      img.src = url;
    });
  }
  async function imagemEstatica(lat, lng, opcoes) {
    opcoes = opcoes || {};
    const z = opcoes.zoom || 16, W = opcoes.largura || 640, H = opcoes.altura || 360;
    const camada = opcoes.satelite ? CAMADAS.satelite : CAMADAS.mapa;
    const cx = lon2x(lng, z), cy = lat2y(lat, z);
    const x0 = cx - W / 2, y0 = cy - H / 2;
    const tx0 = Math.floor(x0 / 256), ty0 = Math.floor(y0 / 256), tx1 = Math.floor((x0 + W) / 256), ty1 = Math.floor((y0 + H) / 256);
    const canvas = document.createElement('canvas'); canvas.width = W; canvas.height = H;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#E8EEF2'; ctx.fillRect(0, 0, W, H);
    const tarefas = [];
    for (let tx = tx0; tx <= tx1; tx++) {
      for (let ty = ty0; ty <= ty1; ty++) {
        const url = camada.url.replace('{z}', z).replace('{x}', tx).replace('{y}', ty);
        tarefas.push(carregarImg(url).then(img => ctx.drawImage(img, tx * 256 - x0, ty * 256 - y0)).catch(() => null));
      }
    }
    const res = await Promise.all(tarefas);
    if (res.every(r => r === null)) return opcoes.semInternet === false ? null : mapaEsquematico(lat, lng, W, H, opcoes);
    desenharPino(ctx, W / 2, H / 2, opcoes.nc);
    ctx.font = '11px Arial'; const atrib = opcoes.satelite ? '© Esri' : '© OpenStreetMap';
    const lw = ctx.measureText(atrib).width + 10;
    ctx.fillStyle = 'rgba(255,255,255,.85)'; ctx.fillRect(W - lw, H - 16, lw, 16);
    ctx.fillStyle = '#333'; ctx.fillText(atrib, W - lw + 5, H - 4.5);
    try { return canvas.toDataURL('image/jpeg', 0.85); } catch (e) { return null; }
  }

  /** Mapa sem imagens (sem internet e região nunca vista): grade + ponto + coordenadas. */
  function mapaEsquematico(lat, lng, W, H, opcoes) {
    const canvas = document.createElement('canvas'); canvas.width = W; canvas.height = H;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#EEF3F1'; ctx.fillRect(0, 0, W, H);
    ctx.strokeStyle = '#D3DFDB'; ctx.lineWidth = 1;
    for (let x = (W / 2) % 40; x < W; x += 40) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke(); }
    for (let y = (H / 2) % 40; y < H; y += 40) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke(); }
    ctx.strokeStyle = '#9FB5AE'; ctx.setLineDash([6, 5]);
    ctx.beginPath(); ctx.moveTo(W / 2, 0); ctx.lineTo(W / 2, H); ctx.moveTo(0, H / 2); ctx.lineTo(W, H / 2); ctx.stroke();
    ctx.setLineDash([]);
    ctx.strokeStyle = opcoes.nc ? COR_NC : COR_OK; ctx.globalAlpha = 0.35; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(W / 2, H / 2, 34, 0, Math.PI * 2); ctx.stroke(); ctx.globalAlpha = 1;
    desenharPino(ctx, W / 2, H / 2, opcoes.nc);
    ctx.font = 'bold 15px Arial'; ctx.fillStyle = '#1A1F2E'; ctx.textAlign = 'center';
    ctx.fillText(fmt(lat) + ', ' + fmt(lng), W / 2, H - 34);
    ctx.font = '12px Arial'; ctx.fillStyle = '#5A6B78';
    ctx.fillText('Local registrado pelo GPS (mapa sem internet)', W / 2, H - 16);
    ctx.font = 'bold 12px Arial'; ctx.fillText('N', 16, 22);
    ctx.beginPath(); ctx.moveTo(16, 26); ctx.lineTo(11, 38); ctx.lineTo(21, 38); ctx.closePath(); ctx.fill();
    try { return canvas.toDataURL('image/jpeg', 0.88); } catch (e) { return null; }
  }

  function desenharPino(ctx, px, py, nc) {
    ctx.fillStyle = 'rgba(0,0,0,.25)'; ctx.beginPath(); ctx.ellipse(px, py + 2, 7, 3, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = nc ? COR_NC : COR_OK; ctx.strokeStyle = '#fff'; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(px, py);
    ctx.bezierCurveTo(px - 4, py - 10, px - 13, py - 16, px - 13, py - 26);
    ctx.arc(px, py - 26, 13, Math.PI, 0); ctx.bezierCurveTo(px + 13, py - 16, px + 4, py - 10, px, py);
    ctx.closePath(); ctx.fill(); ctx.stroke();
    ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(px, py - 26, 5, 0, Math.PI * 2); ctx.fill();
  }

  /**
   * Com internet, guarda no aparelho as imagens do mapa em volta da posição
   * (zooms 15, 16 e 17) — assim o mapa e o PDF funcionam depois sem sinal.
   */
  const preCarregados = new Set();
  let preCarregando = false;
  async function preCarregar(lat, lng) {
    if (!navigator.onLine || preCarregando || lat === null || lat === undefined) return;
    const chave = Number(lat).toFixed(3) + ',' + Number(lng).toFixed(3);   // ~100 m
    if (preCarregados.has(chave)) return;
    preCarregados.add(chave);
    preCarregando = true;
    try {
      const urls = [];
      [[15, 1], [16, 2], [17, 2]].forEach(([z, r]) => {
        const tx = Math.floor(lon2x(lng, z) / 256), ty = Math.floor(lat2y(lat, z) / 256);
        for (let x = tx - r; x <= tx + r; x++) for (let y = ty - r; y <= ty + r; y++) {
          urls.push(CAMADAS.mapa.url.replace('{z}', z).replace('{x}', x).replace('{y}', y));
        }
      });
      for (let i = 0; i < urls.length; i += 6) {
        if (!navigator.onLine) break;
        await Promise.all(urls.slice(i, i + 6).map(u => fetch(u, { mode: 'cors', credentials: 'omit' }).catch(() => null)));
      }
    } finally { preCarregando = false; }
  }

  return {
    preCarregar: preCarregar,
    disponivel: disponivel,
    formulario: formulario,
    seguir: seguir,
    detalhe: detalhe,
    redimensionar: redimensionar,
    imagemEstatica: imagemEstatica,
    linkGoogle: linkGoogle,
    temCoord: temCoord
  };
})();

window.MAPA = MAPA;
