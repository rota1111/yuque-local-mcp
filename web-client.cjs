// Independently implemented Yuque session adapter. See REFERENCES.md for design sources.
const fs = require('node:fs');
const path = require('node:path');
function safeUrl(value) {
  const u = new URL(value);
  if(u.protocol !== 'https:' || !/^(?:[a-z0-9-]+\.)*yuque\.com$/.test(u.hostname) || u.username || u.password || u.port) throw new Error('仅允许 HTTPS 语雀地址');
  u.hash=''; return u;
}
function appData(html) {
  const m=html.match(/window\.appData\s*=\s*JSON\.parse\(decodeURIComponent\(("(?:[^"\\]|\\.)*")\)\)/);
  if(!m) throw new Error('页面没有可解析的 appData；可能需要登录、遇到验证或页面结构变化。不会将验证页当成正文。');
  try{return JSON.parse(decodeURIComponent(JSON.parse(m[1])));}catch{throw new Error('appData 解析失败');}
}
function loadCredentials(root) {
  const p=path.join(root,'credentials.json');
  if(!fs.existsSync(p)) throw new Error('未配置网页登录 Cookie。请在本机运行项目目录中运行 npm run setup；不要将 Cookie 发到聊天。');
  if(process.platform !== 'win32' && (fs.statSync(p).mode & 0o077)!==0) throw new Error('credentials.json 权限必须为 600');
  const c=JSON.parse(fs.readFileSync(p,'utf8')); const origin=safeUrl(c.origin).origin;
  if(typeof c.cookie!=='string'||!c.cookie.includes('_yuque_session=')||/[\r\n]/.test(c.cookie)) throw new Error('本地 Cookie 配置无效');
  return {origin,cookie:c.cookie};
}
function createClient(root, transport=fetch) {
  let sessionCsrf; let sessionCookie;
  async function request(address,json=false, options={}) {
    const c=loadCredentials(root), u=safeUrl(address);
    if(u.origin!==c.origin)throw new Error('地址与本地凭证绑定域名不同；拒绝跨域发送 Cookie');
    if(sessionCookie!==c.cookie){sessionCsrf=undefined;sessionCookie=c.cookie;}
    const method=options.method||'GET';
    if(method!=='GET'&&!sessionCsrf&&!/(?:^|;\s*)yuque_ctoken=/.test(c.cookie))await request(c.origin+'/dashboard');
    const csrf=c.cookie.match(/(?:^|;\s*)yuque_ctoken=([^;]+)/)?.[1]||sessionCsrf;
    if(method!=='GET'&&!csrf)throw new Error('未能取得语雀CSRF凭证，写入已停止');
    const headers={Accept:json?'application/json':'text/html',Cookie:c.cookie,Referer:c.origin+'/dashboard','User-Agent':'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/130.0.0.0 Safari/537.36'};
    if(json){headers['X-Requested-With']='XMLHttpRequest';if(csrf)headers['x-csrf-token']=csrf;}
    if(csrf&&!/(?:^|;\s*)yuque_ctoken=/.test(c.cookie))headers.Cookie+='; yuque_ctoken='+csrf;
    if(options.body!==undefined)headers['Content-Type']='application/json';
    let r;try{r=await transport(u.href,{method,headers,redirect:'manual',signal:AbortSignal.timeout(30000),...(options.body===undefined?{}:{body:JSON.stringify(options.body)})});}catch{throw new Error('语雀网络请求失败或超时');}
    for(const cookie of r.headers.getSetCookie?.()||[]){const match=cookie.match(/^yuque_ctoken=([^;]+)/);if(match)sessionCsrf=match[1];}
    if(r.status>=300&&r.status<400)throw new Error('语雀要求跳转，可能登录失效或触发验证；请在日常浏览器完成验证后更新本地 Cookie');
    if([401,403].includes(r.status))throw new Error('语雀拒绝访问：登录失效、需要验证或无文档权限');
    if(r.status===429)throw new Error('语雀请求频率限制，请稍后再试');
    if(!r.ok)throw new Error('语雀请求失败 HTTP '+r.status);
    const text=await r.text();
    if(!json)return text;
    let payload;try{payload=JSON.parse(text);}catch{throw new Error('接口未返回 JSON，可能遇到登录验证；未缓存结果');}
    if(payload.error || (typeof payload.status==='number' && payload.status>=400)) throw new Error('语雀接口返回错误；未缓存结果');
    return payload;
  }
  async function page(address){return appData(await request(safeUrl(address).href));}
  async function listDocs(address){
    const u=safeUrl(address), parts=u.pathname.split('/').filter(Boolean);
    if(parts.length<2)throw new Error('需要知识库地址 /用户名/知识库');
    const base=u.origin+'/'+parts.slice(0,2).join('/'), data=await page(base);
    if(!data.book || !Array.isArray(data.book.toc))throw new Error('知识库目录不可用；不会返回伪空结果');
    const docs=[];
    function walk(items){for(const x of items){if(String(x.type).toUpperCase()==='DOC'&&x.url){const link=new URL(x.url,base+'/');if(safeUrl(link.href).origin===u.origin)docs.push({title:x.title,url:link.href});}const children=x.children||x.childrens;if(Array.isArray(children))walk(children);}}
    walk(data.book.toc);return {title:data.book.name,documents:docs,scope:'页面内嵌目录；未保证覆盖所有目录类型'};
  }
  async function read(address){
    const u=safeUrl(address), d=await page(u.href), meta=d.doc;
    if(!meta||!meta.slug)throw new Error('未找到文档元信息；可能无权限或页面不是文档');
    const api=new URL('/api/docs/'+encodeURIComponent(meta.slug),u.origin);
    const bookId=meta.book_id||d.book?.id;if(bookId)api.searchParams.set('book_id',String(bookId));
    api.searchParams.set('merge_dynamic_data','false');
    const payload=await request(api.href,true), body=payload.data;
    if(!body||typeof body!=='object')throw new Error('正文响应结构未知');
    const markdown=body.body_markdown||body.markdown;
    const text=markdown||body.content||body.body||body.body_html;
    if(typeof text!=='string'||!text.trim())throw new Error('未获取完整正文；不会以摘要代替正文');
    return {url:u.href,title:body.title||meta.title,text,format:markdown?'markdown':(body.format||'lake'),updated_at:body.updated_at,fetched_at:new Date().toISOString(),links:[]};
  }
  async function search(address,query,limit=10){
    const u=safeUrl(address), parts=u.pathname.split('/').filter(Boolean);
    if(parts.length<2)throw new Error('在线搜索需要知识库范围');
    if(!String(query).trim())throw new Error('搜索词不能为空');
    const target=new URL('/api/zsearch',u.origin);
    for(const [k,v] of Object.entries({q:query,p:1,limit,type:'content',tab:'book',scope:parts.slice(0,2).join('/')}))target.searchParams.set(k,String(v));
    const result=await request(target.href,true);
    if(!result.data || !Array.isArray(result.data.hits) || result.data.info?.scope !== parts.slice(0,2).join('/'))throw new Error('在线搜索响应结构尚未验证；请使用同步后的本地搜索');
    return {scope:parts.slice(0,2).join('/'),results:result.data.hits,total:result.data.totalHits,source:'live',fetched_at:new Date().toISOString()};
  }
  async function books(){
    const c=loadCredentials(root),books=[];
    for(let offset=0;offset<1000;offset+=100){
      const target=new URL('/api/mine/personal_books',c.origin);target.searchParams.set('limit','100');target.searchParams.set('offset',String(offset));
      const payload=await request(target.href,true);if(!Array.isArray(payload.data))throw new Error('知识库列表响应结构未知');
      for(const b of payload.data){if(typeof b.user?.login!=='string'||typeof b.slug!=='string')throw new Error('知识库入口缺少定位信息');books.push({id:b.id,title:b.name,url:c.origin+'/'+encodeURIComponent(b.user.login)+'/'+encodeURIComponent(b.slug)});}
      if(payload.data.length<100)return {books,scope:'自有个人知识库；不含团队和受邀知识库'};
    }
    throw new Error('知识库分页超出上限');
  }
  return {page,listDocs,read,search,books,request};
}
module.exports={safeUrl,appData,loadCredentials,createClient};
