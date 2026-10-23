const assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {createWriter}=require('./writes.cjs');
const root=fs.mkdtempSync(path.join(os.tmpdir(),'yuque-write-test-'));
fs.writeFileSync(path.join(root,'credentials.json'),JSON.stringify({origin:'https://www.yuque.com',cookie:'_yuque_session=fake'}),{mode:0o600});
const bookUrl='https://www.yuque.com/u/book',docUrl=bookUrl+'/doc';
const original='<!doctype lake><p>Original card and table</p>';
let doc={id:1,book_id:9,title:'Existing',slug:'doc',type:'Doc',format:'lake',body_asl:original,body_draft_asl:original,draft_version:1,updated_at:'initial'},created,messages=[];
const client={
 async page(url){return url===bookUrl?{book:{id:9}}:{doc:{id:doc.id,book_id:9}};},
 async listDocs(){return {documents:created?[{title:doc.title,url:bookUrl+'/'+doc.slug}]:[{title:'Existing',url:docUrl}]};},
 async request(address,json,options={}){
  const u=new URL(address);messages.push({method:options.method||'GET',url:u.pathname,body:options.body});
  if(!options.method)return {data:{...doc}};
  if(u.pathname==='/api/docs/convert')return {data:{content:'<!doctype lake><meta name="doc-version" content="1" /><p>'+options.body.content+'</p>'}};
  if(u.pathname==='/api/docs'){
   const b=options.body;doc={...doc,id:2,title:b.title,slug:b.slug,body_asl:b.body_asl,body_draft_asl:b.body_asl};created=true;return {data:{id:doc.id,book_id:9,slug:b.slug}};
  }
  if(u.pathname.endsWith('/content')){assert.equal(options.body.draft_version,doc.draft_version);doc.body_draft_asl=options.body.body_asl;doc.draft_version++;return {data:{id:doc.id,draft_version:doc.draft_version}};}
  if(u.pathname.endsWith('/publish')){doc.body_asl=doc.body_draft_asl;return {data:{id:doc.id}};}
  throw new Error('Unexpected endpoint');
 }
};
(async()=>{try{
 const w=createWriter(root,client);
 const sectionPrefix='<!doctype lake><meta name="doc-version" content="1" /><p>Intro</p><h2 id="keep">背景</h2>';
 const sectionOld='<p>Old body</p><h3>Old subsection</h3><p>More</p>';
 const sectionSuffix='<h2>Next</h2><card name="keep" /><table><tr><td>Keep</td></tr></table>';
 doc.body_asl=sectionPrefix+sectionOld+sectionSuffix;doc.body_draft_asl=doc.body_asl;
 const sectionBefore=doc.body_asl,callCount=messages.filter(m=>m.url.endsWith('/content')).length;
 const sectionPlan=await w.prepare({operation:'replace_section',url:docUrl,section_heading:'背景',markdown:'Rewritten section'});
 assert.equal(doc.body_asl,sectionBefore);
 assert.equal(messages.filter(m=>m.url.endsWith('/content')).length,callCount);
 assert.equal(sectionPlan.section.heading,'背景');
 assert.equal(sectionPlan.section.old_lake_preview,sectionOld);
 assert.equal((await w.apply(sectionPlan.plan_id)).status,'verified');
 assert.equal(doc.body_asl,sectionPrefix+'<p>Rewritten section</p>'+sectionSuffix);
 const sectionStale=await w.prepare({operation:'replace_section',url:docUrl,section_heading:'背景',markdown:'Stale'});
 doc.draft_version++;
 await assert.rejects(w.apply(sectionStale.plan_id),/版本已变化/);
 const beforeInvalid=messages.length;
 await assert.rejects(w.prepare({operation:'replace_section',url:docUrl,section_heading:'Missing',markdown:'No'}),/未找到/);
 assert.ok(!messages.slice(beforeInvalid).some(m=>m.method!=='GET'));
 doc.body_asl=original;doc.body_draft_asl=original;
 const untouched=doc.body_asl;
 await assert.rejects(w.prepare({operation:'replace_text',url:docUrl,old_text:'missing',markdown:'new'}),/匹配数：0/);
 const local=await w.prepare({operation:'replace_text',url:docUrl,old_text:'Original',markdown:'New <safe> & $&'});
 assert.equal(doc.body_asl,untouched);
 assert.equal((await w.apply(local.plan_id)).status,'verified');
 assert.equal(doc.body_asl,untouched.replace('Original',()=> 'New &lt;safe&gt; &amp; $&amp;'));
 doc.body_asl=original;doc.body_draft_asl=original;
 const repeated='<!doctype lake><p>same same</p>';
 doc.body_asl=repeated;doc.body_draft_asl=repeated;
 await assert.rejects(w.prepare({operation:'replace_text',url:docUrl,old_text:'same',markdown:'new'}),/匹配数：2/);
 doc.body_asl='<!doctype lake><p>one</p><p>two</p>';doc.body_draft_asl=doc.body_asl;
 await assert.rejects(w.prepare({operation:'replace_text',url:docUrl,old_text:'onetwo',markdown:'new'}),/匹配数：0/);
 doc.body_asl=original;doc.body_draft_asl=original;
 messages=[];
 const preview=await w.prepare({operation:'append',url:docUrl,markdown:'Appended'});
 assert.equal(messages.filter(m=>m.url.endsWith('/content')).length,0,'preview must not save content');
 const applied=await w.apply(preview.plan_id);assert.equal(applied.status,'verified');assert.ok(doc.body_asl.startsWith(original));assert.ok(doc.body_asl.includes('Appended'));assert.equal((doc.body_asl.match(/doctype lake/g)||[]).length,1);
 assert.ok(fs.existsSync(applied.backup));if(process.platform !== 'win32') assert.equal(fs.statSync(applied.backup).mode&0o777,0o600);
 const count=messages.length;await assert.rejects(w.apply(preview.plan_id),/禁止重复/);assert.equal(messages.length,count);
 const stale=await w.prepare({operation:'replace',url:docUrl,markdown:'Replacement'});doc.draft_version++;
 await assert.rejects(w.apply(stale.plan_id),/版本已变化/);
 doc.body_draft_asl='unpublished';await assert.rejects(w.prepare({operation:'replace',url:docUrl,markdown:'Replacement'}),/未发布草稿/);doc.body_draft_asl=doc.body_asl;
 const replacement=await w.prepare({operation:'replace',url:docUrl,markdown:'Replacement'});assert.equal((await w.apply(replacement.plan_id)).status,'verified');assert.ok(!doc.body_asl.includes('Original'));
 await assert.rejects(w.prepare({operation:'create',url:bookUrl,title:'Existing',markdown:'New'}),/同名/);
 const create=await w.prepare({operation:'create',url:bookUrl,title:'New',markdown:'New doc'});assert.equal((await w.apply(create.plan_id)).status,'verified');
 const expire=await w.prepare({operation:'append',url:bookUrl+'/'+doc.slug,markdown:'Later'});const p=path.join(root,'writes',expire.plan_id+'.json'),data=JSON.parse(fs.readFileSync(p));data.created_at=0;fs.writeFileSync(p,JSON.stringify(data));await assert.rejects(w.apply(expire.plan_id),/过期/);
 const unknown=await w.prepare({operation:'append',url:bookUrl+'/'+doc.slug,markdown:'Network failure'});const request=client.request;let attempts=0;client.request=async(...args)=>{if(args[2]?.method==='PUT'){attempts++;throw new Error('timeout');}return request(...args);};
 assert.equal((await w.apply(unknown.plan_id)).status,'unknown_or_partial');assert.equal(attempts,1);await assert.rejects(w.apply(unknown.plan_id),/禁止重复/);assert.equal(attempts,1);
 await assert.rejects(w.apply('../credentials'),/无效/);
 console.log('PASS: 创建/追加/替换、预览不改文档、富文本前缀保留、备份权限、单次执行、版本冲突、草稿保护、重复标题、计划过期、写入失败不重试');
}finally{fs.rmSync(root,{recursive:true,force:true});}})().catch(e=>{console.error(e);process.exitCode=1;});
