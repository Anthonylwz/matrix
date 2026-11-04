// Pestaña Solicitudes: une Permisos y Correcciones con un control segmentado
import { $, setActiveSegment } from '../js/utils.js';
import { getRouteParams, replaceRouteParams } from '../js/router.js';
import * as Permissions from './permissions.js';
import * as Corrections from './corrections.js';

const sections = {
  permisos: Permissions,
  correcciones: Corrections
};

export function navActions() {
  return `
    <button type="button" id="btn-nav-add" class="nav-btn" aria-label="Nueva solicitud">
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>
    </button>
  `;
}

export function render(container) {
  container.innerHTML = `
    <div class="page">
      <div class="segmented" role="tablist" aria-label="Tipo de solicitud">
        <button type="button" class="segmented__item" data-section="permisos" role="tab">Permisos</button>
        <button type="button" class="segmented__item" data-section="correcciones" role="tab">Correcciones</button>
      </div>
      <div id="requests-body"></div>
    </div>
  `;
}

export function init() {
  const body = $('#requests-body');
  const segments = Array.from(document.querySelectorAll('.view:not(.view--leaving) [data-section]'));

  function show(section) {
    const key = sections[section] ? section : 'permisos';
    setActiveSegment(segments, segments.find((s) => s.dataset.section === key));

    // El botón "+" de la barra cambia de dueño: se reemplaza para soltar el listener anterior
    const addBtn = $('#btn-nav-add');
    if (addBtn) {
      addBtn.replaceWith(addBtn.cloneNode(true));
      $('#btn-nav-add').setAttribute('aria-label', key === 'permisos' ? 'Nuevo permiso' : 'Nueva corrección');
    }

    if (body) {
      sections[key].render(body);
      sections[key].init();
    }
    replaceRouteParams(key === 'permisos' ? {} : { tab: key });
  }

  segments.forEach((seg) => {
    seg.addEventListener('click', () => {
      if (!seg.classList.contains('is-active')) show(seg.dataset.section);
    });
  });

  show(getRouteParams().get('tab') || 'permisos');
}
