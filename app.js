'use strict';
(() => {
  // ------------------------------------------------------------------ datos fijos
  const D = window.HELADERIAS || [];
  const META = window.DATOS_META || {};
  const POR_ID = new Map(D.map(p => [p.id, p]));
  const CLAVE = 'xavi_helados_v2';      // estados, notas, historial
  const CLAVE_UI = 'xavi_helados_ui';   // filtros y vista
  const ESTADOS = [
    ['pendiente', '⏳', 'Pendiente'], ['contactado', '📞', 'Contactado'],
    ['vendido', '💰', 'Vendido'], ['no_interesado', '❌', 'No interesado'],
    ['in_situ_propio', '🟢', 'In situ: fabrica él'], ['in_situ_compra', '🔴', 'In situ: compra producto'],
  ];
  const EST = Object.fromEntries(ESTADOS.map(([k, i, t]) => [k, { i, t }]));
  const HECHO = new Set(['vendido', 'no_interesado', 'in_situ_propio']);
  const CLASE_TXT = { externo: '🔴 Compra fuera', sindatos: '🟡 Sin datos', propio: '🟢 Fabrica él', competidor: '🟣 Competidor' };
  const CLAS_LARGO = { externo: '🔴 PROBABLE PRODUCTO EXTERNO', sindatos: '🟡 SIN DATOS', propio: '🟢 FABRICA ÉL', competidor: '🟣 COMPETIDOR (fabrica y vende)' };
  const PRIO_TXT = { muy_alta: '🔥 Muy alta', alta: '🟠 Alta', media: '🟡 Media', baja: '⚪ Baja', no: '❌ No objetivo' };
  const PRIO_ORD = { muy_alta: 0, alta: 1, media: 2, baja: 3, no: 4 };
  const TAM = { muy_alta: 30, alta: 26, media: 22, baja: 18, no: 14 };
  const ZONAS = [...new Set([...D].sort((a, b) => a.orden_zona - b.orden_zona).map(p => p.zona))];
  const ES_IOS = /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const TACTIL = matchMedia('(pointer: coarse)').matches;
  const $ = s => document.querySelector(s);
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const urlSegura = u => (/^https?:\/\//i.test(u || '') ? u : '');
  const norm = s => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  const hoyISO = () => new Date().toISOString().slice(0, 10);
  const fechaCorta = iso => iso ? new Date(iso).toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit', year: 'numeric' }) : '';
  const fechaHora = iso => new Date(iso).toLocaleString('es-ES', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' });

  // ------------------------------------------------------------------ almacenamiento local
  let almacen = cargar();
  function cargar() {
    let s = null;
    try { s = JSON.parse(localStorage.getItem(CLAVE)); } catch (e) { /* vacío o corrupto */ }
    if (!s || typeof s !== 'object' || typeof s.locales !== 'object') s = { v: 2, locales: {}, ultimaCopia: null, cambiosDesdeCopia: 0 };
    if (!s.migrado) {   // estados del mapa anterior (claves helado_estado_<id>); no se borran
      const equiv = { vendido: 'vendido', no_interesado: 'no_interesado', hace_propio: 'in_situ_propio' };
      try {
        for (let i = 0; i < localStorage.length; i++) {
          const m = /^helado_estado_(\d+)$/.exec(localStorage.key(i) || '');
          const e = m && equiv[localStorage.getItem(m[0])];
          if (e && !s.locales[m[1]]) s.locales[m[1]] = { estado: e, nota: '', hist: [{ f: new Date().toISOString(), e, origen: 'mapa anterior' }], t: Date.now() };
        }
      } catch (e) { /* sin acceso */ }
      s.migrado = true;
      try { localStorage.setItem(CLAVE, JSON.stringify(s)); } catch (e) { /* se avisará al guardar */ }
    }
    return s;
  }
  let errorGuardar = false;
  function guardar() {
    try { localStorage.setItem(CLAVE, JSON.stringify(almacen)); errorGuardar = false; }
    catch (e) { errorGuardar = true; }
    pintarAvisos();
  }
  const reg = id => almacen.locales[id] || { estado: 'pendiente', nota: '', hist: [], t: 0 };
  function setReg(id, cambios) {
    almacen.locales[id] = Object.assign({}, reg(id), cambios, { t: Date.now() });
    almacen.cambiosDesdeCopia = (almacen.cambiosDesdeCopia || 0) + 1;
    guardar();
  }
  let persistPedido = false;
  function pedirPersistencia() {
    if (persistPedido) return;
    persistPedido = true;
    if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
  }

  let ui = {};
  try { ui = JSON.parse(localStorage.getItem(CLAVE_UI)) || {}; } catch (e) { ui = {}; }
  const guardarUi = () => { try { localStorage.setItem(CLAVE_UI, JSON.stringify(ui)); } catch (e) { /* no crítico */ } };

  // ------------------------------------------------------------------ lógica comercial
  function efectivo(p) {
    const r = reg(p.id);
    let clase = p.competidor ? 'competidor' : p.clas, prio = p.prioridad;
    if (r.estado === 'in_situ_propio') { clase = 'propio'; prio = 'no'; }
    else if (r.estado === 'in_situ_compra' && !p.competidor) { clase = 'externo'; prio = p.franquicia ? 'media' : 'muy_alta'; }
    return { clase, prio, estado: r.estado, hecho: HECHO.has(r.estado) };
  }

  // ------------------------------------------------------------------ filtros
  const SETS = ['provincia', 'zona', 'clase', 'conf', 'prio', 'precio', 'estado'];
  const F = { texto: '', municipio: ui.municipio || '', rapidos: new Set(ui.rapidos || []) };
  SETS.forEach(k => { F[k] = new Set((ui.filtros || {})[k] || []); });
  const RAPIDOS = [
    ['calientes', '🔥 Calientes', 'Prioridad muy alta/alta sin visitar'],
    ['girona', 'Girona', 'Provincia de Girona'],
    ['barcelona', 'Barcelona', 'Provincia de Barcelona'],
    ['objetivos', '🎯 Solo objetivos', 'Oculta los que fabrican o compiten'],
    ['pendientes', '⏳ Sin visitar', 'Pendientes o contactados'],
  ];
  function pasaFiltro(p) {
    const e = efectivo(p);
    const R = F.rapidos;
    if (R.has('calientes') && !((e.prio === 'muy_alta' || e.prio === 'alta') && !e.hecho)) return false;
    if (R.has('girona') && !R.has('barcelona') && p.provincia !== 'Girona') return false;
    if (R.has('barcelona') && !R.has('girona') && p.provincia !== 'Barcelona') return false;
    if (R.has('objetivos') && e.prio === 'no') return false;
    if (R.has('pendientes') && !(e.estado === 'pendiente' || e.estado === 'contactado')) return false;
    if (F.provincia.size && !F.provincia.has(p.provincia)) return false;
    if (F.zona.size && !F.zona.has(p.zona)) return false;
    if (F.municipio && p.municipio !== F.municipio) return false;
    if (F.clase.size && !F.clase.has(e.clase)) return false;
    if (F.conf.size && !F.conf.has(p.conf)) return false;
    if (F.prio.size && !F.prio.has(e.prio)) return false;
    if (F.precio.size) {
      const trozos = p.precio === '?' ? ['?'] : p.precio.split('-');
      if (!trozos.some(t => F.precio.has(t))) return false;
    }
    if (F.estado.size && !F.estado.has(e.estado)) return false;
    if (F.texto) {
      const h = norm([p.nombre, p.municipio, p.zona, p.direccion, p.tipo].join(' '));
      if (!F.texto.split(/\s+/).every(w => h.includes(w))) return false;
    }
    return true;
  }
  function guardarFiltros() {
    ui.filtros = Object.fromEntries(SETS.map(k => [k, [...F[k]]]));
    ui.rapidos = [...F.rapidos];
    ui.municipio = F.municipio;
    guardarUi();
  }
  const numFiltros = () => SETS.reduce((n, k) => n + F[k].size, 0) + (F.municipio ? 1 : 0);

  // ------------------------------------------------------------------ mapa
  const mapa = L.map('mapa', { zoomControl: false, preferCanvas: false }).setView([41.85, 2.85], 9);
  L.control.zoom({ position: 'bottomright' }).addTo(mapa);
  const capaEsri = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}',
    { maxZoom: 19, attribution: 'Tiles © Esri' });
  const capaOsm = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png',
    { maxZoom: 19, attribution: '© OpenStreetMap' });
  capaEsri.addTo(mapa);
  L.control.layers({ 'Calles (Esri)': capaEsri, 'OpenStreetMap': capaOsm }, null, { position: 'topright' }).addTo(mapa);
  let fallosTeselas = 0;
  capaEsri.on('tileerror', () => {
    if (++fallosTeselas === 8 && navigator.onLine && mapa.hasLayer(capaEsri)) {
      mapa.removeLayer(capaEsri); capaOsm.addTo(mapa); toast('El mapa de Esri no responde: cambio a OpenStreetMap');
    }
  });
  const Localizar = L.Control.extend({
    options: { position: 'bottomright' },
    onAdd() {
      const b = L.DomUtil.create('button', 'ctl-loc leaflet-bar');
      b.type = 'button'; b.title = 'Mi ubicación'; b.setAttribute('aria-label', 'Centrar en mi ubicación'); b.textContent = '📍';
      L.DomEvent.disableClickPropagation(b);
      b.addEventListener('click', () => localizar(true));
      return b;
    },
  });
  new Localizar().addTo(mapa);
  mapa.on('zoomend', () => marcadores.forEach((m, id) => m.setIcon(icono(POR_ID.get(id)))));

  // Varios locales en el mismo punto (misma calle sin portal): se separan unos metros para poder tocarlos
  const grupos = {};
  D.forEach(p => { p._lat = p.lat; p._lon = p.lon; if (p.lat != null) (grupos[p.lat.toFixed(5) + ',' + p.lon.toFixed(5)] ||= []).push(p); });
  Object.values(grupos).forEach(g => {
    if (g.length > 1) g.forEach((p, i) => { const a = 2 * Math.PI * i / g.length; p._lat = p.lat + 0.00013 * Math.cos(a); p._lon = p.lon + 0.00018 * Math.sin(a); });
  });

  let numerosRuta = new Map();
  // Tamaño según el zoom: pequeños de lejos, grandes de cerca
  const escala = () => Math.min(1.25, Math.max(0.4, 0.4 + (mapa.getZoom() - 9) * 0.14));
  function icono(p) {
    const e = efectivo(p), k = escala();
    const num = numerosRuta.get(p.id);
    if (num) {
      const r = Math.max(20, Math.round(26 * k));
      return L.divIcon({ className: '', html: `<div class="mk ruta" style="width:${r}px;height:${r}px">${num}</div>`, iconSize: [r, r], iconAnchor: [r / 2, r / 2] });
    }
    const t = Math.max(7, Math.round(TAM[e.prio] * k));
    const txt = e.estado !== 'pendiente' && t >= 18 ? EST[e.estado].i : '';
    return L.divIcon({
      className: '', iconSize: [t, t], iconAnchor: [t / 2, t / 2],
      html: `<div class="mk ${e.clase}${e.prio === 'no' ? ' no' : ''}${t < 14 ? ' mini' : ''}" style="width:${t}px;height:${t}px;font-size:${t > 22 ? 13 : 10}px">${txt}</div>`,
    });
  }
  const marcadores = new Map();
  D.forEach(p => {
    if (p.lat == null) return;
    const m = L.marker([p._lat, p._lon], { icon: icono(p), keyboard: true, title: p.nombre, riseOnHover: true });
    m.on('click', () => abrirFicha(p.id));
    marcadores.set(p.id, m);
  });
  const zIndice = p => (4 - PRIO_ORD[efectivo(p).prio]) * 100 + (numerosRuta.has(p.id) ? 1000 : 0);
  function actualizarMarcador(p) {
    const m = marcadores.get(p.id);
    if (m) { m.setIcon(icono(p)); m.setZIndexOffset(zIndice(p)); }
  }
  let capaRuta = L.layerGroup().addTo(mapa);
  let marcaYo = null, posicion = null;

  function localizar(centrar, despues) {
    if (!navigator.geolocation) { toast('Este navegador no da la ubicación'); return; }
    toast('Buscando tu ubicación…');
    navigator.geolocation.getCurrentPosition(pos => {
      posicion = [pos.coords.latitude, pos.coords.longitude];
      if (!marcaYo) marcaYo = L.marker(posicion, { icon: L.divIcon({ className: '', html: '<div class="yo"></div>', iconSize: [16, 16], iconAnchor: [8, 8] }), interactive: false, zIndexOffset: 2000 }).addTo(mapa);
      else marcaYo.setLatLng(posicion);
      if (centrar) mapa.setView(posicion, Math.max(mapa.getZoom(), 14));
      toast('Ubicación encontrada');
      if (despues) despues();
    }, err => {
      toast(err.code === 1 ? 'Sin permiso de ubicación. En iPhone: Ajustes › Privacidad › Localización › Safari.' : 'No se pudo obtener la ubicación');
    }, { enableHighAccuracy: true, timeout: 12000, maximumAge: 60000 });
  }
  const distKm = (a, b) => {
    const r = Math.PI / 180, dLa = (b[0] - a[0]) * r, dLo = (b[1] - a[1]) * r;
    const h = Math.sin(dLa / 2) ** 2 + Math.cos(a[0] * r) * Math.cos(b[0] * r) * Math.sin(dLo / 2) ** 2;
    return 12742 * Math.asin(Math.sqrt(h));
  };

  // ------------------------------------------------------------------ pintar
  let visibles = [];
  function refrescar(encuadrar) {
    visibles = D.filter(pasaFiltro);
    const ids = new Set(visibles.map(p => p.id));
    marcadores.forEach((m, id) => {
      const p = POR_ID.get(id);
      if (ids.has(id)) { if (!mapa.hasLayer(m)) m.addTo(mapa); m.setZIndexOffset(zIndice(p)); }
      else if (mapa.hasLayer(m)) mapa.removeLayer(m);
    });
    if (encuadrar && visibles.length) {
      const b = L.latLngBounds(visibles.filter(p => p.lat != null).map(p => [p._lat, p._lon]));
      if (b.isValid()) mapa.fitBounds(b, { padding: [30, 30], maxZoom: 16 });
    }
    pintarContadores();
    pintarRapidos();
    const n = numFiltros();
    $('#btnFiltros').innerHTML = 'Filtros' + (n ? ` <span class="num">${n}</span>` : '');
    if (!$('#lista').hidden) pintarLista();
  }
  function pintarContadores() {
    let porVisitar = 0, vendidos = 0, insitu = 0;
    D.forEach(p => {
      const e = efectivo(p);
      if (e.prio !== 'no' && (e.estado === 'pendiente' || e.estado === 'contactado')) porVisitar++;
      if (e.estado === 'vendido') vendidos++;
      if (e.estado.startsWith('in_situ')) insitu++;
    });
    $('#contadores').innerHTML = `<span title="Objetivos sin cerrar">🎯 ${porVisitar}</span><span title="Vendidos">💰 ${vendidos}</span>` +
      (insitu ? `<span title="Comprobados en persona">✔ ${insitu}</span>` : '') +
      `<span title="Visibles con los filtros">👁 ${visibles.length}</span>`;
  }
  function pintarRapidos() {
    $('#rapidos').innerHTML = RAPIDOS.map(([k, t, d]) =>
      `<button class="chip${F.rapidos.has(k) ? ' activo' : ''}" data-rapido="${k}" title="${esc(d)}" aria-pressed="${F.rapidos.has(k)}">${esc(t)}</button>`).join('');
  }
  $('#rapidos').addEventListener('click', ev => {
    const b = ev.target.closest('[data-rapido]'); if (!b) return;
    const k = b.dataset.rapido;
    F.rapidos.has(k) ? F.rapidos.delete(k) : F.rapidos.add(k);
    if (k === 'girona' && F.rapidos.has('girona')) F.rapidos.delete('barcelona');
    if (k === 'barcelona' && F.rapidos.has('barcelona')) F.rapidos.delete('girona');
    guardarFiltros(); refrescar(true);
  });
  let tBuscar;
  $('#buscar').addEventListener('input', ev => {
    clearTimeout(tBuscar);
    tBuscar = setTimeout(() => { F.texto = norm(ev.target.value.trim()); refrescar(!!F.texto); }, 200);
  });

  // ------------------------------------------------------------------ lista, ranking y ruta
  let orden = ui.orden || 'prioridad';
  const cmpPrioridad = (a, b) => {
    const ea = efectivo(a), eb = efectivo(b);
    return (ea.hecho - eb.hecho) || (PRIO_ORD[ea.prio] - PRIO_ORD[eb.prio]) || (b.puntos - a.puntos) || a.nombre.localeCompare(b.nombre);
  };
  function rutaVecinoMasCercano(lista, inicio) {
    const quedan = lista.slice(), ruta = [];
    let actual = inicio;
    while (quedan.length && ruta.length < 25) {
      let mejor = 0, dmin = Infinity;
      quedan.forEach((p, i) => { const d = distKm(actual, [p.lat, p.lon]); if (d < dmin) { dmin = d; mejor = i; } });
      const p = quedan.splice(mejor, 1)[0];
      ruta.push({ p, d: dmin });
      actual = [p.lat, p.lon];
    }
    return ruta;
  }
  function itemHtml(p, n, extra) {
    const e = efectivo(p), r = reg(p.id);
    const est = e.estado !== 'pendiente' ? ` · ${EST[e.estado].i} ${EST[e.estado].t}` : '';
    return `<li class="${e.clase}${e.hecho ? ' hecho' : ''}" data-id="${p.id}" tabindex="0">
      <span class="n">${n}</span>
      <span class="t"><b>${esc(p.nombre)}</b><small>${esc(p.municipio)} · ${PRIO_TXT[e.prio]} · ${CLASE_TXT[e.clase]}${est}${r.nota ? ' · 📝' : ''}</small></span>
      ${extra ? `<span class="dist">${extra}</span>` : ''}</li>`;
  }
  function pintarLista() {
    document.querySelectorAll('.orden [data-orden]').forEach(b => b.classList.toggle('activo', b.dataset.orden === orden));
    const cont = $('#items'), expl = $('#explicaOrden');
    numerosRuta = new Map(); capaRuta.clearLayers();
    let html = '';
    if (orden === 'prioridad') {
      expl.textContent = 'Primero los mejores objetivos sin visitar. Los vendidos/descartados van al final.';
      html = visibles.slice().sort(cmpPrioridad).map((p, i) => itemHtml(p, i + 1)).join('');
    } else if (orden === 'cerca' || orden === 'ruta') {
      if (!posicion) {
        expl.textContent = 'Necesito tu ubicación para ordenar por cercanía.';
        html = '<li class="liBoton"><button class="boton primario" id="pedirUbic">📍 Usar mi ubicación</button></li>';
      } else if (orden === 'cerca') {
        expl.textContent = 'Del más cercano al más lejano (en línea recta).';
        html = visibles.filter(p => p.lat != null).map(p => ({ p, d: distKm(posicion, [p.lat, p.lon]) }))
          .sort((a, b) => a.d - b.d).map((x, i) => itemHtml(x.p, i + 1, x.d.toFixed(1) + ' km')).join('');
      } else {
        const objetivos = visibles.filter(p => { const e = efectivo(p); return p.lat != null && e.prio !== 'no' && !e.hecho; });
        const ruta = rutaVecinoMasCercano(objetivos, posicion);
        expl.innerHTML = `Ruta desde donde estás: siempre al objetivo más cercano (máx. 25 paradas, sin los que fabrican ni los ya cerrados). Filtra por zona o 🔥 Calientes para acortarla.`;
        if (ruta.length) {
          const pts = ruta.slice(0, 10).map(x => `${x.p.lat},${x.p.lon}`);
          const gm = `https://www.google.com/maps/dir/?api=1&origin=${posicion.join(',')}&destination=${pts[pts.length - 1]}` +
            (pts.length > 1 ? `&waypoints=${encodeURIComponent(pts.slice(0, -1).join('|'))}` : '') + '&travelmode=driving';
          html = `<li class="liBoton"><a class="boton primario" href="${gm}" target="_blank" rel="noopener">🚗 Abrir las ${pts.length} primeras paradas en Google Maps</a></li>`;
        }
        html += ruta.map((x, i) => { numerosRuta.set(x.p.id, i + 1); return itemHtml(x.p, i + 1, x.d.toFixed(1) + ' km'); }).join('');
        if (ruta.length) L.polyline([posicion, ...ruta.map(x => [x.p._lat, x.p._lon])], { color: '#3e8ef7', weight: 3, dashArray: '6 6', opacity: .8 }).addTo(capaRuta);
      }
    } else {
      expl.textContent = 'Agrupado por zonas, de Barcelona hacia el norte de Girona.';
      ZONAS.forEach(z => {
        const de = visibles.filter(p => p.zona === z).sort((a, b) => a.municipio.localeCompare(b.municipio) || cmpPrioridad(a, b));
        if (de.length) html += `<li class="zonaTitulo">${esc(z)} · ${de.length}</li>` + de.map((p, i) => itemHtml(p, i + 1)).join('');
      });
    }
    cont.innerHTML = html || '<li class="zonaTitulo">Ningún local con estos filtros.</li>';
    marcadores.forEach((m, id) => { m.setIcon(icono(POR_ID.get(id))); m.setZIndexOffset(zIndice(POR_ID.get(id))); });
  }
  $('.orden').addEventListener('click', ev => {
    const b = ev.target.closest('[data-orden]'); if (!b) return;
    orden = b.dataset.orden; ui.orden = orden; guardarUi();
    if ((orden === 'cerca' || orden === 'ruta') && !posicion) localizar(false, pintarLista);
    pintarLista();
  });
  $('#items').addEventListener('click', ev => {
    if (ev.target.closest('#pedirUbic')) { localizar(false, pintarLista); return; }
    if (ev.target.closest('a')) return;
    const li = ev.target.closest('li[data-id]'); if (li) abrirFicha(+li.dataset.id);
  });
  $('#items').addEventListener('keydown', ev => {
    const li = ev.target.closest('li[data-id]');
    if (li && (ev.key === 'Enter' || ev.key === ' ')) { ev.preventDefault(); abrirFicha(+li.dataset.id); }
  });

  function cambiarVista(v) {
    ui.vista = v; guardarUi();
    document.querySelectorAll('#pestanas [data-vista]').forEach(b => b.classList.toggle('activo', b.dataset.vista === v));
    $('#lista').hidden = v !== 'lista';
    if (v === 'lista') pintarLista(); else setTimeout(() => mapa.invalidateSize(), 50);
  }
  $('#pestanas').addEventListener('click', ev => { const b = ev.target.closest('[data-vista]'); if (b) cambiarVista(b.dataset.vista); });

  // ------------------------------------------------------------------ hojas (ficha, filtros, menú)
  let hojaAbierta = null, foco = null;
  function abrirHoja(id) {
    if (hojaAbierta && hojaAbierta !== id) cerrarHoja(true);
    foco = document.activeElement;
    hojaAbierta = id;
    $('#velo').hidden = false; $('#' + id).hidden = false; $('#' + id).scrollTop = 0;
    const c = $('#' + id + ' .cerrar'); if (c && !TACTIL) c.focus();
    pedirPersistencia();
  }
  function cerrarHoja(silencioso) {
    if (!hojaAbierta) return;
    if (hojaAbierta === 'ficha') guardarNotaPendiente();
    const era = hojaAbierta;
    $('#' + hojaAbierta).hidden = true; $('#velo').hidden = true; hojaAbierta = null;
    if (era === 'filtros' && !silencioso) refrescar(true);
    if (foco && foco.focus && !TACTIL) foco.focus();
  }
  $('#velo').addEventListener('click', () => cerrarHoja());
  document.querySelectorAll('.hoja').forEach(h => {
    h.addEventListener('click', ev => { if (ev.target.closest('[data-cerrar]')) cerrarHoja(); });
    let y0 = null;   // deslizar hacia abajo desde arriba para cerrar
    h.addEventListener('touchstart', ev => { y0 = h.scrollTop <= 0 ? ev.touches[0].clientY : null; }, { passive: true });
    h.addEventListener('touchend', ev => { if (y0 != null && ev.changedTouches[0].clientY - y0 > 90 && h.scrollTop <= 0) cerrarHoja(); y0 = null; }, { passive: true });
  });
  document.addEventListener('keydown', ev => { if (ev.key === 'Escape') cerrarHoja(); });

  // ------------------------------------------------------------------ ficha del local
  let fichaId = null;
  const telHref = t => { let d = String(t).replace(/[^\d+]/g, ''); if (/^\d{9}$/.test(d)) d = '+34' + d; return 'tel:' + d; };
  const exacto = p => p.precision === 'direccion' || p.precision === 'osm';
  const destino = p => exacto(p) ? `${p.lat},${p.lon}` : encodeURIComponent(`${p.nombre}, ${p.direccion || p.municipio}`);
  function enlaceIr(p) {
    return ES_IOS ? `https://maps.apple.com/?daddr=${destino(p)}&dirflg=d`
      : `https://www.google.com/maps/dir/?api=1&destination=${destino(p)}`;
  }
  const enlaceGoogle = p => `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${p.nombre} ${p.direccion || p.municipio}`)}`;

  function abrirFicha(id) {
    const p = POR_ID.get(id); if (!p) return;
    fichaId = id;
    pintarFicha();
    abrirHoja('ficha');
  }
  function pintarFicha() {
    const p = POR_ID.get(fichaId), e = efectivo(p), r = reg(p.id);
    const tel = p.tel ? `<a href="${telHref(p.tel)}"><span>📞</span>Llamar</a>` : '<a class="off" aria-disabled="true"><span>📞</span>Sin tel.</a>';
    const web = urlSegura(p.web) ? `<a href="${esc(p.web)}" target="_blank" rel="noopener"><span>🌐</span>Web</a>` : '<a class="off" aria-disabled="true"><span>🌐</span>Sin web</a>';
    const ig = p.ig ? `<a href="https://www.instagram.com/${encodeURIComponent(p.ig)}/" target="_blank" rel="noopener"><span>📷</span>Instagram</a>` : '<a class="off" aria-disabled="true"><span>📷</span>Sin IG</a>';
    const avisoUbic = exacto(p) ? '' : `<div class="etq aviso2">⚠️ Ubicación aproximada (${p.precision === 'calle' ? 'centro de la calle' : 'centro del pueblo'}): confirma en Google Maps</div>`;
    const etq = [
      `<span class="etq ${e.clase}">${CLAS_LARGO[e.clase]}</span>`,
      `<span class="etq prio">${PRIO_TXT[e.prio]}</span>`,
      `<span class="etq prio">Confianza ${esc(p.conf)}</span>`,
      p.franquicia ? '<span class="etq prio">Franquicia / marca</span>' : '',
      p.activo !== 'si' ? `<span class="etq aviso2">${p.activo === 'cerrado' ? 'Cerrado' : '¿Abierto? Sin confirmar'}</span>` : '',
      e.estado.startsWith('in_situ') ? `<span class="etq prio">Comprobado por ti: ${EST[e.estado].t}</span>` : '',
    ].join('');
    const ev = (p.ev || []).map(x => `<li><span class="peso ${esc(x.peso)}">${esc(x.peso)}</span>${esc(x.t)}${urlSegura(x.u) ? ` <a href="${esc(x.u)}" target="_blank" rel="noopener">fuente ↗</a>` : ''}</li>`).join('')
      || '<li>Sin evidencia encontrada.</li>';
    const hist = (r.hist || []).slice().reverse().map(h => `<li>${fechaHora(h.f)} — ${h.e === 'visita' ? '📅 Visitado' : (EST[h.e] ? EST[h.e].i + ' ' + EST[h.e].t : esc(h.e))}${h.origen ? ' (' + esc(h.origen) + ')' : ''}</li>`).join('');
    const res = p.resenas && p.resenas[0] ? `⭐ ${p.resenas[0]}${p.resenas[1] ? ` (${p.resenas[1]} reseñas)` : ''} · ` : '';
    $('#fichaCuerpo').innerHTML = `
      <h3 class="fTitulo" id="fNombre">${esc(p.nombre)}</h3>
      <div class="fSub">${esc(p.tipo)} · ${esc(p.municipio)} (${esc(p.zona)})</div>
      <div class="etiquetas">${etq}</div>
      <div class="fSub">📍 ${esc(p.direccion || 'Dirección sin confirmar')}${p.tel ? ` · 📞 ${esc(p.tel)}` : ''}</div>
      ${avisoUbic}
      <div class="rapidas">
        ${tel}
        <a href="${enlaceIr(p)}" target="_blank" rel="noopener"><span>📍</span>Ir</a>
        <a href="${enlaceGoogle(p)}" target="_blank" rel="noopener"><span>🗺️</span>Google</a>
        ${web}${ig}
        <button data-accion="copiar"><span>📋</span>Copiar dir.</button>
        <button data-accion="visita"><span>📅</span>Visité hoy</button>
        <button data-accion="nota"><span>📝</span>Nota</button>
      </div>
      <div class="motivo"><b>Por qué:</b> ${esc(p.motivo)}<br><b>Qué hacer:</b> ${esc(p.accion || '—')}</div>
      <h2>Estado de la visita</h2>
      <div class="estados">${ESTADOS.map(([k, i, t]) => `<button data-estado="${k}" class="${r.estado === k ? 'activo' : ''}" aria-pressed="${r.estado === k}">${i} ${t}</button>`).join('')}</div>
      <p class="pista">${r.visita ? 'Última visita: ' + fechaCorta(r.visita) : 'Aún sin visitar'}</p>
      <h2>Nota</h2>
      <textarea id="nota" placeholder="Ej.: Hablé con el encargado. Compra la base a X. Volver el martes." aria-label="Nota sobre el local">${esc(r.nota || '')}</textarea>
      <div class="guardado" id="guardado"></div>
      <h2>Evidencia (confianza ${esc(p.conf)})</h2>
      <ul class="evid">${ev}</ul>
      <details><summary>¿Por qué esta prioridad? (${p.puntos} puntos)</summary><ul class="hist">${(p.puntos_detalle || []).map(x => `<li>${esc(x)}</li>`).join('')}</ul></details>
      ${hist ? `<details><summary>Historial de cambios</summary><ul class="hist">${hist}</ul></details>` : ''}
      <div class="datosFicha"><div>${res}Precio: ${esc(p.precio)}</div><div>Comprobado: ${fechaCorta(p.comprobado)} · ficha nº ${p.id}${p.osm ? ` · <a href="${esc(p.osm)}" target="_blank" rel="noopener">OSM</a>` : ''}</div></div>`;
  }
  let tNota = null;
  function guardarNotaPendiente() {
    if (tNota) { clearTimeout(tNota); tNota = null; const t = $('#nota'); if (t && fichaId) guardarNota(t.value); }
  }
  function guardarNota(texto) {
    if (reg(fichaId).nota === texto) return;
    setReg(fichaId, { nota: texto });
    const g = $('#guardado'); if (g) g.textContent = errorGuardar ? '⚠️ No se pudo guardar' : '✓ Guardado ' + new Date().toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });
    if (!$('#lista').hidden) pintarLista();
  }
  $('#fichaCuerpo').addEventListener('input', ev => {
    if (ev.target.id !== 'nota') return;
    clearTimeout(tNota);
    const v = ev.target.value;
    $('#guardado').textContent = 'Guardando…';
    tNota = setTimeout(() => { tNota = null; guardarNota(v); }, 500);
  });
  $('#fichaCuerpo').addEventListener('focusout', ev => { if (ev.target.id === 'nota') guardarNotaPendiente(); });
  $('#fichaCuerpo').addEventListener('click', async ev => {
    const p = POR_ID.get(fichaId);
    const be = ev.target.closest('[data-estado]');
    if (be) {
      const nuevo = be.dataset.estado, r = reg(p.id);
      if (nuevo === r.estado) return;
      guardarNotaPendiente();
      setReg(p.id, { estado: nuevo, visita: nuevo === 'pendiente' ? r.visita : hoyISO(), hist: [...(r.hist || []), { f: new Date().toISOString(), e: nuevo }] });
      actualizarMarcador(p); pintarFicha(); refrescar(false);
      toast(`${EST[nuevo].i} ${EST[nuevo].t}`);
      return;
    }
    const ba = ev.target.closest('[data-accion]'); if (!ba) return;
    const acc = ba.dataset.accion;
    if (acc === 'copiar') {
      const txt = `${p.nombre}, ${p.direccion || p.municipio}`;
      try { await navigator.clipboard.writeText(txt); toast('Dirección copiada'); }
      catch (e) { const t = document.createElement('textarea'); t.value = txt; document.body.appendChild(t); t.select(); document.execCommand('copy'); t.remove(); toast('Dirección copiada'); }
    } else if (acc === 'visita') {
      const r = reg(p.id);
      setReg(p.id, { visita: hoyISO(), hist: [...(r.hist || []), { f: new Date().toISOString(), e: 'visita' }] });
      pintarFicha(); toast('📅 Visita apuntada');
    } else if (acc === 'nota') {
      const t = $('#nota'); t.scrollIntoView({ behavior: 'smooth', block: 'center' }); t.focus();
    }
  });

  // ------------------------------------------------------------------ filtros (hoja)
  function grupoChips(titulo, clave, opciones) {
    return `<div class="grupo"><h2>${titulo}</h2><div class="chips">${opciones.map(([v, t]) =>
      `<button class="chip${F[clave].has(v) ? ' activo' : ''}" data-f="${clave}" data-v="${esc(v)}" aria-pressed="${F[clave].has(v)}">${esc(t)}</button>`).join('')}</div></div>`;
  }
  function pintarFiltros() {
    const cuenta = {};
    D.forEach(p => { cuenta[p.municipio] = (cuenta[p.municipio] || 0) + 1; });
    const munis = Object.keys(cuenta).sort((a, b) => a.localeCompare(b));
    $('#filtrosCuerpo').innerHTML =
      grupoChips('Provincia', 'provincia', [['Girona', 'Girona'], ['Barcelona', 'Barcelona']]) +
      grupoChips('Zona', 'zona', ZONAS.map(z => [z, z])) +
      `<div class="grupo"><h2>Municipio</h2><select id="fMunicipio" aria-label="Municipio"><option value="">Todos</option>${munis.map(m => `<option value="${esc(m)}"${F.municipio === m ? ' selected' : ''}>${esc(m)} (${cuenta[m]})</option>`).join('')}</select></div>` +
      grupoChips('Clasificación', 'clase', [['externo', '🔴 Compra fuera'], ['sindatos', '🟡 Sin datos'], ['propio', '🟢 Fabrica él'], ['competidor', '🟣 Competidor']]) +
      grupoChips('Prioridad comercial', 'prio', Object.entries(PRIO_TXT)) +
      grupoChips('Confianza de la evidencia', 'conf', [['alta', 'Alta'], ['media', 'Media'], ['baja', 'Baja']]) +
      grupoChips('Precio', 'precio', [['€', '€'], ['€€', '€€'], ['€€€', '€€€'], ['?', 'Sin dato']]) +
      grupoChips('Estado de visita', 'estado', ESTADOS.map(([k, i, t]) => [k, `${i} ${t}`]));
  }
  $('#btnFiltros').addEventListener('click', () => { pintarFiltros(); abrirHoja('filtros'); });
  $('#filtrosCuerpo').addEventListener('click', ev => {
    const b = ev.target.closest('[data-f]'); if (!b) return;
    const s = F[b.dataset.f], v = b.dataset.v;
    s.has(v) ? s.delete(v) : s.add(v);
    b.classList.toggle('activo', s.has(v)); b.setAttribute('aria-pressed', s.has(v));
    guardarFiltros(); refrescar(false);
  });
  $('#filtrosCuerpo').addEventListener('change', ev => {
    if (ev.target.id === 'fMunicipio') { F.municipio = ev.target.value; guardarFiltros(); refrescar(false); }
  });
  $('#limpiarFiltros').addEventListener('click', () => {
    SETS.forEach(k => F[k].clear()); F.municipio = ''; F.rapidos.clear();
    guardarFiltros(); pintarFiltros(); refrescar(false);
  });

  // ------------------------------------------------------------------ copia de seguridad
  const sello = () => new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
  async function entregarArchivo(blob, nombre) {
    if (TACTIL && navigator.canShare) {
      const file = new File([blob], nombre, { type: blob.type });
      if (navigator.canShare({ files: [file] })) {
        try { await navigator.share({ files: [file], title: nombre }); return true; }
        catch (e) { if (e.name === 'AbortError') return false; }
      }
    }
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = nombre;
    document.body.appendChild(a); a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 2000);
    return true;
  }
  async function exportarJson() {
    guardarNotaPendiente();
    const datos = { app: 'heladerias-xavi', version: 2, exportado: new Date().toISOString(), datos_comprobados: META.fecha, locales: almacen.locales };
    const ok = await entregarArchivo(new Blob([JSON.stringify(datos, null, 1)], { type: 'application/json' }), `heladerias-copia-${sello()}.json`);
    if (ok) { almacen.ultimaCopia = Date.now(); almacen.cambiosDesdeCopia = 0; guardar(); pintarInfoCopia(); toast('Copia creada. Guárdala en Archivos, mándatela por WhatsApp o correo.'); }
  }
  function exportarCsv() {
    guardarNotaPendiente();
    const cols = ['id', 'nombre', 'municipio', 'zona', 'provincia', 'direccion', 'lat', 'lon', 'precision_ubicacion', 'telefono', 'web', 'instagram',
      'clasificacion', 'confianza', 'prioridad', 'puntos', 'franquicia', 'competidor', 'estado_visita', 'ultima_visita', 'nota', 'motivo', 'accion', 'fuentes', 'comprobado'];
    const q = v => '"' + String(v ?? '').replace(/"/g, '""').replace(/\r?\n/g, ' / ') + '"';
    const filas = D.slice().sort(cmpPrioridad).map(p => {
      const e = efectivo(p), r = reg(p.id);
      return [p.id, p.nombre, p.municipio, p.zona, p.provincia, p.direccion, p.lat, p.lon, p.precision, p.tel, p.web, p.ig,
        CLASE_TXT[e.clase], p.conf, PRIO_TXT[e.prio], p.puntos, p.franquicia ? 'sí' : 'no', p.competidor ? 'sí' : 'no',
        EST[e.estado].t, r.visita || '', r.nota || '', p.motivo, p.accion, (p.ev || []).map(x => x.u).filter(Boolean).join(' '), p.comprobado].map(q).join(';');
    });
    const csv = '﻿' + cols.join(';') + '\n' + filas.join('\n');
    entregarArchivo(new Blob([csv], { type: 'text/csv;charset=utf-8' }), `heladerias-${sello()}.csv`);
  }
  $('#exportarJson').addEventListener('click', exportarJson);
  $('#exportarCsv').addEventListener('click', exportarCsv);
  $('#importar').addEventListener('change', async ev => {
    const f = ev.target.files[0]; ev.target.value = '';
    if (!f) return;
    let obj;
    try { obj = JSON.parse(await f.text()); } catch (e) { toast('Ese archivo no es una copia válida'); return; }
    if (!obj || obj.app !== 'heladerias-xavi' || typeof obj.locales !== 'object') { toast('Ese archivo no es una copia de este mapa'); return; }
    const n = Object.keys(obj.locales).length;
    if (!confirm(`La copia tiene datos de ${n} locales (${obj.exportado ? fechaHora(obj.exportado) : 'sin fecha'}).\n\nSe combinará con lo que hay en este móvil: en cada local se queda el cambio más reciente. No se borra nada más. ¿Seguir?`)) return;
    let aplicados = 0;
    Object.entries(obj.locales).forEach(([id, r]) => {
      if (!r || typeof r !== 'object' || !EST[r.estado || 'pendiente']) return;
      const actual = almacen.locales[id];
      if (!actual || (r.t || 0) > (actual.t || 0)) { almacen.locales[id] = { estado: 'pendiente', nota: '', hist: [], ...r }; aplicados++; }
    });
    guardar();
    D.forEach(actualizarMarcador); refrescar(false);
    toast(`Copia restaurada: ${aplicados} locales actualizados`);
  });
  function pintarInfoCopia() {
    const n = Object.values(almacen.locales).filter(r => r.estado !== 'pendiente' || r.nota).length;
    $('#infoCopia').textContent = (almacen.ultimaCopia ? `Última copia: ${fechaHora(almacen.ultimaCopia)}. ` : 'Todavía no has hecho ninguna copia. ') +
      `Tienes ${n} locales con estado o nota.`;
  }
  $('#btnMenu').addEventListener('click', () => { pintarInfoCopia(); abrirHoja('menu'); });

  // ------------------------------------------------------------------ avisos
  function pintarAvisos() {
    const av = [];
    if (errorGuardar) av.push(['⚠️ Este navegador no deja guardar (¿navegación privada?). Lo que marques se perderá: abre en Safari normal.', null]);
    if (!navigator.onLine) av.push(['📴 Sin conexión: el mapa de fondo puede no cargar. La lista, las fichas y tus datos sí funcionan.', null]);
    const dias = almacen.ultimaCopia ? (Date.now() - almacen.ultimaCopia) / 864e5 : Infinity;
    if ((almacen.cambiosDesdeCopia || 0) >= 5 && dias > 3) av.push([`💾 Llevas ${almacen.cambiosDesdeCopia} cambios sin copia de seguridad.`, 'copia']);
    $('#avisos').innerHTML = av.map(([t, b]) => `<div class="aviso"><span>${esc(t)}</span>${b ? '<button class="boton primario" data-copia>Hacer copia</button>' : ''}</div>`).join('');
  }
  $('#avisos').addEventListener('click', ev => { if (ev.target.closest('[data-copia]')) exportarJson(); });
  addEventListener('online', pintarAvisos);
  addEventListener('offline', pintarAvisos);
  addEventListener('pagehide', guardarNotaPendiente);
  document.addEventListener('visibilitychange', () => { if (document.hidden) guardarNotaPendiente(); });

  let tToast;
  function toast(t) {
    const el = $('#toast'); el.textContent = t; el.classList.add('ver');
    clearTimeout(tToast); tToast = setTimeout(() => el.classList.remove('ver'), 2600);
  }

  // ------------------------------------------------------------------ arranque
  if (navigator.standalone || matchMedia('(display-mode: standalone)').matches) $('#consejoInstalar').textContent = 'Ya está instalada en la pantalla de inicio. ✔';
  $('#infoDatos').textContent = `Investigación comprobada el ${fechaCorta(META.fecha)} · ${D.length} locales. Las clasificaciones se basan en evidencia pública; "artesanal" no cuenta como prueba.`;
  if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js').catch(() => {});
  refrescar(true);
  cambiarVista(ui.vista === 'lista' ? 'lista' : 'mapa');
  pintarAvisos();
  const fid = +new URLSearchParams(location.search).get('id');
  if (POR_ID.has(fid)) { abrirFicha(fid); history.replaceState(null, '', location.pathname); }
})();
