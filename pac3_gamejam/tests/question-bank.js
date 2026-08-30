'use strict';
const {spawn}=require('child_process');
const path=require('path');
const PORT=34679,BASE=`http://127.0.0.1:${PORT}`;
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const assert=(x,m)=>{if(!x)throw new Error(m)};
async function post(url,data={}){const r=await fetch(BASE+url,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(data)});return {status:r.status,...await r.json()}}
(async()=>{const child=spawn(process.execPath,['server.js'],{cwd:path.join(__dirname,'..'),env:{...process.env,NODE_ENV:'test',PORT:String(PORT)}});try{
 await sleep(150);
 const ids=new Set(), texts=new Set();
 const norm=s=>String(s).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();
 for(const phase of ['CONCEITO','GAMEPLAY','PLAYTEST','PITCH']){
   const phaseIds=new Set();
   for(let i=0;i<75;i++){const r=await post('/api/test/question',{phase,scope:phase});assert(r.ok,`regular ${phase} ${i}`);assert(r.question.options.length===3,'regular must have 3 options');assert(!ids.has(r.question.id),'global repeated regular id');assert(!texts.has(norm(r.question.text)),'global repeated regular text');ids.add(r.question.id);texts.add(norm(r.question.text));phaseIds.add(r.question.id)}
   assert(phaseIds.size===75,`${phase} must provide 75 unique regular questions`);
 }
 console.log('PASS 300 regular questions are globally unique in one game');
 for(let i=0;i<80;i++){const r=await post('/api/test/question',{phase:'CONCEITO',scope:'BATTLE'});assert(r.ok,`battle ${i}`);assert(r.question.options.length===4,'battle must have 4 alternatives');assert(!ids.has(r.question.id),'battle id reused');assert(!texts.has(norm(r.question.text)),'battle text reused');ids.add(r.question.id);texts.add(norm(r.question.text))}
 console.log('PASS 80 Battle questions are unique and have A/B/C/D');
 console.log('PASS Battle question stems never repeat after normalization');
 for(let i=0;i<50;i++){const r=await post('/api/test/question',{phase:'PITCH',scope:'PITCH_FINAL'});assert(r.ok,`pitch ${i}`);assert(r.question.options.length===4,'pitch must have 4 alternatives');assert(r.question.id.startsWith('PF-'),'pitch must use exclusive bank');assert(!ids.has(r.question.id),'pitch id reused');assert(!texts.has(norm(r.question.text)),'pitch text reused');ids.add(r.question.id);texts.add(norm(r.question.text))}
 console.log('PASS 50 Pitch Final questions are exclusive and unique');
 assert(ids.size===430&&texts.size===430,'must have 430 unique questions/texts');
 console.log('PASS 430/430 question IDs and texts unique in same game');
 let exhausted=await post('/api/test/question',{phase:'CONCEITO',scope:'CONCEITO'});assert(exhausted.status===409,'exhausted bank must not silently repeat');
 console.log('PASS exhausted bank refuses repetition instead of recycling');
 await post('/api/reset');const after=await post('/api/test/question',{phase:'CONCEITO',scope:'CONCEITO'});assert(after.ok&&after.used===1,'reset must clear used question IDs');
 console.log('PASS new game resets question usage');
 console.log('TOTAL 7/7 QUESTION BANK SCENARIOS PASS');
 }catch(e){console.error('FAIL',e.stack);process.exitCode=1}finally{child.kill('SIGTERM')}})();
