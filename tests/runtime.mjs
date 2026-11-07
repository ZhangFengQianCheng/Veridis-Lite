import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createMessageCleaner } from '../src/runtime.js';
import { activePreset, createState } from '../src/model.js';

class Events {
    events = new Map();
    on(key, fn) { if (!this.events.has(key)) this.events.set(key,[]);this.events.get(key).push(fn); }
    removeListener(key, fn) { this.events.set(key,this.events.get(key).filter(x=>x!==fn)); }
    async emit(key,...args) { for(const fn of [...(this.events.get(key)||[])]) await fn(...args); }
}
const types=Object.fromEntries(['GENERATION_STARTED','GENERATION_ENDED','GENERATION_STOPPED','MESSAGE_RECEIVED','MESSAGE_SWIPED','MESSAGE_EDITED','CHARACTER_MESSAGE_RENDERED','CHAT_CHANGED'].map(k=>[k,k]));
function fixture(target='极其', replacement='') {
    const state = createState();
    const preset = { id: 'fixture-preset', name: '测试预设', rules: [
        { name: '示例', enabled: true, subRules: [{ mode: 'text', enabled: true, targets: [target], replacements: [replacement] }] },
    ] };
    state.presets.push(preset);
    state.activePresetId = preset.id;
    const bus=new Events(), timers=new Map(), warnings=[];let sequence=0,saves=0,updates=0;
    const host={chat:[],chatId:'test',saveChat:async()=>{saves++},updateMessageBlock:()=>{updates++}};
    const cleaner=createMessageCleaner({getContext:()=>host,getState:()=>state,eventSource:bus,eventTypes:types,
        notify:(message,kind)=>warnings.push({message,kind}),defer:fn=>{const id=++sequence;timers.set(id,fn);return id},cancelDefer:id=>timers.delete(id)});
    const tick=async()=>{const list=[...timers.values()];timers.clear();for(const fn of list)fn();await cleaner.flush()};
    const start=type=>bus.emit(types.GENERATION_STARTED,type||'normal',{},false);
    const receipt=(i,type)=>bus.emit(types.MESSAGE_RECEIVED,i,type||'normal');
    const end=()=>bus.emit(types.GENERATION_ENDED,host.chat.length);
    const message=text=>({is_user:false,mes:text,extra:{keep:true},swipe_id:0,swipes:[text],swipe_info:[{extra:{keep:true}}]});
    return {state,bus,host,cleaner,tick,start,receipt,end,message,warnings,get saves(){return saves},get updates(){return updates},get timerCount(){return timers.size}};
}

test('native nonstream order: reception before first Swipe materialization',async()=>{
    const f=fixture();await f.start();const m={is_user:false,mes:'他极其认真。',extra:{}};f.host.chat.push(m);
    await f.receipt(0);await f.tick();assert.equal(m.mes,'他极其认真。');
    m.swipe_id=0;m.swipes=[m.mes];await f.end();await f.tick();
    assert.equal(m.mes,'他认真。');assert.equal(m.swipes[0],m.mes);assert.equal(f.saves,1);f.cleaner.dispose();
});
test('native streaming order: generation end can precede reception',async()=>{
    const f=fixture();await f.start();const m=f.message('他极其认真。');f.host.chat.push(m);
    await f.end();await f.receipt(0);await f.tick();assert.equal(m.mes,'他认真。');assert.equal(f.saves,1);f.cleaner.dispose();
});
test('nonstream new Swipe waits for its real slot and preserves old branches',async()=>{
    const f=fixture();const m=f.message('旧极其回复');m.swipe_id=1;m.swipes.length=2;m.mes='新极其回复';f.host.chat.push(m);
    await f.start('swipe');await f.receipt(0,'swipe');await f.end();await f.tick();
    assert.equal(m.mes,'新极其回复');m.swipes[1]=m.mes;await f.tick();
    assert.equal(m.mes,'新回复');assert.equal(m.swipes[0],'旧极其回复');assert.equal(m.swipes[1],'新回复');f.cleaner.dispose();
});
test('ordinary replacement has no requirement for generation-start tracking',async()=>{
    const f=fixture();f.host.chat.push(f.message('极其'));await f.receipt(0);await f.tick();assert.equal(f.host.chat[0].mes,'');f.cleaner.dispose();
});
test('duplicate receipts do not apply a non-idempotent rule twice',async()=>{
    const f=fixture('a','aa');f.host.chat.push(f.message('a'));await f.receipt(0);await f.tick();await f.receipt(0);await f.tick();
    assert.equal(f.host.chat[0].mes,'aa');assert.equal(f.saves,1);f.cleaner.dispose();
});
test('continue processes appended text while preserving a previously cleaned prefix',async()=>{
    const f=fixture('a','aa'),m=f.message('aa');f.host.chat.push(m);await f.start('continue');m.mes+=' a';m.swipes[0]=m.mes;
    await f.receipt(0,'continue');await f.end();await f.tick();assert.equal(m.mes,'aa aa');f.cleaner.dispose();
});
test('modified continuation boundaries are rejected',async()=>{
    const f=fixture(),m=f.message('原文');f.host.chat.push(m);await f.start('continue');m.mes='不同的极其正文';await f.receipt(0);await f.end();await f.tick();
    assert.equal(m.mes,'不同的极其正文');assert.equal(f.saves,0);assert.equal(f.warnings.length,1);f.cleaner.dispose();
});
test('user, system, greetings and history are never automatically rewritten',async()=>{
    const f=fixture();f.host.chat.push({...f.message('极其'),is_user:true},{...f.message('极其'),is_system:true},f.message('极其'));
    await f.receipt(0);await f.receipt(1);await f.receipt(2,'first_message');await f.end();await f.tick();
    assert.ok(f.host.chat.every(m=>m.mes==='极其'));assert.equal(f.saves,0);f.cleaner.dispose();
});
test('chat switch, object replacement and branch switch reject stale targets',async()=>{
    for(const change of ['chat','object','branch']){
        const f=fixture(),m=f.message('极其');f.host.chat.push(m);await f.receipt(0);
        if(change==='chat') f.host.chatId='different';
        if(change==='object')f.host.chat[0]={...m};
        if(change==='branch'){m.swipes.push('其他极其分支');m.swipe_id=1;m.mes=m.swipes[1];}
        await f.tick();assert.equal(f.saves,0);assert.ok(m.mes.includes('极其'));f.cleaner.dispose();
    }
});
test('manual editing cancels a queued cleanup',async()=>{
    const f=fixture(),m=f.message('极其');f.host.chat.push(m);await f.receipt(0);await f.bus.emit(types.MESSAGE_EDITED,0);await f.tick();assert.equal(m.mes,'极其');f.cleaner.dispose();
});
test('master switch takes effect before a queued commit',async()=>{
    const f=fixture();f.host.chat.push(f.message('极其'));await f.receipt(0);f.state.enabled=false;await f.tick();assert.equal(f.saves,0);f.cleaner.dispose();
});
test('custom and Swipe metadata are preserved without storing provenance snapshots',async()=>{
    const f=fixture(),m=f.message('极其');m.extra.display_text='old';m.swipe_info[0].extra.display_text='old';m.custom={keep:true};f.host.chat.push(m);
    await f.receipt(0);await f.tick();assert.deepEqual(m.extra,{keep:true});assert.deepEqual(m.swipe_info[0].extra,{keep:true});assert.deepEqual(m.custom,{keep:true});
    assert.ok(!Object.keys(m).some(k=>k.startsWith('__blai')));f.cleaner.dispose();
});
test('unchanged text does not save or refresh the host',async()=>{
    const f=fixture();f.host.chat.push(f.message('正常正文'));await f.receipt(0);await f.tick();assert.equal(f.saves,0);assert.equal(f.updates,0);f.cleaner.dispose();
});
test('unmaterialized slots have a bounded retry budget and are not written',async()=>{
    const f=fixture(),m=f.message('极其');m.swipes=[];f.host.chat.push(m);await f.receipt(0);for(let i=0;i<40;i++)await f.tick();
    assert.equal(f.saves,0);assert.equal(f.timerCount,0);assert.equal(f.warnings.length,1);f.cleaner.dispose();
});
test('saving failures surface to the user',async()=>{
    const f=fixture();f.host.saveChat=async()=>{throw Error('offline')};f.host.chat.push(f.message('极其'));await f.receipt(0);await f.tick();
    assert.ok(f.warnings.some(w=>w.kind==='error'));f.cleaner.dispose();
});
test('disposing removes listeners and pending work',async()=>{
    const f=fixture();f.host.chat.push(f.message('极其'));await f.receipt(0);f.cleaner.dispose();await f.tick();assert.equal(f.saves,0);assert.ok([...f.bus.events.values()].every(list=>!list.length));
});

test('manual refresh applies newly added rules to the latest assistant only',async()=>{
    const f=fixture('甲','乙'),old=f.message('旧甲'),latest=f.message('新甲');
    f.host.chat.push(old,latest,{is_user:true,mes:'用户甲'});const result=await f.cleaner.refreshLatest();
    assert.equal(result.status,'applied');assert.equal(latest.mes,'新乙');assert.equal(latest.swipes[0],'新乙');assert.equal(old.mes,'旧甲');assert.equal(f.host.chat[2].mes,'用户甲');assert.equal(f.saves,1);f.cleaner.dispose();
});
test('manual refresh remains available when automatic processing is paused',async()=>{
    const f=fixture();f.state.enabled=false;f.host.chat.push(f.message('极其'));assert.equal((await f.cleaner.refreshLatest()).status,'applied');assert.equal(f.host.chat[0].mes,'');f.cleaner.dispose();
});
test('manual refresh re-evaluates current rules without accumulating earlier replacements',async()=>{
    const f=fixture('a','aa'),m=f.message('a');f.host.chat.push(m);await f.receipt(0);await f.tick();
    assert.equal((await f.cleaner.refreshLatest()).status,'unchanged');assert.equal(m.mes,'aa');
    activePreset(f.state).rules[0].subRules.push({mode:'text',enabled:true,targets:['z'],replacements:[]});
    assert.equal((await f.cleaner.refreshLatest()).status,'unchanged');assert.equal(m.mes,'aa');assert.equal(f.saves,1);f.cleaner.dispose();
});
test('manual refresh respects external edits and preserves appended content',async()=>{
    const f=fixture('甲','乙'),m=f.message('甲');f.host.chat.push(m);await f.receipt(0);await f.tick();
    m.mes+='\n<StatusPlaceHolderImpl/>';m.swipes[0]=m.mes;
    activePreset(f.state).rules[0].subRules[0].replacements=['丙'];await f.cleaner.refreshLatest();assert.equal(m.mes,'丙\n<StatusPlaceHolderImpl/>');
    m.mes='手动甲';m.swipes[0]=m.mes;await f.bus.emit(types.MESSAGE_EDITED,0);await f.cleaner.refreshLatest();assert.equal(m.mes,'手动丙');f.cleaner.dispose();
});
test('manual refresh after continuation uses the known original prefix without duplication',async()=>{
    const f=fixture('a','aa'),m=f.message('a');f.host.chat.push(m);await f.receipt(0);await f.tick();await f.start('continue');m.mes+=' a';m.swipes[0]=m.mes;await f.receipt(0,'continue');await f.end();await f.tick();
    assert.equal(m.mes,'aa aa');assert.equal((await f.cleaner.refreshLatest()).status,'unchanged');assert.equal(m.mes,'aa aa');f.cleaner.dispose();
});
test('manual refresh rejects active generation, bad rules and incomplete Swipe slots',async()=>{
    const f=fixture(),m=f.message('极其');f.host.chat.push(m);await f.start();assert.equal((await f.cleaner.refreshLatest()).status,'busy');await f.end();
    m.swipes=[];assert.equal((await f.cleaner.refreshLatest()).status,'busy');m.swipes=['极其'];
    activePreset(f.state).rules[0].subRules=[{mode:'regex',enabled:true,targets:['['],replacements:[]}];assert.equal((await f.cleaner.refreshLatest()).status,'error');assert.equal(m.mes,'极其');assert.equal(f.saves,0);f.cleaner.dispose();
});
test('manual refresh reports empty chats and failed saves without claiming success',async()=>{
    const f=fixture();assert.equal((await f.cleaner.refreshLatest()).status,'empty');f.host.chat.push(f.message('极其'));f.host.saveChat=async()=>{throw Error('offline')};assert.equal((await f.cleaner.refreshLatest()).status,'save-failed');f.cleaner.dispose();
});
test('a failed manual save can be retried without repeating the replacement',async()=>{
    const f=fixture('a','aa'),m=f.message('a');f.host.chat.push(m);f.host.saveChat=async()=>{throw Error('offline')};
    assert.equal((await f.cleaner.refreshLatest()).status,'save-failed');assert.equal(m.mes,'aa');let saved=0;f.host.saveChat=async()=>{saved++};
    assert.equal((await f.cleaner.refreshLatest()).status,'saved');assert.equal(m.mes,'aa');assert.equal(saved,1);f.cleaner.dispose();
});
