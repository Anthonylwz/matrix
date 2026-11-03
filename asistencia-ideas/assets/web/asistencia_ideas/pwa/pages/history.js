// Pantalla de Historial de Asistencias conectada a la API real
import {
  countUp, $, $$, escapeHtml, setActiveSegment, openSheet, closeSheet, ICON_CHEVRON, ICON_CLOSE, showToast,
  parseDay, formatDayLabel, dayParts, weekStart, weekLabel, hhmmToMinutes, formatDuration
} from '../js/utils.js';
import { getHistoryService, getHistoryRangeService, getHistoryPeriodBounds, horaLima } from '../js/api.js';
import { cacheAttendanceHistory, getCachedAttendanceHistory, cacheHistoryCoverage, getHistoryCoverage } from '../js/db.js';
import { icon } from '../js/icons.js';
import { getUser } from '../js/auth.js';
import { getServerKey } from '../js/server-context.js';

let activeFilter = 'todo';
let historyMode = 'calendar'; // se recuerda al volver a la pestaña

const PASOS = [
  { field: 'hora_entrada', label: 'Entrada' },
  { field: 'hora_almuerzo', label: 'Almuerzo' },
  { field: 'hora_regreso_almuerzo', label: 'Retorno' },
  { field: 'hora_salida', label: 'Salida' }
];

const ICON_CHECK = '<svg viewBox="0 0 24 24" aria-hidden="true"><polyline points="20 6 9 17 4 12"/></svg>';

// Contador de registros junto al Large Title
export function titleAccessory() {
  return '<span class="ios-badge badge-neutral" id="history-total-badge">Cargando…</span>';
}

function skeletonRows(n = 5) {
  return `<div class="ios-card ios-card--flush">${Array.from({ length: n }, () => `
    <div class="skeleton-row">
      <span class="skeleton skeleton--block"></span>
      <span class="list-row__main">
        <span class="skeleton skeleton--line skeleton--w60"></span>
      </span>
    </div>`).join('')}</div>`;
}

export function render(container) {
  container.innerHTML = `
    <div class="page">
      <!-- Vista: calendario (por defecto) o lista -->
      <div class="segmented history-mode" role="tablist" aria-label="Vista del historial">
        <button type="button" class="segmented__item mode-btn" data-mode="calendar" role="tab">${icon('calendar')}<span>Calendario</span></button>
        <button type="button" class="segmented__item mode-btn" data-mode="list" role="tab">${icon('history')}<span>Lista</span></button>
      </div>

      <!-- Calendario: cada día con su estado; al tocarlo se abre el detalle -->
      <div id="history-calendar" class="cal">
        <p id="calendar-note" class="text-secondary t-subhead" role="status"></p>
        <div class="cal__legend" aria-hidden="true">
          <span><i class="cal-dot cal-dot--ok"></i>Puntual</span>
          <span><i class="cal-dot cal-dot--late"></i>Tarde</span>
          <span><i class="cal-dot cal-dot--missing"></i>Sin salida</span>
          <span><i class="cal-dot cal-dot--absent"></i>Falta</span>
        </div>
        <div id="cal-months" class="cal__months">${skeletonRows(3)}</div>
      </div>

      <div id="history-list-view" hidden>
      <!-- Filtros temporales -->
      <div class="segmented" role="tablist">
        <button type="button" class="segmented__item filter-btn" data-filter="todo" role="tab">Todos</button>
        <button type="button" class="segmented__item filter-btn" data-filter="hoy" role="tab">Hoy</button>
        <button type="button" class="segmented__item filter-btn" data-filter="semana" role="tab">Últimos 7 días</button>
        <button type="button" class="segmented__item filter-btn" data-filter="mes" role="tab">Últimos 30 días</button>
      </div>
      <p id="history-note" class="text-secondary t-subhead" role="status"></p>

      <!-- Resumen del período -->
      <div id="history-summary" hidden>
        <div class="stats-row">
          <div class="stat-tile stat-tile--green">
            ${icon('calendar', 'stat-tile__icon')}
            <span id="stat-asistencias" class="stat-tile__value">0</span>
            <span class="stat-tile__label">Asistencias</span>
          </div>
          <div class="stat-tile stat-tile--orange">
            ${icon('clock', 'stat-tile__icon')}
            <span id="stat-tardanzas" class="stat-tile__value">0</span>
            <span class="stat-tile__label">Tardanzas</span>
          </div>
          <div class="stat-tile stat-tile--red">
            ${icon('alert', 'stat-tile__icon')}
            <span id="stat-faltas" class="stat-tile__value">0</span>
            <span class="stat-tile__label">Faltas</span>
          </div>
        </div>

        <div class="ios-card chart-card section-gap">
          <div class="chart-card__head">
            <span class="chart-card__title">Horas trabajadas</span>
            <span id="stat-horas" class="chart-card__value">00:00</span>
          </div>
          <div id="history-bars" class="bars" role="img" aria-label="Horas por día"></div>
        </div>
      </div>

      <!-- Lista de registros -->
      <div id="history-list">${skeletonRows()}</div>
      <button id="history-load-more" type="button" class="ios-btn ios-btn-secondary" hidden>Cargar más</button>
      </div>
    </div>

    <!-- Hoja: detalle de un día -->
    <div id="day-sheet" class="sheet-backdrop" hidden>
      <div class="sheet" aria-labelledby="day-sheet-title">
        <div class="sheet__grabber"></div>
        <div class="sheet__header">
          <div>
            <div id="day-sheet-date" class="day-detail__date"></div>
            <h3 id="day-sheet-title" class="sheet__title">Detalle del día</h3>
          </div>
          <button type="button" id="btn-close-day-sheet" class="icon-btn" aria-label="Cerrar">${ICON_CLOSE}</button>
        </div>
        <div id="day-sheet-hours" class="day-detail__hours"></div>
        <div class="ios-card">
          <ol id="day-sheet-timeline" class="timeline" aria-label="Marcaciones del día"></ol>
        </div>
        <div id="day-sheet-status" class="row-between day-detail__status"></div>
      </div>
    </div>
  `;
}

// Estado del día para la fila: texto + variante de color
function dayStatus(item, hoyIso) {
  if (item.estado_general === 'falta' || item.estado_general === 'ausente') return { text: 'Falta', cls: 'absent' };
  if (!item.hora_entrada) return { text: 'Sin entrada', cls: 'missing' };
  if (!item.hora_salida) return item.fecha === hoyIso ? { text: 'En curso', cls: 'live' } : { text: 'Sin salida', cls: 'missing' };
  if (item.estado_entrada && item.estado_entrada.includes('tarde')) return { text: 'Tarde', cls: 'late' };
  return { text: 'Puntual', cls: 'ok' };
}

const hhmm = (v) => (v ? String(v).slice(0, 5) : '');

export async function init() {
  const listContainer = $('#history-list');
  const totalBadge = $('#history-total-badge');
  const summary = $('#history-summary');
  const bars = $('#history-bars');
  const filterBtns = $$('.view:not(.view--leaving) .filter-btn');
  const daySheet = $('#day-sheet');
  const hoyIso = horaLima().slice(0, 10);
  let items = [];
  let listRequest = null;
  const calendarRequest = new AbortController();
  let disposed = false;
  const server = getServerKey();
  const worker = String(getUser()?.id || '');
  const isActive = () => !disposed && server === getServerKey() && worker === String(getUser()?.id || '');
  const loadMore = $('#history-load-more');
  const historyNote = $('#history-note');
  const calendarNote = $('#calendar-note');
  window.addEventListener('hashchange', () => {
    disposed = true;
    listRequest?.abort();
    calendarRequest.abort();
  }, { once: true });
  loadMore?.addEventListener('click', () => fetchHistory(activeFilter, true));

  const findBtn = (f) => filterBtns.find((b) => b.getAttribute('data-filter') === f);
  setActiveSegment(filterBtns, findBtn(activeFilter));

  filterBtns.forEach((btn) => {
    btn.addEventListener('click', () => {
      activeFilter = btn.getAttribute('data-filter');
      setActiveSegment(filterBtns, btn);
      fetchHistory(activeFilter);
    });
  });

  $('#btn-close-day-sheet')?.addEventListener('click', () => closeSheet(daySheet));

  // ── Calendario ──
  const modeBtns = $$('.view:not(.view--leaving) .mode-btn');
  const calView = $('#history-calendar');
  const listView = $('#history-list-view');
  const calMonths = $('#cal-months');
  let calItems = null;
  let calComplete = false;
  let calendarLoading = false;
  let listLoaded = false;
  const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

  function setMode(mode) {
    historyMode = mode;
    setActiveSegment(modeBtns, modeBtns.find((b) => b.dataset.mode === mode));
    if (calView) calView.hidden = mode !== 'calendar';
    if (listView) listView.hidden = mode !== 'list';
    if (mode === 'calendar') loadCalendar();
    else {
      listView?.closest('.view__scroll')?.scrollTo({ top: 0, behavior: 'auto' });
      if (!listLoaded) { listLoaded = true; fetchHistory(activeFilter); }
    }
  }
  modeBtns.forEach((b) => b.addEventListener('click', () => setMode(b.dataset.mode)));

  async function loadCalendar() {
    if (calItems || calendarLoading) return;
    calendarLoading = true;
    let list = null;
    const today = parseDay(hoyIso);
    const start = `${today.getFullYear() - (today.getMonth() < 11 ? 1 : 0)}-${String((today.getMonth() + 1) % 12 + 1).padStart(2, '0')}-01`;
    try {
      const res = await getHistoryRangeService(start, hoyIso, { signal: calendarRequest.signal });
      if (res.cancelled || !isActive()) return;
      if (res.success && res.data && Array.isArray(res.data.historial)) {
        list = res.data.historial;
        calComplete = res.data.range_complete === true;
        await cacheAttendanceHistory(list, { replace: calComplete, from: start, to: hoyIso });
        if (!isActive()) return;
        if (calComplete) await cacheHistoryCoverage(start, hoyIso);
      } else if (res.partialRecords?.length) {
        list = res.partialRecords;
        await cacheAttendanceHistory(list, { replace: false });
      }
    } catch (_) {}
    const online = list !== null;
    if (!list) {
      list = (await getCachedAttendanceHistory()).filter((item) => item.fecha >= start && item.fecha <= hoyIso);
      const coverage = await getHistoryCoverage();
      calComplete = Boolean(coverage && coverage.from <= start && coverage.to >= hoyIso);
    }
    if (!isActive()) return;
    calItems = list || [];
    if (calendarNote) calendarNote.textContent = online
      ? (calComplete ? `Desde ${start} hasta ${hoyIso}.` : 'Descarga parcial: los días sin datos no confirman una falta ni ausencia de marcaciones.')
      : (calComplete ? 'Sin conexión. Se muestra la última copia completa guardada de este rango.' : 'Sin conexión. La copia local puede estar incompleta; un día vacío no confirma una falta.');
    renderCalendar(calItems, !online);
    calendarLoading = false;
  }

  function renderCalendar(list, offline) {
    if (!calMonths) return;
    const byDay = new Map(list.filter((x) => x && x.fecha).map((x) => [x.fecha, x]));
    if (totalBadge) {
      totalBadge.textContent = `${byDay.size} día${byDay.size === 1 ? '' : 's'}${offline ? ' · sin conexión' : ''}`;
      totalBadge.className = 'ios-badge badge-neutral';
    }
    // Meses: desde el primer registro (máximo 12 meses atrás) hasta el mes actual
    const hoy = parseDay(hoyIso);
    let first = new Date(hoy.getFullYear(), hoy.getMonth() - 2, 1);
    const fechas = [...byDay.keys()].sort();
    if (fechas.length) {
      const f = parseDay(fechas[0]);
      const tope = new Date(hoy.getFullYear(), hoy.getMonth() - 11, 1);
      if (f) first = new Date(Math.max(tope, Math.min(first, new Date(f.getFullYear(), f.getMonth(), 1))));
    }
    const months = [];
    for (let d = new Date(first); d <= hoy; d = new Date(d.getFullYear(), d.getMonth() + 1, 1)) months.push(new Date(d));

    const pad = (n) => String(n).padStart(2, '0');
    calMonths.innerHTML = months.map((m) => {
      const y = m.getFullYear(), mo = m.getMonth();
      const days = new Date(y, mo + 1, 0).getDate();
      const lead = new Date(y, mo, 1).getDay(); // domingo = 0
      let cells = '';
      for (let i = 0; i < lead; i++) cells += '<span class="cal-day cal-day--blank" aria-hidden="true"></span>';
      for (let day = 1; day <= days; day++) {
        const iso = `${y}-${pad(mo + 1)}-${pad(day)}`;
        const item = byDay.get(iso);
        const future = iso > hoyIso;
        const st = item ? dayStatus(item, hoyIso) : null;
        // En el calendario la tardanza manda el color del día; si además falta la salida,
        // un punto amarillo lo indica (así no se esconde la tardanza)
        const tarde = Boolean(item && item.estado_entrada && String(item.estado_entrada).includes('tarde'));
        const sinSalida = Boolean(item && item.hora_entrada && !item.hora_salida && iso !== hoyIso);
        const color = !st ? '' : (st.cls === 'absent' ? 'absent' : tarde ? 'late' : st.cls);
        const cls = ['cal-day', color ? `cal-day--${color}` : '', iso === hoyIso ? 'is-today' : '', future ? 'is-future' : ''].filter(Boolean).join(' ');
        const partes = [];
        if (st) {
          partes.push(tarde ? 'Tarde' : st.text);
          if (tarde && sinSalida) partes.push('sin salida');
          if (item.hora_entrada) partes.push(`entrada ${hhmm(item.hora_entrada)}`);
        }
        const label = `${day} de ${MESES[mo]}${partes.length ? `: ${partes.join(', ')}` : ''}`;
        const dot = st ? `<i class="cal-day__dot${sinSalida && color !== 'missing' ? ' cal-day__dot--missing' : ''}"></i>` : '';
        cells += future
          ? `<span class="${cls}" aria-hidden="true">${day}</span>`
          : `<button type="button" class="${cls}" data-day="${iso}" aria-label="${escapeHtml(label)}">${day}${dot}</button>`;
      }
      const isCurrent = y === hoy.getFullYear() && mo === hoy.getMonth();
      return `
        <section class="cal-month"${isCurrent ? ' id="cal-current"' : ''}>
          <h3 class="cal-month__title">${MESES[mo]} de ${y}</h3>
          <div class="cal-grid cal-grid--head" aria-hidden="true"><span>Dom</span><span>Lun</span><span>Mar</span><span>Mié</span><span>Jue</span><span>Vie</span><span>Sáb</span></div>
          <div class="cal-grid">${cells}</div>
        </section>`;
    }).join('');

    // Se muestra el mes actual (como en Instagram, los anteriores quedan arriba)
    requestAnimationFrame(() => {
      const cur = $('#cal-current');
      const scroller = cur && cur.closest('.view__scroll');
      if (cur && scroller && months.length > 1) scroller.scrollTop = cur.offsetTop - 120;
    });
  }

  calMonths?.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-day]');
    if (!btn) return;
    const item = (calItems || []).find((x) => x.fecha === btn.dataset.day);
    if (item) openDay(item);
    else showToast(calComplete ? 'No hay registros para este día en la última consulta guardada.' : 'Este día no tiene datos en la copia disponible. Compruébalo al recuperar conexión.', 'info');
  });

  async function fetchHistory(filtro, append = false) {
    listRequest?.abort();
    const request = new AbortController();
    listRequest = request;
    const previous = append ? [...items] : [];
    if (!append && listContainer) listContainer.innerHTML = skeletonRows();
    if (loadMore) { loadMore.disabled = true; if (!append) loadMore.hidden = true; }
    try {
      const res = await getHistoryService(filtro, { limite: 100, offset: previous.length, signal: request.signal });
      if (res.cancelled || !isActive() || request.signal.aborted || filtro !== activeFilter) return;
      if (res.success && res.data) {
        const list = res.data.historial || [];
        const merged = [...new Map([...previous, ...list].map((item) => [String(item.id), item])).values()];
        await cacheAttendanceHistory(list, { replace: false });
        if (!isActive() || request.signal.aborted) return;
        renderResumen(res.data.resumen || null, merged);
        renderList(merged, false, res.data.meta);
        if (loadMore) loadMore.hidden = res.data.meta?.has_more !== true || !list.length;
        if (historyNote) historyNote.textContent = res.data.meta
          ? (res.data.meta.has_more ? 'El resumen incluye todo el período. Carga más para ver los días restantes.' : 'Todos los registros del período se han cargado.')
          : 'El servidor no informa si la lista está completa. Los registros mostrados pueden ser parciales.';
      } else {
        if (append) { if (historyNote) historyNote.textContent = 'No se pudo cargar la siguiente página. Puedes reintentar.'; }
        else await loadFromCache(filtro);
      }
    } catch (_) {
      if (isActive() && !request.signal.aborted && !append) await loadFromCache(filtro);
    } finally {
      if (loadMore && listRequest === request) loadMore.disabled = false;
    }
  }

  // Sin conexión: la copia local, recortada al período elegido
  function inPeriod(fecha, filtro) {
    if (!fecha || filtro === 'todo') return true;
    if (filtro === 'hoy') return fecha === hoyIso;
    const period = getHistoryPeriodBounds(filtro, hoyIso);
    return !period || (fecha >= period.fecha_inicio && fecha <= period.fecha_fin);
  }

  async function loadFromCache(filtro) {
    const cached = (await getCachedAttendanceHistory())
      .filter((x) => inPeriod(x.fecha, filtro))
      .sort((a, b) => String(b.fecha).localeCompare(String(a.fecha)));
    if (filtro !== activeFilter) return;
    if (!isActive()) return;
    if (loadMore) loadMore.hidden = true;
    if (historyNote) historyNote.textContent = 'Sin conexión. Los totales corresponden sólo a los días guardados; la copia local puede estar incompleta.';
    if (cached.length > 0) {
      renderResumen(null, cached);
      renderList(cached, true);
    } else {
      renderEmpty(true);
    }
  }

  function renderResumen(resumen, list) {
    if (!summary) return;
    if (!list.length) { summary.hidden = true; return; }
    summary.hidden = false;
    const tardes = list.filter((x) => x.estado_entrada && x.estado_entrada.includes('tarde')).length;
    const set = (id, v) => countUp($(id), v);
    set('#stat-asistencias', resumen ? (resumen.total_asistencias ?? list.length) : list.filter((x) => x.hora_entrada).length);
    set('#stat-tardanzas', resumen ? (resumen.total_tardanzas ?? tardes) : tardes);
    set('#stat-faltas', resumen ? (resumen.total_faltas ?? 0) : list.filter((item) => ['falta', 'ausente'].includes(item.estado_general)).length);
    const totalMin = list.reduce((acc, x) => acc + (hhmmToMinutes(x.horas_trabajadas) || 0), 0);
    set('#stat-horas', resumen && resumen.horas_trabajadas ? resumen.horas_trabajadas : formatDuration(totalMin));

    // Barras: los 7 días más recientes, de izquierda (antiguo) a derecha (reciente)
    if (bars) {
      const ultimos = list.slice(0, 7).reverse();
      const max = Math.max(9 * 60, ...ultimos.map((x) => hhmmToMinutes(x.horas_trabajadas) || 0));
      bars.innerHTML = ultimos.map((x, i) => {
        const min = hhmmToMinutes(x.horas_trabajadas) || 0;
        const pct = Math.max(4, Math.round((min / max) * 100));
        const tarde = x.estado_entrada && x.estado_entrada.includes('tarde');
        const cls = ['bar', x.fecha === hoyIso ? 'is-today' : '', tarde ? 'is-late' : ''].join(' ');
        const p = dayParts(x.fecha);
        return `
          <div class="${cls}" title="${escapeHtml(formatDayLabel(x.fecha))}: ${escapeHtml(formatDuration(min))}">
            <span class="bar__fill" data-pct="${pct}" data-delay="${i * 40}"></span>
            <span class="bar__label">${p.semana.slice(0, 1)}</span>
          </div>`;
      }).join('');
      // Alto y retraso de cada barra (dato dinámico, se asigna por código)
      bars.querySelectorAll('.bar__fill').forEach((el) => {
        el.style.height = el.dataset.pct + '%';
        el.style.animationDelay = el.dataset.delay + 'ms';
      });
      bars.setAttribute('aria-label', ultimos.map((x) => `${formatDayLabel(x.fecha)}: ${formatDuration(hhmmToMinutes(x.horas_trabajadas) || 0)}`).join(', '));
    }
  }

  function renderList(list, isOffline = false, meta = null) {
    if (!listContainer) return;
    items = Array.isArray(list) ? list : [];
    if (items.length === 0) { renderEmpty(); return; }

    if (totalBadge) {
      totalBadge.textContent = `${items.length}${meta?.total > items.length ? ` de ${meta.total}` : ''} día${items.length > 1 ? 's' : ''}${isOffline ? ' · copia local' : ''}`;
      totalBadge.className = 'ios-badge badge-neutral';
    }

    // Agrupar por semana (lunes a domingo)
    const grupos = [];
    items.forEach((item, index) => {
      const d = parseDay(item.fecha);
      const key = d ? weekStart(d).getTime() : 'sin-fecha';
      let g = grupos.find((x) => x.key === key);
      if (!g) { g = { key, label: d ? weekLabel(weekStart(d)) : 'Sin fecha', rows: [] }; grupos.push(g); }
      g.rows.push({ item, index });
    });

    listContainer.innerHTML = grupos.map((g) => `
      <div class="list-header">${escapeHtml(g.label)}</div>
      <div class="ios-card ios-card--flush list-group--days">
        ${g.rows.map(({ item, index }) => dayRowHTML(item, index)).join('')}
      </div>
    `).join('');

    listContainer.querySelectorAll('[data-day-index]').forEach((row) => {
      row.addEventListener('click', () => openDay(items[Number(row.dataset.dayIndex)]));
    });
  }

  function dayRowHTML(item, index) {
    const p = dayParts(item.fecha);
    const st = dayStatus(item, hoyIso);
    const entrada = hhmm(item.hora_entrada);
    const salida = hhmm(item.hora_salida);
    let times;
    if (!entrada) times = 'Sin marcaciones';
    else if (!salida) times = item.fecha === hoyIso ? `Desde ${entrada}` : `${entrada} → sin salida`;
    else times = `${entrada} → ${salida}`;

    const meta = [];
    const min = hhmmToMinutes(item.horas_trabajadas);
    if (min) meta.push(formatDuration(min));
    if (item.hora_almuerzo && item.hora_regreso_almuerzo) {
      meta.push(`almuerzo ${formatDuration(hhmmToMinutes(item.hora_regreso_almuerzo) - hhmmToMinutes(item.hora_almuerzo))}`);
    } else if (item.hora_almuerzo) {
      meta.push('en almuerzo');
    }

    return `
      <button type="button" class="list-row" data-day-index="${index}">
        <span class="date-block ${item.fecha === hoyIso ? 'is-today' : ''}" aria-hidden="true">
          <span class="date-block__week">${p.semana}</span>
          <span class="date-block__day">${p.dia}</span>
        </span>
        <span class="list-row__main">
          <span class="day-row__times">${escapeHtml(times)}</span>
          ${meta.length ? `<span class="day-row__meta">${escapeHtml(meta.join(' · '))}</span>` : ''}
        </span>
        <span class="list-row__end">
          <span class="status-chip status-chip--${st.cls}">${st.text}</span>
          ${ICON_CHEVRON}
        </span>
      </button>`;
  }

  function openDay(item) {
    if (!item || !daySheet) return;
    const st = dayStatus(item, hoyIso);
    const min = hhmmToMinutes(item.horas_trabajadas) || 0;
    const fecha = parseDay(item.fecha);
    $('#day-sheet-date').textContent = fecha
      ? fecha.toLocaleDateString('es-PE', { weekday: 'long', day: 'numeric', month: 'long' })
      : item.fecha;
    $('#day-sheet-title').textContent = formatDayLabel(item.fecha);
    $('#day-sheet-hours').innerHTML = `${Math.floor(min / 60)}<small> h </small>${String(min % 60).padStart(2, '0')}<small> min trabajados</small>`;
    $('#day-sheet-timeline').innerHTML = PASOS.map((paso, i) => {
      const hora = hhmm(item[paso.field]);
      const tarde = i === 0 && item.estado_entrada && item.estado_entrada.includes('tarde');
      const cls = ['timeline__step', hora ? 'is-done' : 'is-pending', tarde ? 'is-late' : ''].join(' ');
      return `
        <li class="${cls}">
          <span class="timeline__dot">${hora ? ICON_CHECK : ''}</span>
          <span class="timeline__label">${paso.label}</span>
          <span class="timeline__time">${hora || '--:--'}</span>
          <span class="timeline__note">${tarde ? 'Tarde' : ''}</span>
        </li>`;
    }).join('');
    $('#day-sheet-status').innerHTML = `
      <span class="text-secondary t-subhead">Estado del día</span>
      <span class="status-chip status-chip--${st.cls}">${st.text}</span>`;
    openSheet(daySheet);
  }

  function renderEmpty(offline = false) {
    if (totalBadge) {
      totalBadge.textContent = offline ? 'Sin conexión' : '0 días';
      totalBadge.className = 'ios-badge badge-neutral';
    }
    if (summary) summary.hidden = true;
    if (listContainer) {
      listContainer.innerHTML = `
        <div class="empty-state">
          ${icon('calendar')}
          <div class="empty-state__title">${offline ? 'Sin conexión' : 'Sin registros'}</div>
          <p class="empty-state__text">${offline
            ? 'No se pudo consultar el servidor y no hay registros guardados de este período. Vuelve a intentarlo cuando tengas conexión.'
            : 'No hay marcaciones para este período.'}</p>
        </div>
      `;
    }
  }

  setMode(historyMode);
}
