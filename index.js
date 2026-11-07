import { extension_settings, getContext } from '../../../extensions.js';
import { eventSource, event_types, saveSettingsDebounced } from '../../../../script.js';
import { SETTINGS_KEY, loadState } from './src/model.js';
import { createMessageCleaner } from './src/runtime.js';
import { createUI } from './src/ui.js';
import { createDiffViewer } from './src/diffView.js';

const notify = (message, kind = 'info') => {
    const api = globalThis.toastr;
    if (typeof api?.[kind] === 'function') api[kind](message, 'Veridis Lite');
    else console[kind === 'error' ? 'error' : 'warn']('[Veridis Lite]', message);
};

try {
    const state = loadState(extension_settings[SETTINGS_KEY]);
    const save = () => {
        extension_settings[SETTINGS_KEY] = state;
        saveSettingsDebounced();
        mount();
    };
    const viewer = createDiffViewer({ getContext, eventSource, eventTypes: event_types });
    const cleaner = createMessageCleaner({ getContext, getState: () => state, eventSource, eventTypes: event_types, notify, onChange: viewer.refresh });
    const ui = createUI({ state, save, notify, cleanRecent: cleaner.cleanRecent, showComparison: viewer.open });
    const mount = () => {
        const menu = document.getElementById('extensionsMenu');
        const launcher = document.getElementById('vrl-launcher');
        if (!state.showInMagicWand) launcher?.remove();
        else if (menu && !launcher) {
            const button = document.createElement('div');
            button.id = 'vrl-launcher'; button.className = 'list-group-item flex-container flexGap5 interactable';
            button.tabIndex = 0; button.setAttribute('role', 'button');
            button.innerHTML = '<span class="fa-solid fa-filter extensionsMenuExtensionButton"></span><span>词汇净化</span>';
            button.addEventListener('click', ui.open);
            button.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); ui.open(); } });
            menu.append(button);
        }
        const settings = document.getElementById('extensions_settings2') || document.getElementById('extensions_settings');
        if (settings && !document.getElementById('vrl-settings')) {
            const row = document.createElement('div'); row.id = 'vrl-settings'; row.className = 'extension_container';
            const button = document.createElement('button'); button.type = 'button'; button.className = 'vrl-settings-entry';
            button.setAttribute('aria-label', '打开词汇净化规则管理');
            button.innerHTML = '<span class="vrl-settings-label">词汇净化 <small>Lite</small></span><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M7 17 17 7M7 7h10v10"/></svg>';
            button.addEventListener('click', ui.open); row.append(button); settings.append(row);
        }
    };
    if (event_types.APP_READY) eventSource.on(event_types.APP_READY, mount);
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount, { once: true });
    else mount();
} catch (error) { notify(`加载失败：${error.message}`, 'error'); }
