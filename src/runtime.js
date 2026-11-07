import { activePreset } from './model.js';
import { applyRules, compileRules } from './engine.js';

function branchOf(message) {
    if (message.swipes === undefined) return { key: 'main', index: -1 };
    const index = message.swipe_id;
    if (!Array.isArray(message.swipes) || !Number.isInteger(index) || index < 0 || index >= message.swipes.length) return null;
    const slot = message.swipes[index];
    if (typeof slot !== 'string' && !(slot && typeof slot.mes === 'string')) return null;
    return { key: `swipe:${index}`, index };
}

// Generation end may precede MESSAGE_RECEIVED in streaming hosts. Reception may
// also precede Swipe-slot creation. Stage candidates, then verify live data in a
// deferred completion pass. No streaming monkey-patches or per-token processing.
export function createMessageCleaner({ getContext, getState, eventSource, eventTypes, notify = () => {}, defer = setTimeout, cancelDefer = clearTimeout }) {
    const pending = new Map(), results = new WeakMap(), listeners = [];
    let active = false, timer = null, continuation = null, disposed = false, draining = false, manualRunning = false, lastRun = null;
    const assistant = msg => msg && msg.is_user !== true && msg.is_system !== true && typeof msg.mes === 'string';
    const identity = ctx => String(ctx.getCurrentChatId?.() ?? ctx.chatId ?? ctx.chat_id ?? '');
    const on = (key, listener) => { if (eventTypes[key]) { eventSource.on(eventTypes[key], listener); listeners.push([eventTypes[key], listener]); } };
    const schedule = (delay = 0) => {
        if (disposed || timer !== null || active || manualRunning || !pending.size) return;
        timer = defer(() => { timer = null; void drain(); }, delay);
    };

    const sourceFor = (msg, branch) => {
        if (lastRun?.message !== msg || lastRun.branch !== branch.key) return msg.mes;
        if (msg.mes === lastRun.output) return lastRun.source;
        if (lastRun.output && msg.mes.startsWith(lastRun.output)) return lastRun.source + msg.mes.slice(lastRun.output.length);
        return msg.mes;
    };

    async function writeResult(ctx, index, msg, branch, source, result, manual = false) {
        const report = (status, message) => {
            if (!manual) notify(message, status === 'save-failed' || status === 'error' ? 'error' : 'warning');
            return { status, message, changes: result.changes, index };
        };
        const changed = result.text !== msg.mes;
        const retrySave = !changed && lastRun?.message === msg && lastRun.branch === branch.key && lastRun.persisted === false;
        if ((changed || retrySave) && typeof ctx.saveChat !== 'function') return report('error', '酒馆未提供保存接口，未修改消息。');
        if (!results.has(msg)) results.set(msg, new Map());
        results.get(msg).set(branch.key, result.text);
        const record = lastRun = { message: msg, branch: branch.key, source, output: result.text, persisted: !changed && !retrySave };
        if (!changed && !retrySave) return { status: 'unchanged', changes: 0, index, message: '最新回复已符合当前规则，无需修改。' };
        msg.mes = result.text;
        if (branch.index >= 0) {
            const slot = msg.swipes[branch.index];
            if (typeof slot === 'string') msg.swipes[branch.index] = result.text;
            else slot.mes = result.text;
        }
        if (msg.extra) delete msg.extra.display_text;
        const extra = msg.swipe_info?.[branch.index]?.extra;
        if (extra) delete extra.display_text;
        let displayFailed = false;
        try { if (changed) ctx.updateMessageBlock?.(index, msg); }
        catch { displayFailed = true; }
        try { await ctx.saveChat(); }
        catch { return report('save-failed', '正文已更新，但保存失败，请检查酒馆服务后手动保存聊天。'); }
        record.persisted = true;
        if (displayFailed) return report('display-failed', '正文已保存，显示刷新失败，可重新打开聊天查看。');
        if (retrySave) return { status: 'saved', changes: 0, index, message: '最新回复已重新保存。' };
        return { status: 'applied', changes: result.changes, index, message: result.changes ? `最新回复已刷新，替换 ${result.changes} 处。` : '最新回复已按当前规则刷新。' };
    }

    async function refreshLatest() {
        const ctx = getContext();
        if (disposed) return { status: 'error', message: '扩展已卸载，请刷新页面。' };
        if (active || draining || manualRunning || ctx.streamingProcessor?.isStopped === false) return { status: 'busy', message: '请等当前回复生成或保存完成后再刷新。' };
        const preset = activePreset(getState());
        if (!preset) return { status: 'empty', message: '请先新建或导入预设。' };
        const index = ctx.chat?.findLastIndex(assistant) ?? -1, msg = ctx.chat?.[index];
        if (!msg) return { status: 'empty', message: '当前聊天还没有可刷新的助手回复。' };
        const branch = branchOf(msg);
        if (!branch) return { status: 'busy', message: '当前回复的 Swipe 尚未保存完成，请稍后再试。' };
        manualRunning = true;
        try {
            const source = sourceFor(msg, branch);
            const compiled = compileRules(preset.rules);
            if (compiled.errors.length) return { status: 'error', message: `有 ${compiled.errors.length} 条无效规则，请先修正后再刷新。` };
            pending.delete(msg);
            return await writeResult(ctx, index, msg, branch, source, applyRules(source, compiled), true);
        } finally { manualRunning = false; schedule(); }
    }

    async function drain() {
        if (disposed || active || draining || manualRunning) return;
        draining = true;
        try {
            let retry = false;
            for (const [msg, target] of [...pending]) {
                if (disposed) break;
                const ctx = getContext();
                const state = getState();
                const preset = activePreset(state);
                if (ctx.chat !== target.chat || ctx.chat[target.index] !== msg || identity(ctx) !== target.chatId
                    || !assistant(msg) || !state.enabled || !preset) { pending.delete(msg); continue; }
                const branch = branchOf(msg);
                if (!branch) {
                    if (++target.attempts < 30) retry = true;
                    else { pending.delete(msg); notify('候选回复尚未完成写入，本次净化已跳过。', 'warning'); }
                    continue;
                }
                pending.delete(msg);
                if (Number.isInteger(target.swipeId) ? branch.index !== target.swipeId : branch.index > 0) continue;
                if (results.get(msg)?.get(branch.key) === msg.mes) continue;
                let startAt = 0;
                if (target.base !== null) {
                    if (!msg.mes.startsWith(target.base)) { notify('继续生成的原文已变化，本次净化已跳过。', 'warning'); continue; }
                    startAt = target.base.length;
                }
                const { processors, errors } = compileRules(preset.rules);
                if (errors.length) notify(`有 ${errors.length} 条无效规则已跳过，请在规则中修正。`, 'warning');
                const result = applyRules(msg.mes, { processors }, { startAt });
                const source = target.base !== null ? (target.sourceBase ?? target.base) + msg.mes.slice(target.base.length) : msg.mes;
                await writeResult(ctx, target.index, msg, branch, source, result);
            }
            if (retry) schedule(100);
        } finally { draining = false; if (pending.size && timer === null && !active) schedule(); }
    }

    on('GENERATION_STARTED', (type, options, dryRun) => {
        if (dryRun || type === 'quiet' || (options?.quiet_prompt && !options.quietToLoud)) return;
        active = true;
        pending.clear();
        const ctx = getContext(), msg = ctx.chat?.at(-1);
        const branch = assistant(msg) ? branchOf(msg) : null;
        continuation = ['continue', 'append', 'appendFinal'].includes(type) && assistant(msg)
            ? { msg, base: msg.mes, sourceBase: branch ? sourceFor(msg, branch) : msg.mes } : null;
    });
    on('MESSAGE_RECEIVED', (value, type) => {
        if (type === 'first_message' || type === 'quiet' || type === 'impersonate') return;
        const index = Number.isInteger(value) ? value : value?.messageId;
        const ctx = getContext(), msg = ctx.chat?.[index];
        if (!Number.isInteger(index) || !assistant(msg)) return;
        pending.set(msg, { index, chat: ctx.chat, chatId: identity(ctx), swipeId: msg.swipe_id, attempts: 0,
            base: continuation?.msg === msg ? continuation.base : null,
            sourceBase: continuation?.msg === msg ? continuation.sourceBase : null });
        schedule();
    });
    on('CHARACTER_MESSAGE_RENDERED', () => schedule());
    const forgetMessage = value => {
        const index = Number.isInteger(value) ? value : value?.messageId;
        const msg = getContext().chat?.[index];
        if (msg) pending.delete(msg);
        if (lastRun?.message === msg) lastRun = null;
    };
    on('MESSAGE_EDITED', forgetMessage);
    on('MESSAGE_SWIPED', forgetMessage);
    on('GENERATION_ENDED', () => { active = false; schedule(); });
    on('GENERATION_STOPPED', () => { active = false; schedule(); });
    on('CHAT_CHANGED', () => { pending.clear(); continuation = null; lastRun = null; active = false; if (timer !== null) cancelDefer(timer); timer = null; });
    return {
        flush: drain,
        refreshLatest,
        dispose() { disposed = true; if (timer !== null) cancelDefer(timer); pending.clear(); for (const [key, listener] of listeners) eventSource.removeListener(key, listener); },
    };
}
