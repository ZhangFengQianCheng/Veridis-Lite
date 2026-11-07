export const SETTINGS_KEY = 'veridis_lite';
export const id = () => globalThis.crypto?.randomUUID?.() || `vrl-${Date.now()}-${Math.random().toString(36).slice(2)}`;
export const clone = value => JSON.parse(JSON.stringify(value));
const strings = value => Array.isArray(value) ? value.filter(v => typeof v === 'string') : [];

export function newRule() {
    return { id: id(), mode: 'text', enabled: true, targets: [], replacements: [], remark: '' };
}

function normalizeRule(source) {
    return {
        id: id(), enabled: source.enabled !== false,
        mode: ['text', 'simple', 'regex'].includes(source.mode) ? source.mode : 'text',
        targets: strings(source.targets).filter(v => v.length > 0),
        replacements: strings(source.replacements), remark: String(source.remark ?? source.note ?? ''),
    };
}

function unwrap(source, depth = 0) {
    if (depth > 10) throw new Error('预设嵌套层数过多。');
    if (Array.isArray(source)) return source;
    if (!source || typeof source !== 'object') throw new Error('预设必须是 JSON 对象或数组。');
    for (const key of ['rules', 'groups', '__content__', 'content']) if (key in source) return unwrap(source[key], depth + 1);
    if (Array.isArray(source.subRules) || Array.isArray(source.targets)) return [source];
    const keys = Object.keys(source).filter(key => /^\d+$/.test(key)).sort((a, b) => Number(a) - Number(b));
    const candidates = (keys.length ? keys.map(key => source[key]) : Object.values(source))
        .filter(v => v && typeof v === 'object' && (Array.isArray(v.subRules) || Array.isArray(v.targets)));
    if (candidates.length) return candidates;
    throw new Error('未识别到规则。请导入单个规则预设的 JSON 文件。');
}

export function importPreset(payload, name = '导入预设') {
    let skipped = 0;
    const rules = unwrap(payload).map((source, index) => {
        if (!source || typeof source !== 'object' || Array.isArray(source)) throw new Error(`第 ${index + 1} 个分组格式错误。`);
        const entries = Array.isArray(source.subRules) ? source.subRules : Array.isArray(source.targets) ? [source] : [];
        const subRules = [];
        for (const entry of entries) {
            if (!entry || typeof entry !== 'object' || !Array.isArray(entry.targets)) throw new Error(`第 ${index + 1} 个分组中的规则格式错误。`);
            if (entry.rewriteMode === 'ai') { skipped++; continue; }
            const rule = normalizeRule(entry);
            if (!rule.targets.length) throw new Error(`第 ${index + 1} 个分组中存在空匹配规则。`);
            subRules.push(rule);
        }
        return { id: id(), name: String(source.name || `规则组 ${index + 1}`), enabled: source.enabled !== false, subRules };
    });
    if (!rules.length) throw new Error('预设中没有规则分组。');
    if (skipped && !rules.some(group => group.subRules.length)) throw new Error('这个预设只包含 AI 规则，精简版无法使用。');
    return { preset: { id: id(), name: String(payload?.name || name), rules }, skipped };
}

export function exportPreset(preset) {
    return {
        type: 'veridis-lite-preset', version: 1, name: preset.name,
        rules: preset.rules.map(group => ({ name: group.name, enabled: group.enabled, subRules: group.subRules.map(rule => ({
            mode: rule.mode, enabled: rule.enabled, targets: [...rule.targets], replacements: [...rule.replacements], remark: rule.remark,
        })) })),
    };
}

export function createState() {
    return { version: 1, enabled: true, activePresetId: null, presets: [] };
}

export function loadState(stored) {
    if (!stored || !Array.isArray(stored.presets)) return createState();
    // Only accept this extension's own shape; never read or overwrite the upstream namespace.
    const state = clone(stored);
    for (const preset of state.presets) {
        if (!preset.id || !Array.isArray(preset.rules)) throw new Error('精简版设置格式损坏，请先备份设置。');
        for (const group of preset.rules) {
            if (!Array.isArray(group.subRules)) throw new Error('精简版规则分组格式损坏。');
        }
    }
    state.enabled = state.enabled !== false;
    if (!state.presets.some(p => p.id === state.activePresetId)) state.activePresetId = state.presets[0]?.id ?? null;
    return state;
}

export function activePreset(state) { return state.presets.find(p => p.id === state.activePresetId); }
export function uniqueName(state, proposed) {
    const base = String(proposed || '新预设').trim() || '新预设';
    let name = base, i = 2;
    while (state.presets.some(p => p.name === name)) name = `${base} (${i++})`;
    return name;
}
