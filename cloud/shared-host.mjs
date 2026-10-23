/** Optional shared-compute hosting. The relay child inherits no host-app credentials. */
import {fork} from 'node:child_process';
import http from 'node:http';
import {isPhonePath,phoneProxyHeaders} from './mount.mjs';
export async function startSharedPhone({publicBase,key}={}){
  const base=new URL(publicBase);
  if(base.protocol!=='https:'||base.pathname!=='/grindzone'||base.search||base.hash||base.username||base.password)throw Error('A fixed HTTPS GrindZone mount is required');
  if(typeof key!=='string'||!/^[A-Za-z0-9_-]{43}$/.test(key))throw Error('Private GrindZone signing key is missing');
  const child=fork(new URL('./activation-server.mjs',import.meta.url),[],{execArgv:['--max-old-space-size=96'],env:{NODE_ENV:'production',PORT:'0',PHONE_RELAY_BIND_HOST:'127.0.0.1',PHONE_RELAY_ORIGIN:publicBase,PHONE_RELAY_SIGNING_KEY:key},stdio:['ignore','inherit','inherit','ipc']});
  const port=await new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>{child.kill();reject(Error('GrindZone startup timed out'));},15000);
    child.once('error',error=>{clearTimeout(timer);reject(error);});
    child.once('exit',()=>{clearTimeout(timer);reject(Error('GrindZone child exited before ready'));});
    child.once('message',message=>{clearTimeout(timer);if(message?.ready===true&&Number.isInteger(message.port)&&message.port>0)resolve(message.port);else{child.kill();reject(Error('Invalid GrindZone startup response'));}});
  });
  let alive=true;child.once('exit',()=>{alive=false;});
  const stop=()=>{if(alive)child.kill();};process.once('exit',stop);
  const unavailable=res=>{res.writeHead(503,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end('{"error":"Phone service is reconnecting. Please retry."}');};
  const forward=(req,res)=>{
    if(!alive)return unavailable(res);
    const upstream=http.request({host:'127.0.0.1',port,path:req.url,method:req.method,headers:phoneProxyHeaders(req.headers)},response=>{res.writeHead(response.statusCode,response.headers);response.pipe(res);});
    upstream.setTimeout(15000,()=>upstream.destroy());upstream.on('error',()=>{if(!res.headersSent)unavailable(res);else res.destroy();});
    req.on('aborted',()=>upstream.destroy());res.on('close',()=>upstream.destroy());req.pipe(upstream);
  };
  const upgrade=(req,socket,head)=>{
    if(!alive){socket.end('HTTP/1.1 503 Unavailable\r\nConnection: close\r\nContent-Length: 0\r\n\r\n');return;}
    const upstream=http.request({host:'127.0.0.1',port,path:req.url,method:'GET',headers:phoneProxyHeaders(req.headers)});
    upstream.setTimeout(10000,()=>upstream.destroy());upstream.on('error',()=>socket.destroy());
    upstream.on('response',response=>{socket.end('HTTP/1.1 '+response.statusCode+' Rejected\r\nConnection: close\r\nContent-Length: 0\r\n\r\n');response.resume();});
    upstream.on('upgrade',(response,peer,peerHead)=>{
      const lines=[];for(let i=0;i<response.rawHeaders.length;i+=2)lines.push(response.rawHeaders[i]+': '+response.rawHeaders[i+1]);
      socket.write('HTTP/1.1 101 Switching Protocols\r\n'+lines.join('\r\n')+'\r\n\r\n');
      socket.setTimeout(0);peer.setTimeout(0);if(head.length)peer.write(head);if(peerHead.length)socket.write(peerHead);
      socket.on('error',()=>peer.destroy());peer.on('error',()=>socket.destroy());socket.on('close',()=>peer.destroy());peer.on('close',()=>socket.destroy());socket.pipe(peer);peer.pipe(socket);
    });upstream.end();
  };
  return {
    wrap(app){return (req,res)=>{
      if(isPhonePath(req.url))return forward(req,res);
      if(req.headers.cookie)req.headers.cookie=req.headers.cookie.split(';').filter(x=>!x.trim().startsWith('__Secure-grindzone-phone=')).join(';');
      return app(req,res);
    };},
    attach(server){const previous=server.listeners('upgrade');server.removeAllListeners('upgrade');server.on('upgrade',(req,socket,head)=>{if(isPhonePath(req.url))return upgrade(req,socket,head);if(previous.length)for(const handler of previous)handler.call(server,req,socket,head);else socket.destroy();});server.once('close',stop);},
    async close(){process.removeListener('exit',stop);if(!alive)return;const exited=new Promise(resolve=>child.once('exit',resolve));stop();await exited;}
  };
}
