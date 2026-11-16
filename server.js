'use strict';
const http=require('http'),fs=require('fs'),path=require('path'),crypto=require('crypto');
const{pipeline}=require('stream/promises');
try{for(const l of fs.readFileSync(path.join(__dirname,'.env'),'utf8').split(/\r?\n/)){const m=/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/.exec(l);if(m&&!(m[1] in process.env))process.env[m[1]]=m[2].replace(/^(['"])(.*)\1$/,'$2')}}catch(e){}
const PORT=process.env.PORT||3000,DEV_EMAIL='websitescarlett@gmail.com';
const DATA=path.join(__dirname,'data'),UP=path.join(DATA,'uploads'),FILE=path.join(DATA,'db.json');
fs.mkdirSync(UP,{recursive:true});
const WORDS=['anjing','bangsat','kontol','memek','ngentot','bajingan','goblok','tolol','babi','asu','fuck','shit','bitch','asshole'];
const now=()=>Date.now(),uid=()=>crypto.randomBytes(6).toString('hex');
const err=(c,m)=>Object.assign(new Error(m),{c});
const hash=(p,s)=>crypto.scryptSync(p,s,32).toString('hex');
const safeEq=(a,b)=>a.length===b.length&&crypto.timingSafeEqual(Buffer.from(a),Buffer.from(b));
const str=(x,n)=>String(x==null?'':x).trim().slice(0,n);
const vf=u=>u.role==='dev'||u.verifiedUntil>now();

let db=null,pool=null;
const EMPTY=()=>({users:{},sessions:{},posts:[],rooms:{},msgs:{},site:{text:"Selamat datang di X'Nest",banner:null,words:[]}});
let dirty=false;const touch=()=>{dirty=!pool};
function flush(){if(!dirty)return;dirty=false;fs.writeFileSync(FILE+'.tmp',JSON.stringify(db));fs.renameSync(FILE+'.tmp',FILE)}
setInterval(flush,1000).unref();
for(const s of['SIGINT','SIGTERM'])process.on(s,()=>{flush();process.exit(0)});

function mkUser(id,name,email,pw,display,role){const salt=crypto.randomBytes(8).toString('hex');return{id,name,email,salt,hash:hash(pw,salt),display,bio:'',avatar:null,banner:null,verifiedUntil:0,role:role||'user',banned:0,joined:now(),viol:0,s:{theme:'auto',size:'n',autoplay:0,dm:'all'}}}
function seedDev(){if(!Object.values(db.users).some(u=>u.role==='dev')){const pw=process.env.DEV_PASSWORD||crypto.randomBytes(5).toString('hex');db.users.dev=mkUser('dev','devweb',DEV_EMAIL,pw,"Developer X'Nest",'dev');touch();console.log(`\nAkun developer dibuat.\n  Username: devweb (atau email ${DEV_EMAIL})\n  Sandi   : ${pw}\n  Ganti sandi di Pengaturan setelah masuk.\n`)}}

const COLS={users:['id','name','email','salt','hash','display','bio','avatar','banner','verified_until','role','banned','joined','viol','s'],sessions:['id','user_id','created'],posts:['id','user_id','body','media','created','likes','comments'],rooms:['id','type','name','descr','owner','members','created'],messages:['id','room','user_id','body','created','announce'],site:['id','data']};
let last={},chain=Promise.resolve();
function rows(){const J=JSON.stringify,R={users:[],sessions:[],posts:[],rooms:[],messages:[],site:[]};
 for(const u of Object.values(db.users))R.users.push({id:u.id,name:u.name,email:u.email,salt:u.salt,hash:u.hash,display:u.display,bio:u.bio||'',avatar:u.avatar,banner:J(u.banner),verified_until:u.verifiedUntil,role:u.role,banned:u.banned,joined:u.joined,viol:u.viol||0,s:J(u.s)});
 for(const[k,v]of Object.entries(db.sessions))R.sessions.push({id:k,user_id:v.u,created:v.t});
 for(const p of db.posts)R.posts.push({id:p.id,user_id:p.u,body:p.x,media:J(p.m),created:p.t,likes:J(p.l),comments:J(p.c)});
 for(const r of Object.values(db.rooms))R.rooms.push({id:r.id,type:r.type,name:r.name,descr:r.desc||'',owner:r.owner,members:J(r.members),created:r.t});
 for(const[room,a]of Object.entries(db.msgs))for(const m of a)R.messages.push({id:m.id,room,user_id:m.u,body:m.x,created:m.t,announce:!!m.a});
 R.site.push({id:'site',data:J(db.site)});return R}
let MODE='file JSON';
const KEY=process.env.SUPABASE_SECRET_KEY||'',REST=!!(process.env.SUPABASE_URL&&KEY);
const BASE=String(process.env.SUPABASE_URL||'').replace(/\/+$/,'').replace(/\/rest\/v1$/,'')+'/rest/v1/';
const JB={users:['banner','s'],posts:['media','likes','comments'],rooms:['members'],site:['data']};
async function rest(method,p,body){const h={apikey:KEY,'Content-Type':'application/json'};if(method!=='GET')h.Prefer='resolution=merge-duplicates,return=minimal';if(KEY.startsWith('eyJ'))h.Authorization='Bearer '+KEY;
 const r=await fetch(BASE+p,{method,headers:h,body:body?JSON.stringify(body):undefined});
 if(!r.ok)throw new Error('Supabase '+r.status+': '+(await r.text()).slice(0,200));
 return method==='GET'?r.json():null}
async function dbSelect(t){if(!REST)return(await pool.query('select * from '+t)).rows;
 const a=[];for(let o=0;;o+=1000){const r=await rest('GET',`${t}?select=*&order=id&limit=1000&offset=${o}`);a.push(...r);if(r.length<1000)return a}}
async function dbApply(ch){
 if(!REST){const c=await pool.connect();
  try{await c.query('begin');
   for(const[t,,del]of ch)if(del.length)await c.query(`delete from ${t} where id=any($1)`,[del]);
   for(const[t,up]of ch){const k=COLS[t];for(const r of up)await c.query(`insert into ${t}(${k.join(',')}) values(${k.map((_,i)=>'$'+(i+1)).join(',')}) on conflict(id) do update set ${k.slice(1).map(x=>x+'=excluded.'+x).join(',')}`,k.map(x=>r[x]))}
   await c.query('commit')}
  catch(e){await c.query('rollback').catch(()=>{});throw e}finally{c.release()}return}
 for(const[t,,del]of ch)for(let i=0;i<del.length;i+=100)await rest('DELETE',`${t}?id=in.(${del.slice(i,i+100).map(x=>'"'+x+'"').join(',')})`);
 for(const[t,up]of ch){const j=JB[t]||[];for(let i=0;i<up.length;i+=200)await rest('POST',`${t}?on_conflict=id`,up.slice(i,i+200).map(r=>{const o={...r};for(const k of j)o[k]=JSON.parse(o[k]);return o}))}}
async function loadSql(){const q=dbSelect,N=Number;db=EMPTY();
 for(const r of await q('users'))db.users[r.id]={id:r.id,name:r.name,email:r.email,salt:r.salt,hash:r.hash,display:r.display,bio:r.bio||'',avatar:r.avatar,banner:r.banner,verifiedUntil:N(r.verified_until),role:r.role,banned:r.banned,joined:N(r.joined),viol:r.viol,s:r.s};
 for(const r of await q('sessions'))db.sessions[r.id]={u:r.user_id,t:N(r.created)};
 db.posts=(await q('posts')).sort((a,b)=>N(b.created)-N(a.created)).map(r=>({id:r.id,u:r.user_id,x:r.body,m:r.media,t:N(r.created),l:r.likes,c:r.comments}));
 for(const r of await q('rooms'))db.rooms[r.id]={id:r.id,type:r.type,name:r.name,desc:r.descr,owner:r.owner,members:r.members,t:N(r.created)};
 for(const r of(await q('messages')).sort((a,b)=>N(a.created)-N(b.created))){const m={id:r.id,u:r.user_id,x:r.body,t:N(r.created)};if(r.announce)m.a=1;(db.msgs[r.room]=db.msgs[r.room]||[]).push(m)}
 const s=await q('site');if(s[0])db.site=s[0].data;
 const R=rows();for(const t of Object.keys(COLS))last[t]=new Map(R[t].map(r=>[r.id,JSON.stringify(r)]))}
async function persist(){const R=rows(),cur={},ch=[];
 for(const t of Object.keys(COLS)){cur[t]=new Map(R[t].map(r=>[r.id,JSON.stringify(r)]));const old=last[t]||new Map();
  ch.push([t,R[t].filter(r=>old.get(r.id)!==cur[t].get(r.id)),[...old.keys()].filter(id=>!cur[t].has(id))])}
 if(!ch.some(c=>c[1].length||c[2].length))return;
 await dbApply(ch);last=cur}
const saveNow=()=>{if(!pool)return Promise.resolve();const p=chain.then(persist);chain=p.catch(()=>{});return p};
async function init(){
 if(REST){pool={};MODE='Supabase REST';try{await loadSql()}catch(e){throw new Error(e.message+' (jalankan schema.sql di Supabase SQL Editor dulu)')}}
 else if(process.env.DATABASE_URL){const{Pool}=require('pg'),u=new URL(process.env.DATABASE_URL);u.searchParams.delete('sslmode');
  pool=new Pool({connectionString:u.toString(),ssl:/^(localhost|127\.0\.0\.1)$/.test(u.hostname)?false:{rejectUnauthorized:false}});pool.on('error',e=>console.error(e.message));MODE='PostgreSQL';
  await pool.query(fs.readFileSync(path.join(__dirname,'schema.sql'),'utf8'));await loadSql()}
 else{try{db=JSON.parse(fs.readFileSync(FILE,'utf8'))}catch(e){}if(!db||!db.users)db=EMPTY()}
 seedDev();await saveNow()}
function cen(t){const w=[...WORDS,...(db.site.words||[])].map(x=>x.replace(/[.*+?^${}()|[\]\\]/g,'\\$&'));return String(t).replace(new RegExp('\\b('+w.join('|')+')\\b','gi'),'****')}
const clean=(t,u)=>{const c=cen(t);if(c!==t)u.viol=(u.viol||0)+1;return c};
const media=m=>{if(!m)return null;if(!['image','video'].includes(m.type)||!/^\/uploads\/[a-f0-9]{16}\.[a-z0-9]{2,4}$/.test(String(m.src)))throw err(400,'Media tidak valid.');return{type:m.type,src:m.src}};
const dev=u=>{if(u.role!=='dev')throw err(403,'Khusus developer.')};
const tries={};
function throttle(req){const k=String(req.headers['x-forwarded-for']||req.socket.remoteAddress||'').split(',')[0].trim(),a=(tries[k]=(tries[k]||[]).filter(t=>now()-t<3e5));if(a.length>=20)throw err(429,'Terlalu banyak percobaan. Coba lagi beberapa menit lagi.');a.push(now())}
const tokenOf=(req,url)=>String(req.headers.authorization||'').slice(7)||url.searchParams.get('t')||'';
function auth(req,url){const s=db.sessions[tokenOf(req,url)],u=s&&db.users[s.u];if(!u)throw err(401,'Sesi berakhir. Masuk lagi.');if(u.banned)throw err(403,'Akun ini diblokir oleh developer.');return u}
function sess(u){const token=crypto.randomBytes(24).toString('hex');db.sessions[token]={u:u.id,t:now()};return{token,id:u.id}}
function rmUser(id){delete db.users[id];db.posts=db.posts.filter(p=>p.u!==id);
 for(const t of Object.keys(db.sessions))if(db.sessions[t].u===id)delete db.sessions[t];
 for(const r of Object.values(db.rooms)){if(r.owner===id){delete db.rooms[r.id];delete db.msgs[r.id]}else r.members=r.members.filter(x=>x!==id)}
 for(const k of Object.keys(db.msgs))if(k.startsWith('dm:')&&k.slice(3).split('~').includes(id))delete db.msgs[k]}
const pub=(u,full)=>({id:u.id,name:u.name,display:u.display,bio:u.bio,avatar:u.avatar,banner:u.banner,verifiedUntil:u.verifiedUntil,role:u.role,banned:u.banned,joined:u.joined,s:{dm:u.s.dm},...(full?{email:u.email,viol:u.viol||0}:{})});
function snapshot(u){const users={},msgs={};for(const x of Object.values(db.users))users[x.id]=pub(x,u.role==='dev');users[u.id]={...pub(u,true),s:u.s};
 for(const[k,a]of Object.entries(db.msgs)){if(k.startsWith('dm:')&&!k.slice(3).split('~').includes(u.id))continue;msgs[k]=a.slice(-150)}
 return{me:u.id,users,posts:db.posts.slice(0,200),rooms:db.rooms,msgs,site:db.site}}

const H={
 reg(_,b,req){throttle(req);const n=str(b.u,20).toLowerCase(),e=str(b.e,80).toLowerCase(),p=String(b.p||'');
  if(!/^[a-z0-9_.]{3,20}$/.test(n))throw err(400,'Username 3-20 karakter: huruf kecil, angka, titik, atau garis bawah.');
  if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e))throw err(400,'Email tidak valid.');
  if(p.length<6||p.length>100)throw err(400,'Kata sandi minimal 6 karakter.');
  const all=Object.values(db.users);
  if(all.some(x=>x.name===n))throw err(409,'Username sudah dipakai.');
  if(all.some(x=>x.email===e))throw err(409,'Email sudah terdaftar.');
  const u=mkUser(uid(),n,e,p,n);db.users[u.id]=u;return sess(u)},
 login(_,b,req){throttle(req);const q=str(b.u,80).toLowerCase(),u=Object.values(db.users).find(x=>x.name===q||x.email===q);
  if(!u||!safeEq(hash(String(b.p||''),u.salt),u.hash))throw err(401,'Username/email atau kata sandi salah.');
  if(u.banned)throw err(403,'Akun ini diblokir oleh developer.');return sess(u)},
 logout(u,b,req,url){delete db.sessions[tokenOf(req,url)]},
 pw(u,b){if(!safeEq(hash(String(b.o||''),u.salt),u.hash))throw err(400,'Sandi lama salah.');const n=String(b.n||'');if(n.length<6||n.length>100)throw err(400,'Sandi baru minimal 6 karakter.');if(n!==b.n2)throw err(400,'Sandi baru tidak sama.');u.salt=crypto.randomBytes(8).toString('hex');u.hash=hash(n,u.salt)},
 prof(u,b){u.display=clean(str(b.d,30),u)||u.name;u.bio=clean(str(b.b,200),u)},
 av(u,b){u.avatar=media({type:'image',src:b.url}).src},
 bn(u,b){u.banner=media(b.m)},
 set(u,b){const ok={theme:['auto','light','dark'],size:['s','n','l'],dm:['all','verified']},o=ok[b.k];if(b.k==='autoplay')u.s.autoplay=b.v?1:0;else if(Array.isArray(o)&&o.includes(b.v)&&!(b.k==='dm'&&u.role==='dev'))u.s[b.k]=b.v},
 post(u,b){const x=clean(str(b.x,1000),u),m=media(b.m);if(!x&&!m)throw err(400,'Tulis sesuatu atau lampirkan media.');db.posts.unshift({id:uid(),u:u.id,x,m,t:now(),l:[],c:[]});if(db.posts.length>500)db.posts.length=500},
 like(u,b){const p=db.posts.find(q=>q.id===b.id);if(!p)throw err(404,'Kiriman tidak ditemukan.');const i=p.l.indexOf(u.id);if(i<0)p.l.push(u.id);else p.l.splice(i,1)},
 cmt(u,b){const p=db.posts.find(q=>q.id===b.id),x=clean(str(b.x,300),u);if(!p||!x)throw err(400,'Komentar tidak valid.');p.c.push({u:u.id,x,t:now()});if(p.c.length>200)p.c.shift()},
 delpost(u,b){const p=db.posts.find(q=>q.id===b.id);if(!p)return;if(p.u!==u.id&&u.role!=='dev')throw err(403,'Tidak diizinkan.');db.posts=db.posts.filter(q=>q!==p)},
 send(u,b){const id=String(b.room||''),x=clean(str(b.x,500),u);if(!x)throw err(400,'Pesan kosong.');
  if(id.startsWith('dm:')){const ids=id.slice(3).split('~'),o=ids.find(i=>i!==u.id),t=db.users[o];
   if(ids.length!==2||!ids.includes(u.id)||!t)throw err(403,'Percakapan tidak valid.');
   if(t.banned)throw err(403,'Akun tujuan tidak tersedia.');
   if(t.role!=='dev'&&t.s.dm==='verified'&&!vf(u))throw err(403,'Akun ini hanya menerima pesan dari akun bercentang biru.')}
  else if(id!=='global'){const r=db.rooms[id];if(!r)throw err(404,'Ruang tidak ditemukan.');
   if(r.type==='ch'?(r.owner!==u.id&&u.role!=='dev'):!r.members.includes(u.id))throw err(403,r.type==='ch'?'Hanya pemilik saluran yang bisa mengirim pesan.':'Gabung dulu untuk ikut mengobrol.')}
  const a=db.msgs[id]=db.msgs[id]||[];a.push({id:uid(),u:u.id,x,t:now()});if(a.length>300)a.shift()},
 mk(u,b){const n=clean(str(b.n,40),u);if(!n)throw err(400,'Nama wajib diisi.');const id=uid();db.rooms[id]={id,type:b.t==='ch'?'ch':'com',name:n,desc:clean(str(b.d,120),u),owner:u.id,members:[u.id],t:now()};return{id}},
 join(u,b){const r=db.rooms[b.id];if(!r)throw err(404,'Tidak ditemukan.');const i=r.members.indexOf(u.id);if(i<0)r.members.push(u.id);else if(r.owner===u.id)throw err(400,'Pemilik tidak bisa keluar. Hapus saja jika tidak dipakai.');else r.members.splice(i,1)},
 rdel(u,b){const r=db.rooms[b.id];if(!r)return;if(r.owner!==u.id&&u.role!=='dev')throw err(403,'Tidak diizinkan.');delete db.rooms[b.id];delete db.msgs[b.id]},
 dmsg(u,b){dev(u);const r=String(b.r||'');if(r.startsWith('dm:')&&!r.slice(3).split('~').includes(u.id))throw err(403,'Tidak diizinkan.');db.msgs[r]=(db.msgs[r]||[]).filter(x=>x.id!==b.id)},
 delacc(u){if(u.role==='dev')throw err(403,'Akun developer tidak bisa dihapus.');rmUser(u.id)},
 rm(u,b){dev(u);const t=db.users[b.id];if(!t||t.role==='dev')throw err(400,'Akun ini tidak bisa dihapus.');rmUser(t.id)},
 ban(u,b){dev(u);const t=db.users[b.id];if(!t||t.role==='dev')throw err(400,'Akun ini tidak bisa diblokir.');t.banned=t.banned?0:1;if(t.banned)for(const k of Object.keys(db.sessions))if(db.sessions[k].u===t.id)delete db.sessions[k]},
 vfy(u,b){dev(u);const t=db.users[b.id],n=+b.n;if(!t||!n)throw err(400,'Data tidak valid.');t.verifiedUntil=n<0?0:(t.verifiedUntil>now()?t.verifiedUntil:now())+Math.min(n,120)*30*864e5},
 site(u,b){dev(u);db.site.text=str(b.t,80);db.site.words=String(b.w||'').split(',').map(x=>x.trim().toLowerCase().slice(0,30)).filter(Boolean).slice(0,200)},
 sbn(u,b){dev(u);db.site.banner=media(b.m)},
 wd(u,b){dev(u);const w=str(b.w,30).toLowerCase();db.site.words=db.site.words||[];if(w&&!db.site.words.includes(w)&&!WORDS.includes(w))db.site.words.push(w)},
 wr(u,b){dev(u);db.site.words=(db.site.words||[]).filter(x=>x!==b.w)},
 an(u,b){dev(u);const x=clean(str(b.x,500),u);if(!x)throw err(400,'Pengumuman kosong.');(db.msgs.global=db.msgs.global||[]).push({id:uid(),u:u.id,x,t:now(),a:1})}
};

const clients=new Set();
const bcast=()=>{for(const c of clients)c.write('data: 1\n\n')};
setInterval(()=>{for(const c of clients)c.write(':\n\n')},25000).unref();
const TYPES={'image/jpeg':'jpg','image/png':'png','image/webp':'webp','image/gif':'gif','video/mp4':'mp4','video/webm':'webm','video/quicktime':'mov'};
const MIME={'.html':'text/html; charset=utf-8','.jpg':'image/jpeg','.png':'image/png','.webp':'image/webp','.gif':'image/gif','.mp4':'video/mp4','.webm':'video/webm','.mov':'video/quicktime'};
const QUIET=new Set(['set','logout','login','pw']);
const json=(res,c,o)=>{res.writeHead(c,{'Content-Type':'application/json'});res.end(JSON.stringify(o))};
function body(req,max){return new Promise((ok,no)=>{const a=[];let n=0,big=false;req.on('data',c=>{n+=c.length;if(n>max)big=true;else a.push(c)});req.on('end',()=>big?no(err(413,'File terlalu besar.')):ok(Buffer.concat(a)));req.on('error',no)})}
function sendFile(req,res,fp){fs.stat(fp,(e,st)=>{if(e||!st.isFile()){res.writeHead(404);return res.end('Not found')}
 const ext=path.extname(fp),h={'Content-Type':MIME[ext]||'application/octet-stream','Accept-Ranges':'bytes','X-Content-Type-Options':'nosniff','Cache-Control':ext==='.html'?'no-cache':'public, max-age=31536000, immutable'};
 const m=/bytes=(\d*)-(\d*)/.exec(req.headers.range||'');
 if(m&&(m[1]||m[2])){const s=m[1]?+m[1]:st.size-+m[2];let t=m[1]&&m[2]?+m[2]:st.size-1;t=Math.min(t,st.size-1);
  if(s<0||s>t){res.writeHead(416,{'Content-Range':'bytes */'+st.size});return res.end()}
  res.writeHead(206,{...h,'Content-Range':`bytes ${s}-${t}/${st.size}`,'Content-Length':t-s+1});return fs.createReadStream(fp,{start:s,end:t}).pipe(res)}
 res.writeHead(200,{...h,'Content-Length':st.size});fs.createReadStream(fp).pipe(res)})}

const srv=http.createServer(async(req,res)=>{try{
 const url=new URL(req.url,'http://x'),p=url.pathname;
 if(req.method==='GET'){
  if(p==='/'||p==='/index.html')return sendFile(req,res,path.join(__dirname,'public','index.html'));
  if(p.startsWith('/uploads/')){const n=p.slice(9);if(!/^[a-f0-9]{16}\.[a-z0-9]{2,4}$/.test(n)){res.writeHead(404);return res.end()}return sendFile(req,res,path.join(UP,n))}
  if(p==='/api/ping')return json(res,200,{ok:1});
  if(p==='/api/sync')return json(res,200,snapshot(auth(req,url)));
  if(p==='/api/stream'){auth(req,url);res.writeHead(200,{'Content-Type':'text/event-stream','Cache-Control':'no-cache','Connection':'keep-alive','X-Accel-Buffering':'no'});res.write('retry: 3000\n\n');clients.add(res);req.on('close',()=>clients.delete(res));return}
 }
 if(req.method==='POST'&&p.startsWith('/api/')){const a=p.slice(5);
  if(a==='upload'){auth(req,url);const ext=TYPES[String(req.headers['content-type']||'').split(';')[0].trim()];if(!ext)throw err(415,'Format file tidak didukung.');
   const n=crypto.randomBytes(8).toString('hex')+'.'+ext,fp=path.join(UP,n);try{await pipeline(req,fs.createWriteStream(fp))}catch(e){fs.unlink(fp,()=>{});throw err(400,'Upload gagal atau dibatalkan.')}
   if(!fs.statSync(fp).size){fs.unlinkSync(fp);throw err(400,'File kosong.')}return json(res,200,{url:'/uploads/'+n})}
  if(!Object.prototype.hasOwnProperty.call(H,a))throw err(404,'Tidak ditemukan.');
  const u=a==='reg'||a==='login'?null:auth(req,url);
  let b;try{b=JSON.parse((await body(req,1<<20)).toString()||'{}')}catch(e){throw err(400,'Data tidak valid.')}
  if(!b||typeof b!=='object')b={};
  const out=H[a](u,b,req,url)||{};touch();await saveNow();if(!QUIET.has(a))bcast();return json(res,200,out)}
 res.writeHead(404);res.end('Not found');
}catch(e){if(!res.headersSent)json(res,e.c||500,{e:e.c?e.message:'Server error'});if(!e.c)console.error(e)}});
srv.requestTimeout=0;
init().then(()=>srv.listen(PORT,()=>console.log(`X'Nest jalan di http://localhost:${PORT}`+' ('+MODE+')'))).catch(e=>{console.error('Gagal start:',e.message);process.exit(1)});
