// Based on Veridis Rewrite's literal/simple/regex matching semantics.
// Original: https://github.com/The-Veridis-Lion/Veridis-Rewrite
// Pure string transformation. No host, DOM, model, or persistence dependencies.

const escape = value => String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const wildcard = '[^,，。.!?！？；;\\n]{0,15}?';

function simplePattern(text) {
    let pattern = '';
    for (let i = 0; i < text.length; i++) {
        if (text[i] === '*') { pattern += wildcard; continue; }
        if (text[i] === '{') {
            const end = text.indexOf('}', i + 1);
            if (end >= 0) {
                const choices = text.slice(i + 1, end).split(/[,，]/).filter(Boolean);
                if (!choices.length) throw new Error('组合括号中至少需要一个候选。');
                pattern += `(?:${choices.map(escape).join('|')})`;
                i = end;
                continue;
            }
        }
        pattern += escape(text[i]);
    }
    return pattern;
}

export function compileTarget(target, mode = 'text') {
    if (typeof target !== 'string' || !target.length) throw new Error('匹配内容不能为空。');
    let pattern = mode === 'text' ? escape(target) : mode === 'simple' ? simplePattern(target) : target.trim();
    let flags = 'gmu';
    if (mode === 'regex' && pattern.startsWith('/')) {
        let end = -1;
        for (let i = pattern.length - 1; i > 0; i--) {
            if (pattern[i] !== '/') continue;
            let backslashes = 0;
            for (let j = i - 1; j >= 0 && pattern[j] === '\\'; j--) backslashes++;
            if (backslashes % 2 === 0) { end = i; break; }
        }
        if (end < 1) throw new Error('请使用 /表达式/flags，或直接填写表达式。');
        flags = pattern.slice(end + 1);
        pattern = pattern.slice(1, end);
        if (!flags.includes('g')) flags += 'g';
    }
    let regex;
    try { regex = new RegExp(pattern, flags); }
    catch (error) { throw new Error(`表达式无效：${error.message}`); }
    if (regex.test('')) throw new Error('匹配内容不能匹配空字符串。');
    regex.lastIndex = 0;
    return regex;
}

export function validateRule(rule) {
    if (!['text', 'simple', 'regex'].includes(rule.mode)) throw new Error('未知的匹配方式。');
    if (!Array.isArray(rule.targets) || !rule.targets.length) throw new Error('至少填写一个匹配项。');
    for (const target of rule.targets) compileTarget(target, rule.mode);
}

// Preserve the upstream replacement syntax: $1..$99 and \n / \r / \t / \\.
export function expandReplacement(template, captures) {
    return String(template).replace(/\\([nrt\\$])|\$([1-9]\d?)/g, (_all, escaped, capture) => {
        if (capture) return captures[Number(capture) - 1] ?? '';
        return { n: '\n', r: '\r', t: '\t', '\\': '\\', $: '$' }[escaped];
    });
}

export function compileRules(groups = []) {
    const processors = [], errors = [];
    // Adjacent literal rules share one longest-first pass, as in the upstream engine.
    // Replacements from earlier literal rules are not fed into later literal rules.
    const literals = new Map();
    for (const [gi, group] of groups.entries()) {
        if (group.enabled === false) continue;
        for (const [ri, rule] of group.subRules.entries()) {
            if (rule.enabled === false) continue;
            try {
                validateRule(rule);
                if (rule.mode === 'text') {
                    for (const target of rule.targets) literals.set(target, rule.replacements);
                } else {
                    for (const target of rule.targets) processors.push({ regex: compileTarget(target, rule.mode), rule });
                }
            } catch (error) { errors.push({ group: gi, rule: ri, message: error.message }); }
        }
    }
    if (literals.size) {
        const targets = [...literals.keys()].sort((a, b) => b.length - a.length);
        processors.unshift({ regex: new RegExp(targets.map(escape).join('|'), 'gmu'), literals });
    }
    return { processors, errors };
}

export function protectedRanges(text) {
    const ranges = [];
    const tag = /<\/?UpdateVariable\b[^>]*>/gi;
    let depth = 0, start = 0;
    for (const match of text.matchAll(tag)) {
        if (match[0].startsWith('</')) {
            if (depth && --depth === 0) ranges.push({ start, end: match.index + match[0].length });
        } else {
            if (depth++ === 0) start = match.index;
        }
    }
    if (depth) ranges.push({ start, end: text.length });
    for (const match of text.matchAll(/<StatusPlaceHolderImpl\s*\/>/gi)) ranges.push({ start: match.index, end: match.index + match[0].length });
    return ranges.sort((a, b) => a.start - b.start);
}

export function applyRules(text, compiled, { startAt = 0, random = Math.random } = {}) {
    const source = String(text ?? '');
    let changes = 0;
    const transform = segment => {
        let value = segment;
        for (const processor of compiled.processors) {
            processor.regex.lastIndex = 0;
            value = value.replace(processor.regex, (match, ...args) => {
                if (!match.length) return match;
                const candidates = processor.literals?.get(match) ?? processor.rule?.replacements ?? [];
                const index = Math.min(candidates.length - 1, Math.max(0, Math.floor(random() * candidates.length)));
                const selected = candidates.length ? candidates[index] : '';
                const named = typeof args.at(-1) === 'object';
                const captures = args.slice(0, named ? -3 : -2);
                const replacement = processor.rule?.mode === 'regex' ? expandReplacement(selected, captures) : selected;
                if (replacement !== match) changes++;
                return replacement;
            });
        }
        return value;
    };
    const ranges = [{ start: 0, end: Math.min(source.length, Math.max(0, startAt)) }, ...protectedRanges(source)];
    let output = '', cursor = 0;
    for (const range of ranges.sort((a, b) => a.start - b.start)) {
        if (range.end <= cursor) continue;
        if (range.start > cursor) output += transform(source.slice(cursor, range.start));
        output += source.slice(Math.max(cursor, range.start), range.end);
        cursor = range.end;
    }
    output += transform(source.slice(cursor));
    return { text: output, changes };
}
