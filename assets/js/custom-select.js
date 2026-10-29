/* Keep native select values and form submission, render an app-styled menu. */
(() => {
  const controls = new WeakMap();
  let nextId = 0;
  let opened = null;
  let refreshing = false;
  let searchText = '';
  let searchTimer;

  function close() {
    if (!opened) return;
    const control = opened;
    opened = null;
    control.button.setAttribute('aria-expanded', 'false');
    control.button.removeAttribute('aria-activedescendant');
    if (control.menu.isConnected && control.menu.matches(':popover-open')) control.menu.hidePopover();
    control.menu.remove();
    clearTimeout(searchTimer);
    searchText = '';
  }

  function position(control) {
    const rect = control.button.getBoundingClientRect();
    const margin = 10;
    const below = window.innerHeight - rect.bottom - margin - 6;
    const above = rect.top - margin - 6;
    const upwards = below < 180 && above > below;
    const height = Math.max(40, Math.min(280, upwards ? above : below));
    const width = Math.min(Math.max(rect.width, 160), window.innerWidth - margin * 2);
    Object.assign(control.menu.style, {
      width: `${width}px`, maxHeight: `${height}px`,
      left: `${Math.max(margin, Math.min(rect.left, window.innerWidth - width - margin))}px`,
      top: upwards ? 'auto' : `${rect.bottom + 6}px`,
      bottom: upwards ? `${window.innerHeight - rect.top + 6}px` : 'auto'
    });
  }

  function activate(control, index) {
    const options = Array.from(control.select.options);
    if (!options[index] || options[index].disabled || options[index].parentElement.disabled) return;
    control.activeIndex = index;
    control.menu.querySelectorAll('[role=option]').forEach(option => {
      option.classList.toggle('is-active', Number(option.dataset.index) === index);
    });
    const option = control.menu.querySelector(`[data-index="${index}"]`);
    if (option) {
      control.button.setAttribute('aria-activedescendant', option.id);
      option.scrollIntoView({block:'nearest'});
    }
  }

  function commit(control, index) {
    const option = control.select.options[index];
    if (!option || option.disabled || option.parentElement.disabled) return;
    const changed = control.select.selectedIndex !== index;
    control.select.selectedIndex = index;
    sync(control);
    close();
    control.button.focus({preventScroll:true});
    if (changed) {
      control.select.dispatchEvent(new Event('input', {bubbles:true}));
      control.select.dispatchEvent(new Event('change', {bubbles:true}));
      // Some screens rebuild their form when a selection changes.
      queueMicrotask(() => {
        refresh();
        const replacement = control.select.isConnected ? control.select
          : control.select.id ? document.getElementById(control.select.id) : null;
        controls.get(replacement)?.button.focus({preventScroll:true});
      });
    }
  }

  function open(control, direction = 1) {
    if (control.select.disabled) return;
    close();
    sync(control);
    const menu = document.createElement('div');
    menu.id = control.menuId;
    menu.className = 'custom-select-menu';
    menu.setAttribute('popover', 'manual');
    menu.setAttribute('role', 'listbox');
    menu.setAttribute('aria-label', control.button.getAttribute('aria-label'));
    let group = null;
    Array.from(control.select.options).forEach((option, index) => {
      if (option.hidden) return;
      const parent = option.parentElement;
      if (parent.tagName === 'OPTGROUP' && group !== parent) {
        const heading = document.createElement('div');
        heading.className = 'custom-select-group';
        heading.textContent = parent.label;
        menu.append(heading);
        group = parent;
      }
      const row = document.createElement('div');
      row.id = `${control.menuId}-${index}`;
      row.dataset.index = index;
      row.className = 'custom-select-option';
      row.setAttribute('role', 'option');
      row.setAttribute('aria-selected', String(option.selected));
      row.setAttribute('aria-disabled', String(option.disabled || !!parent.disabled));
      const label = document.createElement('span');
      label.textContent = option.label;
      const check = document.createElement('span');
      check.className = 'custom-select-check';
      check.setAttribute('aria-hidden', 'true');
      check.textContent = '✓';
      row.append(label, check);
      row.addEventListener('pointerdown', event => event.preventDefault());
      row.addEventListener('pointermove', () => activate(control, index));
      row.addEventListener('click', event => { event.preventDefault(); commit(control, index); });
      menu.append(row);
    });
    if (!menu.querySelector('[role=option]')) {
      const empty = document.createElement('div');
      empty.className = 'custom-select-empty';
      empty.textContent = 'No options available';
      menu.append(empty);
    }
    control.menu = menu;
    // A popover enters the top layer, including when its trigger is in a dialog.
    (control.button.closest('dialog') || document.body).append(menu);
    opened = control;
    position(control);
    menu.showPopover();
    control.button.setAttribute('aria-expanded', 'true');
    const enabled = enabledIndices(control);
    const selected = enabled.includes(control.select.selectedIndex) ? control.select.selectedIndex
      : direction < 0 ? enabled.at(-1) : enabled[0];
    activate(control, selected);
  }

  function enabledIndices(control) {
    return Array.from(control.select.options).flatMap((option, index) =>
      !option.disabled && !option.hidden && !option.parentElement.disabled ? [index] : []);
  }

  function keydown(event, control) {
    if (event.key === 'Escape' && opened === control) {
      event.preventDefault(); event.stopPropagation(); close(); return;
    }
    if (event.key === 'Tab') { close(); return; }
    if (['Enter',' '].includes(event.key)) {
      event.preventDefault();
      if (opened === control) commit(control, control.activeIndex);
      else open(control);
      return;
    }
    if (['ArrowDown','ArrowUp','Home','End'].includes(event.key)) {
      event.preventDefault();
      const direction = event.key === 'ArrowUp' ? -1 : 1;
      if (opened !== control) {
        open(control, direction);
        const enabled = enabledIndices(control);
        if (event.key === 'Home') activate(control, enabled[0]);
        if (event.key === 'End') activate(control, enabled.at(-1));
      }
      else {
        const enabled = enabledIndices(control);
        const current = enabled.indexOf(control.activeIndex);
        const index = event.key === 'Home' ? enabled[0] : event.key === 'End' ? enabled.at(-1)
          : enabled[Math.max(0, Math.min(enabled.length - 1, current + direction))];
        activate(control, index);
      }
      return;
    }
    if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
      event.preventDefault();
      if (opened !== control) open(control);
      clearTimeout(searchTimer);
      searchText += event.key.toLocaleLowerCase();
      const enabled = enabledIndices(control);
      const match = enabled.find(index => control.select.options[index].label.toLocaleLowerCase().startsWith(searchText));
      if (match !== undefined) activate(control, match);
      searchTimer = setTimeout(() => { searchText = ''; }, 600);
    }
  }

  function sync(control) {
    const {select, button, label} = control;
    const text = select.selectedOptions[0]?.label || 'Select…';
    if (label.textContent !== text) label.textContent = text;
    if (button.disabled !== select.disabled) button.disabled = select.disabled;
    const name = select.getAttribute('aria-label') || select.closest('label')?.querySelector(':scope > span')?.textContent
      || Array.from(select.labels || []).map(item => item.textContent).join(' ').trim() || select.name || 'Select option';
    if (button.getAttribute('aria-label') !== name) button.setAttribute('aria-label', name);
    button.setAttribute('aria-required', String(select.required));
  }

  function enhance(select) {
    if (select.multiple || select.size > 1) return;
    if (controls.has(select)) { sync(controls.get(select)); return; }
    const wrapper = document.createElement('div');
    wrapper.className = 'custom-select';
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'custom-select-trigger';
    button.setAttribute('role', 'combobox');
    button.setAttribute('aria-haspopup', 'listbox');
    button.setAttribute('aria-expanded', 'false');
    const menuId = `custom-select-menu-${++nextId}`;
    button.setAttribute('aria-controls', menuId);
    const label = document.createElement('span');
    label.className = 'custom-select-value';
    const arrow = document.createElement('span');
    arrow.className = 'custom-select-arrow';
    arrow.setAttribute('aria-hidden', 'true');
    button.append(label, arrow);
    select.before(wrapper);
    wrapper.append(select, button);
    select.classList.add('custom-select-native');
    select.setAttribute('aria-hidden', 'true');
    select.tabIndex = -1;
    const control = {select, button, label, menuId, menu:null, activeIndex:-1};
    controls.set(select, control);
    button.addEventListener('click', event => {
      event.preventDefault();
      if (opened === control) close(); else open(control);
    });
    button.addEventListener('keydown', event => keydown(event, control));
    select.addEventListener('change', () => sync(control));
    select.addEventListener('invalid', event => {
      event.preventDefault();
      button.setAttribute('aria-invalid', 'true');
      button.focus();
      open(control);
    });
    select.addEventListener('change', () => button.removeAttribute('aria-invalid'));
    for (const property of ['value', 'selectedIndex']) {
      const descriptor = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, property);
      Object.defineProperty(select, property, {
        configurable:true,
        get() { return descriptor.get.call(this); },
        set(value) { descriptor.set.call(this, value); sync(control); }
      });
    }
    sync(control);
  }

  function refresh() {
    document.querySelectorAll('select').forEach(enhance);
    if (opened && (!opened.button.isConnected || !opened.button.getClientRects().length)) close();
  }
  const observer = new MutationObserver(() => {
    if (refreshing) return;
    refreshing = true;
    queueMicrotask(() => { refresh(); refreshing = false; });
  });
  observer.observe(document.body, {childList:true, subtree:true, attributes:true,
    attributeFilter:['selected','disabled','required','label','aria-label']});
  document.addEventListener('pointerdown', event => {
    if (opened && !opened.button.contains(event.target) && !opened.menu.contains(event.target)) close();
  }, true);
  document.addEventListener('focusin', event => {
    if (opened && !opened.button.contains(event.target) && !opened.menu.contains(event.target)) close();
  });
  document.addEventListener('scroll', event => {
    if (opened && !opened.menu.contains(event.target)) close();
  }, true);
  document.addEventListener('cancel', event => {
    if (opened) { event.preventDefault(); close(); }
  }, true);
  document.addEventListener('close', () => { if (opened) close(); }, true);
  document.addEventListener('reset', () => setTimeout(refresh, 0));
  window.addEventListener('resize', close);
  refresh();
})();
