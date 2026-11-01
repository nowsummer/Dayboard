'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const D=require('../renderer/domain.js');
const {createStore,initialState,validateState}=require('../lib/store.cjs');
test('every one-percent glass step changes transmission and blur without changing selected theme',()=>{
  for(const tone of ['light','dark']) for(let n=0;n<=20;n++) {
    const mean=n/20,spread={mean,low:Math.max(0,mean-.16),high:Math.min(1,mean+.16)};
    let last=D.glassLook(0,spread,D.glassTone(mean),tone);
    for(let i=1;i<=100;i++) {
      const k=D.glassLook(i/100,spread,D.glassTone(mean),tone);
      assert.equal(k.tone,tone); assert.ok(k.t>last.t,`${tone} wall ${mean}, step ${i} transmission plateau`);
      assert.ok(k.blur>last.blur,`${tone} wall ${mean}, step ${i} blur plateau`);
      assert.ok(k.t-last.t<=.01); assert.ok(Math.abs(k.ink-last.ink)<.04);
      last=k;
    }
    assert.equal(last.t,1); assert.equal(last.solid,true);
  }
});
test('widget appearance defaults, heals and survives disk persistence independently of app theme',t=>{
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'dayboard-glass-test-')); t.after(()=>fs.rmSync(directory,{recursive:true,force:true}));
  const old=initialState(); delete old.settings.widgetTheme; old.settings.theme='light';
  assert.equal(validateState(old).settings.widgetTheme,'app');
  for(const bad of [null,'system','wallpaper',{},false]) {const state=initialState();state.settings.widgetTheme=bad;assert.equal(validateState(state).settings.widgetTheme,'app');}
  const store=createStore(directory);
  for(const choice of ['app','auto','light','dark']) {
    store.mutate(s=>{s.settings.widgetTheme=choice;s.settings.theme='light';s.settings.glassLevel=.27;});
    const state=createStore(directory).publicState();
    assert.equal(state.settings.widgetTheme,choice);assert.equal(state.settings.theme,'light');assert.equal(state.settings.glassLevel,.27);
  }
});
