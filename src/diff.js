// Exact text-diff core adapted from Veridis Rewrite. Attribution and restrictions: COPYRIGHT.md.
export function escapeHtml(value = '') {
    return String(value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function pushDiffOperation(operations, type, text = '') {
    if (!text) return;
    const last = operations[operations.length - 1];
    // Keep replacements in delete/insert order for related-rule selection.
    if (type === 'delete' && last?.type === 'insert') {
        operations.pop();
        pushDiffOperation(operations, 'delete', text);
        pushDiffOperation(operations, 'insert', last.text);
        return;
    }
    if (last && last.type === type) last.text += text;
    else operations.push({ type, text });
}

// Linear-space Myers bisection. Both frontiers follow exact equal code points;
// there is no size/deadline cutoff that can turn an unexamined middle into edits.
function findMiddleSplit(left, right, a, b, c, d) {
    const m = b - a;
    const n = d - c;
    const maxDepth = Math.ceil((m + n) / 2);
    const offset = maxDepth + 1;
    const forward = new Int32Array(2 * maxDepth + 3).fill(-1);
    const reverse = new Int32Array(2 * maxDepth + 3).fill(-1);
    forward[offset + 1] = reverse[offset + 1] = 0;
    const delta = m - n;
    const odd = delta % 2 !== 0;
    let forwardStart = 0;
    let forwardEnd = 0;
    let reverseStart = 0;
    let reverseEnd = 0;
    for (let depth = 0; depth < maxDepth; depth++) {
        for (let k = -depth + forwardStart; k <= depth - forwardEnd; k += 2) {
            const slot = offset + k;
            let x = k === -depth || (k !== depth && forward[slot - 1] < forward[slot + 1])
                ? forward[slot + 1] : forward[slot - 1] + 1;
            let y = x - k;
            while (x < m && y < n && left[a + x] === right[c + y]) { x++; y++; }
            forward[slot] = x;
            if (x > m) forwardEnd += 2;
            else if (y > n) forwardStart += 2;
            else if (odd) {
                const other = offset + delta - k;
                if (other >= 0 && other < reverse.length && reverse[other] !== -1
                    && x >= m - reverse[other]) return [a + x, c + y];
            }
        }
        for (let k = -depth + reverseStart; k <= depth - reverseEnd; k += 2) {
            const slot = offset + k;
            let x = k === -depth || (k !== depth && reverse[slot - 1] < reverse[slot + 1])
                ? reverse[slot + 1] : reverse[slot - 1] + 1;
            let y = x - k;
            while (x < m && y < n && left[b - x - 1] === right[d - y - 1]) { x++; y++; }
            reverse[slot] = x;
            if (x > m) reverseEnd += 2;
            else if (y > n) reverseStart += 2;
            else if (!odd) {
                const other = offset + delta - k;
                if (other >= 0 && other < forward.length && forward[other] !== -1
                    && forward[other] >= m - x) {
                    const forwardX = forward[other];
                    return [a + forwardX, c + forwardX - (delta - k)];
                }
            }
        }
    }
    // Exhausting all depths proves there is no equality in this region.
    return null;
}

/** Exact, deterministic pair diff shared with Deep Clean; no provenance or state. */
export function getTextDiffOperations(oldStr, newStr) {
    const left = Array.from(String(oldStr ?? ''));
    const right = Array.from(String(newStr ?? ''));
    const operations = [];
    // Explicit work stack avoids a call-stack limit on adversarial input.
    const pending = [{ a: 0, b: left.length, c: 0, d: right.length }];
    while (pending.length) {
        const task = pending.pop();
        if (task.type) {
            pushDiffOperation(operations, task.type, task.text);
            continue;
        }
        let { a, b, c, d } = task;
        const start = a;
        while (a < b && c < d && left[a] === right[c]) { a++; c++; }
        pushDiffOperation(operations, 'equal', left.slice(start, a).join(''));
        const end = b;
        while (a < b && c < d && left[b - 1] === right[d - 1]) { b--; d--; }
        if (b < end) pending.push({ type: 'equal', text: left.slice(b, end).join('') });
        if (a === b || c === d) {
            pushDiffOperation(operations, 'delete', left.slice(a, b).join(''));
            pushDiffOperation(operations, 'insert', right.slice(c, d).join(''));
            continue;
        }
        const split = findMiddleSplit(left, right, a, b, c, d);
        if (split) {
            const [x, y] = split;
            pending.push({ a: x, b, c: y, d });
            pending.push({ a, b: x, c, d: y });
        } else {
            pushDiffOperation(operations, 'delete', left.slice(a, b).join(''));
            pushDiffOperation(operations, 'insert', right.slice(c, d).join(''));
        }
    }
    return operations;
}
