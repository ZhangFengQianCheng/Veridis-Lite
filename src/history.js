import { protectedRanges } from './engine.js';

export const HISTORY_KEY = 'veridis_lite';
const COMPARISON_LIMIT = 10;
export const assistant = message => !!message && message.is_user !== true && message.is_system !== true && typeof message.mes === 'string';
export function recentAssistantIndices(chat, limit = COMPARISON_LIMIT) {
    const result = [];
    for (let i = (chat?.length || 0) - 1; i >= 0 && result.length < limit; i--) if (assistant(chat[i])) result.push(i);
    return result.reverse();
}
export function branchOf(message) {
    if (message.swipes === undefined) return { key: 'main', index: -1 };
    const index = message.swipe_id;
    if (!Array.isArray(message.swipes) || !Number.isInteger(index) || index < 0 || index >= message.swipes.length) return null;
    const slot = message.swipes[index];
    return typeof slot === 'string' || (slot && typeof slot.mes === 'string') ? { key: `swipe:${index}`, index } : null;
}
export function getHistory(message, branch = branchOf(message)) {
    if (!branch) return null;
    const record = message.extra?.[HISTORY_KEY];
    const slot = message.swipe_info?.[branch.index]?.extra?.[HISTORY_KEY];
    const belongsToSlot = branch.index >= 0 && slot?.before === record?.before && slot?.after === record?.after && slot?.version === 1;
    return record?.version === 1 && (record.branch === branch.key || belongsToSlot) && typeof record.before === 'string' && typeof record.after === 'string'
        ? record : null;
}
export function writeHistory(message, branch, before, after, changes) {
    const current = message.extra?.[HISTORY_KEY];
    const next = before === after ? null : { version: 1, branch: branch.key, before, after, changes };
    if (!next && !current && !message.swipe_info?.[branch.index]?.extra?.[HISTORY_KEY]) return false;
    let dirty = JSON.stringify(current ?? null) !== JSON.stringify(next);
    if (!message.extra) message.extra = {};
    if (next) message.extra[HISTORY_KEY] = next;
    else delete message.extra[HISTORY_KEY];
    const swipe = message.swipe_info?.[branch.index];
    if (swipe) {
        if (!swipe.extra) swipe.extra = {};
        if (JSON.stringify(swipe.extra[HISTORY_KEY] ?? null) !== JSON.stringify(next)) dirty = true;
        if (next) swipe.extra[HISTORY_KEY] = structuredClone(next);
        else delete swipe.extra[HISTORY_KEY];
    }
    return dirty;
}
export function pruneHistory(chat, manualLimit = 1) {
    const retained = new Set(recentAssistantIndices(chat, Math.max(COMPARISON_LIMIT, manualLimit)));
    let dirty = false;
    for (const [index, message] of chat.entries()) {
        if (!message || typeof message !== 'object') continue;
        if (retained.has(index)) continue;
        for (const extra of [message.extra, ...(message.swipe_info || []).map(swipe => swipe?.extra)]) {
            if (extra && Object.hasOwn(extra, HISTORY_KEY)) { delete extra[HISTORY_KEY]; dirty = true; }
        }
    }
    return dirty;
}
export function syncSwipe(message, branch) {
    if (branch.index < 0) return;
    const slot = message.swipes[branch.index];
    if (typeof slot === 'string') message.swipes[branch.index] = message.mes;
    else slot.mes = message.mes;
}
export function proseForDiff(text) {
    const source = String(text ?? '');
    let result = '', cursor = 0;
    for (const range of protectedRanges(source)) {
        if (range.end <= cursor) continue;
        if (range.start > cursor) result += source.slice(cursor, range.start);
        cursor = range.end;
    }
    return result + source.slice(cursor);
}
