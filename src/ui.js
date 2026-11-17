import { activePreset, clone, exportPreset, id, importPreset, newRule, normalizeTheme, uniqueName } from './model.js';
import { compileRules, validateRule } from './engine.js';
import { icon } from './icons.js';

const html = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const labels = { text: '普通文本', simple: '简易组合', regex: '正则表达式' };
const tags = { simple: '组合', regex: '正则' };
const button = (action, text, extra = '') => `<button type="button" data-action="${action}" ${extra}>${text}</button>`;
const labelled = (name, text) => `${icon(name)}<span>${text}</span>`;

// The palette is chosen by an attribute on <html>, so every Lite dialog
// (including the comparison window) follows the same setting.
export function applyTheme(theme) {
    document.documentElement.dataset.vrlTheme = normalizeTheme(theme);
}

function dialog(className, content) {
    const node = document.createElement('dialog');
    node.className = `vrl-dialog ${className}`;
    node.innerHTML = content;
    document.body.append(node);
    node.addEventListener('click', event => { if (event.target === node) {
        const rect = node.getBoundingClientRect();
        if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) node.requestClose();
    } });
    return node;
}

export function createUI({ state, save, notify, cleanRecent, showComparison }) {
    let main, search = '', expanded = new Set();
    const preset = () => activePreset(state);
    const groupById = groupId => preset()?.rules.find(g => g.id === groupId);
    const persist = () => { save(); if (main?.open) render(); };
    const cleanupHint = () => `最近 ${state.manualCleanLimit ?? 1} 条助手回复 · 当前 Swipe`;

    function ruleRow(group, rule, error) {
        const many = rule.replacements.length > 1;
        return `<div class="vrl-rule-row ${rule.enabled ? '' : 'vrl-rule-off'}" data-rule="${html(rule.id)}">
            <label class="vrl-check"><input type="checkbox" class="vrl-checkbox" data-toggle-rule="${html(rule.id)}" ${rule.enabled ? 'checked' : ''} aria-label="启用规则 ${html(rule.targets[0])}"></label>
            <div class="vrl-rule-source"><div class="vrl-rule-text">${tags[rule.mode] ? `<span class="vrl-mode" title="${labels[rule.mode]}">${tags[rule.mode]}</span>` : ''}${html(rule.targets.join(' / '))}</div>${rule.remark ? `<small>${html(rule.remark)}</small>` : ''}${error ? `<small class="vrl-error">${html(error)}</small>` : ''}</div>
            <span class="vrl-arrow" aria-hidden="true">→</span>
            <div class="vrl-rule-destination"><div class="vrl-rule-text ${rule.replacements.length ? '' : 'vrl-muted'}">${rule.replacements.length ? html(rule.replacements.join(' / ')) : '删除'}</div>${many ? `<small>随机替换 · ${rule.replacements.length} 个候选</small>` : ''}</div>
            <div class="vrl-row-actions">
                ${button('delete-inline-rule', icon('trash-can'), `class="vrl-icon vrl-delete-rule" data-group-id="${html(group.id)}" data-id="${html(rule.id)}" aria-label="删除规则 ${html(rule.targets[0])}" title="删除"`)}
                ${button('edit-rule', icon('pen'), `class="vrl-icon" data-group-id="${html(group.id)}" data-id="${html(rule.id)}" aria-label="编辑规则 ${html(rule.targets[0])}" title="编辑"`)}
            </div>
        </div>`;
    }

    function groupCard(group) {
        const query = search.trim().toLocaleLowerCase();
        const groupMatches = group.name.toLocaleLowerCase().includes(query);
        const rows = group.subRules.filter(rule => !query || groupMatches
            || [...rule.targets, ...rule.replacements, rule.remark].join('\n').toLocaleLowerCase().includes(query));
        if (query && !groupMatches && !rows.length) return '';
        const visible = query || expanded.has(group.id) ? rows : rows.slice(0, 3);
        const invalid = new Map(compileRules([{ ...group, enabled: true, subRules: group.subRules.map(r => ({...r, enabled: true})) }]).errors.map(error => [group.subRules[error.rule].id, error.message]));
        return `<section class="vrl-card ${group.enabled ? '' : 'vrl-disabled'}" data-group="${html(group.id)}">
            <div class="vrl-card-head"><label class="vrl-check"><input type="checkbox" class="vrl-checkbox" data-toggle-group="${html(group.id)}" ${group.enabled ? 'checked' : ''} aria-label="启用分组 ${html(group.name)}"></label>
                ${button('edit-group', html(group.name), `class="vrl-group-title" data-id="${html(group.id)}"`)}
                <span class="vrl-count">${group.subRules.length} 条</span>
                ${button('add-rule', labelled('plus', '添加规则'), `class="vrl-ghost vrl-small vrl-card-add" data-id="${html(group.id)}" aria-label="添加规则"`)}
                <details class="vrl-menu"><summary aria-label="分组操作" title="分组操作">${icon('ellipsis-vertical')}</summary><div>
                    ${button('edit-group', '编辑分组', `data-id="${html(group.id)}"`)}
                    ${button('copy-group', '复制分组', `data-id="${html(group.id)}"`)}
                    ${button('delete-group', '删除分组', `class="vrl-danger" data-id="${html(group.id)}"`)}
                </div></details>
            </div>
            <div class="vrl-rules">${visible.map(rule => ruleRow(group, rule, invalid.get(rule.id))).join('') || '<div class="vrl-card-empty">这个分组还没有规则。</div>'}</div>
            ${!query && rows.length > 3 ? button('expand', expanded.has(group.id) ? '收起' : `展开其余 ${rows.length - 3} 条`, `class="vrl-expand" data-id="${html(group.id)}"`) : ''}
        </section>`;
    }

    function renderGroups() {
        const area = main.querySelector('#vrl-groups');
        const current = preset();
        if (!current) {
            area.innerHTML = '<div class="vrl-empty"><strong>暂无预设</strong><p>新建预设，或导入预设 JSON 后开始配置规则。</p></div>';
            return;
        }
        const cards = current.rules.map(groupCard).join('');
        area.innerHTML = cards || (search
            ? '<div class="vrl-empty"><strong>没有找到匹配的规则</strong><p>试试匹配词、替换词或备注。</p></div>'
            : `<div class="vrl-empty"><strong>还没有规则组</strong><p>添加一个规则组，再往里面添加替换规则。</p>${button('add-group', labelled('plus', '添加规则组'))}</div>`);
    }

    function render() {
        const current = preset();
        const select = main.querySelector('#vrl-preset');
        select.innerHTML = state.presets.map(p => `<option value="${html(p.id)}">${html(p.name)}</option>`).join('') || '<option value="">暂无预设</option>';
        select.value = state.activePresetId ?? '';
        select.disabled = !current;
        main.querySelector('#vrl-enabled').checked = state.enabled;
        const groups = current?.rules ?? [];
        const rules = groups.flatMap(g => g.subRules);
        main.querySelector('#vrl-stats').textContent = `${groups.length} 个规则组 · ${rules.length} 条规则`;
        main.querySelector('#vrl-saved').textContent = '自动保存';
        for (const action of ['rename-preset', 'export', 'delete-preset', 'add-group', 'search', 'edit-groups', 'reverse']) {
            main.querySelector('[data-action="' + action + '"]').disabled = !current;
        }
        if (!current) {
            main.querySelector('#vrl-search-wrap').hidden = true;
            main.querySelector('[data-action="search"]').setAttribute('aria-pressed', 'false');
        }
        renderGroups();
    }

    function openSettings() {
        const modal = dialog('vrl-settings-dialog', `<form>
            <header><h3 id="vrl-settings-title">设置</h3></header>
            <div class="vrl-form-body">
                <div class="vrl-setting">
                    <div class="vrl-setting-text"><label for="vrl-opt-wand">显示在魔法棒</label><p class="vrl-hint">关闭后从扩展面板进入。</p></div>
                    <input id="vrl-opt-wand" name="showInMagicWand" type="checkbox" role="switch" class="vrl-toggle">
                </div>
                <div class="vrl-setting">
                    <div class="vrl-setting-text"><label for="vrl-opt-floors">手动净化楼层数</label><p class="vrl-hint" id="vrl-clean-limit-hint">填写正整数。留空时净化最近 1 条助手回复。</p></div>
                    <input id="vrl-opt-floors" name="manualCleanLimit" class="vrl-number" type="number" min="1" step="1" max="${Number.MAX_SAFE_INTEGER}" inputmode="numeric" placeholder="1" aria-describedby="vrl-clean-limit-hint">
                </div>
                <div class="vrl-setting">
                    <div class="vrl-setting-text"><span id="vrl-theme-label">配色</span><p class="vrl-hint">跟随酒馆时使用当前美化主题的背景、文字和强调色。</p></div>
                    <div class="vrl-segmented" role="radiogroup" aria-labelledby="vrl-theme-label">
                        <label><input type="radio" name="theme" value="default"><span>默认</span></label>
                        <label><input type="radio" name="theme" value="tavern"><span>跟随酒馆</span></label>
                    </div>
                </div>
            </div>
            <footer>${button('cancel', '取消')}<button type="submit" class="vrl-primary">保存</button></footer>
        </form>`);
        modal.setAttribute('aria-labelledby', 'vrl-settings-title');
        const form = modal.querySelector('form');
        const launcherToggle = form.elements.showInMagicWand;
        const floorCount = form.elements.manualCleanLimit;
        launcherToggle.checked = state.showInMagicWand;
        floorCount.value = state.manualCleanLimit ?? '';
        form.elements.theme.value = state.theme;
        // Preview the palette while choosing; closing without saving restores it.
        form.addEventListener('change', event => { if (event.target.name === 'theme') applyTheme(event.target.value); });
        modal.querySelector('[data-action="cancel"]').onclick = () => modal.close();
        form.onsubmit = event => {
            event.preventDefault();
            state.showInMagicWand = launcherToggle.checked;
            state.manualCleanLimit = floorCount.value === '' ? null : floorCount.valueAsNumber;
            state.theme = normalizeTheme(form.elements.theme.value);
            save();
            if (!main.querySelector('[data-action="refresh-body"]').disabled) {
                const status = main.querySelector('#vrl-refresh-status');
                status.textContent = cleanupHint();
                status.classList.remove('vrl-error');
            }
            modal.close();
        };
        modal.addEventListener('close', () => { applyTheme(state.theme); modal.remove(); }, { once: true });
        modal.showModal();
    }

    function askName(title, initial, commit) {
        const modal = dialog('vrl-name-dialog', `<form><header><h3>${html(title)}</h3></header><div class="vrl-form-body"><label class="vrl-field">名称<input name="name" required maxlength="120" value="${html(initial)}" autocomplete="off"></label></div><footer>${button('cancel', '取消')}<button type="submit" class="vrl-primary">保存</button></footer></form>`);
        modal.querySelector('[data-action="cancel"]').onclick = () => modal.close();
        modal.querySelector('form').onsubmit = event => {
            event.preventDefault();
            const value = modal.querySelector('input').value.trim();
            if (!value) { modal.querySelector('input').setCustomValidity('请填写名称。'); modal.querySelector('input').reportValidity(); return; }
            if (commit(value) !== false) modal.close();
        };
        modal.querySelector('input').oninput = event => event.target.setCustomValidity('');
        modal.addEventListener('close', () => modal.remove(), { once: true });
        modal.showModal(); modal.querySelector('input').select();
    }

    function editRule(groupId, ruleId) {
        const group = groupById(groupId), existing = group?.subRules.find(rule => rule.id === ruleId);
        if (!group) return;
        const draft = clone(existing || newRule());
        const targetsText = draft.targets.join('\n'), replacementsText = draft.replacements.join('\n');
        const modal = dialog('vrl-rule-dialog', `<form><header><div><span class="vrl-eyebrow">${html(group.name)}</span><h3>${existing ? '编辑规则' : '添加规则'}</h3></div>${button('close', icon('xmark'), 'class="vrl-icon" aria-label="关闭规则编辑" title="关闭"')}</header>
            <div class="vrl-form-body">
                <div class="vrl-rule-options"><label class="vrl-field">匹配方式<select name="mode">${Object.entries(labels).map(([key, label]) => `<option value="${key}" ${draft.mode === key ? 'selected' : ''}>${label}</option>`).join('')}</select></label><label class="vrl-check-label"><input type="checkbox" class="vrl-checkbox" name="enabled" ${draft.enabled ? 'checked' : ''}>启用这条规则</label></div>
                <p class="vrl-hint" id="vrl-mode-help"></p>
                <label class="vrl-field">匹配内容<textarea name="targets" rows="4" required spellcheck="false" placeholder="每行一个匹配项">${html(targetsText)}</textarea></label>
                <label class="vrl-field">替换内容 <span class="vrl-muted">留空即删除</span><textarea name="replacements" rows="3" spellcheck="false" placeholder="每行一个候选；多个候选会在每次命中时随机选择">${html(replacementsText)}</textarea></label>
                <label class="vrl-field">备注 <span class="vrl-muted">可选</span><input name="remark" maxlength="300" value="${html(draft.remark)}" placeholder="给自己看的简短说明"></label>
                <p class="vrl-error" id="vrl-rule-error" role="alert"></p>
            </div><footer>${existing ? button('delete-rule', '删除', 'class="vrl-ghost vrl-danger vrl-push-left"') : ''}${button('close', '取消')}<button type="submit" class="vrl-primary">保存规则</button></footer></form>`);
        const form = modal.querySelector('form');
        const help = () => { modal.querySelector('#vrl-mode-help').textContent = {
            text: '按原样匹配文字，每行一项。标点和空格也属于匹配内容。',
            simple: '支持 {A,B,C} 多选组合和 * 通配；* 最多匹配 15 个字，不跨句末标点或换行。',
            regex: '可直接填写表达式或 /表达式/flags。替换支持 $1、$2 等捕获组及 \\n 换行。',
        }[form.elements.mode.value]; };
        form.elements.mode.onchange = help; help();
        modal.addEventListener('click', event => {
            const action = event.target.closest('button')?.dataset.action;
            if (action === 'close') modal.requestClose();
            if (action === 'delete-rule' && confirm('删除这条规则？')) {
                group.subRules = group.subRules.filter(rule => rule.id !== ruleId); persist(); modal.close();
            }
        });
        const changed = () => form.elements.mode.value !== draft.mode || form.elements.targets.value !== targetsText
            || form.elements.replacements.value !== replacementsText || form.elements.remark.value !== draft.remark || form.elements.enabled.checked !== draft.enabled;
        modal.addEventListener('cancel', event => { if (changed() && !confirm('这条规则还没保存，放弃修改？')) event.preventDefault(); });
        form.onsubmit = event => {
            event.preventDefault();
            draft.mode = form.elements.mode.value;
            draft.targets = form.elements.targets.value === targetsText ? draft.targets : form.elements.targets.value.split(/\r?\n/).filter(line => line.length > 0);
            draft.replacements = form.elements.replacements.value === replacementsText ? draft.replacements : form.elements.replacements.value.split(/\r?\n/).filter(line => line.length > 0);
            draft.remark = form.elements.remark.value; draft.enabled = form.elements.enabled.checked;
            try { validateRule(draft); }
            catch (error) { modal.querySelector('#vrl-rule-error').textContent = error.message; return; }
            if (existing) group.subRules[group.subRules.findIndex(rule => rule.id === ruleId)] = draft;
            else group.subRules.push(draft);
            expanded.add(groupId); persist(); modal.close();
        };
        modal.addEventListener('close', () => modal.remove(), { once: true });
        modal.showModal();
    }

    function editGroups(focusId) {
        const modal = dialog('vrl-groups-dialog', `<header><h3>编辑分组</h3>${button('close', icon('xmark'), 'class="vrl-icon" aria-label="关闭分组编辑" title="关闭"')}</header><div class="vrl-group-editor"></div><footer><span class="vrl-muted vrl-push-left">修改后自动保存</span>${button('close', '完成', 'class="vrl-primary"')}</footer>`);
        const list = modal.querySelector('.vrl-group-editor');
        const renderList = () => { list.innerHTML = preset().rules.map((group, index) => `<div class="vrl-group-edit-row" data-id="${html(group.id)}"><label class="vrl-check"><input type="checkbox" class="vrl-checkbox" data-group-toggle ${group.enabled ? 'checked' : ''} aria-label="启用分组 ${html(group.name)}"></label><input value="${html(group.name)}" maxlength="120" aria-label="分组名称"><span class="vrl-count">${group.subRules.length} 条</span><div class="vrl-row-actions">${button('up', icon('arrow-up'), `class="vrl-icon" aria-label="上移分组" title="上移" ${index === 0 ? 'disabled' : ''}`)}${button('down', icon('arrow-down'), `class="vrl-icon" aria-label="下移分组" title="下移" ${index === preset().rules.length - 1 ? 'disabled' : ''}`)}${button('remove', icon('trash-can'), 'class="vrl-icon vrl-delete-rule" aria-label="删除分组" title="删除"')}</div></div>`).join('') || '<p class="vrl-hint vrl-card-empty">还没有分组。</p>'; };
        renderList();
        list.onchange = event => {
            const row = event.target.closest('[data-id]'), group = groupById(row?.dataset.id);
            if (!group) return;
            if (event.target.matches('[data-group-toggle]')) group.enabled = event.target.checked;
            else { group.name = event.target.value.trim() || group.name; event.target.value = group.name; }
            persist();
        };
        modal.onclick = event => {
            const target = event.target.closest('button[data-action]');
            if (!target) return;
            if (target.dataset.action === 'close') { modal.close(); return; }
            const row = target.closest('[data-id]'), group = groupById(row?.dataset.id);
            if (!group) return;
            const index = preset().rules.indexOf(group);
            if (target.dataset.action === 'remove') {
                if (!confirm(`删除分组“${group.name}”和其中的全部规则？`)) return;
                preset().rules.splice(index, 1);
            } else {
                const next = index + (target.dataset.action === 'up' ? -1 : 1);
                if (next < 0 || next >= preset().rules.length) return;
                [preset().rules[index], preset().rules[next]] = [preset().rules[next], preset().rules[index]];
            }
            persist(); renderList();
        };
        modal.addEventListener('close', () => modal.remove(), { once: true }); modal.showModal();
        if (focusId) [...list.querySelectorAll('[data-id]')].find(row => row.dataset.id === focusId)?.querySelector('input:not([type="checkbox"])')?.select();
    }

    async function importFile(file) {
        try {
            if (file.size > 10 * 1024 * 1024) throw new Error('预设文件不能超过 10 MiB。');
            const { preset: imported, skipped } = importPreset(JSON.parse(await file.text()), file.name.replace(/\.json$/i, ''));
            imported.name = uniqueName(state, imported.name);
            const errors = compileRules(imported.rules.map(g => ({ ...g, enabled: true, subRules: g.subRules.map(r => ({ ...r, enabled: true })) }))).errors;
            if (errors.length) throw new Error(`第 ${errors[0].group + 1} 组、第 ${errors[0].rule + 1} 条规则无效：${errors[0].message}`);
            state.presets.push(imported); state.activePresetId = imported.id; search = ''; main.querySelector('#vrl-search').value = ''; expanded.clear(); persist();
            notify(`已导入“${imported.name}”${skipped ? `，跳过 ${skipped} 条旧版 AI 规则` : ''}。`, 'success');
        } catch (error) { notify(`导入失败：${error.message}`, 'error'); }
    }

    function handleAction(action, target) {
        if (action === 'close') main.close();
        if (action === 'settings') openSettings();
        if (action === 'refresh-body') {
            if (target.disabled) return;
            const previous = target.innerHTML;
            target.disabled = true; target.textContent = '正在净化…';
            const status = main.querySelector('#vrl-refresh-status');
            status.textContent = '正在应用当前规则'; status.classList.remove('vrl-error');
            Promise.resolve().then(() => cleanRecent({ onProgress: ({ current, total }) => { status.textContent = `正在净化 ${current}/${total} 楼`; } })).then(result => {
                status.textContent = result.message;
                status.classList.toggle('vrl-error', ['error', 'save-failed', 'display-failed'].includes(result.status));
            }).catch(error => { status.textContent = `净化失败：${error.message}`; status.classList.add('vrl-error'); })
                .finally(() => { target.disabled = false; target.innerHTML = previous; });
        }
        if (action === 'show-comparison') showComparison();
        if (action === 'delete-inline-rule') {
            const group = groupById(target.dataset.groupId), rule = group?.subRules.find(item => item.id === target.dataset.id);
            if (rule && confirm(`删除这条规则？\n${rule.targets.join(' / ').slice(0, 100)}`)) { group.subRules = group.subRules.filter(item => item.id !== rule.id); persist(); }
        }
        if (action === 'new-preset') askName('新建预设', uniqueName(state, '新预设'), name => {
            if (state.presets.some(p => p.name === name)) { notify('已有同名预设，请换一个名称。', 'warning'); return false; }
            const item = { id: id(), name, rules: [] }; state.presets.push(item); state.activePresetId = item.id; expanded.clear(); search = ''; main.querySelector('#vrl-search').value = ''; persist();
        });
        if (action === 'rename-preset') askName('重命名预设', preset().name, name => {
            if (state.presets.some(p => p.id !== preset().id && p.name === name)) { notify('已有同名预设，请换一个名称。', 'warning'); return false; }
            preset().name = name; persist();
        });
        if (action === 'delete-preset' && preset() && confirm(`删除预设“${preset().name}”及其中全部规则？`)) {
            state.presets = state.presets.filter(p => p.id !== state.activePresetId);
            state.activePresetId = state.presets[0]?.id ?? null;
            search = '';
            main.querySelector('#vrl-search').value = '';
            expanded.clear();
            persist();
        }
        if (action === 'import') main.querySelector('#vrl-file').click();
        if (action === 'export') {
            const blob = new Blob([JSON.stringify(exportPreset(preset()), null, 2)], { type: 'application/json' });
            const url = URL.createObjectURL(blob), link = document.createElement('a'); link.href = url;
            link.download = `${preset().name.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_') || 'Veridis-Lite'}.json`; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
        }
        if (action === 'add-group') askName('添加规则组', '新分组', name => { preset().rules.push({ id: id(), name, enabled: true, subRules: [] }); persist(); });
        if (action === 'edit-group' || action === 'edit-groups') editGroups(target.dataset.id);
        if (action === 'reverse') { preset().rules.reverse(); persist(); }
        if (action === 'search') {
            const wrap = main.querySelector('#vrl-search-wrap');
            wrap.hidden = !wrap.hidden; target.setAttribute('aria-pressed', String(!wrap.hidden));
            if (!wrap.hidden) main.querySelector('#vrl-search').focus(); else { search = ''; main.querySelector('#vrl-search').value = ''; renderGroups(); }
        }
        if (action === 'clear-search') { search = ''; main.querySelector('#vrl-search').value = ''; renderGroups(); main.querySelector('#vrl-search').focus(); }
        if (action === 'expand') { expanded.has(target.dataset.id) ? expanded.delete(target.dataset.id) : expanded.add(target.dataset.id); renderGroups(); }
        if (action === 'add-rule') editRule(target.dataset.id);
        if (action === 'edit-rule') editRule(target.dataset.groupId, target.dataset.id);
        if (action === 'delete-group') {
            const group = groupById(target.dataset.id);
            if (group && confirm(`删除分组“${group.name}”和其中全部规则？`)) { preset().rules = preset().rules.filter(g => g.id !== group.id); persist(); }
        }
        if (action === 'copy-group') {
            const group = clone(groupById(target.dataset.id)); group.id = id(); group.name += '（副本）'; group.subRules.forEach(rule => { rule.id = id(); });
            preset().rules.splice(preset().rules.findIndex(g => g.id === target.dataset.id) + 1, 0, group); persist();
        }
    }

    function open() {
        if (!main) {
            main = dialog('vrl-main-dialog', `<header class="vrl-main-header">
                <div class="vrl-title"><h2>词汇净化</h2><span>Lite</span></div>
                <div class="vrl-header-actions">
                    <label class="vrl-switch" title="新回复完成后自动净化。关闭后仍可立即净化。">
                        <span class="vrl-switch-text">自动净化</span>
                        <input id="vrl-enabled" type="checkbox" role="switch" class="vrl-toggle">
                    </label>
                    <span class="vrl-divider" aria-hidden="true"></span>
                    ${button('settings', icon('gear'), 'class="vrl-icon" aria-label="设置" title="设置"')}
                    ${button('close', icon('xmark'), 'class="vrl-icon" aria-label="关闭词汇净化" title="关闭"')}
                </div>
            </header>
            <div class="vrl-main-scroll">
                <section class="vrl-preset-bar">
                    <label class="vrl-preset-label" for="vrl-preset">预设</label>
                    <select id="vrl-preset" aria-label="当前预设"></select>
                    <div class="vrl-preset-actions">${button('new-preset', '新建')}${button('rename-preset', '重命名')}${button('import', '导入')}${button('export', '导出')}${button('delete-preset', '删除', 'class="vrl-danger"')}</div>
                </section>
                <section class="vrl-rules-section">
                    <div class="vrl-section-head">
                        <div class="vrl-section-title"><h3>规则</h3><span id="vrl-stats"></span></div>
                        <div class="vrl-rule-actions">
                            ${button('search', labelled('magnifying-glass', '搜索'), 'class="vrl-ghost" aria-label="搜索规则" aria-pressed="false" title="搜索规则"')}
                            ${button('edit-groups', labelled('list', '编辑分组'), 'class="vrl-ghost" aria-label="编辑分组" title="编辑分组"')}
                            ${button('reverse', labelled('arrow-down-up', '反序'), 'class="vrl-ghost" aria-label="反序排列分组" title="反序排列分组"')}
                            ${button('add-group', labelled('plus', '添加规则组'), 'aria-label="添加规则组" title="添加规则组"')}
                        </div>
                    </div>
                    <div id="vrl-search-wrap" class="vrl-search" hidden><input id="vrl-search" type="search" placeholder="搜索匹配词、替换词、备注或分组" aria-label="搜索规则">${button('clear-search', icon('xmark'), 'class="vrl-icon" aria-label="清空搜索" title="清空"')}</div>
                    <div id="vrl-groups"></div>
                </section>
            </div>
            <footer class="vrl-main-footer">
                <div class="vrl-clean-actions">${button('refresh-body', '立即净化', 'class="vrl-primary" title="按设置的楼层数净化最近的助手回复，只处理当前 Swipe"')}${button('show-comparison', '查看改动', 'title="查看最近十楼的净化前后对比"')}</div>
                <span id="vrl-refresh-status" role="status">${cleanupHint()}</span>
                <div class="vrl-footer-meta"><span id="vrl-saved">自动保存</span><span aria-hidden="true">·</span><a href="https://github.com/The-Veridis-Lion/Veridis-Rewrite" target="_blank" rel="noopener noreferrer">基于 Veridis Rewrite</a></div>
            </footer><input type="file" id="vrl-file" accept="application/json,.json" hidden>`);
            main.addEventListener('click', event => { const target = event.target.closest('button[data-action]'); if (target && !target.disabled) handleAction(target.dataset.action, target); });
            main.addEventListener('change', event => {
                const input = event.target;
                if (input.dataset.toggleGroup) {
                    const group = groupById(input.dataset.toggleGroup);
                    if (group) { group.enabled = input.checked; persist(); }
                }
                if (input.dataset.toggleRule) {
                    const group = groupById(input.closest('[data-group]')?.dataset.group);
                    const rule = group?.subRules.find(item => item.id === input.dataset.toggleRule);
                    if (rule) { rule.enabled = input.checked; persist(); }
                }
            });
            main.querySelector('#vrl-enabled').onchange = event => { state.enabled = event.target.checked; persist(); };
            main.querySelector('#vrl-preset').onchange = event => { state.activePresetId = event.target.value; expanded.clear(); persist(); };
            main.querySelector('#vrl-search').oninput = event => { search = event.target.value; renderGroups(); };
            main.querySelector('#vrl-file').onchange = async event => { const file = event.target.files[0]; event.target.value = ''; if (file) await importFile(file); };
        }
        render(); if (!main.open) main.showModal();
    }
    return { open };
}
