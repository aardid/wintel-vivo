/* Wintel en vivo — interfaz estática. Lee docs/data/index.json y docs/data/dias/<día>/*. Sin build, sin servidor. */
(async function () {
  const $ = (s) => document.querySelector(s);
  const fmtPct = (x) => (x == null ? "—" : Math.round(x * 100) + " %");
  const MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
  const DIAS = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];
  const MESC = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
  const toDate = (s) => new Date(s + "T12:00:00");
  const fLong = (s) => { const d = toDate(s); return `${DIAS[d.getDay()][0].toUpperCase()}${DIAS[d.getDay()].slice(1)} ${d.getDate()} de ${MESES[d.getMonth()]} de ${d.getFullYear()}`; };
  const fShort = (s) => { const d = toDate(s); return `${d.getDate()} ${MESC[d.getMonth()]}`; };
  const addDays = (s, k) => { const d = toDate(s); d.setDate(d.getDate() + k); return d.toISOString().slice(0, 10); };
  const getJSON = async (u) => { const r = await fetch(u, { cache: "no-store" }); if (!r.ok) throw new Error(u); return r.json(); };

  // ---------- pestañas ----------
  document.querySelectorAll(".tab").forEach((b) => b.addEventListener("click", () => {
    document.querySelectorAll(".tab").forEach((x) => x.classList.toggle("on", x === b));
    document.querySelectorAll(".view").forEach((v) => v.classList.toggle("on", v.id === b.dataset.tab));
    if (b.dataset.tab === "hoy") setTimeout(() => map.invalidateSize(), 50);
  }));

  // ---------- índice ----------
  let index; try { index = await getJSON("data/index.json"); } catch (e) { $("#status").textContent = "sin datos todavía"; return; }
  const days = index.dias.map((d) => d.dia); const byDay = Object.fromEntries(index.dias.map((d) => [d.dia, d]));
  const last = days[days.length - 1];
  const hoursOld = (Date.now() - new Date(index.actualizado)) / 36e5;
  // siempre en hora de Chile: sin timeZone el navegador usa la del visitante (en Nueva Zelanda mostraba 12 h de más)
  const enChile = (t) => new Date(t).toLocaleString("es-CL", { timeZone: "America/Santiago", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hour12: false });
  $("#status").textContent = `Actualizado ${enChile(index.actualizado)} · próxima corrida 06:00 · hora de Chile`;
  $("#dot").className = "dot " + (hoursOld < 30 ? "ok" : "old");
  $("#upd").textContent = `${index.dias.length} días publicados · ${index.resumen.dias_con_focos} verificados con focos`;
  const sel = $("#daysel"); days.slice().reverse().forEach((d) => { const o = document.createElement("option"); o.value = d; o.textContent = fLong(d); sel.appendChild(o); });

  // ---------- mapa ----------
  const map = L.map("map", { zoomControl: true, attributionControl: true, scrollWheelZoom: false }).setView([-37.8, -72.6], 7);
  // OpenStreetMap estándar (sin API key); el overlay del pronóstico va encima con transparencia
  L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", { attribution: "© OpenStreetMap contributors", maxZoom: 14, opacity: 0.85 }).addTo(map);
  const labels = L.layerGroup();   // OSM ya trae etiquetas
  const comunasGeo = await getJSON("data/comunas_web.geojson");
  let overlay = null, zonas = null, focos = null, comLayer = null, layerMode = "km", horizon = 1, current = null;
  const ramp = (t) => { // misma rampa que los mapas del prototipo
    const stops = [[0, [253, 243, 236]], [0.25, [247, 201, 168]], [0.5, [235, 104, 52]], [0.75, [166, 58, 23]], [1, [92, 29, 10]]];
    for (let i = 1; i < stops.length; i++) if (t <= stops[i][0]) { const [a, ca] = stops[i - 1], [b, cb] = stops[i], u = (t - a) / (b - a); return `rgb(${ca.map((v, k) => Math.round(v + (cb[k] - v) * u)).join(",")})`; }
    return "rgb(92,29,10)";
  };
  const comStyle = (f) => { const c = current && current.byId[f.properties.comuna_id]; const v = c ? (horizon === 1 ? c.indice : horizon === 2 ? c.indice_h2 : c.indice_h3) : null; return { color: "#fff", weight: 0.7, fillColor: v == null ? "#eee" : ramp(Math.sqrt(Math.min(v, 100) / 100)), fillOpacity: layerMode === "comuna" ? 0.85 : 0 }; };
  comLayer = L.geoJSON(comunasGeo, { style: comStyle, onEachFeature: (f, l) => l.bindTooltip(() => { const c = current && current.byId[f.properties.comuna_id]; return c ? `<b>${c.comuna}</b><br>índice ${c.indice} · puesto ${c.rank}${c.prob == null ? "" : ` · prob. foco ${Math.round(c.prob)} %`}<br>focos 7 d: ${c.ign_7d}` : f.properties.comuna; }, { sticky: true }) }).addTo(map);
  map.fitBounds(comLayer.getBounds(), { padding: [4, 4] });
  document.querySelectorAll(".segb[data-layer]").forEach((b) => b.addEventListener("click", () => {
    document.querySelectorAll(".segb[data-layer]").forEach((x) => x.classList.toggle("on", x === b)); layerMode = b.dataset.layer;
    if (overlay) overlay.setOpacity(layerMode === "km" ? 1 : 0); comLayer.setStyle(comStyle);
  }));
  document.querySelectorAll("#hz .segb").forEach((b) => b.addEventListener("click", () => { horizon = +b.dataset.h; document.querySelectorAll("#hz .segb").forEach((x) => x.classList.toggle("on", x === b)); renderTable(); comLayer.setStyle(comStyle); }));

  // ---------- un día ----------
  async function showDay(day) {
    const dir = `data/dias/${day}/`;
    const [cj, bounds, zon] = await Promise.all([getJSON(dir + "comunas.json"), getJSON(dir + "mapa_bounds.json"), getJSON(dir + "zonas.geojson")]);
    const ver = byDay[day] && byDay[day].verificado ? await getJSON(dir + "verificacion.json") : null;
    const fo = ver ? await getJSON(dir + "focos_dia_siguiente.geojson").catch(() => null) : null;
    current = { day, meta: cj.meta, comunas: cj.comunas, byId: Object.fromEntries(cj.comunas.map((c) => [c.comuna_id, c])), ver };
    sel.value = day;
    $("#d1").textContent = fLong(day); $("#d2").textContent = `pronóstico para mañana, ${DIAS[toDate(cj.meta.pronostico_para).getDay()]} ${toDate(cj.meta.pronostico_para).getDate()}${cj.meta.modo === "relleno" ? " · relleno posterior" : ""}`;
    $("#prev").disabled = days.indexOf(day) === 0; $("#next").disabled = day === last;
    $("#km2lbl").textContent = cj.meta.km2_zonas.toLocaleString("es-CL") + " km²";
    if (overlay) map.removeLayer(overlay); overlay = L.imageOverlay(dir + "mapa.png", bounds.bounds, { opacity: layerMode === "km" ? 1 : 0, interactive: false }).addTo(map);
    if (zonas) map.removeLayer(zonas); zonas = L.geoJSON(zon, { style: { color: "#2a78d6", weight: 1.6, fillOpacity: 0 }, interactive: false }).addTo(map);
    if (focos) { map.removeLayer(focos); focos = null; }
    if (fo && fo.features.length) focos = L.geoJSON(fo, { pointToLayer: (f, ll) => L.circleMarker(ll, { radius: 5, color: "#1c1a17", weight: 1.4, fillOpacity: 0 }) }).addTo(map);
    if (!map.hasLayer(labels)) labels.addTo(map);
    comLayer.setStyle(comStyle); comLayer.bringToFront(); zonas.bringToFront(); if (focos) focos.bringToFront();
    const hasH = cj.meta.horizontes && cj.meta.horizontes.length > 1; $("#hz").style.display = hasH ? "flex" : "none"; if (!hasH) horizon = 1;
    renderTable();
    // cómo nos fue ayer: verificación del día anterior
    const y = addDays(day, -1); const vy = byDay[y] && byDay[y].verificado ? await getJSON(`data/dias/${y}/verificacion.json`) : null;
    $("#ayertxt").textContent = vy ? `El pronóstico del ${fShort(y)} para el ${fShort(day)} se contrasta con los focos VIIRS detectados.` : `Sin verificación disponible para el ${fShort(y)}.`;
    $("#k_focos").textContent = vy ? vy.focos : "—"; $("#k_w").textContent = vy ? vy.capturados_top10_wintel : "—"; $("#k_h").textContent = vy ? vy.capturados_top10_historico : "—";
    $("#k_w").className = vy && vy.focos > 0 && vy.capturados_top10_wintel === 0 ? "redk" : "blue";
    // temporada
    const r = index.resumen; $("#s_w").textContent = fmtPct(r.cap_top10_wintel); $("#s_h").textContent = fmtPct(r.cap_top10_historico);
    $("#s_txt").textContent = `${r.dias_con_focos} días con focos verificados de ${r.dias} publicados · ${r.focos} focos nuevos.`;
    // descargas
    const csv = ["puesto,comuna,region,indice,prob_foco_pct,prob_h2,prob_h3,indice_h2,indice_h3,indice_historico,puesto_ayer,focos_7d,focos_30d,tmax,hr,viento_max,lluvia,dias_secos,lluvia_30d"].concat(cj.comunas.map((c) => [c.rank, c.comuna, c.region, c.indice, c.prob, c.prob_h2, c.prob_h3, c.indice_h2, c.indice_h3, c.indice_historico, c.rank_ayer, c.ign_7d, c.ign_30d, c.temperature_2m_max, c.relative_humidity_2m_mean, c.wind_speed_10m_max, c.precipitation_sum, c.dry_days, c.rain30].map((v) => (v == null ? "" : v)).join(","))).join("\n");
    $("#csv").href = URL.createObjectURL(new Blob(["﻿" + csv], { type: "text/csv" })); $("#csv").download = `wintel_comunas_${day}.csv`;
    $("#geo").href = dir + "zonas.geojson"; $("#geo").download = `wintel_zonas_1km_${day}.geojson`;
    spark(day);
  }
  function renderTable() {
    const key = horizon === 1 ? "indice" : horizon === 2 ? "indice_h2" : "indice_h3";
    const pkey = horizon === 1 ? "prob" : horizon === 2 ? "prob_h2" : "prob_h3";
    $("#para").textContent = horizon === 1 ? "mañana" : `+${horizon} días`;
    const rows = current.comunas.filter((c) => c[key] != null).sort((a, b) => b[key] - a[key]).slice(0, 10);
    $("#tbl tbody").innerHTML = rows.map((c, i) => {
      const ayer = c.rank_ayer == null ? '<td class="r mute">—</td>' : c.rank_ayer > 10 ? '<td class="r new">nueva</td>' : `<td class="r mute">${c.rank_ayer}º</td>`;
      return `<tr><td class="mute num">${i + 1}</td><td><span class="cm">${c.comuna}</span><span class="rg">${c.region}</span></td><td><span class="bar"><i><b style="width:${Math.min(100, c[key])}px"></b></i><span class="v num">${Math.round(c[key])}</span></span></td><td class="r num">${c[pkey] == null ? '<span class="mute">—</span>' : `${Math.round(c[pkey])} %`}</td>${ayer}<td class="r num mute">${c.ign_7d}</td></tr>`;
    }).join("");
  }
  function spark(day) {
    const i = days.indexOf(day); const win = index.dias.slice(Math.max(0, i - 29), i + 1);
    const svg = $("#spark"); const W = 300, H = 120, base = 110;
    const idx = win.map((d) => d.indice_regional), fo = win.map((d) => (d.focos == null ? null : d.focos));
    const maxI = Math.max(...idx, 1), maxF = Math.max(...fo.filter((v) => v != null), 1);
    const x = (k) => 4 + (k * (W - 8)) / Math.max(win.length - 1, 1);
    const bars = win.map((d, k) => fo[k] == null ? "" : `<rect x="${x(k) - 3}" y="${base - (fo[k] / maxF) * 30}" width="6" height="${(fo[k] / maxF) * 30}" fill="#f7c9a8"></rect>`).join("");
    const line = win.map((d, k) => `${x(k)},${20 + (1 - idx[k] / maxI) * 60}`).join(" ");
    svg.innerHTML = `<line x1="0" y1="${base}" x2="${W}" y2="${base}" stroke="#e7e3dc"></line>${bars}<polyline fill="none" stroke="#2a78d6" stroke-width="2" stroke-linejoin="round" points="${line}"></polyline>` +
      `<circle cx="${x(win.length - 1)}" cy="${20 + (1 - idx[idx.length - 1] / maxI) * 60}" r="3.5" fill="#fff" stroke="#2a78d6" stroke-width="2"></circle>` +
      `<text x="0" y="12" font-size="9" fill="#847d72">${fShort(win[0].dia)}</text><text x="${W}" y="12" font-size="9" fill="#847d72" text-anchor="end">${fShort(day)}</text>`;
  }
  $("#prev").addEventListener("click", () => showDay(days[days.indexOf(current.day) - 1]));
  $("#next").addEventListener("click", () => showDay(days[days.indexOf(current.day) + 1]));
  $("#today").addEventListener("click", () => showDay(last)); sel.addEventListener("change", () => showDay(sel.value));

  // ---------- verificación ----------
  const ver = index.dias.filter((d) => d.verificado).slice().reverse();
  const barcell = (n, tot, cls) => `<span class="bar"><i class="${cls}"><b style="width:${tot ? Math.round((90 * n) / tot) : 0}px"></b></i><span class="num">${n} de ${tot}</span></span>`;
  $("#vtbl tbody").innerHTML = ver.map((d) => `<tr><td><b>${fShort(d.dia)}</b></td><td class="mute">${d.top3.join(", ")}</td><td class="r num">${d.focos}</td><td>${barcell(d.cap_w, d.focos, "")}</td><td>${barcell(d.cap_h, d.focos, "h")}</td><td>${barcell(d.cap_z, d.focos, "z")}</td><td class="r"><a href="#" data-day="${d.dia}">ver</a></td></tr>`).join("") || `<tr><td colspan="7" class="mute">Todavía no hay días verificados: la primera verificación aparece al día siguiente de la primera corrida.</td></tr>`;
  const T = ver.reduce((a, d) => ({ f: a.f + d.focos, w: a.w + d.cap_w, h: a.h + d.cap_h, z: a.z + d.cap_z }), { f: 0, w: 0, h: 0, z: 0 });
  const tot = $("#vtot").children; tot[0].textContent = `${ver.length} días`; tot[2].textContent = T.f; tot[3].innerHTML = `<span class="blue num">${T.w} de ${T.f} · ${T.f ? Math.round((100 * T.w) / T.f) : 0} %</span>`; tot[4].innerHTML = `<span class="mute num">${T.h} de ${T.f} · ${T.f ? Math.round((100 * T.h) / T.f) : 0} %</span>`; tot[5].innerHTML = `<span class="orange num">${T.z} de ${T.f} · ${T.f ? Math.round((100 * T.z) / T.f) : 0} %</span>`;
  document.querySelectorAll("#vtbl a[data-day]").forEach((a) => a.addEventListener("click", (e) => { e.preventDefault(); document.querySelector('.tab[data-tab="hoy"]').click(); showDay(a.dataset.day); }));
  const r = index.resumen; $("#v_w").textContent = fmtPct(r.cap_top10_wintel); $("#v_h").textContent = fmtPct(r.cap_top10_historico); $("#v_z").textContent = fmtPct(r.cap_zonas_1km);
  $("#v_txt").textContent = `Promedio por día sobre ${r.dias_con_focos} días con focos (${r.focos} focos). Referencia fuera de muestra: ${fmtPct(r.referencia_loso.top10_wintel)} · ${fmtPct(r.referencia_loso.top10_historico)} · ${fmtPct(r.referencia_loso.zonas_1km)}.`;
  const vcsv = ["dia_pronostico,dia_verificado,focos,capturados_top10_wintel,capturados_top10_historico,capturados_zonas_1km,top3"].concat(ver.map((d) => [d.dia, addDays(d.dia, 1), d.focos, d.cap_w, d.cap_h, d.cap_z, '"' + d.top3.join(", ") + '"'].join(","))).join("\n");
  $("#vcsv").href = URL.createObjectURL(new Blob(["﻿" + vcsv], { type: "text/csv" })); $("#vcsv").download = "wintel_verificacion.csv";

  await showDay(last);
})();
