// Headless, isolated browser fixture. All requests are fulfilled in-process;
// no listening server, desktop control, real chat service, or model connection.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';

const {chromium} = process.env.VRL_TEST_MODULES
    ? await import(pathToFileURL(path.join(process.env.VRL_TEST_MODULES,'playwright','index.mjs')).href)
    : await import('playwright');
const root=path.resolve(fileURLToPath(new URL('..',import.meta.url)));
const output=path.join(root,'test-results');fs.mkdirSync(output,{recursive:true});
const prefix='/scripts/extensions/third-party/Veridis-Lite/';
const nativeRow=label=>`<div class="extension_container"><div class="inline-drawer"><div class="inline-drawer-toggle inline-drawer-header"><b>${label}</b><span aria-hidden="true">⌄</span></div></div></div>`;
const fixture=`<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Veridis Lite isolated fixture</title><link rel="stylesheet" href="${prefix}style.css"><style>
html,body{margin:0;height:100%;font-family:'Segoe UI','Microsoft YaHei',sans-serif;background:#151713;color:#ddd}body{background:radial-gradient(ellipse at 50% 30%,#33372b,#151713 75%)}
:root{--SmartThemeBlurTintColor:#25271f;--SmartThemeBodyColor:#e7e7de;--SmartThemeBorderColor:#3a3d32;--SmartThemeQuoteColor:#d6bb6d}
body{display:block;overflow:auto;min-height:100vh}#extensionsMenu{position:absolute;top:15px;left:20px}
#host-panel{width:min(1024px,calc(100vw - 32px));margin:65px auto 25px;padding:12px;background:var(--SmartThemeBlurTintColor);border:1px solid var(--SmartThemeBorderColor);border-radius:10px}#host-panel>h3{margin:0 0 12px;font-size:20px}.vrl-host-columns{display:flex;gap:10px}.vrl-host-columns>div{flex:1;min-width:0;width:50%}
.menu_button{width:min-content}.inline-drawer-header{display:flex;align-items:center;justify-content:space-between;border:1px solid var(--SmartThemeBorderColor);border-radius:9px;padding:4px 7px;margin-bottom:5px;font-size:16px;background:linear-gradient(348deg,#ffffff10,#0009)}
@media(max-width:600px){#host-panel{margin-top:60px}.vrl-host-columns{flex-direction:column}.vrl-host-columns>div{width:100%}}
</style></head><body><div id="extensionsMenu"></div><section id="host-panel"><h3>扩展程序</h3><div class="vrl-host-columns"><div id="extensions_settings" class="flex1 wide50p">${['下载扩展程序和资源','角色表情','图像生成','图像提示词模板','TTS','提示词模板','故事神谕','酒馆助手'].map(nativeRow).join('')}</div><div id="extensions_settings2" class="flex1 wide50p">${['快速回复','QR助手','聊天翻译','图片描述','总结','正则','向量存储','鸡尾酒'].map(nativeRow).join('')}</div></div></section><div id="chat" style="position:relative;width:700px;max-width:95vw;height:auto;margin:20px auto"></div><script type="module" src="${prefix}index.js"></script></body></html>`;
const host=`
class Events{constructor(){this.listeners=new Map()}on(k,f){if(!this.listeners.has(k))this.listeners.set(k,[]);this.listeners.get(k).push(f)}removeListener(k,f){this.listeners.set(k,this.listeners.get(k).filter(x=>x!==f))}async emit(k,...args){for(const f of [...(this.listeners.get(k)||[])])await f(...args)}}
export const extension_settings=JSON.parse(sessionStorage.getItem('settings')||'{"ultimate_purifier_ai_rewrite":{"untouched":true}}');
export const eventSource=new Events();export const event_types=Object.fromEntries(['APP_READY','GENERATION_STARTED','GENERATION_ENDED','GENERATION_STOPPED','MESSAGE_RECEIVED','CHARACTER_MESSAGE_RENDERED','MESSAGE_EDITED','MESSAGE_UPDATED','MESSAGE_SWIPED','CHAT_CHANGED'].map(k=>[k,k]));
export const saveSettingsDebounced=()=>sessionStorage.setItem('settings',JSON.stringify(extension_settings));
const ctx={chat:JSON.parse(sessionStorage.getItem('chat')||'[]'),chatId:'fixture',updateMessageBlock(index,message){window.__updates++;let node=document.querySelector('#chat .mes[mesid="'+index+'"]');if(!node){node=document.createElement('div');node.className='mes';node.setAttribute('mesid',index);node.innerHTML='<div class="mes_buttons"><div class="mes_edit">✎</div></div><div class="mes_text"></div>';document.querySelector('#chat').append(node)}node.querySelector('.mes_text').textContent=message.mes},async saveChat(){window.__saves++;sessionStorage.setItem('chat',JSON.stringify(ctx.chat))}};
export const getContext=()=>ctx;window.__saves=0;window.__updates=0;window.__notices=[];
window.toastr=Object.fromEntries(['info','warning','error','success'].map(k=>[k,m=>window.__notices.push({kind:k,message:m})]));
window.__beautify=[];eventSource.on(event_types.MESSAGE_UPDATED,index=>{window.__beautify.push(index);const node=document.querySelector('#chat .mes[mesid="'+index+'"] .mes_text');if(node){const wrapper=document.createElement('div');wrapper.className='fixture-beautified';wrapper.textContent=ctx.chat[index].mes;node.replaceChildren(wrapper)}});
window.__host={ctx,eventSource,event_types,extension_settings};ctx.chat.forEach((message,index)=>ctx.updateMessageBlock(index,message));
`;
const browser=await chromium.launch({headless:true,executablePath:process.env.VRL_TEST_CHROME||undefined});
const page=await browser.newPage({viewport:{width:1360,height:960},deviceScaleFactor:1});
const errors=[], checks=[];page.on('pageerror',error=>errors.push(error.message));page.on('dialog',dialog=>dialog.accept());
await page.route('**/*',async route=>{
    const pathname=new URL(route.request().url()).pathname;
    if(pathname==='/')return route.fulfill({contentType:'text/html',body:fixture});
    if(pathname==='/fixture-host.js')return route.fulfill({contentType:'text/javascript',body:host});
    if(pathname==='/scripts/extensions.js')return route.fulfill({contentType:'text/javascript',body:"export {extension_settings,getContext} from '/fixture-host.js';"});
    if(pathname==='/script.js')return route.fulfill({contentType:'text/javascript',body:"export {eventSource,event_types,saveSettingsDebounced} from '/fixture-host.js';"});
    if(pathname.startsWith(prefix)){
        const filename=path.resolve(root,pathname.slice(prefix.length));
        if(filename.startsWith(root+path.sep)&&fs.existsSync(filename))return route.fulfill({contentType:filename.endsWith('.css')?'text/css':'text/javascript',body:fs.readFileSync(filename)});
    }
    return route.abort();
});
const check=(name,value=true)=>{assert.ok(value,name);checks.push(name)};
const settings=()=>page.evaluate(()=>window.__host.extension_settings.veridis_lite);
const click=action=>page.locator(`.vrl-main-dialog [data-action="${action}"]`).first().click();
const nameDialog=()=>page.locator('.vrl-name-dialog');
const ruleDialog=()=>page.locator('.vrl-rule-dialog');

try{
    await page.goto('http://veridis-lite.test/');await page.locator('#vrl-settings .vrl-settings-entry').waitFor();
    for(const width of [1360,390]){
        await page.setViewportSize({width,height:960});await page.locator('#vrl-settings').scrollIntoViewIfNeeded();
        const size=await page.locator('#vrl-settings .vrl-settings-entry').evaluate(button=>{const b=button.getBoundingClientRect(),p=button.parentElement.getBoundingClientRect();return{width:b.width,parent:p.width,height:b.height,nowrap:getComputedStyle(button).whiteSpace,writingMode:getComputedStyle(button).writingMode}});
        check(`native extension entry stays horizontal at ${width}px`,size.width>=size.parent-2&&size.height<=60&&size.nowrap==='nowrap'&&size.writingMode==='horizontal-tb');
    }
    await page.setViewportSize({width:1360,height:960});await page.locator('#host-panel').scrollIntoViewIfNeeded();await page.screenshot({path:path.join(output,'native-panel-preview.png')});await page.locator('#host-panel').screenshot({path:path.join(output,'native-panel-crop.png')});
    await page.locator('#vrl-settings .vrl-settings-entry').click();
    await page.locator('.vrl-main-dialog[open]').waitFor();
    check('single-page shell opens without host dependencies');
    check('fresh install has no saved preset or rule', await page.locator('#vrl-preset').isDisabled()
        && await page.locator('#vrl-groups').innerText().then(text => text.includes('暂无预设'))
        && await page.locator('#vrl-stats').innerText() === '0 个规则组 · 0 条规则' && (await settings()) === undefined);
    await click('new-preset');
    await nameDialog().locator('input').fill('临时测试预设');
    await nameDialog().getByRole('button', { name: '保存', exact: true }).click();
    check('the first preset can be created', (await settings()).presets.length === 1);
    await click('delete-preset');
    check('deleting the last preset leaves empty settings', (await settings()).presets.length === 0 && (await settings()).activePresetId === null);
    await page.reload();
    await page.locator('#vrl-launcher').click();
    check('empty settings survive a reload', await page.locator('#vrl-preset').isDisabled() && (await settings()).presets.length === 0);
    const untouched = await page.evaluate(async () => {
        const { ctx, eventSource, event_types } = window.__host;
        await eventSource.emit(event_types.GENERATION_STARTED, 'normal', {}, false);
        ctx.chat.push({ is_user: false, mes: '示例回复', extra: {} });
        await eventSource.emit(event_types.MESSAGE_RECEIVED, 0, 'normal');
        await eventSource.emit(event_types.GENERATION_ENDED, 1);
        await new Promise(resolve => setTimeout(resolve, 20));
        return ctx.chat.pop().mes === '示例回复' && window.__saves === 0 && window.__notices.length === 0;
    });
    check('generation without a preset leaves the chat untouched', untouched);
    await click('refresh-body');
    await page.waitForFunction(() => document.querySelector('#vrl-refresh-status').textContent.includes('请先新建或导入预设'));
    check('manual cleanup without a preset prompts for setup');
    check('model settings and old navigation are absent',!await page.locator('.vrl-main-dialog').innerText().then(t=>/AI|Deep Clean|透视|改写要求/.test(t)));
    const legacy={type:'veridis-rewrite-preset',version:2,rules:[{name:'示例词汇',enabled:true,subRules:[
        {mode:'text',targets:['以太'],replacements:['魔力'],enabled:true},
        {mode:'text',targets:['时辰'],replacements:['小时'],enabled:true},
        {mode:'text',targets:['方才'],replacements:['刚才'],enabled:true},
        {mode:'text',targets:['模型用词'],rewriteMode:'ai',aiPromptTemplate:'excluded',enabled:true},
    ]}]};
    await page.locator('#vrl-file').setInputFiles({name:'轻量词表.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(legacy))});
    await page.waitForFunction(()=>window.__host.extension_settings.veridis_lite?.presets.length===1);
    check('upstream preset import retains three program rules',(await settings()).presets.at(-1).rules[0].subRules.length===3);
    check('import explicitly reports omitted model rules',await page.evaluate(()=>window.__notices.at(-1).message.includes('跳过 1')));
    check('upstream namespace remains untouched',await page.evaluate(()=>JSON.stringify(window.__host.extension_settings.ultimate_purifier_ai_rewrite)==='{"untouched":true}'));
    await page.screenshot({path:path.join(output,'desktop-preview.png')});

    await page.evaluate(async()=>{
        const {ctx,eventSource:e,event_types:t}=window.__host;
        await e.emit(t.GENERATION_STARTED,'normal',{},false);
        ctx.chat.push({is_user:false,mes:'她换好衣服。方才，一时辰前出现了以太。守卫叫她停下。',extra:{}});
        await e.emit(t.MESSAGE_RECEIVED,0,'normal');
        ctx.chat[0].swipe_id=0;ctx.chat[0].swipes=[ctx.chat[0].mes];
        await e.emit(t.GENERATION_ENDED,1);
    });
    await page.waitForFunction(()=>window.__host.ctx.chat[0].mes==='她换好衣服。刚才，一小时前出现了魔力。守卫叫她停下。');
    check('actual entry responds to host completion events and synchronizes Swipe',await page.evaluate(()=>window.__saves===1&&window.__host.ctx.chat[0].swipes[0]===window.__host.ctx.chat[0].mes));
    check('beautification is automatically restored after writing',await page.locator('#chat .mes[mesid="0"] .fixture-beautified').count()===1);
    await page.evaluate(()=>{const s=window.__host.extension_settings.veridis_lite;const p=s.presets.find(p=>p.id===s.activePresetId);p.rules[0].subRules.push({id:'manual-rule',mode:'text',enabled:true,targets:['出现了'],replacements:['产生了'],remark:''})});
    await click('refresh-body');await page.waitForFunction(()=>window.__host.ctx.chat[0].mes==='她换好衣服。刚才，一小时前产生了魔力。守卫叫她停下。');
    check('manual refresh applies a newly added rule and synchronizes the current Swipe',await page.evaluate(()=>window.__host.ctx.chat[0].swipes[0]===window.__host.ctx.chat[0].mes));
    check('manual cleanup displays a concrete completion status',(await page.locator('#vrl-refresh-status').innerText()).includes('已净化'));
    const savedBeforeRepeat=await page.evaluate(()=>window.__saves);await click('refresh-body');await page.waitForFunction(()=>document.querySelector('#vrl-refresh-status').textContent.includes('无需修改'));
    check('repeated manual refresh has no extra write',await page.evaluate(()=>window.__saves)===savedBeforeRepeat);
    await click('show-comparison');await page.locator('.vrl-diff-body del').first().waitFor();
    check('comparison marks deleted and inserted text',await page.locator('.vrl-diff-body ins').count()>0&&await page.locator('.vrl-diff-body del').count()>0);
    const snippet=await page.locator('.vrl-diff-body').innerText();
    check('snippet shows one complete changed sentence without neighbouring prose',await page.locator('.vrl-diff-fragment').count()===1&&!snippet.includes('她换好衣服')&&!snippet.includes('守卫叫她停下')&&snippet.endsWith('。'));
    await page.locator('.vrl-diff-dialog').screenshot({path:path.join(output,'sentence-snippet-preview.png')});
    const savesBeforeView=await page.evaluate(()=>window.__saves);await page.locator('.vrl-diff-dialog [data-mode]').click();
    check('full text comparison opens without editing the chat',await page.locator('.vrl-diff-prose').count()===1&&await page.evaluate(()=>window.__saves)===savesBeforeView);
    check('full comparison still includes unmodified neighbouring sentences',(await page.locator('.vrl-diff-prose').innerText()).includes('守卫叫她停下'));
    await page.screenshot({path:path.join(output,'comparison-preview.png')});await page.locator('.vrl-diff-dialog [data-close]').click();
    await page.waitForFunction(()=>document.querySelector('#chat .vrl-diff-message'));
    check('a message gets a comparison entry only after actual purification',await page.locator('#chat .vrl-diff-message').count()===1);

    await click('add-group');await nameDialog().locator('input').fill('标点与口癖');await nameDialog().getByRole('button',{name:'保存',exact:true}).click();
    let card=page.locator('.vrl-card').filter({has:page.getByRole('button',{name:'标点与口癖',exact:true})});
    await card.locator('[data-action="add-rule"]').click();
    await ruleDialog().locator('[name="targets"]').fill('极其');await ruleDialog().getByRole('button',{name:'保存规则',exact:true}).click();
    check('literal delete rule saves without any rewrite prompt',(await settings()).presets.at(-1).rules.at(-1).subRules[0].replacements.length===0);

    await card.locator('[data-action="add-rule"]').click();await ruleDialog().locator('[name="mode"]').selectOption('regex');
    await ruleDialog().locator('[name="targets"]').fill('[');await ruleDialog().getByRole('button',{name:'保存规则',exact:true}).click();
    check('invalid regex produces an inline error',await ruleDialog().locator('#vrl-rule-error').isVisible());
    await ruleDialog().locator('[name="targets"]').fill('/——+/g');await ruleDialog().locator('[name="replacements"]').fill('，');
    await ruleDialog().getByRole('button',{name:'保存规则',exact:true}).click();
    await card.locator('[data-action="add-rule"]').click();await ruleDialog().locator('[name="mode"]').selectOption('simple');
    await ruleDialog().locator('[name="targets"]').fill('{非常,十分}*认真');await ruleDialog().locator('[name="replacements"]').fill('认真');await ruleDialog().getByRole('button',{name:'保存规则',exact:true}).click();
    check('all three rule modes are editable',(await settings()).presets.at(-1).rules.at(-1).subRules.map(r=>r.mode).join(',')==='text,regex,simple');
    const actionPlacement=await card.locator('.vrl-rule-row').first().evaluate(row=>{const d=row.querySelector('[data-action="delete-inline-rule"]').getBoundingClientRect(),e=row.querySelector('[data-action="edit-rule"]').getBoundingClientRect(),b=row.getBoundingClientRect();return{deleteRight:d.right,editLeft:e.left,editRight:e.right,rowRight:b.right}});
    check('inline delete sits left of the pencil and the pencil keeps its original grid position '+JSON.stringify(actionPlacement),actionPlacement.deleteRight<=actionPlacement.editLeft&&Math.abs(actionPlacement.editLeft-(actionPlacement.rowRight-34))<2);
    await card.locator('[data-action="add-rule"]').click();await ruleDialog().locator('[name="targets"]').fill('临时删除示例');await ruleDialog().getByRole('button',{name:'保存规则',exact:true}).click();
    await card.getByRole('button',{name:'删除规则 临时删除示例',exact:true}).click();
    check('inline rule deletion is saved immediately',(await settings()).presets.at(-1).rules.at(-1).subRules.length===3);

    await card.locator('.vrl-rule-row').first().locator('[data-action="edit-rule"]').click();await ruleDialog().locator('[name="remark"]').fill('删除多余程度副词');await ruleDialog().getByRole('button',{name:'保存规则',exact:true}).click();
    check('ordinary remarks persist',(await settings()).presets.at(-1).rules.at(-1).subRules[0].remark==='删除多余程度副词');
    await card.locator('[data-toggle-rule]').first().uncheck();check('individual rule enable flag persists',!(await settings()).presets.at(-1).rules.at(-1).subRules[0].enabled);await card.locator('[data-toggle-rule]').first().check();
    await click('search');await page.locator('#vrl-search').fill('程度副词');check('search covers remarks and filters group cards',await page.locator('.vrl-card').count()===1);await click('clear-search');await click('search');

    await click('edit-groups');const groupEditor=page.locator('.vrl-groups-dialog');
    await groupEditor.locator('.vrl-group-edit-row').last().getByRole('button',{name:'上移分组'}).click();
    check('group ordering persists',(await settings()).presets.at(-1).rules[0].name==='标点与口癖');
    await groupEditor.getByRole('button',{name:'完成',exact:true}).click();await click('reverse');
    check('reverse order affects the saved list',(await settings()).presets.at(-1).rules[0].name==='示例词汇');

    const downloadPromise=page.waitForEvent('download');await click('export');const download=await downloadPromise;await download.saveAs(path.join(output,'exported.json'));
    const exported=JSON.parse(fs.readFileSync(path.join(output,'exported.json'),'utf8'));
    check('export contains only program preset data',!JSON.stringify(exported).includes('aiPrompt')&&!JSON.stringify(exported).includes('apiKey')&&exported.rules.length===2);

    const before=JSON.stringify(await settings());await page.locator('#vrl-file').setInputFiles({name:'invalid.json',mimeType:'application/json',buffer:Buffer.from('{broken')});
    await page.waitForFunction(()=>window.__notices.at(-1).kind==='error');check('invalid imports leave working presets intact',JSON.stringify(await settings())===before);
    await page.locator('#vrl-enabled').uncheck();check('master switch persists',!(await settings()).enabled);await page.locator('#vrl-enabled').check();

    await click('new-preset');await nameDialog().locator('input').fill('空白预设');await nameDialog().getByRole('button',{name:'保存',exact:true}).click();
    check('new preset starts empty',(await settings()).presets.at(-1).rules.length===0);
    await click('rename-preset');await nameDialog().locator('input').fill('重命名示例');await nameDialog().getByRole('button',{name:'保存',exact:true}).click();
    check('preset can be renamed',(await settings()).presets.at(-1).name==='重命名示例');await click('delete-preset');
    const chosen=(await settings()).presets.find(p=>p.name==='轻量词表');await page.locator('#vrl-preset').selectOption(chosen.id);
    await page.reload();await page.locator('#vrl-launcher').click();
    check('saved presets and rules survive a browser reload',(await settings()).activePresetId===chosen.id&&(await page.locator('.vrl-card').count())===2);
    await click('show-comparison');await page.locator('.vrl-diff-body del').first().waitFor();check('comparison records survive a browser reload',await page.locator('.vrl-diff-body ins').count()>0);await page.locator('.vrl-diff-dialog [data-close]').click();
    await page.evaluate(()=>{const {ctx}=window.__host;ctx.chat=Array.from({length:24},(_,i)=>i%2?{is_user:false,mes:'极其'+i,extra:{},swipe_id:0,swipes:['极其'+i],swipe_info:[{extra:{}}]}:{is_user:true,mes:'用户极其'+i})});
    const beforeBatch=await page.evaluate(()=>window.__saves);await click('refresh-body');await page.waitForFunction(()=>document.querySelector('#vrl-refresh-status').textContent.includes('已净化 10 楼'));
    check('button cleans exactly ten recent assistant replies in one saved batch',await page.evaluate(previous=>window.__saves===previous+1&&window.__host.ctx.chat[1].mes==='极其1'&&window.__host.ctx.chat[3].mes==='极其3'&&window.__host.ctx.chat.filter(m=>m.is_user).every(m=>m.mes.startsWith('用户极其'))&&window.__host.ctx.chat.slice(4).filter(m=>!m.is_user).every(m=>!m.mes.includes('极其')),beforeBatch));

    for(const [width,height] of [[1920,1080],[768,1024],[390,844],[360,780]]){
        await page.setViewportSize({width,height});
        const layout=await page.locator('.vrl-main-dialog').evaluate(node=>{const b=node.getBoundingClientRect();return {left:b.left,right:b.right,top:b.top,bottom:b.bottom,width:innerWidth,height:innerHeight,overflow:node.scrollWidth>node.clientWidth+1}});
        check(`layout fits ${width}px`,layout.left>=0&&layout.top>=0&&layout.right<=width+.5&&layout.bottom<=height+.5&&!layout.overflow);
        if(width<=390){const rows=await page.locator('.vrl-preset-actions').evaluate(node=>[...node.children].map(child=>Math.round(child.getBoundingClientRect().top)));check(`preset actions stay on one row at ${width}px`,new Set(rows).size===1);}
        if(width===390)await page.screenshot({path:path.join(output,'mobile-preview.png')});
    }
    await page.locator('.vrl-card').first().locator('[data-action="add-rule"]').click();
    await ruleDialog().locator('[name="targets"]').fill('示例');await ruleDialog().getByRole('button',{name:'保存规则',exact:true}).scrollIntoViewIfNeeded();
    check('mobile editor save control stays reachable',await ruleDialog().getByRole('button',{name:'保存规则',exact:true}).isVisible());
    await page.screenshot({path:path.join(output,'mobile-editor.png')});
    await ruleDialog().locator('[data-action="close"]').first().click();
    await page.setViewportSize({width:1360,height:960});
    await page.evaluate(()=>{document.documentElement.style.setProperty('--SmartThemeBlurTintColor','#faf9f6');document.documentElement.style.setProperty('--SmartThemeBodyColor','#292c25');document.documentElement.style.setProperty('--SmartThemeBorderColor','#deddd5');document.documentElement.style.setProperty('--SmartThemeQuoteColor','#86661e')});
    await page.screenshot({path:path.join(output,'light-preview.png')});
    check('no uncaught browser errors',errors.length===0);
    console.log(JSON.stringify({checks:checks.length,results:checks,errors,scope:'headless Chromium; real extension source; simulated host and storage; no model calls or desktop control'},null,2));
}finally{
    fs.writeFileSync(path.join(output,'ui-results.json'),JSON.stringify({checks,errors},null,2));await browser.close();
}
