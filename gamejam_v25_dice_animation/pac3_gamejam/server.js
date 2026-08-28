
const express=require('express');
const http=require('http');
const os=require('os');
const QRCode=require('qrcode');
const {Server}=require('socket.io');
const app=express(), server=http.createServer(app), io=new Server(server);
const PORT=process.env.PORT||3000;
let game={teams:[],turnIndex:0,started:false,turnCount:1,phase:'CONCEITO',sessionId:Date.now()};
let vote=null,timer=null;

app.use(express.static('public'));
app.get('/',(_,res)=>res.redirect('/professor.html'));
app.get('/aluno',(_,res)=>res.sendFile(__dirname+'/public/aluno.html'));
app.get('/qr.png',async(req,res)=>{try{res.type('png').send(await QRCode.toBuffer(String(req.query.url||''),{width:420,margin:2}))}catch(e){res.status(500).send('QR error')}});

function current(){return game.teams[game.turnIndex]||null}
function emitGame(){io.emit('game:state',game)}
function pubVote(){if(!vote)return null;return {voteId:vote.id,open:vote.open,kind:vote.kind,optionCount:vote.optionCount,eligibleTeamIds:vote.eligible,currentChoices:{...vote.responses}}}
function closeVote(){
 if(!vote||!vote.open)return; vote.open=false; clearTimeout(timer);
 const results={}; for(const id of vote.eligible){const c=Object.prototype.hasOwnProperty.call(vote.responses,id)?vote.responses[id]:null;results[id]={choice:c,correct:c===vote.correctIndex,answered:c!==null}}
 io.emit('vote:result',{voteId:vote.id,kind:vote.kind,results,correctIndex:vote.correctIndex});
 io.emit('vote:closed',{voteId:vote.id}); setTimeout(()=>vote=null,800);
}
function resetGame(){
 clearTimeout(timer);
 vote=null;
 game={teams:[],turnIndex:0,started:false,turnCount:1,phase:'CONCEITO',sessionId:Date.now()};
 io.emit('vote:closed',{});
 io.emit('game:reset',{newGame:true,sessionId:game.sessionId});
 emitGame();
}
function nextTurn(){
 if(!game.teams.length)return;
 let tries=0;
 do{
   game.turnIndex=(game.turnIndex+1)%game.teams.length;
   tries++;
 }while(game.teams[game.turnIndex]?.eliminated&&tries<game.teams.length+1);

 game.turnCount++;
 const t=current();

 if(t?.blocked){
   t.blocked=0;
   t.pendingRoll=null;
   emitGame();
   io.emit('game:crunchReleased',{teamId:t.id,name:t.name,duration:3200});
   setTimeout(()=>nextTurn(),3200);
   return;
 }
 emitGame();
}

function rollCurrent(ack){
 const t=current();
 if(!game.started||!t)return ack&&ack({ok:false,message:'A partida ainda não foi iniciada.'});
 if(t.blocked)return ack&&ack({ok:false,message:'O Crunch será consumido automaticamente quando chegar o turno.'});
 if(t.moving||t.pendingRoll)return ack&&ack({ok:false,message:'O dado já está sendo lançado.'});

 const n=1+Math.floor(Math.random()*6);
 const from=t.pos||1;
 const target=Math.min(24,from+n);
 const session=game.sessionId;

 t.pendingRoll=n;
 t.moving=true;
 emitGame();

 // Fase 1: animação do dado por 5 segundos.
 io.emit('game:diceRolling',{teamId:t.id,from,duration:5000});
 ack&&ack({ok:true,rolling:true});

 setTimeout(()=>{
   if(game.sessionId!==session)return;
   const live=game.teams.find(x=>x.id===t.id);
   if(!live||!live.moving)return;

   // Fase 2: revela o resultado e informa quantas casas serão percorridas.
   io.emit('game:rolled',{teamId:live.id,value:n,from,target,displayMs:2200});

   // Fase 3: volta ao mapa e caminha casa por casa.
   setTimeout(()=>{
     if(game.sessionId!==session)return;
     const movingTeam=game.teams.find(x=>x.id===t.id);
     if(!movingTeam||!movingTeam.moving)return;

     const actualSteps=Math.max(0,target-from);
     if(actualSteps===0){
       movingTeam.pendingRoll=null;movingTeam.moving=false;
       movingTeam.revealed=movingTeam.revealed||{};movingTeam.revealed[movingTeam.pos]=true;
       emitGame();
       io.emit('game:moved',{teamId:movingTeam.id,roll:n,from,to:movingTeam.pos});
       return;
     }

     let step=0;
     const walk=()=>{
       if(game.sessionId!==session)return;
       const currentTeam=game.teams.find(x=>x.id===t.id);
       if(!currentTeam||!currentTeam.moving)return;
       step++;
       currentTeam.pos=Math.min(target,from+step);
       emitGame();
       io.emit('game:step',{teamId:currentTeam.id,roll:n,step,totalSteps:actualSteps,pos:currentTeam.pos,from,target});
       if(step<actualSteps){
         setTimeout(walk,550);
       }else{
         currentTeam.pendingRoll=null;
         currentTeam.moving=false;
         currentTeam.revealed=currentTeam.revealed||{};
         currentTeam.revealed[currentTeam.pos]=true;
         emitGame();
         setTimeout(()=>io.emit('game:moved',{teamId:currentTeam.id,roll:n,from,to:currentTeam.pos}),250);
       }
     };
     walk();
   },2200);
 },5000);
}
function activateCurrentPath(teamId,ack){
 const t=current();
 if(!t)return ack&&ack({ok:false,message:'Nenhum estúdio ativo.'});
 if(teamId && t.id!==String(teamId))return ack&&ack({ok:false,message:'O turno mudou. Selecione novamente o estúdio atual.'});
 t.pendingPath=true;
 emitGame();
 io.emit('game:pathActivated',{teamId:t.id});
 ack&&ack({ok:true,teamId:t.id});
}
function cancelCurrentPath(ack){
 const t=current();
 if(t)t.pendingPath=null;
 emitGame();
 io.emit('game:pathCancelled',{teamId:t?.id||null});
 ack&&ack({ok:true});
}
function chooseCurrentPath(choice,ack){
 const t=current();
 if(!t)return ack&&ack({ok:false,message:'Nenhum estúdio ativo.'});
 if(!['risk','safe'].includes(choice))return ack&&ack({ok:false,message:'Rota inválida.'});

 // Recuperação segura: se o popup está aberto mas pendingPath se perdeu,
 // a escolha do Game Master/equipe ainda resolve a bifurcação do estúdio atual.
 t.pendingPath=false;
 t.routeChoice=choice;

 let result;
 if(choice==='safe'){
   t.points=(t.points||0)+1;
   result={choice,teamId:t.id,kind:'safe',message:'Rota segura: +1 XP.',pointsDelta:1,blocked:false};
 }else{
   if(Math.random()<0.6){
     t.points=(t.points||0)+2;
     result={choice,teamId:t.id,kind:'risk_success',message:'Exploração bem-sucedida: +2 XP!',pointsDelta:2,blocked:false};
   }else{
     t.blocked=1;
     result={choice,teamId:t.id,kind:'risk_fail',message:'A rota arriscada gerou Crunch.',pointsDelta:0,blocked:true};
   }
 }
 emitGame();
 io.emit('game:pathResolved',result);
 ack&&ack({ok:true,result});
}

function applyGameEffect(d,ack){
 const t=game.teams.find(x=>x.id===String(d?.teamId||'')) || current();
 if(!t)return ack&&ack({ok:false,message:'Estúdio inválido.'});

 const kind=String(d?.kind||'');
 const amount=Number(d?.amount||0);
 let result={ok:true,teamId:t.id,kind,message:''};

 if(kind==='points'){
   t.points=Math.max(0,(t.points||0)+amount);
   result.points=t.points;
   result.message=`${amount>=0?'+':''}${amount} XP.`;
 }
 else if(kind==='block'){
   t.blocked=1;
   result.blocked=true;
   result.message='Crunch aplicado: perde o próximo turno.';
 }
 else if(kind==='move'){
   const oldPos=t.pos||1;
   let delta=amount;

   // Hotfix pode anular automaticamente UMA penalidade de recuo.
   // Só é consumido em deslocamento negativo.
   if(delta<0 && (t.inventory?.hotfix||0)>0 && d?.allowHotfix!==false){
     t.inventory.hotfix--;
     result.hotfixUsed=true;
     result.oldPos=oldPos;
     result.newPos=oldPos;
     result.message='🔧 Hotfix usado: a penalidade de recuo foi anulada.';
   } else {
     const newPos=Math.max(1,Math.min(24,oldPos+delta));
     const wasRevealed=!!(t.revealed&&t.revealed[newPos]);
     t.pos=newPos;
     t.pendingRoll=null;
     t.revealed=t.revealed||{};
     t.revealed[newPos]=true;
     result.oldPos=oldPos;
     result.newPos=newPos;
     result.wasRevealed=wasRevealed;
     result.message=`${delta<0?'Recuo':'Avanço'}: casa ${oldPos} → ${newPos}.`;
   }
 }
 else if(kind==='inventory'){
   const item=String(d?.item||'');
   if(!['insight','hotfix','pivot'].includes(item))
     return ack&&ack({ok:false,message:'Power-up inválido.'});
   t.inventory=t.inventory||{insight:0,hotfix:0,pivot:0};
   t.inventory[item]=Math.max(0,(t.inventory[item]||0)+(amount||1));
   result.inventory={...t.inventory};
   result.message=`Power-up ${item} atualizado.`;
 }
 else if(kind==='clearAllCrunch'){
   game.teams.forEach(x=>x.blocked=0);
   result.message='Todos os Crunch foram removidos.';
 }
 else{
   return ack&&ack({ok:false,message:'Efeito desconhecido.'});
 }

 emitGame();
 io.emit('game:effectApplied',result);
 ack&&ack({ok:true,result});
}

io.on('connection',socket=>{
 socket.emit('game:state',game); if(vote&&vote.open)socket.emit('vote:open',pubVote());
 socket.on('professor:state',d=>{if(d&&Array.isArray(d.teams)){game=d;emitGame()}});
 socket.on('professor:reset',()=>resetGame());
 socket.on('professor:roll',(_,ack)=>rollCurrent(ack));
 socket.on('professor:activatePath',(d,ack)=>activateCurrentPath(d?.teamId,ack));
 socket.on('professor:path',(d,ack)=>chooseCurrentPath(d?.choice,ack));
 socket.on('professor:cancelPath',(_,ack)=>cancelCurrentPath(ack));
 socket.on('professor:setTurn',(d,ack)=>{const i=game.teams.findIndex(t=>t.id===String(d?.teamId||''));if(i<0)return ack&&ack({ok:false,message:'Estúdio inválido.'});game.turnIndex=i;emitGame();ack&&ack({ok:true})});
 socket.on('professor:clearCrunch',(d,ack)=>{
   const t=game.teams.find(x=>x.id===String(d?.teamId||''));
   if(!t)return ack&&ack({ok:false,message:'Estúdio inválido.'});
   t.blocked=0;t.pendingRoll=null;emitGame();ack&&ack({ok:true,teamId:t.id});
 });
 socket.on('professor:consumeCrunch',(d,ack)=>{
   const t=current();
   if(!t)return ack&&ack({ok:false,message:'Nenhum estúdio ativo.'});
   if(d?.teamId && t.id!==String(d.teamId))return ack&&ack({ok:false,message:'O turno mudou.'});
   t.blocked=0;t.pendingRoll=null;emitGame();ack&&ack({ok:true,teamId:t.id});
 });
 socket.on('professor:openVote',(d,ack)=>{
   // Cancela silenciosamente qualquer votação antiga. Não emite vote:result,
   // evitando que o resultado anterior seja aplicado à pergunta recém-aberta.
   if(vote&&vote.open){
     clearTimeout(timer);
     io.emit('vote:closed',{voteId:vote.id,cancelled:true});
     vote=null;
   }
   const duration=Math.max(1,+d.duration||20);
   vote={id:'V'+Date.now(),open:true,kind:d.kind||'collective',optionCount:+d.optionCount||4,correctIndex:+d.correctIndex,eligible:[...new Set(d.eligibleTeamIds||[])],responses:{},openedAt:Date.now(),duration};
   io.emit('vote:open',pubVote()); io.emit('vote:progress',{count:0,total:vote.eligible.length});
   timer=setTimeout(closeVote,duration*1000);
   ack&&ack({ok:true,voteId:vote.id,duration});
 });
 socket.on('professor:applyEffect',(d,ack)=>applyGameEffect(d,ack));
 socket.on('professor:closeVote',()=>closeVote());
 socket.on('professor:nextTurn',()=>nextTurn());
 socket.on('student:hello',d=>{socket.data.teamId=d?.teamId||null;socket.emit('game:state',game);if(vote&&vote.open)socket.emit('vote:open',pubVote())});
 socket.on('student:join',(d,ack)=>{
   const id=String(d?.teamId||''); if(socket.data.teamId&&socket.data.teamId!==id)return ack&&ack({ok:false,message:'Este aparelho já está vinculado a outro estúdio.'});
   if(!game.teams.some(t=>t.id===id))return ack&&ack({ok:false,message:'Estúdio inválido.'});
   socket.data.teamId=id; ack&&ack({ok:true}); socket.emit('game:state',game);
 });
 socket.on('student:roll',(d,ack)=>{
   const t=current(),id=String(d?.teamId||''); if(!game.started||!t||t.id!==id)return ack&&ack({ok:false,message:'Não é o turno do seu estúdio.'});
   rollCurrent(ack);
 });
 socket.on('student:path',(d,ack)=>{
   const t=current(),id=String(d?.teamId||''); if(!t||t.id!==id)return ack&&ack({ok:false,message:'Não é o seu turno.'});
   chooseCurrentPath(d?.choice,ack);
 });
 socket.on('student:power',(d,ack)=>{
   const t=game.teams.find(x=>x.id===String(d?.teamId||'')); if(!t)return ack&&ack({ok:false});
   const p=String(d?.power||''); if(!t.inventory?.[p])return ack&&ack({ok:false,message:'Power-up indisponível.'});
   io.emit('game:powerRequest',{teamId:t.id,power:p}); ack&&ack({ok:true,message:'Solicitação enviada ao Game Master.'});
 });
 socket.on('student:vote',(d,ack)=>{
   if(!vote||!vote.open)return ack&&ack({ok:false,message:'Votação encerrada.'});
   const id=String(d?.teamId||''); if(!vote.eligible.includes(id))return ack&&ack({ok:false,message:'Seu estúdio acompanha, mas não responde esta rodada.'});
   const c=+d.choice;if(!Number.isInteger(c)||c<0||c>=vote.optionCount)return ack&&ack({ok:false,message:'Alternativa inválida.'});
   vote.responses[id]=c;io.emit('vote:progress',{count:Object.keys(vote.responses).length,total:vote.eligible.length});ack&&ack({ok:true});
 });
});
function ips(){let a=[];for(const xs of Object.values(os.networkInterfaces()))for(const x of xs||[])if(x.family==='IPv4'&&!x.internal)a.push(x.address);return a}
server.listen(PORT,'0.0.0.0',()=>{console.log('\nPAC III — Game Jam: Corrida pelo Greenlight');console.log(`Professor: http://localhost:${PORT}/professor.html`);for(const ip of ips())console.log(`Alunos: http://${ip}:${PORT}/aluno`);console.log('')});
