'use strict';
const {spawn}=require('child_process');
const path=require('path');
const PORT=34567,BASE=`http://127.0.0.1:${PORT}`;
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const assert=(x,m)=>{if(!x)throw new Error(m)};
async function get(p){const r=await fetch(BASE+p);const t=await r.text();return {r,t}}
async function jsonGet(p){const r=await fetch(BASE+p);return r.json()}
async function post(p,d={}){const r=await fetch(BASE+p,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(d)});const j=await r.json();return {status:r.status,...j}}
async function waitFor(fn,timeout=4000,label='condition'){const end=Date.now()+timeout;while(Date.now()<end){const v=await fn();if(v)return v;await sleep(20)}throw new Error('timeout '+label)}
(async()=>{
 const child=spawn(process.execPath,['server.js'],{cwd:path.join(__dirname,'..'),env:{...process.env,PORT:String(PORT),NODE_ENV:'test',DICE_MS:'70',DICE_RESULT_MS:'25',MOVE_MS:'12',VOTE_MS:'180',RESULT_MS:'90',PODIUM_MS:'70',NOTICE_MS:'60',TEST_DICE:'5,1,1,1'}});
 let out='';child.stdout.on('data',d=>out+=d);child.stderr.on('data',d=>out+=d);
 try{
  await waitFor(async()=>{try{return (await jsonGet('/healthz')).ok}catch{return false}},2500,'server');
  console.log('PASS server starts without npm dependencies');
  let x=await get('/professor.html');assert(x.r.status===200&&x.t.includes('v4.2.0-playable'),'professor page');console.log('PASS professor page');
  x=await get('/aluno.html');assert(x.r.status===200&&x.t.includes('Voto'),'student page');console.log('PASS student page');
  x=await get('/qr.svg?text='+encodeURIComponent(BASE+'/aluno.html'));assert(x.r.status===200&&x.t.includes('<svg'),'qr');console.log('PASS QR generated locally');
  let r=await post('/api/setup',{count:3,names:['Alpha','Beta','Gamma']});assert(r.ok&&r.state.teams[0].name==='Alpha','setup');console.log('PASS setup names');
  assert((await post('/api/join',{teamId:'T1',controlId:'C1'})).ok,'join1');assert((await post('/api/join',{teamId:'T2',controlId:'C2'})).ok,'join2');assert((await post('/api/join',{teamId:'T3',controlId:'C3'})).ok,'join3');
  r=await post('/api/join',{teamId:'T1',controlId:'OTHER'});assert(r.status===409,'team lock');console.log('PASS team lock');
  assert((await post('/api/unlock',{teamId:'T3'})).ok,'unlock');assert((await post('/api/join',{teamId:'T3',controlId:'C3'})).ok,'rejoin after unlock');console.log('PASS Game Master can release a control before start');
  assert((await post('/api/start')).ok,'start');console.log('PASS start with connected controls');
  assert((await post('/api/roll')).ok,'roll');
  let st=await waitFor(async()=>{const s=await jsonGet('/api/state');return s.vote&&s.vote.open?s:null},1800,'battle vote');assert(st.vote.kind==='battle','battle expected');assert(st.teams[0].pos===6,'dice moved stepwise to 6');console.log('PASS dice + movement + Battle landing');
  const v=st.vote,correct=v.question.correct,wrong=(correct+1)%v.question.options.length;
  r=await post('/api/vote',{voteId:v.id,teamId:'T1',controlId:'C1',choice:wrong});assert(r.ok,'vote wrong first');r=await post('/api/vote',{voteId:v.id,teamId:'T1',controlId:'C1',choice:correct});assert(r.ok,'change vote');r=await post('/api/vote',{voteId:v.id,teamId:'T2',controlId:'C2',choice:wrong});assert(r.ok,'vote2');
  st=await jsonGet('/api/state');assert(st.vote.responses.T1===correct&&st.vote.responses.T2===wrong,'vote replace/record');console.log('PASS votes recorded and changeable');
  await waitFor(async()=>{const s=await jsonGet('/api/state');return s.phase==='TURN'&&s.turn===2?s:null},2000,'post battle/crunch');st=await jsonGet('/api/state');assert(st.teams[0].xp===2,'winner +2');assert(st.teams[1].xp===0&&!st.teams[1].blocked,'loser crunch consumed next turn');console.log('PASS Battle scoring + loser-only Crunch + auto unlock');
  // bonus cell: Gamma at 7, dice=1 -> 8
  await post('/api/test/set',{turn:2,teamId:'T3',pos:7,phase:'TURN',started:true});await post('/api/roll');await waitFor(async()=>{const s=await jsonGet('/api/state');return s.teams[2].xp===1?s:null},1200,'bonus');console.log('PASS bonus +1 XP');
  // setback: Alpha at 9, dice=1 -> 10 then back to 9
  await post('/api/test/set',{turn:0,teamId:'T1',pos:9,phase:'TURN',started:true});await post('/api/roll');await waitFor(async()=>{const s=await jsonGet('/api/state');return s.teams[0].pos===9&&s.phase!=='DICE'&&s.phase!=='MOVE'?s:null},1200,'setback');console.log('PASS setback returns 1 house');
  // final: Alpha at 29, dice=1 -> 30, answer 5 pitch questions correctly
  await post('/api/test/set',{turn:0,teamId:'T1',pos:29,phase:'TURN',started:true});await post('/api/roll');
  for(let i=1;i<=5;i++){
    st=await waitFor(async()=>{const s=await jsonGet('/api/state');return s.vote?.open&&s.vote.kind==='pitch-final'&&s.vote.pitchStep===i?s:null},1600,'pitch '+i);
    const pv=st.vote;await post('/api/vote',{voteId:pv.id,teamId:'T1',controlId:'C1',choice:pv.question.correct});
  }
  st=await waitFor(async()=>{const s=await jsonGet('/api/state');return s.winnerId==='T1'?s:null},2500,'final winner');assert(st.pitch.hits>=3,'3/5');console.log('PASS Pitch Day 5 questions / minimum 3 / winner');
  const hz=await jsonGet('/healthz');assert(hz.version==='4.2.0-playable'&&hz.winnerId==='T1','health');console.log('PASS health/diagnostic state');
  r=await post('/api/reset');assert(r.ok&&!r.state.started&&r.state.teams.length===0,'reset');console.log('PASS reset creates fresh game');
  console.log('TOTAL 15/15 INTEGRATION SCENARIOS PASS');
 }catch(e){console.error('FAIL',e.stack);console.error(out);process.exitCode=1}finally{child.kill('SIGTERM')}
})();
