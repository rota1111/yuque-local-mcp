// Cookie web writes; source contracts are documented in REFERENCES.md.
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const {safeUrl,loadCredentials}=require('./web-client.cjs');
const hash=value=>crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
const text=value=>typeof value==='string'&&value.trim().length>0&&value.length<=500000;
function createWriter(root,client){
  const directory=path.join(root,'writes');
  function store(file,value){fs.mkdirSync(directory,{recursive:true,mode:0o700});fs.writeFileSync(file,JSON.stringify(value),{mode:0o600});}
  function binding(){const c=loadCredentials(root);return hash([c.origin,c.cookie]);}
  async function snapshot(address){
    const u=safeUrl(address), page=await client.page(u.href),meta=page.doc;
    if(!meta?.id||!meta.book_id)throw new Error('地址不是可编辑文档');
    const target=new URL('/api/docs/'+meta.id,u.origin);target.searchParams.set('book_id',meta.book_id);target.searchParams.set('mode','edit');
    const d=(await client.request(target.href,true)).data;
    if(!d||d.id!==meta.id||d.book_id!==meta.book_id||d.type!=='Doc'||d.format!=='lake'||typeof d.body_asl!=='string'||!Number.isInteger(d.draft_version))throw new Error('仅支持具有完整编辑版本信息的 Lake 普通文档');
    if(d.body_draft_asl && d.body_asl!==d.body_draft_asl)throw new Error('文档有未发布草稿；请先在语雀处理，避免覆盖');
    return {url:u.href,id:d.id,book_id:d.book_id,title:d.title,slug:d.slug,lake:d.body_asl,draft_version:d.draft_version,updated_at:d.updated_at,raw:d};
  }
  const fingerprint=s=>hash([s.id,s.title,s.lake,s.draft_version,s.updated_at]);
  async function prepare(a){
    if(!['create','append','replace','replace_text'].includes(a.operation)||!text(a.markdown))throw new Error('需要 create/append/replace/replace_text 和非空 Markdown（最多50万字符）');
    const u=safeUrl(a.url);const parts=u.pathname.split('/').filter(Boolean);
    if(parts.length!==(a.operation==='create'?2:3))throw new Error('创建需要知识库URL；追加/替换需要文档URL');
    let before,book;
    if(a.operation==='create'){
      if(!text(a.title)||a.title.length>200)throw new Error('创建需要1至200字符标题');
      const page=await client.page(u.href);book=page.book;
      if(!book?.id)throw new Error('未找到目标知识库');
      const list=await client.listDocs(u.href);if(list.documents.some(d=>d.title===a.title))throw new Error('已有同名文档，请先定位它');
    }else before=await snapshot(u.href);
    let next;
    if(a.operation==='replace_text'){
      if(!text(a.old_text))throw new Error('局部替换需要非空 old_text');
      const escape=value=>value.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
      const needle=escape(a.old_text),replacement=escape(a.markdown);
      // Only text nodes may change; never replace attributes or Lake markup.
      let matches=0;
      const chunks=before.lake.split(/(<[^>]*>)/g);
      for(let i=0;i<chunks.length;i+=2){
        let at=chunks[i].indexOf(needle);
        while(at!==-1){matches++;at=chunks[i].indexOf(needle,at+1);}
      }
      if(matches!==1)throw new Error('原文必须在单个文本节点中唯一匹配；当前匹配数：'+matches+'。跨段落或格式节点的文字请缩小范围');
      next=chunks.map((chunk,i)=>i%2?chunk:chunk.replace(needle,()=>replacement)).join('');
    }else{
      const payload=await client.request(u.origin+'/api/docs/convert',true,{method:'POST',body:{content:a.markdown,from:'markdown',to:'lake'}});
      const converted=payload.data?.content;if(typeof converted!=='string'||!/^<!doctype lake>/i.test(converted))throw new Error('Markdown 转换未返回有效Lake');
      next=a.operation==='append'?before.lake+converted.replace(/^<!doctype lake>/i,'').replace(/<meta\b[^>]*\/>/gi,''):converted;
    }
    const id=crypto.randomUUID(),slug='mcp-'+crypto.randomBytes(10).toString('hex');
    const plan={id,status:'prepared',created_at:Date.now(),binding:binding(),operation:a.operation,url:u.href,title:a.operation==='create'?a.title:before.title,markdown:a.markdown,lake:next,before,book_id:book?.id||before.book_id,slug};
    store(path.join(directory,id+'.json'),plan);
    return {plan_id:id,operation:plan.operation,url:plan.url,title:plan.title,expires_in_seconds:900,before_fingerprint:before?fingerprint(before):null,old_text_preview:a.operation==='replace_text'?a.old_text.slice(0,4000):undefined,markdown_preview:a.markdown.slice(0,4000),characters:a.markdown.length,note:'尚未修改语雀文档。apply_write将保存本地备份并发布内容到原知识库；不改变分享权限。'};
  }
  async function apply(id){
    if(!/^[0-9a-f-]{36}$/.test(id))throw new Error('无效plan_id');
    const file=path.join(directory,id+'.json');if(!fs.existsSync(file))throw new Error('找不到变更计划');
    const lock=file+'.lock';let fd,targetFd,targetLock;try{fd=fs.openSync(lock,'wx',0o600);}catch{throw new Error('该计划正在执行；不要重复调用');}
    try{
      const plan=JSON.parse(fs.readFileSync(file));
      targetLock=path.join(directory,hash(plan.url)+'.target.lock');
      try{targetFd=fs.openSync(targetLock,'wx',0o600);}catch{throw new Error('目标正在进行另一项写入；稍后重新读取再预览');}
      if(plan.status!=='prepared')throw new Error('计划已执行或结果未知，禁止重复提交；先检查计划中的目标URL');
      if(Date.now()-plan.created_at>900000)throw new Error('计划已过期，请重新预览');
      if(plan.binding!==binding())throw new Error('登录凭证已变化，请重新预览');
      let current;if(plan.before){current=await snapshot(plan.url);if(fingerprint(current)!==fingerprint(plan.before))throw new Error('文档版本已变化，请重新读取和预览');}
      else{const list=await client.listDocs(plan.url);if(list.documents.some(x=>x.title===plan.title))throw new Error('已有同名文档，停止创建');}
      const origin=safeUrl(plan.url).origin;
      if(current){plan.backup=path.join(directory,id+'.backup.json');store(plan.backup,current);}
      plan.target_url=plan.operation==='create'?plan.url+'/'+plan.slug:plan.url;
      plan.status='executing';store(file,plan);
      try{
        if(plan.operation==='create'){
          const result=(await client.request(origin+'/api/docs',true,{method:'POST',body:{action:'prependChild',body_asl:plan.lake,body_draft_asl:plan.lake,book_id:plan.book_id,format:'lake',insert_to_catalog:true,slug:plan.slug,status:1,title:plan.title,type:'Doc',target_uuid:''}})).data;
          if(!result?.id||result.slug!==plan.slug||result.book_id!==plan.book_id)throw new Error('创建响应与目标不一致');
          plan.doc_id=result.id;store(file,plan);
        }else{
          await client.request(origin+'/api/docs/'+current.id+'/content',true,{method:'PUT',body:{id:current.id,body_asl:plan.lake,body_draft_asl:plan.lake,format:'lake',save_type:'user',draft_version:current.draft_version}});
          plan.doc_id=current.id;plan.status='draft_saved';store(file,plan);
        }
        await client.request(origin+'/api/docs/'+plan.doc_id+'/publish',true,{method:'PUT',body:{id:plan.doc_id,cover:null,force:false,notify:false,ignoreGlobalMessage:true}});
        const after=await snapshot(plan.target_url);
        if(after.id!==plan.doc_id||after.title!==plan.title||after.lake!==plan.lake)throw new Error('写后回读未匹配预期内容');
        if(plan.operation==='create'){const list=await client.listDocs(plan.url);if(!list.documents.some(d=>d.url===plan.target_url))throw new Error('创建后目录尚未找到新文档');}
        plan.status='verified';plan.finished_at=Date.now();store(file,plan);
        return {status:'verified',operation:plan.operation,url:plan.target_url,title:after.title,fingerprint:fingerprint(after),backup:plan.backup||null};
      }catch(e){plan.status='unknown_or_partial';plan.error=e.message;store(file,plan);return {status:plan.status,url:plan.target_url,backup:plan.backup||null,error:e.message,note:'可能已创建文档或保存草稿；不要自动重试，先读取目标核对。'};}
    }finally{if(targetFd!==undefined){fs.closeSync(targetFd);fs.unlinkSync(targetLock);}if(fd!==undefined)fs.closeSync(fd);fs.unlinkSync(lock);}
  }
  return {prepare,apply,snapshot};
}
module.exports={createWriter};
