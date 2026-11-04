import { $, openFormSheet, dismissSheet, closeSheet, showToast } from './utils.js';
import { getUser } from './auth.js';
import { updateProfileService } from './api.js';

// Las dos filas del perfil comparten el mismo comportamiento y conservan sus hojas.
export function bindWorkerContactEditors({ isCurrent, onSaved }) {
  const definitions = [
    { key: 'phone', field: 'telefono', form: '#form-update-phone', input: '#input-new-phone',
      open: '#btn-open-change-phone', close: '#btn-close-phone-modal', submit: '#btn-submit-phone', modal: '#modal-phone',
      valid: value => /^[0-9]{9}$/.test(value), invalid: 'El teléfono debe tener 9 dígitos numéricos.',
      normalize: value => value.replace(/\D/g, '').replace(/^51(?=\d{9}$)/, '').slice(0, 9), success: 'Teléfono actualizado correctamente' },
    { key: 'email', field: 'email', form: '#form-update-email', input: '#input-new-email',
      open: '#btn-open-change-email', close: '#btn-close-email-modal', submit: '#btn-submit-email', modal: '#modal-email',
      valid: value => value === '' || (value.length <= 150 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)),
      invalid: 'Ingresa un correo electrónico válido.', normalize: value => value.trim(), success: 'Correo actualizado correctamente' }
  ];
  for (const definition of definitions) {
    const form = $(definition.form), input = $(definition.input), submit = $(definition.submit), modal = $(definition.modal);
    if (!form || !input || !submit || !modal) continue;
    let original = '', busy = false;
    const value = () => definition.normalize(input.value);
    const paint = () => { submit.disabled = busy || !definition.valid(value()) || value() === original; };
    $(definition.open)?.addEventListener('click', () => {
      if (!isCurrent() || busy) return;
      original = definition.normalize(String(getUser()?.[definition.field] || ''));
      input.value = original;
      paint();
      openFormSheet(modal, form, { onClose: paint });
    });
    $(definition.close)?.addEventListener('click', () => { if (!busy) dismissSheet(modal); });
    input.addEventListener('input', () => {
      if (definition.key === 'phone') input.value = value();
      paint();
    });
    form.addEventListener('submit', async event => {
      event.preventDefault();
      if (busy || !isCurrent()) return;
      const next = value();
      if (!definition.valid(next)) { showToast(definition.invalid, 'warning'); return; }
      if (next === original) return;
      busy = true;
      modal.dataset.dismissible = 'false';
      input.disabled = true;
      submit.textContent = 'Guardando…';
      paint();
      try {
        const result = await updateProfileService({ [definition.field]: next });
        if (result.cancelled || !isCurrent()) return;
        if (!result.success) { showToast(result.message || 'No se pudo actualizar el dato.', 'danger'); return; }
        if (!result.data || !Object.prototype.hasOwnProperty.call(result.data, definition.field)) throw new Error('missing_profile_field');
        await onSaved({ [definition.field]: result.data[definition.field] });
        if (!isCurrent()) return;
        original = definition.normalize(String(result.data[definition.field] || ''));
        busy = false;
        await closeSheet(modal);
        showToast(definition.success, 'success');
      } catch (_) {
        if (isCurrent()) showToast('No se pudo guardar el cambio. Inténtalo nuevamente.', 'danger');
      } finally {
        busy = false;
        delete modal.dataset.dismissible;
        input.disabled = false;
        submit.textContent = 'Guardar';
        paint();
      }
    });
  }
}
