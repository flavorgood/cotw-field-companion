/** Deterministic public projection. Never reads the installed app, saves, or private journal. */
import {readFileSync,writeFileSync,mkdirSync,existsSync,readdirSync,lstatSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
const root=path.dirname(path.dirname(fileURLToPath(import.meta.url))),out=path.join(root,'docs');
const files=['public.js','feedback.js','species-style.js','data-client.js','reference.js','reference-core.js','field-library.js','career.js','studio.js','screenshot-decode.js','capture-source.js','capture-source.css','style.css','field-theme.css','icon.svg','map.js','route-stops.js','map-geometry.js','terrain-layer.js','map-atlas.js','maps.css'];
const outputs={'index.html':readFileSync(path.join(root,'public/public.html'))};
const configuredFeedbackEndpoint=process.env.COTW_FEEDBACK_ENDPOINT?.trim()||'';
let feedbackOrigin='';
if(configuredFeedbackEndpoint){let parsed;try{parsed=new URL(configuredFeedbackEndpoint);}catch{throw Error('COTW_FEEDBACK_ENDPOINT must be an absolute HTTP(S) origin');}if(!['http:','https:'].includes(parsed.protocol)||parsed.pathname!=='/'||parsed.search||parsed.hash)throw Error('COTW_FEEDBACK_ENDPOINT must be an origin without a path');feedbackOrigin=parsed.origin;}
outputs['index.html']=Buffer.from(outputs['index.html'].toString().replace('__COTW_FEEDBACK_ENDPOINT__',configuredFeedbackEndpoint).replace("connect-src 'self'","connect-src 'self'"+(feedbackOrigin?' '+feedbackOrigin:'')));
for(const name of files)outputs[name]=readFileSync(path.join(root,'public',name));
outputs['catalog/reference.json']=readFileSync(path.join(root,'lib/rating-data.json'));
outputs['catalog/gear.json']=readFileSync(path.join(root,'lib/gear-data.json'));
outputs['catalog/maps.json']=readFileSync(path.join(root,'lib/maps-data.json'));
outputs['.nojekyll']=Buffer.from('');
outputs['APC-MIT.txt']=readFileSync(path.join(root,'licenses/APC-MIT.txt')); 
// Every allowlisted asset is UTF-8 text. Normalize checkout line endings before
// hashing so Windows and Linux publish the same files and cache identities.
for(const name of Object.keys(outputs))outputs[name]=Buffer.from(outputs[name].toString('utf8').replace(/\r\n/g,'\n'));
const buildTag=createHash('sha256').update(Object.entries(outputs).sort(([a],[b])=>a<b?-1:a>b?1:0).map(([n,b])=>n+':'+createHash('sha256').update(b).digest('hex')).join('\n')).digest('hex').slice(0,16);
for(const [name,bytes]of Object.entries(outputs)){let text=bytes.toString();if(name.endsWith('.js'))text=text.replace(/(from\s*['"]\.\/[^'"]+\.js)(['"])/g,'$1?v='+buildTag+'$2');if(name==='index.html')text=text.replace(/((?:src|href)="\.\/[^"]+\.(?:js|css|svg))(")/g,'$1?v='+buildTag+'$2');if(name.endsWith('.js')||name==='index.html')outputs[name]=Buffer.from(text);}
const forbidden=/765611\d{11}|[A-Za-z]:\\Users\\|gh[pousr]_[A-Za-z0-9]{20}|github_pat_|journal\.sqlite|"sourceFolder"\s*:|"HarvestHistory"\s*:|"StatsData"\s*:/;
for(const [name,bytes] of Object.entries(outputs)){if(forbidden.test(bytes.toString()))throw Error('Private content in public projection: '+name);}
if(existsSync(out)){const walk=d=>readdirSync(d).flatMap(n=>{const p=path.join(d,n);if(lstatSync(p).isSymbolicLink())throw Error('No public symlinks');return lstatSync(p).isDirectory()?walk(p):[path.relative(out,p).replaceAll('\\','/')];});for(const n of walk(out))if(!Object.hasOwn(outputs,n)&&n!=='build.json')throw Error('Unreviewed public output: '+n);}
mkdirSync(out,{recursive:true});const manifest=[];
for(const [name,bytes]of Object.entries(outputs)){const p=path.join(out,name);mkdirSync(path.dirname(p),{recursive:true});writeFileSync(p,bytes);manifest.push({path:name,bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')});}
writeFileSync(path.join(out,'build.json'),JSON.stringify({schema:'field.public_build.v1',version:JSON.parse(readFileSync(path.join(root,'package.json'))).version,mode:'public_no_player_data',buildTag,files:manifest},null,2)+'\n');
console.log(JSON.stringify({publicFiles:manifest.length,bytes:manifest.reduce((s,f)=>s+f.bytes,0),output:'docs',privateDataIncluded:false}));
