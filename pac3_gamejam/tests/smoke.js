const fs=require('fs'),vm=require('vm');
const assert=(x,m)=>{if(!x)throw new Error(m)};
const server=fs.readFileSync(require('path').join(__dirname,'..','server.js'),'utf8');
const prof=fs.readFileSync(require('path').join(__dirname,'..','public','professor.html'),'utf8');
const stu=fs.readFileSync(require('path').join(__dirname,'..','public','aluno.html'),'utf8');
const checks=[
 ['server version',server.includes("VERSION='4.0.0-clean'")],
 ['single server vote state',server.includes('G.vote={id:')],
 ['server authoritative timer',server.includes('voteTimer=setTimeout(finishVote,duration*1000)')],
 ['student vote ack',server.includes("ack&&ack({ok:true,choice,count:voterIds.length,total:v.eligible.length})")],
 ['live voter progress',server.includes("io.emit('vote:progress'")],
 ['vote changes allowed',server.includes('v.responses[id]=choice')],
 ['dice 1-6',server.includes('1+Math.floor(Math.random()*6)')],
 ['dice 5 seconds',server.includes("duration:5000")],
 ['step movement',server.includes("io.emit('move:step'")],
 ['crunch auto consume',server.includes("t.blocked=false")],
 ['battle loser blocked',server.includes("actor.blocked=true")],
 ['battle winner free',server.includes("actor.blocked=false")],
 ['professor voter board',prof.includes('0/${v.eligible.length} responderam')],
 ['professor result screen',prof.includes('Resposta correta:')],
 ['professor podium',prof.includes('PÓDIO DA GAME JAM')],
 ['student cannot swap via UI',stu.includes("if(me||!state)return")],
 ['student can change vote',stu.includes('Você ainda pode alterar')],
 ['health endpoint',server.includes("app.get('/healthz'")],
 ['reset new session',server.includes("G=fresh()")],
 ['2-10 teams',server.includes('Math.max(2,Math.min(10')]
];
for(const [n,ok] of checks){console.log((ok?'PASS':'FAIL')+' '+n);assert(ok,n)}
console.log(`TOTAL ${checks.length}/${checks.length} PASS`);
