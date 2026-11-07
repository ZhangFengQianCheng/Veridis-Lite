import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyRules, compileRules, compileTarget, validateRule } from '../src/engine.js';
import { activePreset, createState, exportPreset, importPreset, loadState, uniqueName } from '../src/model.js';
import { getTextDiffOperations } from '../src/diff.js';
import { getHistory, pruneHistory, writeHistory, branchOf } from '../src/history.js';
import { renderComparison } from '../src/diffView.js';

const rule = (targets, replacements = [], mode = 'text', enabled = true) => ({targets, replacements, mode, enabled});
const group = (...subRules) => ({name: '合成示例', enabled: true, subRules});
const apply = (text, rules, options) => applyRules(text, compileRules([group(...rules)]), options);

test('literal text matches punctuation exactly and supports deletion', () => {
    assert.equal(apply('他极其认真，使用 a+b。极其。', [rule(['极其']), rule(['a+b'], ['普通词'])]).text, '他认真，使用 普通词。。');
});
test('literal alternatives run longest first without cascading into one another', () => {
    assert.equal(apply('甲乙 甲 a', [rule(['甲'], ['a']), rule(['甲乙'], ['b']), rule(['a'], ['c'])]).text, 'b a c');
});
test('duplicate literal targets keep the upstream last-rule priority', () => {
    assert.equal(apply('甲', [rule(['甲'], ['乙']), rule(['甲'], ['丙'])]).text, '丙');
});
test('disabled groups and rules do not participate', () => {
    const compiled = compileRules([{...group(rule(['甲'])), enabled: false}, group(rule(['乙'], [], 'text', false))]);
    assert.equal(applyRules('甲乙', compiled).text, '甲乙');
});
test('random candidates are chosen independently for each occurrence', () => {
    const values = [0, .9, 0]; let i = 0;
    assert.equal(apply('甲甲甲', [rule(['甲'], ['乙', '丙'])], { random: () => values[i++] }).text, '乙丙乙');
});
test('simple combinations support alternatives and bounded wildcard', () => {
    assert.equal(apply('他非常开心。她极其认真。', [rule(['{非常,极其}*。'], ['结束。'], 'simple')]).text, '他结束。她结束。');
    assert.equal(apply('甲，乙', [rule(['甲*乙'], [], 'simple')]).text, '甲，乙');
    assert.equal(apply('甲' + '字'.repeat(16) + '乙', [rule(['甲*乙'], [], 'simple')]).changes, 0);
});
test('regex replacement supports captures and escaped control characters', () => {
    assert.equal(apply('编号12', [rule(['编号(\\d+)'], ['$1\\n完成'], 'regex')]).text, '12\n完成');
    assert.equal(apply('AB ab', [rule(['/ab/i'], ['ok'], 'regex')]).text, 'ok ok');
    assert.equal(apply('a', [rule(['(?<word>a)'], ['$1'], 'regex')]).text, 'a');
});
test('invalid expressions and unconditional empty matches are rejected', () => {
    for (const target of ['[', '/a/ii', '/a/z', '.*', '^']) assert.throws(() => compileTarget(target, 'regex'));
    assert.throws(() => validateRule(rule([], [], 'text')));
    assert.throws(() => validateRule(rule(['*'], [], 'simple')));
    assert.equal(compileRules([group(rule(['['], [], 'regex'))]).errors.length, 1);
});
test('conditional empty matches never insert or loop', () => {
    assert.equal(apply('a', [rule(['(?=a)'], ['bad'], 'regex')]).text, 'a');
});
test('variable data and placeholders are preserved exactly', () => {
    const block = '<UpdateVariable>甲<UpdateVariable>甲</UpdateVariable>甲</UpdateVariable>';
    const source = '甲' + block + '甲<StatusPlaceHolderImpl/>';
    assert.equal(apply(source, [rule(['甲', 'StatusPlaceHolderImpl'])]).text, block + '<StatusPlaceHolderImpl/>');
    assert.equal(apply('甲<UpdateVariable>甲', [rule(['甲'])]).text, '<UpdateVariable>甲');
});
test('continuation applies only after the established prefix', () => {
    assert.equal(apply('甲甲 甲', [rule(['甲'], ['甲甲'])], {startAt: 3}).text, '甲甲 甲甲');
});
test('legacy JSON imports keep ordinary rules and discard all model data', () => {
    const payload = {type:'veridis-rewrite-preset',version:2,apiKey:'never-copy',aiRewrite:{apiKey:'never-copy'},rules:[{
        name:'示例',enabled:false,subRules:[{...rule(['甲'],['乙']),rewriteMode:'program',aiPromptTemplate:'never-copy'},
        {...rule(['丙']),rewriteMode:'ai',aiPromptTemplate:'never-copy'}]}]};
    const {preset,skipped} = importPreset(payload,'导入');
    assert.equal(skipped,1);assert.equal(preset.rules[0].enabled,false);assert.equal(preset.rules[0].subRules.length,1);
    const exported=exportPreset(preset), serialized=JSON.stringify(exported);
    assert.ok(!serialized.includes('never-copy'));assert.ok(!serialized.includes('aiRewrite'));assert.ok(!serialized.includes('rewriteMode'));
    assert.deepEqual(exportPreset(importPreset(exported).preset),exported);
});
test('legacy wrappers, flat rules and numeric dictionaries are accepted', () => {
    const g = group(rule(['甲']));
    for (const payload of [[g], {__content__:{rules:[g]}}, {content:[g]}, {'0':g}, {named:g}, [rule(['甲'])]]) {
        assert.equal(importPreset(payload).preset.rules[0].subRules[0].targets[0],'甲');
    }
});
test('malformed and AI-only imports fail instead of replacing working rules', () => {
    for (const payload of [null, {}, {rules:[null]}, {rules:[{subRules:[{}]}]}, {rules:[group({...rule(['甲']),rewriteMode:'ai'})]}]) assert.throws(()=>importPreset(payload));
});
test('multiline literals and replacements survive JSON round trips', () => {
    const first=importPreset([group(rule(['甲\n乙'],['丙\n丁','']))]).preset;
    assert.deepEqual(exportPreset(importPreset(exportPreset(first)).preset),exportPreset(first));
});
test('own settings are independent and preset names stay unique', () => {
    const empty = createState();
    assert.deepEqual(empty, { version: 1, enabled: true, showInMagicWand: true, manualCleanLimit: null, activePresetId: null, presets: [] });
    assert.deepEqual(loadState(undefined), empty);
    const paused = { ...empty, enabled: false };
    assert.deepEqual(loadState(paused), paused);
    assert.equal(activePreset(empty), undefined);
    const preset = { id: 'fixture-preset', name: '测试预设', rules: [] };
    const state = { version: 1, enabled: false, activePresetId: preset.id, presets: [preset] };
    assert.deepEqual(activePreset(state), preset);
    assert.equal(uniqueName(state, '测试预设'), '测试预设 (2)');
    const restored = loadState(state);
    assert.deepEqual(restored, { ...empty, ...state });
    assert.notEqual(restored, state);
    const configured = { ...restored, showInMagicWand: false, manualCleanLimit: 12 };
    assert.deepEqual(loadState(configured), configured);
    for (const invalid of [0, -1, 1.5, '12', Number.MAX_SAFE_INTEGER + 1]) {
        assert.equal(loadState({ ...configured, manualCleanLimit: invalid }).manualCleanLimit, null);
    }
    assert.throws(()=>loadState({presets:[{}]}));
});
test('exact diff reconstructs both sides including repeated text, emoji and whitespace',()=>{
    for(const [before,after] of [['泥星','污泥'],['甲甲乙甲','甲乙丙甲'],['你好😀\n甲','你好😀\n乙'],['a\n\nb','a\nb'],['','新正文'],['旧正文',''],['<script>甲</script>','<script>乙</script>']]){
        const ops=getTextDiffOperations(before,after);
        assert.equal(ops.filter(op=>op.type!=='insert').map(op=>op.text).join(''),before);
        assert.equal(ops.filter(op=>op.type!=='delete').map(op=>op.text).join(''),after);
    }
});
test('comparison HTML escapes source markup and shows actual removals and insertions',()=>{
    const result=renderComparison(getTextDiffOperations('<img onerror="bad">甲','<img onerror="bad">乙'));
    assert.ok(!result.includes('<img'));assert.ok(result.includes('&lt;img'));assert.ok(result.includes('<del>甲</del>'));assert.ok(result.includes('<ins>乙</ins>'));
});
test('history eviction removes only this extension records beyond the last ten assistants',()=>{
    const chat=Array.from({length:12},(_,i)=>({is_user:false,mes:'甲'+i,extra:{other:'keep'},swipe_id:0,swipes:['甲'+i],swipe_info:[{extra:{other:'keep'}}]}));
    for(const message of chat)writeHistory(message,branchOf(message),'原文',message.mes,1);
    assert.equal(pruneHistory(chat),true);assert.equal(getHistory(chat[0]),null);assert.equal(getHistory(chat[1]),null);assert.ok(getHistory(chat[2]));
    assert.equal(chat[0].extra.other,'keep');assert.equal(chat[0].swipe_info[0].extra.other,'keep');
});
test('a saved comparison follows its Swipe when an earlier candidate is deleted',()=>{
    const message={mes:'乙',swipe_id:1,swipes:['其他','乙'],extra:{},swipe_info:[{extra:{}},{extra:{}}]};
    writeHistory(message,branchOf(message),'甲','乙',1);message.swipes.splice(0,1);message.swipe_info.splice(0,1);message.swipe_id=0;
    assert.equal(getHistory(message).before,'甲');assert.equal(getHistory(message).after,'乙');
});
test('snippets stop at sentence boundaries and exclude unchanged neighbouring sentences',()=>{
    const before='她换好衣服。鞋面沾上泥星，随后走到出口。守卫叫她停下。';
    const after=before.replace('泥星','污泥');const output=renderComparison(getTextDiffOperations(before,after));
    assert.ok(output.includes('鞋面沾上'));assert.ok(output.includes('随后走到出口。'));
    assert.ok(!output.includes('她换好衣服'));assert.ok(!output.includes('守卫叫她停下'));
    assert.equal((output.match(/class="vrl-diff-fragment"/g)||[]).length,1);
});
test('several edits in one sentence are displayed together once',()=>{
    const output=renderComparison(getTextDiffOperations('刚才，他非常认真地检查泥星。','方才，他认真地检查污泥。'));
    assert.equal((output.match(/class="vrl-diff-fragment"/g)||[]).length,1);
    assert.ok(output.includes('<del>'));assert.ok(output.includes('<ins>'));
});
test('long changed sentences are not clipped to a fixed character count',()=>{
    const start='没有句号的前文'.repeat(18),end='句尾的内容'.repeat(18)+'。';
    const output=renderComparison(getTextDiffOperations(start+'甲'+end+'无关下一句。',start+'乙'+end+'无关下一句。'));
    assert.ok(output.includes(start));assert.ok(output.includes(end));assert.ok(!output.includes('无关下一句'));
});
test('changed sentences remain separate across an unchanged middle sentence',()=>{
    const output=renderComparison(getTextDiffOperations('甲句。中间没有改动。乙句。','丙句。中间没有改动。丁句。'));
    assert.equal((output.match(/class="vrl-diff-fragment"/g)||[]).length,2);assert.ok(!output.includes('中间没有改动'));
});
test('sentence snippets retain closing quotes and respect newlines and decimal numbers',()=>{
    for(const [before,after,included,excluded] of [
        ['他说：“甲。”她走开了。','他说：“乙。”她走开了。','。”','她走开了'],
        ['甲行\n下一行不变','乙行\n下一行不变','行','下一行不变'],
        ['Value 3.14 is bad. Another sentence.','Value 3.14 is good. Another sentence.','Value 3.14 is','Another sentence'],
    ]){const output=renderComparison(getTextDiffOperations(before,after));assert.ok(output.includes(included));assert.ok(!output.includes(excluded));}
});
test('punctuation replacements stay paired and full comparison keeps untouched sentences',()=>{
    const ops=getTextDiffOperations('第一句。下一句不变。','第一句！下一句不变。');
    const snippet=renderComparison(ops);assert.ok(snippet.includes('<del>。</del>'));assert.ok(snippet.includes('<ins>！</ins>'));assert.ok(!snippet.includes('下一句不变'));
    assert.ok(renderComparison(ops,'full').includes('下一句不变'));
});
