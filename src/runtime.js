import { activePreset, normalizeManualCleanLimit } from './model.js';
import { applyRules, compileRules } from './engine.js';
import { assistant, branchOf, getHistory, pruneHistory, recentAssistantIndices, syncSwipe, writeHistory } from './history.js';
import { refreshDisplay } from './display.js';

export function createMessageCleaner({ getContext, getState, eventSource, eventTypes, notify = () => {}, onChange = () => {}, defer = setTimeout, cancelDefer = clearTimeout }) {
    const pending = new Map(), runs = new WeakMap(), listeners = [];
    let active = false, timer = null, continuation = null, disposed = false, draining = false, manualRunning = false, drainPromise = null;
    const identity = ctx => String(ctx.getCurrentChatId?.() ?? ctx.chatId ?? ctx.chat_id ?? '');
    const on = (key, fn) => { if (eventTypes[key]) { eventSource.on(eventTypes[key], fn); listeners.push([eventTypes[key], fn]); } };
    const configuredLimit = () => normalizeManualCleanLimit(getState().manualCleanLimit) ?? 1;
    const memory = (message, branch) => runs.get(message)?.get(branch.key);
    const sourceFor = (message, branch) => {
        const saved = getHistory(message, branch), cached = memory(message, branch);
        const source = saved?.before ?? cached?.source, output = saved?.after ?? cached?.output;
        if (typeof source !== 'string' || typeof output !== 'string') return message.mes;
        if (message.mes === output) return source;
        return output && message.mes.startsWith(output) ? source + message.mes.slice(output.length) : message.mes;
    };
    const sameChat = target => {
        const ctx = getContext();
        return ctx.chat === target.chat && identity(ctx) === target.chatId;
    };
    const fresh = target => sameChat(target) && getContext().chat[target.index] === target.message
        && branchOf(target.message)?.key === target.branch.key;
    const snapshot = (ctx, index, branch) => ({ chat: ctx.chat, chatId: identity(ctx), index, message: ctx.chat[index], branch });
    const schedule = (delay = 0) => {
        if (disposed || timer !== null || active || manualRunning || !pending.size) return;
        timer = defer(() => { timer = null; void drain(); }, delay);
    };

    async function commit(target, source, result, { manual = false, save = true } = {}) {
        if (!fresh(target) || disposed) return { status: 'stale', dirty: false, message: '消息或分支已变化，已跳过。' };
        const ctx = getContext(), message = target.message, branch = target.branch;
        if (typeof ctx.saveChat !== 'function') return { status: 'error', dirty: false, message: '酒馆未提供保存接口，未修改消息。' };
        const textChanged = message.mes !== result.text, retrySave = memory(message, branch)?.persisted === false;
        message.mes = result.text;
        syncSwipe(message, branch);
        const historyChanged = writeHistory(message, branch, source, result.text, result.changes);
        const pruned = !manual && pruneHistory(ctx.chat, configuredLimit());
        let dirty = historyChanged || pruned || textChanged || retrySave;
        const record = { source, output: result.text, persisted: !dirty };
        if (!runs.has(message)) runs.set(message, new Map());
        runs.get(message).set(branch.key, record);
        let displayFailed = false;
        if (textChanged || manual) {
            if (message.extra) delete message.extra.display_text;
            const extra = message.swipe_info?.[branch.index]?.extra;
            if (extra) delete extra.display_text;
            const beforeRender = message.mes;
            try { await refreshDisplay(ctx, eventSource, eventTypes, target.index, message); }
            catch { displayFailed = true; }
            if (!fresh(target) || disposed) return { status: 'stale', dirty, textChanged, record, message: '会话或分支已切换，已停止后续写回。' };
            syncSwipe(message, branch);
            dirty ||= message.mes !== beforeRender;
        }
        if (save && dirty) {
            try { await ctx.saveChat(); record.persisted = true; }
            catch { return { status: 'save-failed', dirty, textChanged, record, message: '正文已更新，但保存失败，请检查酒馆服务后重试。' }; }
        }
        if (save) onChange();
        return { status: displayFailed ? 'display-failed' : textChanged ? 'applied' : retrySave ? 'saved' : 'unchanged',
            dirty, textChanged, record, changes: textChanged ? result.changes : 0,
            message: displayFailed ? '正文已保存，渲染通知失败，可稍后重试。' : '' };
    }

    async function cleanRecent({ limit = configuredLimit(), onProgress = () => {} } = {}) {
        const ctx = getContext();
        if (disposed) return { status: 'error', message: '扩展已卸载，请刷新页面。' };
        if (active || draining || manualRunning || ctx.streamingProcessor?.isStopped === false) return { status: 'busy', message: '请等当前回复生成或保存完成后再净化。' };
        const preset = activePreset(getState());
        if (!preset) return { status: 'empty', message: '请先新建或导入预设。' };
        const count = normalizeManualCleanLimit(limit) ?? 1;
        const indices = recentAssistantIndices(ctx.chat, count);
        if (!indices.length) return { status: 'empty', message: '当前聊天还没有可净化的助手回复。' };
        const compiled = compileRules(structuredClone(preset.rules));
        if (compiled.errors.length) return { status: 'error', message: '有 ' + compiled.errors.length + ' 条无效规则，请先修正后再净化。' };
        const targets = indices.map(index => ({ ...snapshot(ctx, index, branchOf(ctx.chat[index])), text: ctx.chat[index].mes }));
        const valid = targets.filter(target => target.branch);
        if (!valid.length) return { status: 'busy', message: '回复的 Swipe 尚未保存完成，请稍后再试。' };
        let changed = 0, changes = 0, skipped = targets.length - valid.length, dirty = false, displayFailed = false, retrySave = false;
        const records = [];
        manualRunning = true;
        try {
            for (const [position, target] of valid.entries()) {
                if (disposed || active || !sameChat(target)) { skipped += valid.length - position; break; }
                onProgress({ current: position + 1, total: valid.length });
                if (!fresh(target) || target.message.mes !== target.text) { skipped++; continue; }
                pending.delete(target.message);
                const source = sourceFor(target.message, target.branch);
                const result = await commit(target, source, applyRules(source, compiled), { manual: true, save: false });
                if (result.status === 'error') return result;
                dirty ||= result.dirty;
                if (result.record) records.push(result.record);
                if (result.textChanged) { changed++; changes += result.changes || 0; }
                else if (result.status === 'saved') retrySave = true;
                if (result.status === 'display-failed') displayFailed = true;
                if (result.status === 'stale') skipped++;
            }
            if (!sameChat(valid[0])) return { status: 'stale', message: '会话已切换，已停止后续保存。', changed, skipped };
            if (records.length) dirty = pruneHistory(ctx.chat, Math.max(count, configuredLimit())) || dirty;
            if (dirty) {
                try { await ctx.saveChat(); records.forEach(record => { record.persisted = true; }); }
                catch { return { status: 'save-failed', message: '正文已更新，但保存失败，请检查酒馆服务后重试。', changed, changes }; }
            }
            onChange();
            return { status: displayFailed ? 'display-failed' : changed ? 'applied' : retrySave ? 'saved' : 'unchanged', changed, changes, skipped,
                message: displayFailed ? '正文已保存，部分美化渲染未完成，可再次净化重试。'
                    : changed ? '已净化 ' + changed + ' 楼，替换 ' + changes + ' 处' + (skipped ? '，跳过 ' + skipped + ' 楼' : '') + '。'
                    : retrySave ? '正文已重新保存。' : '已检查 ' + valid.length + ' 楼，无需修改。' };
        } finally { manualRunning = false; schedule(); }
    }

    function drain() {
        if (drainPromise) return drainPromise;
        drainPromise = runDrain().finally(() => { drainPromise = null; });
        return drainPromise;
    }
    async function runDrain() {
        if (disposed || active || draining || manualRunning) return;
        draining = true;
        try {
            let retry = false;
            for (const [message, target] of [...pending]) {
                if (disposed) break;
                const ctx = getContext();
                const state = getState();
                const preset = activePreset(state);
                if (ctx.chat !== target.chat || ctx.chat[target.index] !== message || identity(ctx) !== target.chatId || !assistant(message) || !state.enabled || !preset) { pending.delete(message); continue; }
                const branch = branchOf(message);
                if (!branch) {
                    if (++target.attempts < 30) retry = true;
                    else { pending.delete(message); notify('候选回复尚未完成写入，本次净化已跳过。', 'warning'); }
                    continue;
                }
                pending.delete(message);
                if (Number.isInteger(target.swipeId) ? branch.index !== target.swipeId : branch.index > 0) continue;
                if (memory(message, branch)?.output === message.mes) continue;
                let startAt = 0;
                if (target.base !== null) {
                    if (!message.mes.startsWith(target.base)) { notify('继续生成的原文已变化，本次净化已跳过。', 'warning'); continue; }
                    startAt = target.base.length;
                }
                const compiled = compileRules(preset.rules);
                if (compiled.errors.length) notify('有 ' + compiled.errors.length + ' 条无效规则已跳过，请在规则中修正。', 'warning');
                const source = target.base !== null ? (target.sourceBase ?? target.base) + message.mes.slice(target.base.length) : message.mes;
                const result = await commit(snapshot(ctx, target.index, branch), source, applyRules(message.mes, compiled, { startAt }));
                if (['error', 'save-failed', 'display-failed'].includes(result.status)) notify(result.message, result.status === 'display-failed' ? 'warning' : 'error');
            }
            if (retry) schedule(100);
        } finally { draining = false; if (pending.size && timer === null && !active) schedule(); }
    }

    on('GENERATION_STARTED', (type, options, dryRun) => {
        if (dryRun || type === 'quiet' || (options?.quiet_prompt && !options.quietToLoud)) return;
        active = true; pending.clear();
        const ctx = getContext(), message = ctx.chat?.at(-1), branch = assistant(message) ? branchOf(message) : null;
        continuation = ['continue', 'append', 'appendFinal'].includes(type) && assistant(message)
            ? { message, base: message.mes, sourceBase: branch ? sourceFor(message, branch) : message.mes } : null;
    });
    on('MESSAGE_RECEIVED', (value, type) => {
        if (['first_message', 'quiet', 'impersonate'].includes(type)) return;
        const index = Number.isInteger(value) ? value : value?.messageId, ctx = getContext(), message = ctx.chat?.[index];
        if (!Number.isInteger(index) || !assistant(message)) return;
        pending.set(message, { index, chat: ctx.chat, chatId: identity(ctx), swipeId: message.swipe_id, attempts: 0,
            base: continuation?.message === message ? continuation.base : null, sourceBase: continuation?.message === message ? continuation.sourceBase : null });
        schedule();
    });
    on('CHARACTER_MESSAGE_RENDERED', () => schedule());
    const forget = value => { const message = getContext().chat?.[Number.isInteger(value) ? value : value?.messageId]; if (message) { pending.delete(message); runs.delete(message); } };
    on('MESSAGE_EDITED', forget); on('MESSAGE_SWIPED', forget);
    on('GENERATION_ENDED', () => { active = false; schedule(); });
    on('GENERATION_STOPPED', () => { active = false; schedule(); });
    on('CHAT_CHANGED', () => { pending.clear(); continuation = null; active = false; if (timer !== null) cancelDefer(timer); timer = null; });
    return { flush: drain, cleanRecent, refreshLatest: () => cleanRecent({ limit: 1 }),
        dispose() { disposed = true; if (timer !== null) cancelDefer(timer); pending.clear(); for (const [key, fn] of listeners) eventSource.removeListener(key, fn); } };
}
