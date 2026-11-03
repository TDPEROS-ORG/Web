import { createIcons, Sun, House, ArrowRight, RefreshCw, LogOut, Plus, Search, BatteryMedium, Clock3, Activity, Zap, CircleCheck, TriangleAlert, X, Radio, Settings2, History, LayoutDashboard, ClipboardList, Copy, KeyRound, Power, Save, ArrowLeft } from 'lucide';
import { Chart, LineController, LineElement, PointElement, CategoryScale, LinearScale, Tooltip, Legend, Filler } from 'chart.js';
import './style.css';

Chart.register(LineController, LineElement, PointElement, CategoryScale, LinearScale, Tooltip, Legend, Filler);
const iconSet = { Sun, House, ArrowRight, RefreshCw, LogOut, Plus, Search, BatteryMedium, Clock3, Activity, Zap, CircleCheck, TriangleAlert, X, Radio, Settings2, History, LayoutDashboard, ClipboardList, Copy, KeyRound, Power, Save, ArrowLeft };
const root = document.querySelector('#app');
const state = { user: null, csrf: '', homes: [], selected: null, home: null, tab: 'overview', period: 'today', history: null, incidents: [], cursor: null, type: '', status: '', sort: 'newest', error: '', lastSync: null, busy: false, query: '' };
let chart = null;
let refreshQueue = Promise.resolve();
const esc = value => String(value ?? '').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]));
const icon = name => `<i data-lucide="${name}" aria-hidden="true"></i>`;
const number = (value, unit = '') => typeof value === 'number' && Number.isFinite(value) ? `${new Intl.NumberFormat('es-PE', { maximumFractionDigits: 1 }).format(value)}${unit ? ` ${unit}` : ''}` : '--';
const date = value => value ? new Intl.DateTimeFormat('es-PE', { dateStyle: 'short', timeStyle: 'medium' }).format(new Date(value)) : 'Sin registros';
const statusNames = { open: 'Abierta', acknowledged: 'En seguimiento', resolved: 'Resuelta' };
const severityNames = { high: 'Alta', medium: 'Media', low: 'Baja' };
const qualityNames = { live: 'Datos actuales', stale: 'Datos desactualizados', invalid: 'Lectura no válida', empty: 'Sin lecturas' };
const typeNames = { critical_battery: 'Batería crítica', low_battery: 'Batería baja', overconsumption: 'Sobreconsumo', low_autonomy: 'Autonomía reducida', invalid_reading: 'Lectura inválida', ai_alert: 'Alerta IA' };
const operatingNames = { NORMAL_OPERATION: 'Normal', LOW_BATTERY: 'Batería baja', CRITICAL_BATTERY: 'Batería crítica', LOW_AUTONOMY: 'Autonomía reducida', CHARGING: 'Cargando', STANDBY: 'En espera', HIGH_BASIC_HOME_DEMAND: 'Demanda elevada', WARNING_BATTERY: 'Atención a batería', SENSOR_FAILURE: 'Fallo de sensor' };

function hydrate() { createIcons({ icons: iconSet, attrs: { 'stroke-width': 1.7 } }); }
function toast(message) {
  const element = document.querySelector('#notice');
  element.textContent = message;
  element.className = 'visible';
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => { element.className = ''; }, 5000);
}

async function api(path, options = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12000);
  try {
    const response = await fetch(`/api${path}`, { ...options, signal: controller.signal, credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': state.csrf, ...options.headers } });
    const body = await response.json();
    if (response.status === 401 && state.user) { state.user = null; state.csrf = ''; document.querySelector('dialog')?.close(); renderLogin('Tu sesión ha caducado.'); }
    if (!response.ok) throw new Error(body.error || `Error ${response.status}`);
    return body;
  } catch (error) {
    if (error.name === 'AbortError') throw new Error('El servidor no responde. Reintentaremos automáticamente.');
    if (error instanceof TypeError) throw new Error('No se pudo conectar con el servidor. Reintentaremos automáticamente.');
    throw error;
  } finally { clearTimeout(timeout); }
}

function renderLogin(error = '') {
  chart?.destroy(); chart = null;
  root.innerHTML = `<main class="login-page"><div class="login-brand">${icon('sun')}<span>energía<span class="brand-divider">/</span><small>Operación</small></span></div>
    <div class="login-content"><img class="solar-photo" src="/operador/assets/solar.jpg" alt="Instalación de paneles solares" width="480" height="160">
      <div class="login-heading"><span class="eyebrow">ACCESO DE OPERADORES</span><h1>Iniciar sesión</h1></div>
      <form id="login-form"><label>Usuario o correo<input name="email" type="text" autocomplete="username" placeholder="operador" required maxlength="190"></label>
      <label>Contraseña<input name="password" type="password" autocomplete="current-password" placeholder="Tu contraseña" required maxlength="128"></label>
      <p class="form-error" role="alert">${esc(error)}</p><button class="primary" type="submit">Entrar ${icon('arrow-right')}</button></form>
      <div class="login-bottom">${icon('key-round')} Acceso autorizado</div></div><footer>ENERGÍA PARA CADA HOGAR</footer></main>`;
  hydrate();
}

function homeList() {
  for (const home of state.homes) updateAge(home);
  const homes = state.homes.filter(home => `${home.name} ${home.full_name} ${home.email}`.toLowerCase().includes(state.query.toLowerCase()));
  return homes.length ? homes.map(home => `<button class="home-row ${home.id === state.selected ? 'selected' : ''}" data-home="${home.id}" aria-pressed="${home.id === state.selected}">
    <span class="home-symbol">${icon('house')}</span><span class="home-info"><b>${esc(home.name)}</b><small>${esc(home.full_name)}</small><span class="home-state"><span class="dot ${home.quality.state}"></span>${!home.active ? 'Cuenta desactivada' : qualityNames[home.quality.state]}</span></span>
    <span class="home-battery">${home.quality.valid ? number(home.latest?.batteryLevel, '%') : '--'}</span></button>`).join('') : '<p class="empty-small">No hay hogares para mostrar.</p>';
}

function renderShell() {
  if (!state.user) return;
  chart?.destroy(); chart = null;
  root.innerHTML = `<header class="topbar"><a href="/operador" class="brand">${icon('sun')}<span>energía</span><span class="brand-divider">/</span><small>Operación</small></a>
    <div class="top-actions"><span class="sync-state ${state.error ? 'disconnected' : ''}"><span class="dot ${state.error ? 'invalid' : 'live'}"></span>${state.error ? 'Sin conexión' : 'Monitoreo activo'}</span>
    <button class="icon-button" data-action="refresh" title="Actualizar lecturas" aria-label="Actualizar lecturas">${icon('refresh-cw')}</button>
    <button class="primary new-home" data-action="create-home">${icon('plus')}<span>Nuevo hogar</span></button>
    <button class="icon-button" data-action="logout" title="Cerrar sesión" aria-label="Cerrar sesión">${icon('log-out')}</button></div></header>
    <div class="workspace"><aside class="sidebar"><div class="sidebar-heading"><span class="eyebrow">HOGARES</span><span class="count">${state.homes.length}</span></div>
    <label class="search">${icon('search')}<input id="home-search" placeholder="Buscar hogar o cliente" value="${esc(state.query)}" aria-label="Buscar hogar o cliente"></label>
    <div class="home-list">${homeList()}</div><div class="operator"><span class="avatar">${esc(state.user.fullName.slice(0, 1))}</span><span><b>${esc(state.user.fullName)}</b><small>Operador</small></span></div></aside>
    <main class="main-content">${state.error ? `<div class="connection-error" role="alert">${icon('triangle-alert')}<span>${esc(state.error)} Los datos conservan su fecha original.</span><button class="icon-button" data-action="refresh" aria-label="Reintentar" title="Reintentar">${icon('refresh-cw')}</button></div>` : ''}
    ${state.home ? renderHome() : `<div class="empty-state">${icon('house')}<h1>${state.homes.length ? 'Selecciona un hogar' : 'Hogares'}</h1><p>${state.homes.length ? 'Sin hogar seleccionado.' : 'Todavía no hay hogares registrados.'}</p><button class="primary" data-action="create-home">${icon('plus')} Nuevo hogar</button></div>`}</main></div>`;
  hydrate();
  if (state.home && (state.tab === 'history' || state.tab === 'overview')) drawChart();
}

function renderHome() {
  const home = state.home;
  updateAge(home);
  const tabs = [['overview', 'layout-dashboard', 'Estado actual'], ['history', 'history', 'Historial'], ['incidents', 'clipboard-list', 'Incidencias'], ['profile', 'settings-2', 'Perfil']];
  return `<div class="page-heading"><div><div class="breadcrumb">HOGARES <span>/</span> ${esc(home.full_name)}</div><h1>${esc(home.name)}</h1><p class="subtitle">${esc(home.address || home.email)}</p></div>
    <span class="quality ${home.quality.state}"><span class="dot ${home.quality.state}"></span>${qualityNames[home.quality.state]}</span></div>
    <nav class="tabs" aria-label="Vistas del hogar">${tabs.map(([id, symbol, label]) => `<button data-tab="${id}" class="${state.tab === id ? 'active' : ''}" aria-current="${state.tab === id ? 'page' : 'false'}">${icon(symbol)}${label}</button>`).join('')}</nav>
    ${state.tab === 'overview' ? overview() : state.tab === 'history' ? historyView() : state.tab === 'incidents' ? incidentsView() : profileView()}`;
}

function metric(symbol, title, value, detail, extra = '') {
  return `<div class="metric ${extra}"><div class="metric-label">${icon(symbol)}${title}</div><div class="metric-value">${value}</div><small>${detail}</small></div>`;
}

function overview() {
  const { latest: reading, quality, alerts, devices } = state.home;
  const valid = quality.valid;
  const value = (field, unit) => valid ? number(reading?.[field], unit) : '--';
  const alertText = quality.state === 'stale' ? '<div class="stale-banner">Las lecturas son antiguas. No representan necesariamente el estado actual del hogar.</div>' : !valid ? '<div class="stale-banner">No hay una lectura completa y válida para evaluar el estado energético.</div>' : '';
  return `${alertText}<div class="reading-time">${icon('clock-3')} Última lectura <strong>${date(reading?.createdAt)}</strong><span>${reading ? esc(reading.deviceId) : 'Sin fuente'}</span></div>
    <section class="metrics" aria-label="Indicadores energéticos">
      ${metric('battery-medium', 'Batería', value('batteryLevel', '%'), 'Nivel de carga', 'battery-metric')}
      ${metric('clock-3', 'Autonomía', valid && reading.estimatedAutonomyHours >= 99 && (reading.netPowerW ?? 0) <= 0 ? 'Sin descarga' : value('estimatedAutonomyHours', 'h'), 'Estimación de la IA local')}
      ${metric('activity', 'Disponibilidad', value('availabilityIndex', '%'), 'Índice energético')}
      ${metric('zap', 'Consumo', value('loadPowerW', 'W'), 'Potencia demandada')}
      ${metric('sun', 'Aporte solar', value('solarPowerW', 'W'), 'Potencia generada', 'solar-metric')}
      ${metric('circle-check', 'Estado general', valid ? esc(operatingNames[reading.operationalState] || reading.operationalState) : 'Sin evaluar', valid ? (alerts.length ? `${alerts.length} condición(es) detectada(s)` : 'Sin alertas energéticas') : 'Lectura no disponible', 'state-metric')}
    </section><div class="overview-columns"><section class="section"><div class="section-title"><h2>Condiciones detectadas</h2><span class="count">${alerts.length}</span></div>
    ${alerts.length ? alerts.map(alert => `<article class="alert ${alert.severity}"><div class="alert-heading">${icon('triangle-alert')}<h3>${esc(alert.title)}</h3><span class="severity ${alert.severity}">${severityNames[alert.severity]}</span></div><p>${esc(alert.recommendation)}</p></article>`).join('') : `<div class="all-clear">${icon('circle-check')}<span>${valid ? 'Sin condiciones críticas en la última lectura.' : 'Esperando una lectura válida.'}</span></div>`}
    <button class="text-button" data-tab="incidents">Ver incidencias ${icon('arrow-right')}</button></section>
    <section class="section technical"><div class="section-title"><h2>Detalle técnico</h2>${icon('radio')}</div><dl>
    <div><dt>Voltaje</dt><dd>${value('voltage', 'V')}</dd></div><div><dt>Corriente</dt><dd>${value('currentA', 'A')}</dd></div><div><dt>Energía disponible</dt><dd>${value('availableEnergyWh', 'Wh')}</dd></div><div><dt>Balance neto</dt><dd>${value('netPowerW', 'W')}</dd></div><div><dt>Almacenamiento</dt><dd>${esc(reading?.energyStorageType || '--')}</dd></div><div><dt>Fuente</dt><dd>${esc(devices?.find(device => device.device_id === reading?.deviceId)?.name || reading?.deviceId || '--')}</dd></div><div><dt>Comunicación</dt><dd>${esc(reading?.communicationMode || '--')}</dd></div></dl></section></div>
    <section class="section"><div class="section-title"><h2>Disponibilidad de hoy</h2><button class="text-button" data-tab="history">Ver historial ${icon('arrow-right')}</button></div>${chartMarkup()}</section>`;
}

function periods() {
  return `<div class="segmented" role="group" aria-label="Periodo">${[['today', 'Hoy'], ['7d', '7 días'], ['30d', '30 días']].map(([id, label]) => `<button class="${state.period === id ? 'active' : ''}" data-period="${id}" aria-pressed="${state.period === id}">${label}</button>`).join('')}</div>`;
}

function chartMarkup() {
  return state.history?.trend?.length ? '<div class="chart-frame"><canvas id="energy-chart" role="img" aria-label="Gráfico histórico de disponibilidad y batería"></canvas></div>' : '<div class="empty-chart">No hay lecturas válidas para este periodo.</div>';
}

function historyView() {
  return `<div class="view-toolbar"><h2>Historial energético</h2>${periods()}</div><section class="section">${chartMarkup()}</section>
    <section class="section"><div class="section-title"><h2>Últimas lecturas y chequeos</h2><small>Hasta 100 registros del periodo</small></div><div class="table-scroll"><table><thead><tr><th>Fecha y hora</th><th>Fuente</th><th>Batería</th><th>Voltaje</th><th>Corriente</th><th>Consumo</th><th>Solar</th><th>Chequeo</th></tr></thead><tbody>
    ${(state.history?.readings || []).map(reading => `<tr><td>${date(reading.createdAt)}</td><td>${esc(reading.deviceId)}</td><td>${reading.quality.valid ? number(reading.batteryLevel, '%') : '--'}</td><td>${reading.quality.valid ? number(reading.voltage, 'V') : '--'}</td><td>${reading.quality.valid ? number(reading.currentA, 'A') : '--'}</td><td>${reading.quality.valid ? number(reading.loadPowerW, 'W') : '--'}</td><td>${reading.quality.valid ? number(reading.solarPowerW, 'W') : '--'}</td><td><span class="quality ${reading.quality.valid ? 'live' : 'invalid'}">${reading.quality.valid ? 'Válida' : 'Inválida'}</span></td></tr>`).join('') || '<tr><td colspan="8" class="empty-table">Sin lecturas en este periodo.</td></tr>'}
    </tbody></table></div></section>`;
}

function incidentsView() {
  return `<div class="view-toolbar"><h2>Incidencias</h2>${periods()}</div><div class="filters"><label>Tipo<select id="incident-type"><option value="">Todos los tipos</option>${Object.entries(typeNames).map(([value, name]) => `<option value="${value}" ${state.type === value ? 'selected' : ''}>${name}</option>`).join('')}</select></label>
    <label>Estado<select id="incident-status"><option value="">Todos los estados</option>${Object.entries(statusNames).map(([value, name]) => `<option value="${value}" ${state.status === value ? 'selected' : ''}>${name}</option>`).join('')}</select></label><label>Orden<select id="incident-sort"><option value="newest">Más recientes</option><option value="oldest" ${state.sort === 'oldest' ? 'selected' : ''}>Más antiguas</option></select></label></div>
    <div class="table-scroll"><table><thead><tr><th>Incidencia</th><th>Fecha y hora</th><th>Severidad</th><th>Estado</th><th></th></tr></thead><tbody>${state.incidents.map(incident => `<tr><td><b>${esc(incident.title)}</b><small class="table-sub">#${incident.id} · Lectura #${incident.telemetry_id}</small></td><td>${date(incident.created_at)}</td><td><span class="severity ${incident.severity}">${severityNames[incident.severity]}</span></td><td>${statusNames[incident.status]}</td><td><button class="icon-button" data-incident="${incident.id}" title="Detalle y trazabilidad" aria-label="Detalle de incidencia ${incident.id}">${icon('arrow-right')}</button></td></tr>`).join('') || '<tr><td colspan="5" class="empty-table">No hay incidencias con estos filtros.</td></tr>'}</tbody></table></div>
    ${state.cursor ? '<button class="secondary load-more" data-action="more-incidents">Cargar más</button>' : ''}`;
}

function profileView() {
  const home = state.home;
  return `<section class="section"><div class="section-title"><h2>Perfil del hogar</h2><span class="quality ${home.active ? 'live' : 'stale'}">${home.active ? 'Cuenta activa' : 'Cuenta desactivada'}</span></div>
    <form id="profile-form" class="form-grid"><label>Nombre del cliente<input name="fullName" value="${esc(home.full_name)}" required maxlength="120"></label><label>Nombre del hogar<input name="householdName" value="${esc(home.name)}" required maxlength="120"></label><label>Correo electrónico<input value="${esc(home.email)}" readonly></label><label>Dirección<input name="address" value="${esc(home.address)}" maxlength="255"></label><label class="full">Notas<textarea name="notes" maxlength="3000" rows="3">${esc(home.notes)}</textarea></label><label>Nueva contraseña<input name="password" type="password" autocomplete="new-password" minlength="10" maxlength="128" placeholder="Sin cambios"></label><label class="checkbox"><input name="active" type="checkbox" ${home.active ? 'checked' : ''}> Cuenta activa</label><div class="full"><button class="primary" type="submit">${icon('save')} Guardar perfil</button></div></form></section>
    <section class="section"><div class="section-title"><h2>Fuentes y dispositivos</h2><button class="secondary" data-action="add-device">${icon('plus')} Añadir fuente</button></div><div class="table-scroll"><table><thead><tr><th>Dispositivo</th><th>Identificador</th><th>Estado</th><th>Acciones</th></tr></thead><tbody>${home.devices.map(device => `<tr><td>${esc(device.name)}</td><td>${esc(device.device_id)}</td><td>${device.active ? 'Activo' : 'Desactivado'}</td><td><div class="row-actions"><button class="icon-button" data-device-key="${esc(device.device_id)}" title="Renovar clave" aria-label="Renovar clave de ${esc(device.name)}">${icon('key-round')}</button><button class="icon-button" data-device-toggle="${esc(device.device_id)}" title="${device.active ? 'Desactivar' : 'Activar'} fuente" aria-label="Cambiar estado de ${esc(device.name)}">${icon('power')}</button></div></td></tr>`).join('') || '<tr><td colspan="4" class="empty-table">Este hogar no tiene fuentes asignadas.</td></tr>'}</tbody></table></div></section>`;
}

function drawChart() {
  const canvas = document.querySelector('#energy-chart');
  if (!canvas || !state.history?.trend?.length) return;
  const trend = state.history.trend;
  chart = new Chart(canvas, { type: 'line', data: { labels: trend.map(point => new Date(point.timestamp).toLocaleString('es-PE', state.period === 'today' ? { hour: '2-digit', minute: '2-digit' } : { day: '2-digit', month: 'short' })), datasets: [
    { label: 'Disponibilidad (%)', data: trend.map(point => point.availabilityIndex), borderColor: '#198268', backgroundColor: 'rgba(25,130,104,.07)', fill: true, tension: .25, pointRadius: 3, borderWidth: 2 },
    { label: 'Batería (%)', data: trend.map(point => point.batteryLevel), borderColor: '#d3972d', tension: .25, pointRadius: 3, borderWidth: 2 },
  ] }, options: { responsive: true, maintainAspectRatio: false, animation: false, interaction: { mode: 'index', intersect: false }, scales: { y: { min: 0, max: 100, ticks: { callback: value => `${value}%` }, grid: { color: '#edf1ef' } }, x: { grid: { display: false }, ticks: { maxTicksLimit: 8 } } }, plugins: { legend: { position: 'bottom', align: 'start', labels: { usePointStyle: true, boxWidth: 7, font: { family: 'Manrope' } } } } } });
}

async function loadDetails() {
  if (!state.selected) return;
  const id = state.selected;
  const tab = state.tab;
  const home = await api(`/operator/households/${id}`);
  let history = null;
  let incidents = null;
  if (tab === 'overview' || tab === 'history') history = await api(`/operator/households/${id}/history?period=${tab === 'overview' ? 'today' : state.period}`);
  if (tab === 'incidents') incidents = await api(incidentPath());
  if (state.selected !== id || state.tab !== tab) return;
  state.home = home;
  if (history) state.history = history;
  if (incidents) { state.incidents = incidents.data; state.cursor = incidents.nextCursor; }
}

function incidentPath(cursor = '') {
  const query = new URLSearchParams({ period: state.period, type: state.type, status: state.status, sort: state.sort });
  if (cursor) query.set('cursor', cursor);
  return `/operator/households/${state.selected}/incidents?${query}`;
}

function updateAge(home) {
  if (home?.quality.valid && home.latest?.createdAt && (Date.now() - new Date(home.latest.createdAt).getTime()) / 1000 > (home.quality.staleAfterSeconds || 120)) home.quality.state = 'stale';
}

function refresh() {
  refreshQueue = refreshQueue.then(performRefresh, performRefresh);
  return refreshQueue;
}

async function performRefresh() {
  if (!state.user) return;
  try {
    const response = await api('/operator/households');
    state.homes = response.data;
    if (!state.selected && state.homes.length) state.selected = state.homes[0].id;
    await loadDetails();
    state.error = ''; state.lastSync = new Date();
  } catch (error) { state.error = error.message; }
  finally { if (state.user) renderShell(); }
}

async function navigate(change) {
  Object.assign(state, change);
  try { await loadDetails(); state.error = ''; }
  catch (error) { state.error = error.message; }
  renderShell();
}

function dialog(title, content) {
  document.querySelector('dialog')?.remove();
  const element = document.createElement('dialog');
  element.innerHTML = `<div class="dialog-heading"><h2>${esc(title)}</h2><button class="icon-button" data-close title="Cerrar" aria-label="Cerrar">${icon('x')}</button></div>${content}`;
  document.body.append(element);
  element.addEventListener('click', event => { if (event.target === element || event.target.closest('[data-close]')) element.close(); });
  element.addEventListener('close', () => element.remove());
  element.showModal(); hydrate();
  return element;
}

function createHome() {
  dialog('Nuevo hogar', `<form id="create-home-form" class="dialog-form"><label>Nombre del cliente<input name="fullName" required maxlength="120" autocomplete="name"></label><label>Correo electrónico<input name="email" type="email" required maxlength="190" autocomplete="off"></label><label>Contraseña inicial<input name="password" type="password" required minlength="10" maxlength="128" autocomplete="new-password"></label><label>Nombre del hogar<input name="householdName" required maxlength="120"></label><label>Dirección<input name="address" maxlength="255"></label><p class="form-error" role="alert"></p><button class="primary" type="submit">${icon('plus')} Crear hogar</button></form>`);
}

function addDevice() {
  dialog('Añadir fuente de datos', `<form id="device-form" class="dialog-form"><label>Identificador del dispositivo<input name="deviceId" required maxlength="100" placeholder="ESP32-RURAL-HOME-001"></label><label>Nombre de la fuente<input name="name" required maxlength="120" placeholder="Sistema solar principal"></label><label class="checkbox"><input type="checkbox" name="claimLegacy"> Asignar también las lecturas antiguas sin propietario de este dispositivo</label><p class="form-error" role="alert"></p><button class="primary" type="submit">${icon('plus')} Asignar dispositivo</button></form>`);
}

function showKey(deviceId, key) {
  dialog('Clave del dispositivo', `<div class="dialog-form"><p class="key-warning">Esta clave se muestra una sola vez. Configúrala como DEVICE_KEY en el simulador. Renovarla invalida la anterior.</p><label>Dispositivo<input value="${esc(deviceId)}" readonly></label><label>DEVICE_KEY<textarea id="device-secret" rows="3" readonly>${esc(key)}</textarea></label><button class="secondary" data-action="copy-key">${icon('copy')} Copiar clave</button></div>`);
}

async function openIncident(id) {
  const incident = await api(`/operator/incidents/${id}`);
  dialog(`Incidencia #${id}`, `<div class="incident-detail"><div class="section-title"><h3>${esc(incident.title)}</h3><span class="severity ${incident.severity}">${severityNames[incident.severity]}</span></div><p>${esc(incident.recommendation)}</p>
    <dl class="trace-data"><div><dt>Detectada</dt><dd>${date(incident.created_at)}</dd></div><div><dt>Lectura</dt><dd>#${incident.telemetry_id}</dd></div><div><dt>Fuente</dt><dd>${esc(incident.reading?.device_id)}</dd></div><div><dt>Tipo</dt><dd>${typeNames[incident.type] || esc(incident.type)}</dd></div><div><dt>Batería registrada</dt><dd>${number(incident.reading?.battery_level, '%')}</dd></div><div><dt>Voltaje registrado</dt><dd>${number(incident.reading?.voltage, 'V')}</dd></div></dl>
    <h3>Seguimiento</h3><ol class="timeline"><li><b>Detección automática</b><small>${date(incident.created_at)}</small><p>Lectura #${incident.telemetry_id}</p></li>${incident.events.map(event => `<li><b>${statusNames[event.status]} · ${esc(event.full_name)}</b><small>${date(event.created_at)}</small><p>${esc(event.note)}</p></li>`).join('')}</ol>
    <form id="incident-event-form" data-id="${id}" class="dialog-form"><label>Estado<select name="status">${Object.entries(statusNames).map(([value, label]) => `<option value="${value}" ${incident.status === value ? 'selected' : ''}>${label}</option>`).join('')}</select></label><label>Nota de seguimiento<textarea name="note" rows="3" required maxlength="3000"></textarea></label><p class="form-error" role="alert"></p><button type="submit" class="primary">${icon('save')} Registrar seguimiento</button></form></div>`);
}

document.addEventListener('submit', async event => {
  const form = event.target;
  if (!(form instanceof HTMLFormElement)) return;
  event.preventDefault();
  const button = form.querySelector('button[type="submit"]');
  if (button.disabled) return;
  button.disabled = true;
  const values = Object.fromEntries(new FormData(form));
  const errorElement = form.querySelector('.form-error');
  if (errorElement) errorElement.textContent = '';
  try {
    if (form.id === 'login-form') {
      const response = await api('/auth/login', { method: 'POST', body: JSON.stringify({ ...values, profile: 'operator' }) });
      state.user = response.user; state.csrf = response.csrfToken;
      await refresh();
    } else if (form.id === 'create-home-form') {
      const response = await api('/operator/households', { method: 'POST', body: JSON.stringify(values) });
      state.selected = response.householdId; state.tab = 'profile';
      form.closest('dialog').close(); await refresh(); toast('Hogar creado.');
    } else if (form.id === 'profile-form') {
      await api(`/operator/households/${state.selected}`, { method: 'PATCH', body: JSON.stringify({ ...values, active: Boolean(values.active) }) });
      await refresh(); toast('Perfil actualizado.');
    } else if (form.id === 'device-form') {
      const response = await api(`/operator/households/${state.selected}/devices`, { method: 'POST', body: JSON.stringify({ ...values, claimLegacy: Boolean(values.claimLegacy) }) });
      await refresh(); showKey(response.deviceId, response.deviceKey);
    } else if (form.id === 'incident-event-form') {
      await api(`/operator/incidents/${form.dataset.id}/events`, { method: 'POST', body: JSON.stringify(values) });
      await openIncident(form.dataset.id); await refresh(); toast('Seguimiento registrado.');
    }
  } catch (error) { if (errorElement?.isConnected) errorElement.textContent = error.message; else toast(error.message); }
  finally { button.disabled = false; }
});

document.addEventListener('click', async event => {
  const target = event.target.closest('button');
  if (!target || (target.type === 'submit' && target.closest('form')) || target.disabled) return;
  try {
    if (target.dataset.home) { state.home = null; await navigate({ selected: Number(target.dataset.home), tab: 'overview' }); }
    if (target.dataset.tab) await navigate({ tab: target.dataset.tab });
    if (target.dataset.period) await navigate({ period: target.dataset.period });
    if (target.dataset.incident) await openIncident(target.dataset.incident);
    const action = target.dataset.action;
    if (action === 'refresh') await refresh();
    if (action === 'create-home') createHome();
    if (action === 'add-device') addDevice();
    if (action === 'logout') {
      await api('/auth/logout', { method: 'POST' });
      Object.assign(state, { user: null, csrf: '', homes: [], selected: null, home: null }); renderLogin();
    }
    if (action === 'copy-key') { await navigator.clipboard.writeText(document.querySelector('#device-secret').value); toast('Clave copiada.'); }
    if (action === 'more-incidents') {
      const response = await api(incidentPath(state.cursor)); state.incidents.push(...response.data); state.cursor = response.nextCursor; renderShell();
    }
    if (target.dataset.deviceKey || target.dataset.deviceToggle) {
      const id = target.dataset.deviceKey || target.dataset.deviceToggle;
      const device = state.home.devices.find(entry => entry.device_id === id);
      const rotate = Boolean(target.dataset.deviceKey);
      if (!confirm(rotate ? '¿Renovar la clave? El simulador necesitará la nueva clave.' : `¿${device.active ? 'Desactivar' : 'Activar'} esta fuente?`)) return;
      const response = await api(`/operator/households/${state.selected}/devices/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify({ active: rotate ? Boolean(device.active) : !device.active, rotateKey: rotate }) });
      await refresh(); if (rotate) showKey(id, response.deviceKey);
    }
  } catch (error) { toast(error.message); }
});

document.addEventListener('input', event => {
  if (event.target.id !== 'home-search') return;
  state.query = event.target.value;
  document.querySelector('.home-list').innerHTML = homeList(); hydrate();
});
document.addEventListener('change', event => {
  const mapping = { 'incident-type': 'type', 'incident-status': 'status', 'incident-sort': 'sort' };
  if (mapping[event.target.id]) void navigate({ [mapping[event.target.id]]: event.target.value });
});

async function boot() {
  try { const response = await api('/auth/me'); state.user = response.user; state.csrf = response.csrfToken;
    if (state.user.role !== 'operator') { state.user = null; renderLogin('Se requiere una cuenta de operador.'); return; }
    await refresh();
  } catch { renderLogin(); }
}

setInterval(() => {
  if (state.user && !document.hidden && state.tab !== 'profile' && !document.querySelector('dialog[open]') && document.activeElement?.id !== 'home-search') void refresh();
}, 10000);
document.addEventListener('visibilitychange', () => { if (!document.hidden && state.user && !document.querySelector('dialog[open]') && state.tab !== 'profile') void refresh(); });
window.addEventListener('online', () => { if (state.user) void refresh(); });
void boot();