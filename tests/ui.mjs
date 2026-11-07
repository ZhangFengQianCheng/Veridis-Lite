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
const fixture=`<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Veridis Lite isolated fixture</title><link rel="stylesheet" href="${prefix}style.css"><style>
html,body{margin:0;height:100%;font-family:'Segoe UI','Microsoft YaHei',sans-serif;background:#151713;color:#ddd}body{background:radial-gradient(ellipse at 50% 30%,#33372b,#151713 75%)}
:root{--SmartThemeBlurTintColor:#25271f;--SmartThemeBodyColor:#e7e7de;--SmartThemeBorderColor:#3a3d32;--SmartThemeQuoteColor:#d6bb6d}
#host-chat{max-width:750px;margin:100px auto;opacity:.5;padding:30px}#extensionsMenu{position:absolute;top:18px;left:20px}#extensions_settings2{display:none}
</style></head><body><div id="extensionsMenu"></div><div id="extensions_settings2"></div><div id="host-chat"><p>SillyTavern · 隔离测试环境</p><p>真实扩展界面，模拟酒馆事件与保存接口。</p></div><script type="module" src="${prefix}index.js"></script></body></html>`;
const host=`
class Events{constructor(){this.listeners=new Map()}on(k,f){if(!this.listeners.has(k))this.listeners.set(k,[]);this.listeners.get(k).push(f)}removeListener(k,f){this.listeners.set(k,this.listeners.get(k).filter(x=>x!==f))}async emit(k,...args){for(const f of [...(this.listeners.get(k)||[])])await f(...args)}}
export const extension_settings=JSON.parse(sessionStorage.getItem('settings')||'{"ultimate_purifier_ai_rewrite":{"untouched":true}}');
export const eventSource=new Events();export const event_types=Object.fromEntries(['APP_READY','GENERATION_STARTED','GENERATION_ENDED','GENERATION_STOPPED','MESSAGE_RECEIVED','CHARACTER_MESSAGE_RENDERED','MESSAGE_EDITED','MESSAGE_SWIPED','CHAT_CHANGED'].map(k=>[k,k]));
export const saveSettingsDebounced=()=>sessionStorage.setItem('settings',JSON.stringify(extension_settings));
const ctx={chat:[],chatId:'fixture',updateMessageBlock(){window.__updates++},async saveChat(){window.__saves++}};
export const getContext=()=>ctx;window.__saves=0;window.__updates=0;window.__notices=[];
window.toastr=Object.fromEntries(['info','warning','error','success'].map(k=>[k,m=>window.__notices.push({kind:k,message:m})]));
window.__host={ctx,eventSource,event_types,extension_settings};
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
    await page.goto('http://veridis-lite.test/');await page.locator('#vrl-launcher').click();
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
        ctx.chat.push({is_user:false,mes:'方才，一时辰前出现了以太。',extra:{}});
        await e.emit(t.MESSAGE_RECEIVED,0,'normal');
        ctx.chat[0].swipe_id=0;ctx.chat[0].swipes=[ctx.chat[0].mes];
        await e.emit(t.GENERATION_ENDED,1);
    });
    await page.waitForFunction(()=>window.__host.ctx.chat[0].mes==='刚才，一小时前出现了魔力。');
    check('actual entry responds to host completion events and synchronizes Swipe',await page.evaluate(()=>window.__saves===1&&window.__host.ctx.chat[0].swipes[0]===window.__host.ctx.chat[0].mes));

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

    for(const [width,height] of [[1920,1080],[768,1024],[390,844],[360,780]]){
        await page.setViewportSize({width,height});
        const layout=await page.locator('.vrl-main-dialog').evaluate(node=>{const b=node.getBoundingClientRect();return {left:b.left,right:b.right,top:b.top,bottom:b.bottom,width:innerWidth,height:innerHeight,overflow:node.scrollWidth>node.clientWidth+1}});
        check(`layout fits ${width}px`,layout.left>=0&&layout.top>=0&&layout.right<=width+.5&&layout.bottom<=height+.5&&!layout.overflow);
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
