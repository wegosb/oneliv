#!/usr/bin/env node
/* =====================================================================
   AURA STUDIO — servidor de geração
   Sem dependências: apenas os módulos nativos do Node (>= 18).
   A chave do fornecedor fica SEMPRE aqui, nunca no browser.
   ===================================================================== */
const http=require('http'), https=require('https'), fs=require('fs'), path=require('path'), crypto=require('crypto');

const PORT=process.env.PORT||8787;
const PROVIDER=(process.env.PROVIDER||'mock').toLowerCase();
const API_KEY=process.env.API_KEY||'';
const ORIGINS=(process.env.ALLOWED_ORIGINS||'*').split(',').map(s=>s.trim());
const STATIC=path.resolve(__dirname,'..');
const MAX_PROMPT=2500;
const RATE={janela:60000,max:30}; const hits=new Map();

/* ---------------- preços em créditos ---------------- */
function custo({mode,duration,quality,model}){
  let c = mode==='text-to-image' ? 8 : (Number(duration)>=10?70:35);
  if(quality==='pro') c=Math.round(c*2.2);
  if(String(model).startsWith('2.5')) c=Math.round(c*0.6);
  if(String(model).startsWith('3.0-omni')) c=Math.round(c*1.25);
  return c;
}

/* ---------------- estado dos trabalhos ---------------- */
const jobs=new Map();
const novoJob=p=>{
  const id='job_'+crypto.randomBytes(8).toString('hex');
  jobs.set(id,{id,status:'queued',progress:0,params:p,cost:custo(p),
    created:Date.now(),output:null,error:null});
  return jobs.get(id);
};
setInterval(()=>{ const lim=Date.now()-6*3600e3;
  for(const [id,j] of jobs) if(j.created<lim) jobs.delete(id); },10*60e3).unref();

/* ---------------- adaptadores de fornecedor ---------------- */
const pedido=(url,opts,body)=>new Promise((res,rej)=>{
  const u=new URL(url);
  const r=https.request({hostname:u.hostname,path:u.pathname+u.search,method:opts.method||'GET',
    headers:opts.headers||{}},resp=>{
      let d=''; resp.on('data',c=>d+=c);
      resp.on('end',()=>{ try{res({status:resp.statusCode,body:JSON.parse(d||'{}')});}
        catch(e){res({status:resp.statusCode,body:{raw:d}});} });
    });
  r.on('error',rej); r.setTimeout(120000,()=>{r.destroy(new Error('timeout do fornecedor'));});
  if(body)r.write(JSON.stringify(body)); r.end();
});

const ADAPTADORES={
  /* --- desenvolvimento: simula sem gastar nada --- */
  async mock(job){
    const total=Number(job.params.duration||5)>=10?9000:5000;
    const t0=Date.now();
    const iv=setInterval(()=>{
      job.progress=Math.min(99,Math.round((Date.now()-t0)/total*100));
      if(job.progress>=99){clearInterval(iv);
        job.status='succeeded'; job.progress=100;
        job.output={kind:'procedural',seed:job.params.prompt};}
    },300);
  },

  /* --- fal.ai --- */
  async fal(job){
    if(!API_KEY) throw new Error('API_KEY em falta');
    const modelo=job.params.mode==='text-to-image'
      ? 'fal-ai/flux/dev' : 'fal-ai/kling-video/v1/standard/text-to-video';
    job.status='running'; job.progress=8;
    const r=await pedido(`https://fal.run/${modelo}`,{method:'POST',
      headers:{'Authorization':`Key ${API_KEY}`,'Content-Type':'application/json'}},
      {prompt:job.params.prompt, negative_prompt:job.params.negative||undefined,
       aspect_ratio:job.params.aspect_ratio, duration:String(job.params.duration||5)});
    if(r.status>=400) throw new Error(r.body?.detail||r.body?.error||('fal '+r.status));
    const url=r.body?.video?.url||r.body?.images?.[0]?.url||r.body?.image?.url;
    if(!url) throw new Error('fornecedor não devolveu ficheiro');
    job.status='succeeded'; job.progress=100; job.output={kind:'url',url};
  },

  /* --- replicate --- */
  async replicate(job){
    if(!API_KEY) throw new Error('API_KEY em falta');
    const version=process.env.REPLICATE_VERSION;
    if(!version) throw new Error('defina REPLICATE_VERSION');
    job.status='running'; job.progress=6;
    const cr=await pedido('https://api.replicate.com/v1/predictions',{method:'POST',
      headers:{'Authorization':`Bearer ${API_KEY}`,'Content-Type':'application/json'}},
      {version,input:{prompt:job.params.prompt,negative_prompt:job.params.negative||''}});
    if(cr.status>=400) throw new Error(cr.body?.detail||('replicate '+cr.status));
    let pred=cr.body;
    while(['starting','processing'].includes(pred.status)){
      await new Promise(r=>setTimeout(r,2500));
      job.progress=Math.min(95,job.progress+6);
      const p=await pedido(pred.urls.get,{headers:{'Authorization':`Bearer ${API_KEY}`}});
      pred=p.body;
    }
    if(pred.status!=='succeeded') throw new Error(pred.error||'falhou no fornecedor');
    const out=Array.isArray(pred.output)?pred.output[pred.output.length-1]:pred.output;
    job.status='succeeded'; job.progress=100; job.output={kind:'url',url:out};
  },

  /* --- Kling oficial (chave + segredo, JWT HS256) --- */
  async kling(job){
    const ak=process.env.KLING_ACCESS_KEY, sk=process.env.KLING_SECRET_KEY;
    if(!ak||!sk) throw new Error('defina KLING_ACCESS_KEY e KLING_SECRET_KEY');
    const b64=o=>Buffer.from(JSON.stringify(o)).toString('base64url');
    const agora=Math.floor(Date.now()/1000);
    const cab=b64({alg:'HS256',typ:'JWT'});
    const pay=b64({iss:ak,exp:agora+1800,nbf:agora-5});
    const sig=crypto.createHmac('sha256',sk).update(`${cab}.${pay}`).digest('base64url');
    const jwt=`${cab}.${pay}.${sig}`;
    const base='https://api-singapore.klingai.com/v1/videos/text2video';
    job.status='running'; job.progress=8;
    const r=await pedido(base,{method:'POST',
      headers:{'Authorization':`Bearer ${jwt}`,'Content-Type':'application/json'}},
      {model_name:'kling-v1',prompt:job.params.prompt,negative_prompt:job.params.negative||'',
       aspect_ratio:job.params.aspect_ratio,duration:String(job.params.duration||5),
       mode:job.params.quality==='pro'?'pro':'std'});
    if(r.status>=400) throw new Error(r.body?.message||('kling '+r.status));
    const tid=r.body?.data?.task_id; if(!tid) throw new Error('sem task_id');
    let est='submitted';
    while(['submitted','processing'].includes(est)){
      await new Promise(x=>setTimeout(x,4000));
      job.progress=Math.min(95,job.progress+5);
      const q=await pedido(`${base}/${tid}`,{headers:{'Authorization':`Bearer ${jwt}`}});
      est=q.body?.data?.task_status||'failed';
      if(est==='succeed'){
        const url=q.body?.data?.task_result?.videos?.[0]?.url;
        job.status='succeeded'; job.progress=100; job.output={kind:'url',url}; return;
      }
      if(est==='failed') throw new Error(q.body?.data?.task_status_msg||'falhou no fornecedor');
    }
  },
};

/* ---------------- utilitários HTTP ---------------- */
const cors=(req,res)=>{
  const o=req.headers.origin||'';
  const ok=ORIGINS.includes('*')?'*':(ORIGINS.includes(o)?o:'');
  if(ok)res.setHeader('Access-Control-Allow-Origin',ok);
  res.setHeader('Access-Control-Allow-Methods','GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers','Content-Type');
  res.setHeader('Vary','Origin');
};
const json=(res,code,obj)=>{res.writeHead(code,{'Content-Type':'application/json; charset=utf-8'});
  res.end(JSON.stringify(obj));};
const corpo=req=>new Promise((res,rej)=>{let d='';let n=0;
  req.on('data',c=>{n+=c.length;if(n>1e6){rej(new Error('corpo demasiado grande'));req.destroy();}d+=c;});
  req.on('end',()=>{try{res(JSON.parse(d||'{}'));}catch(e){rej(new Error('JSON inválido'));}});});
function limite(ip){
  const agora=Date.now(); const l=(hits.get(ip)||[]).filter(t=>agora-t<RATE.janela);
  l.push(agora); hits.set(ip,l); return l.length<=RATE.max;
}
const MIME={'.html':'text/html; charset=utf-8','.js':'text/javascript','.css':'text/css',
  '.svg':'image/svg+xml','.png':'image/png','.json':'application/json','.ico':'image/x-icon'};

/* ---------------- servidor ---------------- */
const srv=http.createServer(async(req,res)=>{
  cors(req,res);
  if(req.method==='OPTIONS'){res.writeHead(204);return res.end();}
  const u=new URL(req.url,'http://x'); const p=u.pathname;
  const ip=req.headers['x-forwarded-for']?.split(',')[0]?.trim()||req.socket.remoteAddress||'?';

  try{
    if(p==='/health'||p==='/v1/health')
      return json(res,200,{ok:true,provider:PROVIDER,chave:!!API_KEY||PROVIDER==='mock',
        versao:'1.0.0',trabalhos:jobs.size,hora:new Date().toISOString()});

    if(p==='/v1/generate'&&req.method==='POST'){
      if(!limite(ip)) return json(res,429,{error:'demasiados pedidos, tente daqui a pouco'});
      const b=await corpo(req);
      const prompt=String(b.prompt||'').trim();
      if(!prompt) return json(res,400,{error:'prompt em falta'});
      if(prompt.length>MAX_PROMPT) return json(res,400,{error:`prompt acima de ${MAX_PROMPT} caracteres`});
      const par={prompt,negative:String(b.negative||'').slice(0,1000),
        model:b.model||'3.0-omni',mode:b.mode||'text-to-video',
        aspect_ratio:b.aspect_ratio||'16:9',duration:Number(b.duration)||5,
        quality:b.quality==='pro'?'pro':'std'};
      const job=novoJob(par);
      const fn=ADAPTADORES[PROVIDER]||ADAPTADORES.mock;
      fn(job).catch(e=>{job.status='failed';job.error=String(e.message||e);
        console.error('['+job.id+']',e.message);});
      return json(res,202,{id:job.id,status:job.status,cost:job.cost,provider:PROVIDER});
    }

    if(p.startsWith('/v1/jobs/')){
      const j=jobs.get(p.split('/')[3]);
      if(!j) return json(res,404,{error:'trabalho não encontrado'});
      return json(res,200,{id:j.id,status:j.status,progress:j.progress,
        output:j.output,error:j.error,cost:j.cost,params:j.params});
    }
    if(p==='/v1/jobs')
      return json(res,200,{jobs:[...jobs.values()].slice(-50).map(j=>
        ({id:j.id,status:j.status,progress:j.progress,created:j.created}))});

    /* ficheiros estáticos: serve a própria aplicação */
    let f=path.join(STATIC,p==='/'?'index.html':decodeURIComponent(p));
    if(!f.startsWith(STATIC)) {res.writeHead(403);return res.end('proibido');}
    if(!fs.existsSync(f)||fs.statSync(f).isDirectory()) f=path.join(STATIC,'index.html');
    res.writeHead(200,{'Content-Type':MIME[path.extname(f)]||'application/octet-stream'});
    return fs.createReadStream(f).pipe(res);
  }catch(e){ return json(res,500,{error:String(e.message||e)}); }
});
srv.listen(PORT,()=>{
  console.log(`AURA Studio · servidor em http://localhost:${PORT}`);
  console.log(`  fornecedor: ${PROVIDER}${PROVIDER!=='mock'?(API_KEY?' (chave definida)':'  ⚠ SEM CHAVE'):''}`);
  console.log(`  origens permitidas: ${ORIGINS.join(', ')}`);
});
