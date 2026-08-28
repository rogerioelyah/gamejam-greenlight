
const express=require('express');
const http=require('http');
const os=require('os');
const QRCode=require('qrcode');
const {Server}=require('socket.io');
const app=express(), server=http.createServer(app), io=new Server(server);
const PORT=process.env.PORT||3000;
let game={teams:[],turnIndex:0,started:false,turnCount:1,phase:'CONCEITO'};
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
 game={teams:[],turnIndex:0,started:false,turnCount:1,phase:'CONCEITO'};
 io.emit('vote:closed',{});
 io.emit('game:reset');
 emitGame();
}
function nextTurn(){
 if(!game.teams.length)return;
 let tries=0;
 do{game.turnIndex=(game.turnIndex+1)%game.teams.length;tries++}while(game.teams[game.turnIndex]?.eliminated&&tries<game.teams.length+1);
 game.turnCount++; emitGame();
}
io.on('connection',socket=>{
 socket.emit('game:state',game); if(vote&&vote.open)socket.emit('vote:open',pubVote());
 socket.on('professor:state',d=>{if(d&&Array.isArray(d.teams)){game=d;emitGame()}});
 socket.on('professor:reset',()=>resetGame());
 socket.on('professor:openVote',(d,ack)=>{
   if(vote&&vote.open)closeVote();
   vote={id:'V'+Date.now(),open:true,kind:d.kind||'collective',optionCount:+d.optionCount||4,correctIndex:+d.correctIndex,eligible:[...new Set(d.eligibleTeamIds||[])],responses:{}};
   io.emit('vote:open',pubVote()); io.emit('vote:progress',{count:0,total:vote.eligible.length});
   timer=setTimeout(closeVote,(+d.duration||20)*1000+200); ack&&ack({ok:true,voteId:vote.id});
 });
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
   if(t.blocked){return ack&&ack({ok:false,message:'Seu estúdio está em Crunch e perde este turno.'})}
   if(t.pendingRoll)return ack&&ack({ok:false,message:'O dado já foi lançado.'});
   const n=1+Math.floor(Math.random()*3); t.pendingRoll=n; emitGame(); io.emit('game:rolled',{teamId:id,value:n}); ack&&ack({ok:true,value:n});
 });
 socket.on('student:path',(d,ack)=>{
   const t=current(),id=String(d?.teamId||''); if(!t||t.id!==id)return ack&&ack({ok:false,message:'Não é o seu turno.'});
   if(!t.pendingPath)return ack&&ack({ok:false,message:'Não há bifurcação ativa.'});
   const c=d?.choice; if(!['risk','safe'].includes(c))return ack&&ack({ok:false,message:'Rota inválida.'});
   t.pendingPath=null;t.routeChoice=c;emitGame();io.emit('game:pathChosen',{teamId:id,choice:c});ack&&ack({ok:true});
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
