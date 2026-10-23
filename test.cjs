const assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {safeUrl,appData,createClient}=require('./web-client.cjs');
const root=fs.mkdtempSync(path.join(os.tmpdir(),'yuque-test-'));
const creds=path.join(root,'credentials.json');
const html=data=>'window.appData = JSON.parse(decodeURIComponent('+JSON.stringify(encodeURIComponent(JSON.stringify(data)))+'))';
(async()=>{try{
  for(const u of ['http://www.yuque.com/a','https://yuque.com.evil.test','https://a@www.yuque.com','https://www.yuque.com:444'])assert.throws(()=>safeUrl(u));
  assert.deepEqual(appData(html({doc:{title:'文档'}})),{doc:{title:'文档'}});
  assert.throws(()=>appData('<html>验证失败</html>'));
  fs.writeFileSync(creds,JSON.stringify({origin:'https://www.yuque.com',cookie:'_yuque_session=test; yuque_ctoken=csrf'}),{mode:0o600});
  let requests=[];
  const client=createClient(root,async(address,options)=>{
    const u=new URL(address);requests.push(u);
    assert.equal(options.redirect,'manual');assert.equal(options.headers.Cookie,'_yuque_session=test; yuque_ctoken=csrf');
    if(u.pathname==='/u/book')return new Response(html({book:{id:9,name:'知识库',toc:[{type:'TITLE',children:[{type:'DOC',title:'文档',url:'doc'}]}]}}));
    if(u.pathname==='/u/book/doc')return new Response(html({doc:{slug:'doc',book_id:9,title:'文档'}}));
    if(u.pathname==='/api/docs/doc'){assert.equal(u.searchParams.get('book_id'),'9');return Response.json({data:{title:'文档',body_markdown:'# 正文\n代码',format:'markdown'}});}
    if(u.pathname==='/api/zsearch'){assert.equal(u.searchParams.get('scope'),'u/book');return Response.json({data:{hits:[{title:'文档'}],totalHits:1,info:{scope:'u/book'}}});}
    if(u.pathname==='/api/mine/personal_books')return Response.json({data:[{id:9,name:'知识库',user:{login:'u'},slug:'book'}]});
    throw new Error('Unexpected route');
  });
  assert.equal((await client.listDocs('https://www.yuque.com/u/book')).documents[0].url,'https://www.yuque.com/u/book/doc');
  assert.equal((await client.read('https://www.yuque.com/u/book/doc')).format,'markdown');
  assert.equal((await client.search('https://www.yuque.com/u/book','词')).total,1);
  assert.equal((await client.books()).books[0].url,'https://www.yuque.com/u/book');
  const count=requests.length;await assert.rejects(client.read('https://team.yuque.com/u/book/doc'),/域名不同/);assert.equal(requests.length,count);
  for(const status of [302,401,403,429]){
    const broken=createClient(root,async()=>new Response('',{status}));
    await assert.rejects(broken.read('https://www.yuque.com/u/book/doc'));
  }
  const challenge=createClient(root,async()=>new Response('<html>验证失败</html>'));
  await assert.rejects(challenge.read('https://www.yuque.com/u/book/doc'),/appData/);
  const wrongScope=createClient(root,async()=>Response.json({data:{hits:[],info:{scope:'/'}}}));
  await assert.rejects(wrongScope.search('https://www.yuque.com/u/book','词'),/尚未验证/);
  fs.writeFileSync(creds,JSON.stringify({origin:'https://www.yuque.com',cookie:'_yuque_session=test'}));
  let writes=0;
  const csrfClient=createClient(root,async(address,options)=>{
    if(options.method==='GET')return new Response('dashboard',{headers:{'Set-Cookie':'yuque_ctoken=server-csrf; Path=/; Secure'}});
    assert.equal(options.headers['x-csrf-token'],'server-csrf');
    assert.ok(options.headers.Cookie.includes('yuque_ctoken=server-csrf'));
    assert.equal(options.headers['Content-Type'],'application/json');writes++;
    return Response.json({data:{content:'<!doctype lake><p>hello</p>'}});
  });
  await csrfClient.request('https://www.yuque.com/api/docs/convert',true,{method:'POST',body:{content:'hello'}});
  assert.equal(writes,1);
  let refusedWrites=0;
  const noCsrf=createClient(root,async(address,options)=>{if(options.method!=='GET')refusedWrites++;return new Response('dashboard');});
  await assert.rejects(noCsrf.request('https://www.yuque.com/api/docs',true,{method:'POST',body:{}}),/CSRF/);
  assert.equal(refusedWrites,0);
  if(process.platform !== 'win32'){fs.chmodSync(creds,0o644);await assert.rejects(client.books(),/600/);}
  console.log('PASS: URL限制、appData解析、嵌套目录、正文接口、限定范围搜索、知识库发现、跨域凭证隔离、跳转/鉴权/限流/验证页拒绝、文件权限');
}finally{fs.rmSync(root,{recursive:true,force:true});}})().catch(e=>{console.error(e);process.exitCode=1;});
