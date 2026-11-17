import { escapeHtml } from './diff.js';
import { branchOf, getHistory, proseForDiff, recentAssistantIndices } from './history.js';
import { icon } from './icons.js';

export function renderComparison(operations, mode = 'snippet') {
    const run = op => op.type === 'delete' ? `<del>${escapeHtml(op.text)}</del>`
        : op.type === 'insert' ? `<ins>${escapeHtml(op.text)}</ins>` : escapeHtml(op.text);
    if (mode === 'full') return `<div class="vrl-diff-prose">${operations.map(run).join('')}</div>`;
    // Split the complete aligned diff into sentences, then show only changed
    // sentences. A replacement's adjacent delete/insert runs remain together.
    const tokens = operations.flatMap(op => Array.from(op.text).map(char => ({ type: op.type, char })));
    const blocks = [];
    let parts = [], boundary = false, previousType = null;
    const endMark = (token, index) => {
        if (/[。！？!?\r\n]/u.test(token.char)) return true;
        if (token.char !== '.') return false;
        const before = tokens[index - 1]?.char, after = tokens[index + 1]?.char;
        return before !== '.' && after !== '.' && !(/\d/u.test(before || '') && /\d/u.test(after || ''))
            && (!after || /[\s"'”’」』）)\]]/u.test(after));
    };
    const flush = () => {
        if (parts.some(part => part.type !== 'equal')) {
            if (parts[0]?.type === 'equal') parts[0].text = parts[0].text.replace(/^\s+/u, '');
            if (parts.at(-1)?.type === 'equal') parts.at(-1).text = parts.at(-1).text.replace(/\s+$/u, '');
            blocks.push(`<div class="vrl-diff-fragment">${parts.map(run).join('')}</div>`);
        }
        parts = []; boundary = false;
    };
    for (const [index, token] of tokens.entries()) {
        const trailing = /[\s。！？!?.”’」』）)\]}"'*`]/u.test(token.char);
        if (boundary && !trailing && (token.type === 'equal' || previousType === 'equal')) flush();
        if (parts.at(-1)?.type === token.type) parts.at(-1).text += token.char;
        else parts.push({ type: token.type, text: token.char });
        if (endMark(token, index)) boundary = true;
        previousType = token.type;
    }
    flush();
    return blocks.join('') || '<p class="vrl-diff-empty">这条记录没有可见正文差异。</p>';
}

export function createDiffViewer({ getContext, eventSource, eventTypes }) {
    let modal = null, timer = null, worker = null, mode = 'snippet', selected = null, pair = null, task = 0;
    const cancel = () => { task++; worker?.terminate(); worker = null; };
    const recorded = () => recentAssistantIndices(getContext().chat).filter(index => {
        const history = getHistory(getContext().chat[index]);
        return history && history.before !== history.after;
    });
    const syncMode = () => {
        for (const node of modal.querySelectorAll('[data-mode]')) node.setAttribute('aria-pressed', String(node.dataset.mode === mode));
    };
    const paint = () => {
        if (!pair || !modal?.open) return;
        const current = proseForDiff(pair.message.mes), after = proseForDiff(pair.history.after);
        modal.querySelector('.vrl-diff-body').innerHTML = (current !== after ? '<p class="vrl-diff-notice">正文在净化后又有变化；下面展示当时的净化结果。</p>' : '') + renderComparison(pair.operations, mode);
    };
    function compare(index) {
        cancel(); pair = null; selected = index;
        const message = getContext().chat?.[index], history = message && getHistory(message);
        const body = modal.querySelector('.vrl-diff-body');
        if (!history) { body.innerHTML = '<p class="vrl-diff-empty">当前分支尚无净化记录。</p>'; return; }
        body.innerHTML = '<p class="vrl-diff-empty">正在比较正文…</p>';
        const token = task, branch = branchOf(message)?.key;
        try {
            worker = new Worker(new URL('./diffWorker.js', import.meta.url), { type: 'module' });
            worker.onmessage = ({ data }) => {
                worker?.terminate(); worker = null;
                if (token !== task || !modal.open) return;
                if (getContext().chat?.[index] !== message || branchOf(message)?.key !== branch || getHistory(message) !== history) { refreshWindow(); return; }
                if (data.error) { body.textContent = `对比失败：${data.error}`; return; }
                pair = { index, message, history, operations: data.operations }; paint();
            };
            worker.onerror = event => { event.preventDefault(); worker?.terminate(); worker = null; if (token === task) body.textContent = '文本比较失败，请关闭窗口后重试。'; };
            worker.postMessage({ before: proseForDiff(history.before), after: proseForDiff(history.after) });
        } catch (error) { body.textContent = `无法打开文本比较：${error.message}`; }
    }
    function refreshWindow() {
        if (!modal?.open) return;
        const indices = recorded().reverse(), select = modal.querySelector('select');
        select.innerHTML = indices.map(index => `<option value="${index}">第 ${index + 1} 楼 · 当前 Swipe</option>`).join('');
        if (!indices.length) {
            cancel(); pair = null;
            modal.querySelector('.vrl-diff-body').innerHTML = '<p class="vrl-diff-empty">最近十楼尚无净化记录。生成新回复或执行“立即净化”后，实际发生的改动会显示在这里。</p>';
            select.disabled = true; return;
        }
        select.disabled = false;
        if (!indices.includes(selected)) selected = indices[0];
        select.value = String(selected);
        if (pair?.message === getContext().chat[selected] && pair.history === getHistory(pair.message)) paint();
        else compare(selected);
    }
    function open(index) {
        if (!modal) {
            modal = document.createElement('dialog'); modal.className = 'vrl-dialog vrl-diff-dialog';
            modal.innerHTML = `<header><div><span class="vrl-eyebrow">普通规则</span><h3>净化对比</h3></div><button type="button" class="vrl-icon" data-close aria-label="关闭净化对比" title="关闭">${icon('xmark')}</button></header>`
                + '<div class="vrl-diff-toolbar"><select aria-label="选择净化记录"></select><div class="vrl-segmented" role="group" aria-label="对比范围"><button type="button" data-mode="snippet">只看改动</button><button type="button" data-mode="full">全文对比</button></div><span class="vrl-diff-legend"><span class="vrl-legend-del">原文</span><span class="vrl-legend-ins">替换后</span></span></div><div class="vrl-diff-body"></div>';
            document.body.append(modal);
            modal.querySelector('[data-close]').onclick = () => modal.close();
            modal.querySelector('select').onchange = event => compare(Number(event.target.value));
            modal.querySelector('.vrl-segmented').onclick = event => {
                const choice = event.target.closest('[data-mode]');
                if (!choice || choice.dataset.mode === mode) return;
                mode = choice.dataset.mode; syncMode(); paint();
            };
            syncMode();
            modal.addEventListener('close', () => { cancel(); pair = null; });
        }
        selected = Number.isInteger(index) ? index : null;
        if (!modal.open) modal.showModal(); refreshWindow();
    }
    function refreshButtons() {
        const indices = new Set(recorded());
        for (const node of document.querySelectorAll('#chat .mes')) {
            const index = Number(node.getAttribute('mesid') ?? node.dataset.mesid);
            const existing = node.querySelector('.vrl-diff-message');
            if (!indices.has(index)) { existing?.remove(); continue; }
            if (existing) continue;
            const area = node.querySelector('.mes_buttons'); if (!area) continue;
            const button = document.createElement('div');
            button.className = 'mes_button vrl-diff-message interactable'; button.tabIndex = 0;
            button.setAttribute('role', 'button'); button.setAttribute('aria-label', '查看净化对比'); button.title = '查看净化对比';
            button.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/></svg>';
            button.onclick = () => open(index);
            button.onkeydown = event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); open(index); } };
            area.insertBefore(button, area.querySelector('.mes_edit'));
        }
        refreshWindow();
    }
    function schedule() {
        if (timer !== null) return;
        timer = setTimeout(() => { timer = null; refreshButtons(); }, 0);
    }
    for (const key of ['CHARACTER_MESSAGE_RENDERED', 'MESSAGE_UPDATED', 'MESSAGE_SWIPED', 'MORE_MESSAGES_LOADED', 'CHAT_CHANGED']) if (eventTypes[key]) eventSource.on(eventTypes[key], schedule);
    schedule();
    return { open, refresh: schedule };
}
