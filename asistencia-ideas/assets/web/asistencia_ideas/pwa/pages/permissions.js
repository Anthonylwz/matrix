// Pantalla de Permisos y Salidas Temporales con datos reales
import { $, showToast, escapeHtml, formatTime, openFormSheet, closeSheet, dismissSheet, formatDayLabel, parseDay } from '../js/utils.js';
import { horaLima } from '../js/api.js';
import { icon, rowIcon } from '../js/icons.js';

// Ícono y color por tipo de permiso
const TIPOS_PERMISO = {
  personal: { label: 'Asunto personal', icon: 'user', color: 'indigo' },
  salud: { label: 'Salud / Cita médica', icon: 'heart', color: 'red' },
  tramite: { label: 'Trámite documentario', icon: 'stamp', color: 'teal' },
  comision: { label: 'Comisión de servicio', icon: 'briefcase', color: 'blue' },
  emergencia: { label: 'Emergencia familiar', icon: 'alert', color: 'orange' },
  otro: { label: 'Otro motivo', icon: 'dots', color: 'gray' }
};
import { getPermissionsService, requestPermissionService } from '../js/api.js';

export function render(container) {
  // Calcular horas sugeridas por defecto
  const ahora = new Date();
  const horaSalidaDefecto = formatTime(ahora);
  const horaRetornoDefecto = formatTime(new Date(ahora.getTime() + 60 * 60 * 1000));

  const hoyIso = horaLima().slice(0, 10);
  const maxIso = horaLima(new Date(Date.now() + 60 * 86400000)).slice(0, 10);

  container.innerHTML = `
    <div>
      <!-- Calendario: avisar con tiempo (toca un día para pedir permiso) -->
      <div class="ios-card perm-cal-card">
        <div class="perm-cal-card__head">
          <span class="fw-semibold">Planifica tus permisos</span>
          <span class="perm-cal-card__hint">Toca un día para avisar</span>
        </div>
        <div class="cal__legend" aria-hidden="true">
          <span><i class="cal-dot cal-dot--ok"></i>Aprobado</span>
          <span><i class="cal-dot cal-dot--late"></i>Pendiente</span>
          <span><i class="cal-dot cal-dot--rejected"></i>Rechazado</span>
        </div>
        <div id="perm-cal" class="cal__months"></div>
      </div>

      <!-- Lista de solicitudes de permisos -->
      <div class="ios-card ios-card--flush">
        <div class="list-header--row">
          <span class="fw-semibold">Mis solicitudes</span>
          <span id="permissions-count-badge" class="ios-badge badge-neutral">0 solicitudes</span>
        </div>
        <div id="permissions-list">
          <div class="empty-state">
            <span class="spinner spinner--center"></span>
            <p class="empty-state__text">Consultando solicitudes...</p>
          </div>
        </div>
      </div>
    </div>

    <!-- Hoja: nuevo permiso -->
    <div id="permiso-sheet" class="sheet-backdrop" hidden>
      <div class="sheet" aria-labelledby="permiso-sheet-title">
        <div class="sheet__grabber"></div>
        <div class="sheet__nav">
          <button type="button" id="btn-cancel-permiso" class="nav-btn nav-btn--text">Cancelar</button>
          <h3 id="permiso-sheet-title" class="sheet__nav-title">Nuevo permiso</h3>
          <button type="submit" form="permiso-form" id="btn-submit-permiso" class="nav-btn nav-btn--text nav-btn--strong" disabled>
            <span id="btn-permiso-text">Enviar</span>
            <span id="btn-permiso-spinner" class="spinner" hidden></span>
          </button>
        </div>

        <form id="permiso-form">
          <div class="ios-input-group">
            <label class="ios-label" for="permiso-tipo">Tipo de permiso</label>
            <select id="permiso-tipo" class="ios-input" required>
              <option value="personal">Asunto personal</option>
              <option value="salud">Salud / Cita médica</option>
              <option value="tramite">Trámite documentario</option>
              <option value="comision">Comisión de servicio</option>
              <option value="emergencia">Emergencia familiar</option>
              <option value="otro">Otro motivo</option>
            </select>
          </div>

          <div class="ios-input-group">
            <label class="ios-label" for="permiso-fecha">Día del permiso</label>
            <input type="date" id="permiso-fecha" class="ios-input" value="${hoyIso}" min="${hoyIso}" max="${maxIso}" required>
            <span id="permiso-fecha-hint" class="field-hint">Hoy</span>
          </div>

          <label for="permiso-dia-completo" class="list-row perm-full-day">
            <span class="list-row__main">
              <span>Todo el día (no asistiré)</span>
              <span class="list-row__sub">Para avisar con tiempo una falta justificada</span>
            </span>
            <input type="checkbox" id="permiso-dia-completo" class="ios-switch" role="switch">
          </label>

          <div class="grid-2" id="permiso-horas">
            <div class="ios-input-group">
              <label class="ios-label" for="permiso-hora-salida">Hora de salida</label>
              <input type="time" id="permiso-hora-salida" class="ios-input" value="${horaSalidaDefecto}" required>
            </div>
            <div class="ios-input-group">
              <label class="ios-label" for="permiso-hora-retorno">Hora de retorno</label>
              <input type="time" id="permiso-hora-retorno" class="ios-input" value="${horaRetornoDefecto}" required>
            </div>
          </div>

          <div class="ios-input-group">
            <label class="ios-label" for="permiso-motivo">Motivo o justificación</label>
            <textarea id="permiso-motivo" class="ios-input" rows="3" placeholder="Describe brevemente la razón de la salida temporal" required></textarea>
          </div>
        </form>
      </div>
    </div>
  `;
}

export async function init() {
  // El "+" vive en la barra de navegación de Solicitudes
  const addBtn = $('#btn-nav-add');
  const cancelBtn = $('#btn-cancel-permiso');
  const sheet = $('#permiso-sheet');
  const form = $('#permiso-form');
  const motivoInput = $('#permiso-motivo');
  const listContainer = $('#permissions-list');
  const countBadge = $('#permissions-count-badge');
  const submitBtn = $('#btn-submit-permiso');
  const btnText = $('#btn-permiso-text');
  const btnSpinner = $('#btn-permiso-spinner');

  // "Enviar" se habilita cuando el motivo tiene texto
  const updateSubmitState = () => {
    if (submitBtn) submitBtn.disabled = !(motivoInput && motivoInput.value.trim());
  };
  form?.addEventListener('input', updateSubmitState);

  // ── Fecha y día completo ──
  const hoyIso = horaLima().slice(0, 10);
  const fechaInput = $('#permiso-fecha');
  const fechaHint = $('#permiso-fecha-hint');
  const diaCompleto = $('#permiso-dia-completo');
  const horas = $('#permiso-horas');
  const DIAS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
  const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
  const paintFecha = () => {
    if (!fechaInput || !fechaHint) return;
    const d = parseDay(fechaInput.value);
    if (!d) { fechaHint.textContent = ''; return; }
    const dias = Math.round((d - parseDay(hoyIso)) / 86400000);
    const rel = dias === 0 ? 'Hoy' : dias === 1 ? 'Mañana' : `En ${dias} días`;
    fechaHint.textContent = `${rel} · ${DIAS[d.getDay()]} ${d.getDate()} de ${MESES[d.getMonth()]}`;
  };
  const paintDiaCompleto = () => {
    if (horas) horas.hidden = Boolean(diaCompleto && diaCompleto.checked);
    if (motivoInput) motivoInput.placeholder = diaCompleto && diaCompleto.checked
      ? 'Explica por qué no asistirás ese día (ej.: cita médica, viaje, trámite)'
      : 'Describe brevemente la razón de la salida temporal';
  };
  fechaInput?.addEventListener('change', paintFecha);
  diaCompleto?.addEventListener('change', paintDiaCompleto);

  function openRequest(fechaIso) {
    if (!sheet || !form) return;
    openFormSheet(sheet, form, { onClose: () => { updateSubmitState(); if (fechaInput) fechaInput.value = hoyIso; if (diaCompleto) diaCompleto.checked = false; paintFecha(); paintDiaCompleto(); } });
    if (fechaInput && fechaIso) fechaInput.value = fechaIso;
    // Un día futuro suele ser una falta completa: se sugiere activar "Todo el día"
    if (diaCompleto) diaCompleto.checked = Boolean(fechaIso && fechaIso > hoyIso);
    paintFecha();
    paintDiaCompleto();
  }

  if (addBtn && sheet && form) {
    addBtn.addEventListener('click', () => openRequest(hoyIso));
  }

  // ── Calendario de permisos (mes actual y siguiente) ──
  const calBox = $('#perm-cal');
  let permisos = [];
  function renderPermCalendar() {
    if (!calBox) return;
    const byDay = new Map();
    permisos.forEach((p) => { if (p.fecha) (byDay.get(p.fecha) || byDay.set(p.fecha, []).get(p.fecha)).push(p); });
    const hoy = parseDay(hoyIso);
    const pad = (n) => String(n).padStart(2, '0');
    const maxIso = horaLima(new Date(Date.now() + 60 * 86400000)).slice(0, 10);
    calBox.innerHTML = [0, 1].map((k) => {
      const m = new Date(hoy.getFullYear(), hoy.getMonth() + k, 1);
      const y = m.getFullYear(), mo = m.getMonth();
      const days = new Date(y, mo + 1, 0).getDate();
      let cells = '';
      for (let i = 0; i < m.getDay(); i++) cells += '<span class="cal-day cal-day--blank" aria-hidden="true"></span>';
      for (let day = 1; day <= days; day++) {
        const iso = `${y}-${pad(mo + 1)}-${pad(day)}`;
        const lista = byDay.get(iso) || [];
        const estado = lista.some((p) => p.estado === 'aprobado') ? 'ok'
          : lista.some((p) => !p.estado || p.estado === 'pendiente') ? 'late'
          : lista.length ? 'rejected' : '';
        const pasado = iso < hoyIso;
        const fuera = iso > maxIso;
        const cls = ['cal-day', estado ? `cal-day--${estado}` : '', iso === hoyIso ? 'is-today' : '', (pasado || fuera) && !estado ? 'is-future' : ''].filter(Boolean).join(' ');
        const label = `${day} de ${MESES[mo]}${lista.length ? `: ${lista.length} permiso${lista.length > 1 ? 's' : ''}` : ''}`;
        cells += (pasado && !estado) || fuera
          ? `<span class="${cls}" aria-hidden="true">${day}</span>`
          : `<button type="button" class="${cls}" data-perm-day="${iso}" aria-label="${escapeHtml(label)}">${day}${estado ? '<i class="cal-day__dot"></i>' : ''}</button>`;
      }
      return `
        <section class="cal-month">
          <h3 class="cal-month__title">${MESES[mo]} de ${y}</h3>
          <div class="cal-grid cal-grid--head" aria-hidden="true"><span>Dom</span><span>Lun</span><span>Mar</span><span>Mié</span><span>Jue</span><span>Vie</span><span>Sáb</span></div>
          <div class="cal-grid">${cells}</div>
        </section>`;
    }).join('');
  }
  calBox?.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-perm-day]');
    if (!btn) return;
    const iso = btn.dataset.permDay;
    const lista = permisos.filter((p) => p.fecha === iso);
    if (lista.length) {
      // Ya hay permiso ese día: se muestra en la lista
      const row = listContainer && listContainer.querySelector(`[data-perm-id="${lista[0].id}"]`);
      if (row) { row.scrollIntoView({ behavior: 'smooth', block: 'center' }); row.classList.remove('is-flash'); void row.offsetWidth; row.classList.add('is-flash'); }
      if (iso >= hoyIso && !lista.some((p) => (p.motivo || '').startsWith('[Día completo]') && p.estado !== 'rechazado')) {
        showToast('Ya tienes un permiso ese día. Toca + si necesitas otro.', 'info');
      }
      return;
    }
    if (iso < hoyIso) return;
    openRequest(iso);
  });
  renderPermCalendar();

  if (cancelBtn) cancelBtn.addEventListener('click', () => dismissSheet(sheet));

  // Cargar lista de permisos desde la API
  async function loadPermissions() {
    try {
      const res = await getPermissionsService();
      if (res.success && res.data && Array.isArray(res.data.permisos)) {
        permisos = res.data.permisos;
        renderPermCalendar();
        renderPermissionsList(res.data.permisos);
      } else {
        renderEmpty(true);
      }
    } catch (_) {
      renderEmpty(true);
    }
  }

  function renderPermissionsList(items) {
    if (!listContainer) return;
    if (items.length === 0) {
      renderEmpty();
      return;
    }

    if (countBadge) {
      countBadge.textContent = `${items.length} solicitud${items.length > 1 ? 'es' : ''}`;
    }

    listContainer.innerHTML = items.map((p) => {
      const hSalida = p.hora_salida_estimada ? p.hora_salida_estimada.slice(0, 5) : '--:--';
      const hRetorno = p.hora_retorno_estimada ? p.hora_retorno_estimada.slice(0, 5) : '--:--';
      const tipo = TIPOS_PERMISO[p.tipo_permiso] || TIPOS_PERMISO.otro;
      const fecha = p.fecha ? formatDayLabel(p.fecha) : 'Sin fecha';
      const completo = (p.motivo || '').startsWith('[Día completo]');
      const motivo = completo ? p.motivo.replace('[Día completo]', '').trim() : p.motivo;

      return `
        <div class="request-row" data-perm-id="${p.id}">
          ${rowIcon(completo ? 'calendarx' : tipo.icon, completo ? 'purple' : tipo.color)}
          <div class="request-row__main">
            <div class="request-row__top">
              <span class="request-row__title">${escapeHtml(completo ? `Falta avisada · ${tipo.label}` : tipo.label)}</span>
              ${estadoChip(p.estado)}
            </div>
            <div class="request-row__meta tabular">${escapeHtml(fecha)} · ${completo ? 'Todo el día' : `${hSalida} – ${hRetorno}`}</div>
            ${motivo ? `<p class="request-row__text">${escapeHtml(motivo)}</p>` : ''}
            ${p.observacion_admin ? `
              <div class="reply"><span class="reply__who">Respuesta del administrador</span>${escapeHtml(p.observacion_admin)}</div>
            ` : ''}
          </div>
        </div>
      `;
    }).join('');
  }

  function renderEmpty(failed = false) {
    if (failed) return renderLoadError();
    if (countBadge) countBadge.textContent = '0 solicitudes';
    if (listContainer) {
      listContainer.innerHTML = `
        <div class="empty-state">
          ${icon('doc')}
          <div class="empty-state__title">Sin permisos</div>
          <p class="empty-state__text">Toca + para pedir una salida temporal o una cita.</p>
        </div>
      `;
    }
  }

  // Sin conexión no se sabe si hay permisos: no decir "Sin permisos"
  function renderLoadError() {
    if (countBadge) countBadge.textContent = 'Sin conexión';
    if (listContainer) {
      listContainer.innerHTML = `
        <div class="empty-state">
          ${icon('doc')}
          <div class="empty-state__title">No se pudo cargar</div>
          <p class="empty-state__text">Revisa tu conexión y vuelve a abrir esta pantalla para ver tus permisos.</p>
        </div>
      `;
    }
  }

  function estadoChip(estado) {
    switch (estado) {
      case 'aprobado': return '<span class="status-chip status-chip--ok">Aprobado</span>';
      case 'rechazado': return '<span class="status-chip status-chip--missing">Rechazado</span>';
      default: return '<span class="status-chip status-chip--pending">Pendiente</span>';
    }
  }

  // Enviar nueva solicitud de permiso
  if (form) {
    form.addEventListener('submit', async (e) => {
      e.preventDefault();

      const tipo = $('#permiso-tipo')?.value || 'personal';
      const hSalida = $('#permiso-hora-salida')?.value || '';
      const hRetorno = $('#permiso-hora-retorno')?.value || '';
      const motivo = $('#permiso-motivo')?.value.trim() || '';
      const fecha = fechaInput ? fechaInput.value : hoyIso;
      const completo = Boolean(diaCompleto && diaCompleto.checked);

      if (!fecha || fecha < hoyIso) {
        showToast('Elige hoy o un día futuro.', 'warning');
        return;
      }
      if (!completo && (!hSalida || !hRetorno)) {
        showToast('Debes indicar hora de salida y de retorno.', 'warning');
        return;
      }
      if (!motivo) {
        showToast('El motivo es obligatorio.', 'warning');
        return;
      }

      if (submitBtn) submitBtn.disabled = true;
      if (btnText) btnText.hidden = true;
      if (btnSpinner) btnSpinner.hidden = false;

      try {
        const res = await requestPermissionService({
          tipo_permiso: tipo,
          hora_salida_estimada: completo ? '' : hSalida,
          hora_retorno_estimada: completo ? '' : hRetorno,
          motivo: motivo,
          fecha,
          dia_completo: completo
        });

        if (res.success) {
          showToast(completo
            ? 'Falta avisada. Recursos Humanos la revisará y te llegará la respuesta.'
            : (res.message || 'Solicitud de permiso enviada'), 'success');
          closeSheet(sheet); // al cerrarse reinicia el formulario
          await loadPermissions();
        } else {
          showToast(res.message || 'No se pudo registrar la solicitud', 'danger');
        }
      } catch (_) {
        showToast('Error de conexión al enviar el permiso', 'danger');
      } finally {
        if (btnText) btnText.hidden = false;
        if (btnSpinner) btnSpinner.hidden = true;
        updateSubmitState();
      }
    });
  }

  loadPermissions();
}
