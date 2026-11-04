// Pantalla de Correcciones de Asistencia con datos reales
import { $, showToast, escapeHtml, openFormSheet, closeSheet, dismissSheet, formatDayLabel } from '../js/utils.js';
import { icon, rowIcon } from '../js/icons.js';

// Ícono y color por tipo de corrección
const TIPOS_CORRECCION = {
  olvido_salida: { label: 'Olvidé marcar la salida', icon: 'clock', color: 'orange' },
  error_marcacion: { label: 'Error en la marcación', icon: 'edit', color: 'blue' },
  permiso_no_registrado: { label: 'Permiso no registrado', icon: 'doc', color: 'purple' },
  otro: { label: 'Otra corrección', icon: 'dots', color: 'gray' }
};

const CAMPOS = {
  entrada: 'entrada',
  almuerzo: 'salida a almuerzo',
  regreso_almuerzo: 'retorno de almuerzo',
  salida: 'salida'
};
import { getCorrectionsService, requestCorrectionService } from '../js/api.js';

export function render(container) {
  const hoyStr = new Date().toISOString().split('T')[0];

  container.innerHTML = `
    <div>
      <!-- Lista de solicitudes de corrección -->
      <div class="ios-card ios-card--flush">
        <div class="list-header--row">
          <span class="fw-semibold">Historial de correcciones</span>
          <span id="corrections-count-badge" class="ios-badge badge-neutral">0 solicitudes</span>
        </div>
        <div id="corrections-list">
          <div class="empty-state">
            <span class="spinner spinner--center"></span>
            <p class="empty-state__text">Consultando correcciones...</p>
          </div>
        </div>
      </div>
    </div>

    <!-- Hoja: nueva corrección -->
    <div id="correccion-sheet" class="sheet-backdrop" hidden>
      <div class="sheet" aria-labelledby="correccion-sheet-title">
        <div class="sheet__grabber"></div>
        <div class="sheet__nav">
          <button type="button" id="btn-cancel-correccion" class="nav-btn nav-btn--text">Cancelar</button>
          <h3 id="correccion-sheet-title" class="sheet__nav-title">Nueva corrección</h3>
          <button type="submit" form="correccion-form" id="btn-submit-correccion" class="nav-btn nav-btn--text nav-btn--strong" disabled>
            <span id="btn-corr-text">Enviar</span>
            <span id="btn-corr-spinner" class="spinner" hidden></span>
          </button>
        </div>

        <form id="correccion-form">
          <div class="ios-input-group">
            <label class="ios-label" for="correccion-tipo">Tipo de situación</label>
            <select id="correccion-tipo" class="ios-input" required>
              <option value="olvido_salida">Olvidé marcar salida</option>
              <option value="error_marcacion">Error en hora o marcación</option>
              <option value="permiso_no_registrado">Permiso no registrado</option>
              <option value="otro">Otro motivo</option>
            </select>
          </div>

          <div class="grid-2">
            <div class="ios-input-group">
              <label class="ios-label" for="correccion-fecha">Fecha</label>
              <input type="date" id="correccion-fecha" class="ios-input" value="${hoyStr}" max="${hoyStr}" required>
            </div>
            <div class="ios-input-group" id="group-hora-propuesta">
              <label class="ios-label" for="correccion-hora">Hora propuesta</label>
              <input type="time" id="correccion-hora" class="ios-input" required>
            </div>
          </div>

          <div class="ios-input-group" id="group-campo-corregir">
            <label class="ios-label" for="correccion-campo">Campo a corregir</label>
            <select id="correccion-campo" class="ios-input" required>
              <option value="salida">Hora de salida</option>
              <option value="entrada">Hora de entrada</option>
              <option value="almuerzo">Salida a almuerzo</option>
              <option value="regreso_almuerzo">Regreso de almuerzo</option>
              <option value="ninguno">Ninguno / General</option>
            </select>
          </div>

          <div class="ios-input-group">
            <label class="ios-label" for="correccion-desc">Explicación</label>
            <textarea id="correccion-desc" class="ios-input" rows="3" placeholder="Explica qué ocurrió para la revisión del administrador" required></textarea>
          </div>
        </form>
      </div>
    </div>
  `;
}

export async function init() {
  // El "+" vive en la barra de navegación de Solicitudes
  const addBtn = $('#btn-nav-add');
  const cancelBtn = $('#btn-cancel-correccion');
  const sheet = $('#correccion-sheet');
  const form = $('#correccion-form');
  const descInput = $('#correccion-desc');
  const selectTipo = $('#correccion-tipo');
  const selectCampo = $('#correccion-campo');
  const groupHora = $('#group-hora-propuesta');
  const groupCampo = $('#group-campo-corregir');
  const listContainer = $('#corrections-list');
  const countBadge = $('#corrections-count-badge');
  const submitBtn = $('#btn-submit-correccion');
  const btnText = $('#btn-corr-text');
  const btnSpinner = $('#btn-corr-spinner');

  // "Enviar" se habilita cuando la explicación tiene texto
  const updateSubmitState = () => {
    if (submitBtn) submitBtn.disabled = !(descInput && descInput.value.trim());
  };
  form?.addEventListener('input', updateSubmitState);

  if (addBtn && sheet && form) {
    addBtn.addEventListener('click', () => {
      openFormSheet(sheet, form, {
        onClose: () => {
          setCamposVisibles(true);
          updateSubmitState();
        }
      });
    });
  }

  if (cancelBtn) cancelBtn.addEventListener('click', () => dismissSheet(sheet));

  function setCamposVisibles(visible) {
    if (groupHora) groupHora.hidden = !visible;
    if (groupCampo) groupCampo.hidden = !visible;
    // Un campo oculto con "required" impide enviar el formulario
    const horaInput = $('#correccion-hora');
    if (horaInput) { horaInput.required = visible; if (!visible) horaInput.value = ''; }
  }

  // Ajustar campos según tipo seleccionado
  if (selectTipo) {
    selectTipo.addEventListener('change', () => {
      const val = selectTipo.value;
      if (val === 'olvido_salida') {
        if (selectCampo) selectCampo.value = 'salida';
        setCamposVisibles(true);
      } else if (val === 'permiso_no_registrado' || val === 'otro') {
        if (selectCampo) selectCampo.value = 'ninguno';
        setCamposVisibles(false);
      } else {
        setCamposVisibles(true);
      }
    });
  }

  // Cargar solicitudes de corrección desde la API
  async function loadCorrections() {
    try {
      const res = await getCorrectionsService();
      if (res.success && res.data && Array.isArray(res.data.correcciones)) {
        renderCorrectionsList(res.data.correcciones);
      } else {
        renderEmpty(true);
      }
    } catch (_) {
      renderEmpty(true);
    }
  }

  function renderCorrectionsList(items) {
    if (!listContainer) return;
    if (items.length === 0) {
      renderEmpty();
      return;
    }

    if (countBadge) {
      countBadge.textContent = `${items.length} solicitud${items.length > 1 ? 'es' : ''}`;
    }

    listContainer.innerHTML = items.map((c) => {
      const tipo = TIPOS_CORRECCION[c.tipo_correccion] || TIPOS_CORRECCION.otro;
      const fecha = c.fecha_referencia ? formatDayLabel(c.fecha_referencia) : 'Sin fecha';
      const campo = CAMPOS[c.campo_corregir] || '';
      const horaProp = c.hora_propuesta ? `propone ${c.hora_propuesta.slice(0, 5)}` : '';
      const meta = [fecha, campo, horaProp].filter(Boolean).join(' · ');

      return `
        <div class="request-row">
          ${rowIcon(tipo.icon, tipo.color)}
          <div class="request-row__main">
            <div class="request-row__top">
              <span class="request-row__title">${escapeHtml(tipo.label)}</span>
              ${estadoChip(c.estado)}
            </div>
            <div class="request-row__meta">${escapeHtml(meta)}</div>
            ${c.descripcion ? `<p class="request-row__text">${escapeHtml(c.descripcion)}</p>` : ''}
            ${c.respuesta_admin ? `
              <div class="reply"><span class="reply__who">Respuesta del administrador</span>${escapeHtml(c.respuesta_admin)}</div>
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
          ${icon('edit')}
          <div class="empty-state__title">Sin correcciones</div>
          <p class="empty-state__text">Si olvidaste marcar o hubo un error, toca + para avisar.</p>
        </div>
      `;
    }
  }

  // Sin conexión no se sabe si hay correcciones: no decir "Sin correcciones"
  function renderLoadError() {
    if (countBadge) countBadge.textContent = 'Sin conexión';
    if (listContainer) {
      listContainer.innerHTML = `
        <div class="empty-state">
          ${icon('edit')}
          <div class="empty-state__title">No se pudo cargar</div>
          <p class="empty-state__text">Revisa tu conexión y vuelve a abrir esta pantalla para ver tus correcciones.</p>
        </div>
      `;
    }
  }

  function estadoChip(estado) {
    if (estado === 'aprobada' || estado === 'aprobado') return '<span class="status-chip status-chip--ok">Aprobada</span>';
    if (estado === 'rechazada' || estado === 'rechazado') return '<span class="status-chip status-chip--missing">Rechazada</span>';
    return '<span class="status-chip status-chip--pending">Pendiente</span>';
  }


  // Enviar formulario de corrección
  if (form) {
    form.addEventListener('submit', async (e) => {
      e.preventDefault();

      const tipo = $('#correccion-tipo')?.value || 'olvido_salida';
      const fecha = $('#correccion-fecha')?.value || '';
      const hora = $('#correccion-hora')?.value || '';
      const campo = $('#correccion-campo')?.value || 'salida';
      const desc = $('#correccion-desc')?.value.trim() || '';

      if (!fecha) {
        showToast('Debes seleccionar la fecha del suceso.', 'warning');
        return;
      }
      if (!desc) {
        showToast('Por favor describe el motivo de la corrección.', 'warning');
        return;
      }

      if ((tipo === 'olvido_salida' || tipo === 'error_marcacion') && !hora) {
        showToast('Debes proponer la hora que corresponde.', 'warning');
        return;
      }

      if (submitBtn) submitBtn.disabled = true;
      if (btnText) btnText.hidden = true;
      if (btnSpinner) btnSpinner.hidden = false;

      try {
        const res = await requestCorrectionService({
          tipo_correccion: tipo,
          fecha_referencia: fecha,
          campo_corregir: campo,
          hora_propuesta: hora,
          descripcion: desc
        });

        if (res.success) {
          showToast(res.message || 'Solicitud de corrección enviada con éxito', 'success');
          closeSheet(sheet); // al cerrarse reinicia el formulario
          await loadCorrections();
        } else {
          showToast(res.message || 'No se pudo enviar la corrección', 'danger');
        }
      } catch (_) {
        showToast('Error de conexión con el servidor', 'danger');
      } finally {
        if (btnText) btnText.hidden = false;
        if (btnSpinner) btnSpinner.hidden = true;
        updateSubmitState();
      }
    });
  }

  loadCorrections();
}
