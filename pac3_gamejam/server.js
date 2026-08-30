'use strict';
const http=require('http');
const fs=require('fs');
const path=require('path');
const {URL}=require('url');
const QRCode=require('./vendor/QRCode');
const QRErrorCorrectLevel=require('./vendor/QRCode/QRErrorCorrectLevel');

const PORT=Number(process.env.PORT||3000);
const VERSION='4.2.7-blocked-control';
const PUBLIC=path.join(__dirname,'public');
const DUR={
  dice:Number(process.env.DICE_MS||5000),
  diceResult:Number(process.env.DICE_RESULT_MS||1800),
  move:Number(process.env.MOVE_MS||700),
  vote:Number(process.env.VOTE_MS||20000),
  result:Number(process.env.RESULT_MS||4200),
  podium:Number(process.env.PODIUM_MS||2300),
  notice:Number(process.env.NOTICE_MS||2400),
};
const FIXED_DICE=(process.env.TEST_DICE||'').split(',').map(Number).filter(n=>n>=1&&n<=6);
let fixedDiceIndex=0;
const PHASES=['CONCEITO','GAMEPLAY','PLAYTEST','PITCH'];
const CELL_TYPES=['challenge','bonus','challenge','setback','challenge','battle','challenge','bonus','challenge','setback','challenge','battle','challenge','bonus','challenge','setback','challenge','battle','challenge','bonus','challenge','setback','challenge','battle','challenge','bonus','challenge','setback','challenge','final'];
const QUESTIONS=require('./questions.json');

function fresh(){return {version:VERSION,sessionId:`S-${Date.now()}-${Math.random().toString(36).slice(2,7)}`,started:false,phase:'LOBBY',turn:0,round:1,teams:[],vote:null,lastResult:null,pitch:null,winnerId:null,usedQuestionIds:[],usedQuestionKeys:[],log:[]}}
let G=fresh();
const streams=new Set();
let timers=new Set();
function later(fn,ms){const t=setTimeout(()=>{timers.delete(t);fn()},ms);timers.add(t);return t}
function every(fn,ms){const t=setInterval(fn,ms);timers.add(t);return t}
function clearAllTimers(){for(const t of timers){clearTimeout(t);clearInterval(t)}timers.clear()}
function team(id){return G.teams.find(t=>t.id===id)}
function phaseForPos(pos){return PHASES[Math.min(3,Math.floor((Math.max(1,pos)-1)/8))]}
function visibleTeam(t){return {id:t.id,name:t.name,pos:t.pos,xp:t.xp,blocked:t.blocked,phase:t.phase,joined:!!t.controlId,lastSeen:t.lastSeen||0}}
function publicState(){return {version:G.version,sessionId:G.sessionId,started:G.started,phase:G.phase,turn:G.turn,round:G.round,teams:G.teams.map(visibleTeam),vote:G.vote?publicVote():null,lastResult:G.lastResult,pitch:G.pitch,winnerId:G.winnerId}}
function publicVote(){const v=G.vote;return v?{id:v.id,kind:v.kind,actorId:v.actorId,opponentId:v.opponentId,eligible:v.eligible,question:v.question,responses:{...v.responses},open:v.open,endsAt:v.endsAt,duration:v.duration,pitchStep:v.pitchStep||null}:null}
function log(type,data={}){G.log.push({at:Date.now(),type,data});if(G.log.length>400)G.log.shift()}
function sse(res,event,data){res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)}
function broadcast(event,data){for(const res of [...streams]){try{sse(res,event,data)}catch{streams.delete(res)}}}
function emitState(){broadcast('state',publicState())}
function json(res,status,obj){res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify(obj))}
function body(req){return new Promise((resolve,reject)=>{let s='';req.on('data',c=>{s+=c;if(s.length>1e6)req.destroy()});req.on('end',()=>{try{resolve(s?JSON.parse(s):{})}catch(e){reject(e)}});req.on('error',reject)})}
function questionKey(text){return String(text||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim()}
function shuffleQuestion(phase,actorId,scope=phase){
 let bank='regular';
 if(scope==='BATTLE')bank='battle';
 if(scope==='PITCH_FINAL')bank='pitch-final';
 let pool=QUESTIONS.filter(q=>q.bank===bank&&(bank!=='regular'||q.phase===phase));
 const usedIds=new Set(G.usedQuestionIds||[]);
 const usedKeys=new Set(G.usedQuestionKeys||[]);
 const available=pool.filter(q=>!usedIds.has(q.id)&&!usedKeys.has(questionKey(q.text)));
 if(!available.length)throw new Error(`Banco de questões esgotado para ${bank}${bank==='regular'?`/${phase}`:''}. Reinicie a partida para reutilizar questões.`);
 const raw=available[Math.floor(Math.random()*available.length)];
 const key=questionKey(raw.text);
 G.usedQuestionIds.push(raw.id);G.usedQuestionKeys.push(key);
 log('question:used',{id:raw.id,bank,phase,key,usedTotal:G.usedQuestionIds.length});
 const pairs=raw.options.map((text,i)=>({text,correct:i===raw.correct}));
 for(let i=pairs.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[pairs[i],pairs[j]]=[pairs[j],pairs[i]]}
 return {id:raw.id,phase:raw.phase,text:raw.text,options:pairs.map(x=>x.text),correct:pairs.findIndex(x=>x.correct),why:raw.why};
}
function nextDice(){if(FIXED_DICE.length)return FIXED_DICE[fixedDiceIndex++%FIXED_DICE.length];return 1+Math.floor(Math.random()*6)}
function podiumPayload(){return [...G.teams].sort((a,b)=>b.xp-a.xp||b.pos-a.pos).slice(0,3).map(visibleTeam)}
function showPodiumThenNext(){G.phase='PODIUM';emitState();broadcast('podium',{teams:podiumPayload()});later(()=>{if(G.winnerId){G.phase='GAMEOVER';emitState();return}nextTurn()},DUR.podium)}
function nextTurn(){if(!G.started||G.winnerId)return;if(G.vote?.open)return;G.turn=(G.turn+1)%G.teams.length;if(G.turn===0)G.round++;const t=G.teams[G.turn];if(!t)return;if(t.blocked){
 G.phase='NOTICE';emitState();
 broadcast('notice',{title:'💥 CRUNCH',body:`${t.name} perde este turno. O bloqueio será consumido agora.`,teamId:t.id});
 later(()=>{
   t.blocked=false;emitState();
   broadcast('notice',{title:'🔓 EQUIPE DESBLOQUEADA',body:`${t.name} está desbloqueado e volta a participar a partir da próxima oportunidade.`,teamId:t.id});
   later(nextTurn,Math.min(900,DUR.notice));
 },DUR.notice);
 return
}G.phase='TURN';emitState()}
function resultRows(v){const results={};for(const id of v.eligible){const c=v.responses[id];results[id]={answered:Number.isInteger(c),choice:Number.isInteger(c)?c:null,correct:c===v.question.correct}}return results}
function applyStandardResult(payload){const actor=team(payload.actorId);if(!actor)return;if(payload.kind==='battle'){
 const opp=team(payload.opponentId),ar=payload.results[actor.id],br=opp&&payload.results[opp.id];
 if(ar?.correct)actor.xp+=2;if(br?.correct&&opp)opp.xp+=2;
 // Crunch apenas para a equipe que efetivamente perde a disputa.
 // Acerto x erro: quem errou perde. Empate (ambas acertam ou ambas erram): ninguém é bloqueado.
 if(opp&&ar?.correct&&!br?.correct){opp.xp=Math.max(0,opp.xp-1);opp.blocked=true;actor.blocked=false}
 else if(opp&&!ar?.correct&&br?.correct){actor.xp=Math.max(0,actor.xp-1);actor.blocked=true;opp.blocked=false}
 else {actor.blocked=false;if(opp)opp.blocked=false}
 }else{for(const [id,r] of Object.entries(payload.results)){const t=team(id);if(t&&r.correct)t.xp++}if(!payload.results[actor.id]?.correct)actor.blocked=true}}
function finishVote(){const v=G.vote;if(!v||!v.open)return;v.open=false;const payload={voteId:v.id,kind:v.kind,actorId:v.actorId,opponentId:v.opponentId,eligible:v.eligible,question:v.question,results:resultRows(v),pitchStep:v.pitchStep||null};G.lastResult=payload;log('vote:finish',{voteId:v.id,results:payload.results});if(v.kind==='pitch-final'){const actor=team(v.actorId);const ok=!!payload.results[actor.id]?.correct;if(ok)G.pitch.hits++;G.pitch.step++;broadcast('vote:result',payload);G.phase='RESULT';emitState();later(()=>{G.vote=null;G.lastResult=null;if(G.pitch.step>=5){if(G.pitch.hits>=3){G.winnerId=actor.id;G.phase='PODIUM';broadcast('final',{success:true,teamId:actor.id,hits:G.pitch.hits});emitState();broadcast('podium',{teams:podiumPayload(),final:true});later(()=>{G.phase='GAMEOVER';emitState()},DUR.podium)}else{actor.pos=Math.max(1,actor.pos-3);actor.phase=phaseForPos(actor.pos);broadcast('final',{success:false,teamId:actor.id,hits:G.pitch.hits});G.pitch=null;showPodiumThenNext()}}else{openPitchQuestion(actor)}},DUR.result);return}
applyStandardResult(payload);broadcast('vote:result',payload);G.phase='RESULT';emitState();later(()=>{G.vote=null;G.lastResult=null;showPodiumThenNext()},DUR.result)}
function openVote({kind='collective',actorId,opponentId=null,duration=DUR.vote,pitchStep=null}){if(G.vote?.open)return;const actor=team(actorId);if(!actor)return;const eligible=kind==='battle'?[actorId,opponentId].filter(Boolean):kind==='pitch-final'?[actorId]:G.teams.filter(t=>!t.blocked).map(t=>t.id);if(kind==='battle'&&eligible.length!==2)return;const qPhase=kind==='pitch-final'?'PITCH':actor.phase;const question=shuffleQuestion(qPhase,actorId,kind==='pitch-final'?'PITCH_FINAL':kind==='battle'?'BATTLE':qPhase);const v={id:`V-${Date.now()}-${Math.random().toString(36).slice(2,6)}`,kind,actorId,opponentId,eligible,question,responses:{},open:true,endsAt:Date.now()+duration,duration:Math.ceil(duration/1000),pitchStep};G.vote=v;G.phase=kind==='battle'?'BATTLE':kind==='pitch-final'?'PITCH_FINAL':'QUESTION';log('vote:open',{voteId:v.id,kind,eligible});emitState();broadcast('vote:open',publicVote());const tick=every(()=>{if(!G.vote||G.vote.id!==v.id||!G.vote.open){clearInterval(tick);timers.delete(tick);return}broadcast('vote:tick',{voteId:v.id,remaining:Math.max(0,Math.ceil((v.endsAt-Date.now())/1000))})},250);later(()=>finishVote(),duration)}
function openPitchQuestion(actor){if(!G.pitch)return;openVote({kind:'pitch-final',actorId:actor.id,duration:DUR.vote,pitchStep:G.pitch.step+1})}
function startFinal(actor){G.pitch={teamId:actor.id,step:0,hits:0};broadcast('notice',{title:'🏰 PITCH DAY',body:`${actor.name} chegou ao Greenlight. São 5 perguntas; precisa acertar pelo menos 3.`});G.phase='NOTICE';emitState();later(()=>openPitchQuestion(actor),DUR.notice)}
function land(actor){actor.phase=phaseForPos(actor.pos);const type=CELL_TYPES[(actor.pos-1)%CELL_TYPES.length];log('land',{teamId:actor.id,pos:actor.pos,type});if(type==='final'){startFinal(actor);return}if(type==='bonus'){actor.xp++;G.phase='NOTICE';emitState();broadcast('notice',{title:'⭐ POWER-UP',body:`${actor.name} recebe +1 XP.`,teamId:actor.id});later(()=>showPodiumThenNext(),DUR.notice);return}if(type==='setback'){
 const from=actor.pos;
 actor.pos=Math.max(1,actor.pos-1);actor.phase=phaseForPos(actor.pos);
 G.phase='NOTICE';emitState();
 broadcast('notice',{title:'↩️ REVÉS',body:`${actor.name} volta 1 casa.`,teamId:actor.id});
 later(()=>{
   G.phase='MOVE';emitState();
   broadcast('move:step',{teamId:actor.id,pos:actor.pos,target:actor.pos,from,effect:'setback'});
   later(()=>{
     const destinationType=CELL_TYPES[(actor.pos-1)%CELL_TYPES.length];
     broadcast('landing',{teamId:actor.id,pos:actor.pos,type:destinationType,source:'setback'});
     // A casa de destino precisa ser resolvida antes do pódio.
     // Evita loop imediato de revés sobre revés: nesse caso mostra a casa e encerra o turno.
     if(destinationType==='setback'){
       G.phase='NOTICE';emitState();
       broadcast('notice',{title:'🛤️ NOVA CASA',body:`${actor.name} chegou à casa ${actor.pos}.`,teamId:actor.id});
       later(()=>showPodiumThenNext(),DUR.notice);return;
     }
     land(actor);
   },DUR.move);
 },DUR.notice);
 return
}if(type==='battle'){const opp=G.teams.filter(t=>t.id!==actor.id&&!t.blocked).sort((a,b)=>a.xp-b.xp||a.pos-b.pos)[0];if(opp){openVote({kind:'battle',actorId:actor.id,opponentId:opp.id});return}}openVote({actorId:actor.id})}
function roll(){if(!G.started||G.phase!=='TURN'||G.vote?.open||G.winnerId)return false;const actor=G.teams[G.turn];if(!actor||actor.blocked)return false;const value=nextDice(),from=actor.pos,target=Math.min(30,from+value);G.phase='DICE';log('dice',{teamId:actor.id,value,from,target});emitState();broadcast('dice:rolling',{teamId:actor.id,duration:DUR.dice});later(()=>{broadcast('dice:result',{teamId:actor.id,value,from,target,duration:DUR.diceResult});later(()=>{G.phase='MOVE';emitState();let p=from;const moveOne=()=>{if(p>=target){later(()=>land(actor),500);return}p++;actor.pos=p;actor.phase=phaseForPos(p);emitState();broadcast('move:step',{teamId:actor.id,pos:p,target});later(moveOne,DUR.move)};moveOne()},DUR.diceResult)},DUR.dice);return true}
function reset(){clearAllTimers();G=fresh();fixedDiceIndex=0;broadcast('reset',{version:VERSION});emitState()}
function qrSvg(text){const qr=new QRCode(-1,QRErrorCorrectLevel.M);qr.addData(text);qr.make();const n=qr.getModuleCount(),m=4,size=n+2*m;let d='';for(let r=0;r<n;r++)for(let c=0;c<n;c++)if(qr.isDark(r,c))d+=`M${c+m} ${r+m}h1v1h-1z`;return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" shape-rendering="crispEdges"><rect width="100%" height="100%" fill="white"/><path d="${d}" fill="black"/></svg>`}
function serveStatic(req,res,url){let rel=url.pathname==='/'?'professor.html':url.pathname.replace(/^\//,'');const file=path.normalize(path.join(PUBLIC,rel));if(!file.startsWith(PUBLIC))return json(res,403,{error:'forbidden'});if(!fs.existsSync(file)||fs.statSync(file).isDirectory())return false;const ext=path.extname(file),ct={'.html':'text/html; charset=utf-8','.js':'application/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.svg':'image/svg+xml'}[ext]||'application/octet-stream';res.writeHead(200,{'Content-Type':ct,'Cache-Control':'no-store'});fs.createReadStream(file).pipe(res);return true}
async function api(req,res,url){if(req.method==='GET'&&url.pathname==='/api/state')return json(res,200,publicState());if(req.method==='GET'&&url.pathname==='/api/trace')return json(res,200,{version:VERSION,state:publicState(),log:G.log.slice(-300)});if(req.method==='GET'&&url.pathname==='/healthz')return json(res,200,{ok:true,version:VERSION,phase:G.phase,started:G.started,teams:G.teams.map(t=>({id:t.id,joined:!!t.controlId,pos:t.pos,xp:t.xp,blocked:t.blocked})),vote:G.vote?{id:G.vote.id,open:G.vote.open,eligible:G.vote.eligible,voters:Object.keys(G.vote.responses),endsAt:G.vote.endsAt}:null,lastResult:G.lastResult?{voteId:G.lastResult.voteId,kind:G.lastResult.kind}:null,pitch:G.pitch,winnerId:G.winnerId});if(req.method==='GET'&&url.pathname==='/events'){res.writeHead(200,{'Content-Type':'text/event-stream','Cache-Control':'no-store','Connection':'keep-alive'});res.write(': connected\n\n');streams.add(res);sse(res,'hello',{version:VERSION,state:publicState()});req.on('close',()=>streams.delete(res));return true}if(req.method==='GET'&&url.pathname==='/qr.svg'){const text=url.searchParams.get('text')||'';res.writeHead(200,{'Content-Type':'image/svg+xml','Cache-Control':'no-store'});res.end(qrSvg(text));return true}if(req.method!=='POST')return false;let d={};try{d=await body(req)}catch{return json(res,400,{ok:false,error:'JSON inválido'})}
 if(process.env.NODE_ENV==='test'&&url.pathname==='/api/test/question'){try{const phase=String(d.phase||'CONCEITO'),scope=String(d.scope||phase);const q=shuffleQuestion(phase,'TEST',scope);return json(res,200,{ok:true,question:q,used:G.usedQuestionIds.length,usedKeys:G.usedQuestionKeys.length})}catch(e){return json(res,409,{ok:false,error:e.message})}}
 if(process.env.NODE_ENV==='test'&&url.pathname==='/api/test/open-vote'){
   if(G.vote?.open){G.vote=null}
   const actorId=String(d.actorId||'T1'),kind=String(d.kind||'collective'),opponentId=d.opponentId?String(d.opponentId):null;
   openVote({kind,actorId,opponentId,duration:Number(d.duration||40),pitchStep:d.pitchStep||null});
   return json(res,200,{ok:!!G.vote,vote:G.vote?publicVote():null});
 }
 if(process.env.NODE_ENV==='test'&&url.pathname==='/api/test/set'){if(Number.isInteger(d.turn))G.turn=Math.max(0,Math.min(G.teams.length-1,d.turn));if(d.phase)G.phase=String(d.phase);if(d.started!==undefined)G.started=!!d.started;if(d.teamId){const t=team(String(d.teamId));if(t){if(Number.isInteger(d.pos))t.pos=Math.max(1,Math.min(30,d.pos));if(d.blocked!==undefined)t.blocked=!!d.blocked;if(Number.isFinite(d.xp))t.xp=Number(d.xp);t.phase=phaseForPos(t.pos)}}G.vote=null;G.lastResult=null;G.pitch=null;G.winnerId=null;emitState();return json(res,200,{ok:true,state:publicState()})}
 if(url.pathname==='/api/setup'){if(G.started)return json(res,409,{ok:false,error:'Partida já iniciada.'});clearAllTimers();G=fresh();const names=Array.isArray(d.names)?d.names:[];const count=Math.max(2,Math.min(10,Number(d.count)||7));G.teams=Array.from({length:count},(_,i)=>({id:`T${i+1}`,name:String(names[i]||`Estúdio ${i+1}`).slice(0,40),pos:1,xp:0,blocked:false,phase:'CONCEITO',controlId:null,lastSeen:0}));log('setup',{count});emitState();return json(res,200,{ok:true,state:publicState()})}
 if(url.pathname==='/api/unlock'){if(G.started)return json(res,409,{ok:false,error:'Só é possível liberar controles antes de iniciar.'});const t=team(String(d.teamId||''));if(!t)return json(res,404,{ok:false,error:'Equipe não encontrada.'});t.controlId=null;t.lastSeen=0;log('unlock',{teamId:t.id});emitState();return json(res,200,{ok:true})}
 if(url.pathname==='/api/start'){if(G.teams.filter(t=>t.controlId).length<2)return json(res,409,{ok:false,error:'Conecte pelo menos 2 controles.'});G.started=true;G.phase='TURN';G.turn=0;G.round=1;log('start');emitState();return json(res,200,{ok:true})}
 if(url.pathname==='/api/reset'){reset();return json(res,200,{ok:true,state:publicState()})}
 if(url.pathname==='/api/roll'){
   const actor=G.teams[G.turn],teamId=String(d.teamId||''),controlId=String(d.controlId||'');
   if(!actor)return json(res,409,{ok:false,error:'Não há equipe no turno.'});
   if(teamId!==actor.id)return json(res,403,{ok:false,error:`É a vez de ${actor.name}.`});
   if(actor.controlId!==controlId)return json(res,403,{ok:false,error:'Este controle não está vinculado à equipe da vez.'});
   const ok=roll();
   return json(res,ok?200:409,{ok,error:ok?null:'Não é possível rolar agora.'})
 }
 if(url.pathname==='/api/join'){const t=team(String(d.teamId||'')),cid=String(d.controlId||'');if(!t||!cid)return json(res,400,{ok:false,error:'Equipe/controle inválido.'});if(t.controlId&&t.controlId!==cid)return json(res,409,{ok:false,error:'Esta equipe já possui um controle vinculado.'});t.controlId=cid;t.lastSeen=Date.now();log('join',{teamId:t.id,controlId:cid});emitState();return json(res,200,{ok:true,team:visibleTeam(t),state:publicState()})}
 if(url.pathname==='/api/ping'){const t=team(String(d.teamId||''));if(t&&t.controlId===String(d.controlId||''))t.lastSeen=Date.now();return json(res,200,{ok:true})}
 if(url.pathname==='/api/vote'){const v=G.vote,t=team(String(d.teamId||'')),cid=String(d.controlId||'');if(!v?.open)return json(res,409,{ok:false,error:'Não há votação ativa.'});if(!t||t.controlId!==cid)return json(res,403,{ok:false,error:'Controle não vinculado a esta equipe.'});if(String(d.voteId)!==v.id)return json(res,409,{ok:false,error:'Votação desatualizada.'});if(t.blocked)return json(res,403,{ok:false,error:'Equipe em Crunch não pode votar.'});if(!v.eligible.includes(t.id))return json(res,403,{ok:false,error:'Sua equipe não participa desta votação.'});const choice=Number(d.choice);if(!Number.isInteger(choice)||choice<0||choice>=v.question.options.length)return json(res,400,{ok:false,error:'Alternativa inválida.'});v.responses[t.id]=choice;log('vote',{voteId:v.id,teamId:t.id,choice});broadcast('vote:progress',{voteId:v.id,voterIds:Object.keys(v.responses),count:Object.keys(v.responses).length,total:v.eligible.length});emitState();return json(res,200,{ok:true,choice,count:Object.keys(v.responses).length,total:v.eligible.length})}
 return false}
const server=http.createServer(async(req,res)=>{const url=new URL(req.url,`http://${req.headers.host||'localhost'}`);try{const done=await api(req,res,url);if(done!==false)return;if(serveStatic(req,res,url))return;json(res,404,{error:'not found'})}catch(e){console.error(e);json(res,500,{ok:false,error:e.message})}});
server.listen(PORT,()=>console.log(`Game Jam ${VERSION} listening on ${PORT}`));
