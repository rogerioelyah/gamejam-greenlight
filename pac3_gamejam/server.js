const express=require('express');
const http=require('http');
const path=require('path');
const {Server}=require('socket.io');
const app=express(),server=http.createServer(app),io=new Server(server,{pingTimeout:20000,pingInterval:10000});
const PORT=process.env.PORT||3000, VERSION='4.0.0-clean';
app.use((req,res,next)=>{res.set('Cache-Control','no-store');next()});
app.use(express.static(path.join(__dirname,'public')));
app.get('/',(_,res)=>res.redirect('/professor.html'));

const PHASES=['CONCEITO','GAMEPLAY','PLAYTEST','PITCH'];
const CELL_TYPES=['challenge','bonus','challenge','setback','challenge','battle','challenge','bonus','challenge','setback','challenge','battle','challenge','bonus','challenge','setback','challenge','battle','challenge','bonus','challenge','setback','challenge','battle','challenge','bonus','challenge','setback','challenge','battle'];
const Q=[
['CONCEITO','No GDD, qual seção apresenta nome, estilo, público-alvo, história e regras principais?',['Conceito','Câmeras','Sonorização'],0,'O conceito apresenta a visão geral do jogo.'],
['CONCEITO','Qual função melhor descreve um Game Design Document?',['Substituir o código-fonte','Descrever os aspectos do jogo e orientar o projeto','Registrar apenas bugs'],1,'O GDD funciona como espinha dorsal do projeto.'],
['CONCEITO','Qual elemento pertence às especificações do jogo?',['Sistema de pontuação e ranking','Somente logotipo','Somente linguagem de programação'],0,'Pontuação, ranking, fases e jogadores integram as especificações.'],
['CONCEITO','No planejamento de um jogo, público-alvo serve principalmente para:',['Orientar decisões de design','Definir a senha do servidor','Eliminar testes'],0,'O público-alvo influencia linguagem, desafio, interface e experiência.'],
['CONCEITO','Uma condição de vitória deve responder a qual pergunta?',['Como o jogador sabe que alcançou o objetivo?','Qual IDE foi usada?','Quem criou o banco de dados?'],0,'A condição de vitória explicita o objetivo final.'],
['CONCEITO','Qual item é adequado a um GDD de uma página?',['Resumo do jogo','Código completo do servidor','Todos os commits Git'],0,'O resumo apresenta história, gameplay, regras e objetivos.'],
['CONCEITO','Qual decisão pertence ao universo do jogo?',['Como fases e cenários se conectam','Qual senha do Wi-Fi','Qual editor de texto usar'],0,'O universo descreve cenários, estrutura do mundo e conexão entre fases.'],
['CONCEITO','Por que regras precisam estar claras no GDD?',['Para alinhar como o jogo funciona','Para impedir qualquer mudança','Para substituir playtests'],0,'Regras claras alinham a experiência pretendida.'],
['GAMEPLAY','Gameplay descreve principalmente:',['Mecânicas, desafios e progressão','Apenas créditos','Somente requisitos de hardware'],0,'Gameplay trata de como se joga e progride.'],
['GAMEPLAY','Qual é um sistema de recompensa de gameplay?',['XP, pontos ou itens','Nome do arquivo HTML','Resolução do monitor'],0,'Recompensas dão retorno e motivam progressão.'],
['GAMEPLAY','Um desafio fica mais difícil ao longo das fases. Isso é exemplo de:',['Progressão de dificuldade','Menu de créditos','Backup'],0,'A progressão regula o desafio conforme o avanço.'],
['GAMEPLAY','Qual ação é uma métrica de personagem típica?',['Andar e pular','Editar README','Criar branch'],0,'Ações e capacidades do personagem fazem parte do gameplay.'],
['GAMEPLAY','Por que controles devem constar no GDD?',['Para definir como o jogador executa ações','Para esconder comandos','Para dispensar interface'],0,'Controles ligam intenção do jogador às ações do jogo.'],
['GAMEPLAY','Uma recompensa é mais útil quando:',['Reforça o comportamento e a progressão desejados','É aleatória sem relação com o jogo','Impede o jogador de entender o objetivo'],0,'Recompensas devem conversar com a experiência.'],
['GAMEPLAY','A câmera influencia o gameplay porque:',['Define como o jogador visualiza e percebe o espaço','Só muda o nome do jogo','Não interfere na experiência'],0,'A câmera é parte da percepção e navegação.'],
['GAMEPLAY','Qual relação entre história e gameplay é mais consistente?',['As ações do jogador ajudam a avançar a narrativa','A história nunca se relaciona às ações','Gameplay só existe no menu'],0,'O GDD pergunta explicitamente como gameplay e história se relacionam.'],
['PLAYTEST','O objetivo central de um playtest é:',['Observar a experiência real e encontrar problemas','Provar que o designer está certo','Evitar mudanças'],0,'Playtest gera evidências sobre a experiência.'],
['PLAYTEST','Durante um playtest, o melhor comportamento da equipe é:',['Observar antes de explicar tudo ao jogador','Ensinar cada resposta','Ignorar dificuldades'],0,'Observar revela problemas de compreensão e interação.'],
['PLAYTEST','Se vários jogadores não entendem uma regra, a equipe deve:',['Revisar regra/interface e testar novamente','Culpar os jogadores','Remover o playtest'],0,'Iteração é parte do processo de design.'],
['PLAYTEST','Qual dado de playtest é mais útil?',['Onde jogadores travam e por quê','Apenas elogios dos amigos','Número de linhas de código'],0,'Problemas observáveis orientam melhorias.'],
['PLAYTEST','Uma alteração feita após feedback deve ser:',['Validada em novo teste','Considerada perfeita automaticamente','Escondida do restante da equipe'],0,'Mudanças precisam ser verificadas.'],
['PLAYTEST','O HUD deve ser avaliado porque:',['Comunica informações necessárias durante o jogo','Serve apenas como decoração','Não afeta decisões'],0,'HUD comunica estado, pontuação e recursos.'],
['PLAYTEST','Se o desafio é impossível para quase todos, qual hipótese testar?',['Dificuldade mal calibrada','O jogo está necessariamente perfeito','O público não importa'],0,'A dificuldade deve ser calibrada ao objetivo e público.'],
['PLAYTEST','Qual ciclo representa melhor prototipação de jogo?',['Construir → testar → aprender → ajustar','Construir → nunca testar','Planejar → publicar sem jogar'],0,'Iteração reduz incertezas.'],
['PITCH','Em um pitch de jogo, o objetivo é:',['Comunicar claramente proposta, diferencial e experiência','Ler todo o código','Mostrar somente cronograma'],0,'Pitch sintetiza valor e experiência do projeto.'],
['PITCH','Qual informação ajuda a explicar o diferencial do jogo?',['Principais características e atrativos','Senha do GitHub','Nome de todas as variáveis'],0,'Características principais tornam a proposta compreensível.'],
['PITCH','Um pitch coerente deve conectar:',['Problema/proposta, público e gameplay','Somente cores','Somente tecnologia'],0,'A proposta precisa formar uma experiência coerente.'],
['PITCH','Ao apresentar controles, o grupo deve explicar:',['Como as ações do jogador são executadas','Apenas o modelo do teclado','Somente atalhos do editor'],0,'Controles são parte essencial da experiência.'],
['PITCH','Qual evidência fortalece um pitch após playtest?',['Mudanças realizadas a partir de observações','Afirmar que ninguém encontrou problemas','Evitar mencionar testes'],0,'Aprendizado e iteração fortalecem a justificativa.'],
['PITCH','O cronograma no GDD registra:',['Etapas e desenvolvimento planejado','Somente a data de lançamento','Apenas nomes dos integrantes'],0,'O cronograma descreve o desenvolvimento.'],
['PITCH','Uma boa condição de vitória deve ser:',['Compreensível e relacionada ao objetivo do jogo','Secreta para todos','Mudada a cada minuto'],0,'O jogador precisa entender o que busca alcançar.'],
['PITCH','Qual fechamento é mais adequado ao pitch?',['Mostrar por que vale testar/continuar o projeto','Abrir o código inteiro','Repetir o título várias vezes'],0,'O fechamento reforça a proposta e próximo passo.']
];

function fresh(){
 return {version:VERSION,sessionId:Date.now().toString(36),started:false,phase:'LOBBY',turn:0,round:1,
 teams:[],vote:null,lastResult:null,log:[]};
}
let G=fresh(), voteTimer=null, tickTimer=null;
function team(id){return G.teams.find(t=>t.id===id)}
function publicState(){return {...G,vote:G.vote?{...G.vote,responses:{...G.vote.responses}}:null}}
function emitState(){io.emit('state',publicState())}
function log(type,data={}){G.log.push({at:Date.now(),type,data});if(G.log.length>200)G.log.shift()}
function clearVoteTimers(){clearTimeout(voteTimer);clearInterval(tickTimer);voteTimer=tickTimer=null}
function shuffleQuestion(phase){
 const pool=Q.filter(q=>q[0]===phase), raw=pool[Math.floor(Math.random()*pool.length)];
 const pairs=raw[2].map((text,i)=>({text,correct:i===raw[3]}));
 for(let i=pairs.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[pairs[i],pairs[j]]=[pairs[j],pairs[i]]}
 return {phase,text:raw[1],options:pairs.map(x=>x.text),correct:pairs.findIndex(x=>x.correct),why:raw[4]};
}
function nextTurn(){
 if(!G.teams.length)return;
 G.turn=(G.turn+1)%G.teams.length;
 if(G.turn===0)G.round++;
 const t=G.teams[G.turn];
 if(t.blocked){t.blocked=false;log('crunch:consumed',{teamId:t.id});io.emit('notice',{title:'🔓 CRUNCH CONSUMIDO',body:`${t.name} perde este turno e está desbloqueado.`});setTimeout(nextTurn,2400)}
 else {G.phase='TURN';emitState()}
}
function finishVote(){
 if(!G.vote||!G.vote.open)return;
 clearVoteTimers();
 const v=G.vote;v.open=false;
 const results={};
 v.eligible.forEach(id=>{const c=v.responses[id];results[id]={answered:Number.isInteger(c),choice:Number.isInteger(c)?c:null,correct:c===v.question.correct}});
 const payload={voteId:v.id,kind:v.kind,question:v.question,results,eligible:v.eligible,actorId:v.actorId,opponentId:v.opponentId};
 G.lastResult=payload; log('vote:finish',payload);
 io.emit('vote:result',payload);
 setTimeout(()=>{G.vote=null;emitState()},800);
}
function openVote({kind='collective',actorId,opponentId=null,duration=20}){
 if(G.vote?.open)return;
 const actor=team(actorId); if(!actor)return;
 const eligible=kind==='battle'?[actorId,opponentId].filter(Boolean):G.teams.filter(t=>!t.blocked).map(t=>t.id);
 const question=shuffleQuestion(actor.phase||'CONCEITO');
 G.vote={id:`V-${Date.now()}-${Math.random().toString(36).slice(2,6)}`,kind,actorId,opponentId,eligible,question,responses:{},open:true,endsAt:Date.now()+duration*1000,duration};
 log('vote:open',{voteId:G.vote.id,eligible,kind});
 io.emit('vote:open',G.vote); emitState();
 tickTimer=setInterval(()=>{if(!G.vote?.open)return;io.emit('vote:tick',{voteId:G.vote.id,remaining:Math.max(0,Math.ceil((G.vote.endsAt-Date.now())/1000))})},500);
 voteTimer=setTimeout(finishVote,duration*1000);
}
function land(actor){
 const pos=actor.pos, type=CELL_TYPES[(pos-1)%CELL_TYPES.length];
 actor.cellType=type;
 if(type==='bonus'){actor.xp+=1;io.emit('notice',{title:'⭐ POWER-UP',body:`${actor.name} recebe +1 XP.`});setTimeout(()=>{emitState();nextTurn()},2200);return}
 if(type==='setback'){actor.pos=Math.max(1,actor.pos-1);io.emit('notice',{title:'↩️ REVÉS',body:`${actor.name} volta 1 casa.`});setTimeout(()=>{emitState();nextTurn()},2200);return}
 if(type==='battle'){
   const others=G.teams.filter(t=>t.id!==actor.id&&!t.blocked);
   const opp=others.sort((a,b)=>a.xp-b.xp)[0];
   if(!opp){openVote({actorId:actor.id});return}
   openVote({kind:'battle',actorId:actor.id,opponentId:opp.id});return
 }
 openVote({actorId:actor.id});
}
function roll(){
 if(!G.started||G.phase!=='TURN'||G.vote?.open)return;
 const actor=G.teams[G.turn];if(!actor)return;
 G.phase='DICE';emitState();
 const value=1+Math.floor(Math.random()*6),from=actor.pos,target=Math.min(30,from+value);
 log('dice',{teamId:actor.id,value,from,target});
 io.emit('dice:rolling',{teamId:actor.id,duration:5000});
 setTimeout(()=>{io.emit('dice:result',{teamId:actor.id,value,from,target});
   setTimeout(()=>{
    G.phase='MOVE';let step=from;
    const iv=setInterval(()=>{step++;actor.pos=step;emitState();io.emit('move:step',{teamId:actor.id,pos:step,target});
      if(step>=target){clearInterval(iv);setTimeout(()=>{actor.phase=PHASES[Math.min(PHASES.length-1,Math.floor((actor.pos-1)/8))];land(actor)},650)}
    },650);
   },1800);
 },5000);
}
function applyResult(d){
 const actor=team(d.actorId); if(!actor)return;
 if(d.kind==='battle'){
   const opp=team(d.opponentId), ar=d.results[actor.id], br=opp&&d.results[opp.id];
   if(ar?.correct){actor.xp+=2;actor.blocked=false}else{actor.xp=Math.max(0,actor.xp-1);actor.blocked=true}
   if(opp){if(br?.correct){opp.xp+=2;opp.blocked=false}else{opp.xp=Math.max(0,opp.xp-1);opp.blocked=true}}
 }else{
   Object.entries(d.results).forEach(([id,r])=>{const t=team(id);if(t&&r.correct)t.xp++});
   if(!d.results[actor.id]?.correct)actor.blocked=true;
 }
 emitState();
 setTimeout(nextTurn,5200);
}
io.on('connection',socket=>{
 socket.emit('hello',{version:VERSION,state:publicState()});
 if(G.vote?.open)socket.emit('vote:open',G.vote);
 socket.on('professor:setup',(d,ack)=>{
   const n=Math.max(2,Math.min(10,+d.count||7));clearVoteTimers();G=fresh();
   G.teams=Array.from({length:n},(_,i)=>({id:`T${i+1}`,name:`Estúdio ${i+1}`,pos:1,xp:0,blocked:false,phase:'CONCEITO',cellType:null}));
   log('setup',{n});emitState();ack&&ack({ok:true});
 });
 socket.on('professor:start',(_,ack)=>{if(G.teams.length<2)return ack&&ack({ok:false});G.started=true;G.phase='TURN';G.turn=0;G.round=1;emitState();ack&&ack({ok:true})});
 socket.on('professor:roll',()=>roll());
 socket.on('professor:reset',()=>{clearVoteTimers();G=fresh();emitState()});
 socket.on('professor:forceNext',()=>{clearVoteTimers();G.vote=null;nextTurn()});
 socket.on('student:join',(d,ack)=>{
   const t=team(String(d.teamId||''));if(!t)return ack&&ack({ok:false,error:'Equipe inválida'});
   if(t.socketId&&t.socketId!==socket.id)return ack&&ack({ok:false,error:'Esta equipe já possui um controle conectado.'});
   t.socketId=socket.id;socket.data.teamId=t.id;socket.join(t.id);log('join',{teamId:t.id,socketId:socket.id});emitState();ack&&ack({ok:true,team:t,state:publicState(),vote:G.vote});
 });
 socket.on('student:vote',(d,ack)=>{
   const id=socket.data.teamId,v=G.vote;
   if(!id||!v?.open)return ack&&ack({ok:false,error:'Não há votação ativa.'});
   if(d.voteId!==v.id)return ack&&ack({ok:false,error:'Votação desatualizada.'});
   if(!v.eligible.includes(id))return ack&&ack({ok:false,error:'Sua equipe não participa desta votação.'});
   const choice=+d.choice;if(!Number.isInteger(choice)||choice<0||choice>=v.question.options.length)return ack&&ack({ok:false,error:'Alternativa inválida.'});
   v.responses[id]=choice;log('vote',{voteId:v.id,teamId:id,choice});
   const voterIds=Object.keys(v.responses);
   io.emit('vote:progress',{voteId:v.id,voterIds,count:voterIds.length,total:v.eligible.length});
   ack&&ack({ok:true,choice,count:voterIds.length,total:v.eligible.length});
 });
 socket.on('professor:resultApplied',(d)=>{if(G.lastResult&&d.voteId===G.lastResult.voteId){applyResult(G.lastResult);G.lastResult=null}});
 socket.on('disconnect',()=>{const id=socket.data.teamId,t=team(id);if(t&&t.socketId===socket.id){t.socketId=null;emitState()}});
});
app.get('/healthz',(_,res)=>res.json({ok:true,version:VERSION,phase:G.phase,started:G.started,teams:G.teams.map(t=>({id:t.id,connected:!!t.socketId,pos:t.pos,xp:t.xp,blocked:t.blocked})),vote:G.vote?{id:G.vote.id,open:G.vote.open,eligible:G.vote.eligible,voters:Object.keys(G.vote.responses),endsAt:G.vote.endsAt}:null,lastResult:G.lastResult?{voteId:G.lastResult.voteId,kind:G.lastResult.kind}:null}));
server.listen(PORT,()=>console.log(`Game Jam Greenlight ${VERSION} on ${PORT}`));
