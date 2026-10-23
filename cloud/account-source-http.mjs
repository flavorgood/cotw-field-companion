/** Same-origin ACCOUNT endpoints only. PC approvals never accept a device credential in browser JSON.
 * The host mounts this handler only after configuring durable registry + real account verification.
 */
const baseHeaders={'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer','X-Frame-Options':'DENY','Content-Security-Policy':"default-src 'none'; frame-ancestors 'none'; base-uri 'none'"};
const known=new Set([400,401,403,404,405,409,410,413,415,429,503]);
const error=(status,message)=>Object.assign(Error(message),{status});
async function requestBody(req){
 if(String(req.headers['content-type']||'').split(';')[0].trim()!=='application/json')throw error(415,'JSON required');
 const chunks=[];let bytes=0;for await(const c of req){bytes+=c.length;if(bytes>4096)throw error(413,'Request too large');chunks.push(c);}
 try{const input=JSON.parse(Buffer.concat(chunks).toString('utf8'));if(!input||typeof input!=='object'||Array.isArray(input))throw Error();return input;}catch{throw error(400,'Invalid request');}
}
export function createAccountSourceHandler({boundary,origin,mount='/grindzone',now=Date.now}={}){
 if(!boundary||['sources','requestLink','completeLink','read','unlink','cancelPending'].some(k=>typeof boundary[k]!=='function'))throw TypeError('Configured account-source boundary is required');
 const address=new URL(origin);if(address.protocol!=='https:'||address.origin!==origin||!['','/grindzone'].includes(mount))throw TypeError('Fixed HTTPS origin and approved mount required');
 const root=mount+'/api/account/sources',rates=new Map();
 const reply=(res,status,value)=>{res.writeHead(status,{...baseHeaders,'Content-Type':'application/json; charset=utf-8'});res.end(JSON.stringify(value));return true;};
 return async function handle(req,res){
  const url=new URL(req.url,origin);if(url.pathname!==root&&!url.pathname.startsWith(root+'/'))return false;
  try{
   if(req.headers.host!==address.host||req.headers.origin&&req.headers.origin!==origin||req.headers['sec-fetch-site']&&!['same-origin','none'].includes(req.headers['sec-fetch-site']))throw error(403,'Open GrindZone directly');
   const at=now(),ip=String(req.socket.remoteAddress||'unknown');
   for(const [key,value]of rates)if(value.until<=at)rates.delete(key);
   let rate=rates.get(ip);if(!rate){if(rates.size>=2048)throw error(429,'Try again shortly');rates.set(ip,rate={count:0,until:at+60000});}
   if(++rate.count>120)throw error(429,'Too many requests; try again shortly');
   if(req.method==='GET'&&url.pathname===root){if(url.search)throw error(400,'Unexpected query');return reply(res,200,{sources:await boundary.sources(req)});}
   if(req.method==='GET'&&url.pathname===root+'/read'){
    if([...url.searchParams.keys()].some(k=>k!=='source')||url.searchParams.getAll('source').length!==1)throw error(400,'Choose one account-owned source');
    const value=await boundary.read(req,url.searchParams.get('source'));if(!value)throw error(503,'The linked PC is unavailable; this endpoint does not create a backup');
    // Internal lease, HMAC owner and source identifiers never become a browser response.
    return reply(res,200,{sourceId:value.sourceId,sourceUpdatedAt:value.sourceUpdatedAt,state:value.state});
   }
   if(req.method!=='POST')throw error(405,'Method not allowed');
   if(url.search)throw error(400,'Unexpected query');
   if(req.headers.origin!==origin)throw error(403,'Open GrindZone directly');
   const suffix=url.pathname.slice(root.length),actions={'/link/request':'requestLink','/link/complete':'completeLink','/unlink':'unlink','/cancel-pending':'cancelPending'};
   if(!Object.hasOwn(actions,suffix))throw error(404,'Account source endpoint not found');
   const input=await requestBody(req);if(suffix==='/cancel-pending'&&Object.keys(input).length)throw error(400,'No identity is accepted');
   return reply(res,200,await boundary[actions[suffix]](req,input));
  }catch(e){return reply(res,known.has(e.status)?e.status:500,{error:known.has(e.status)?e.message:'Account source request failed'});}
 };
}
