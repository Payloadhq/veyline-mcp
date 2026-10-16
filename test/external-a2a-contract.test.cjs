'use strict';
// Consumer contract check; uses a mock rail, never real credentials or funds.
// Run: node --test test/external-a2a-contract.test.cjs
const {test}=require('node:test');
const assert=require('node:assert/strict');
const http=require('node:http');
const {spawn}=require('node:child_process');
const readline=require('node:readline');
const path=require('node:path');

test('Veyline MCP uses real A2A SendMessage contract and preserves preflight fields',async()=>{
 const calls=[];
 const server=http.createServer((req,res)=>{
   let body='';
   req.on('data',b=>body+=b);
   req.on('end',()=>{
     const p=JSON.parse(body),m=p?.params?.message,op=m?.parts?.[0]?.data?.operation;
     calls.push({p,auth:req.headers.authorization,url:req.url});
     res.setHeader('content-type','application/json');
     if(p.method!=='SendMessage'||m?.role!=='ROLE_USER'||!m.messageId||!op||req.url!=='/v1/a2a'){
       res.statusCode=400;
       res.end(JSON.stringify({jsonrpc:'2.0',id:p.id,error:{code:-32602,message:'Wrong A2A contract'}}));
     } else res.end(JSON.stringify({jsonrpc:'2.0',id:p.id,result:{message:{role:'ROLE_AGENT',messageId:'reply',parts:[{data:{ok:true,op}}]}}}));
   });
 });
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const proc=spawn(process.execPath,[path.join(__dirname,'..','mcp','index.js')],{env:{
   ...process.env,PAYLOAD_RAIL_URL:'http://127.0.0.1:'+server.address().port,
   PAYLOAD_RAIL_API_KEY:'mock-key-not-production'
 },stdio:['pipe','pipe','pipe']});
 let id=0,stderr='';const wait=new Map();
 proc.stderr.on('data',d=>stderr+=d);
 readline.createInterface({input:proc.stdout}).on('line',line=>{
   try{const r=JSON.parse(line),fn=wait.get(r.id);if(fn){wait.delete(r.id);fn(r);}}catch{}
 });
 const rpc=(method,params)=>new Promise((resolve,reject)=>{
   const n=++id,timer=setTimeout(()=>{wait.delete(n);reject(Error('MCP timeout '+stderr.slice(0,200)));},4000);
   wait.set(n,result=>{clearTimeout(timer);resolve(result);});
   proc.stdin.write(JSON.stringify({jsonrpc:'2.0',id:n,method,params})+'\n');
 });
 try{
   assert.ok((await rpc('initialize',{protocolVersion:'2024-11-05',capabilities:{},clientInfo:{name:'test',version:'1'}})).result);
   const list=await rpc('tools/list',{});
   for(const name of ['veyline_status','veyline_usage','veyline_preflight'])
     assert.ok(list.result?.tools?.some(t=>t.name===name),'missing '+name);
   const status=await rpc('tools/call',{name:'veyline_status',arguments:{}});
   assert.equal(status.result?.isError,false,JSON.stringify(status));
   assert.equal(calls.at(-1).auth,'Bearer mock-key-not-production');
   assert.equal(calls.at(-1).p.method,'SendMessage');
   assert.equal(calls.at(-1).p.params.message.parts[0].data.operation,'veyline_status');
   const args={protocol:'x402',provider:'callx402',action:'diagnose',network:'eip155:8453',
     asset:'USDC',amount_cents:1,recipient:'0x000000000000000000000000000000000000dEaD',
     request_hash:'fake-hash',quote_id:'fake-quote',quote:{fixture:true}};
   const response=await rpc('tools/call',{name:'veyline_preflight',arguments:args});
   assert.equal(response.result?.isError,false,JSON.stringify(response));
   const sent=calls.at(-1).p.params.message.parts[0].data;
   assert.equal(sent.operation,'veyline_preflight');
   assert.deepEqual(sent.arguments,args,'production-required fields must survive');
 } finally{proc.kill();await new Promise(r=>server.close(r));}
});