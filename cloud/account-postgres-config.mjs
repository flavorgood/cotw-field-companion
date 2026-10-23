/** Only explicitly configured GrindZone credentials may reach the account registry. */
export function accountPostgresOptions(connectionString){
  let u;try{u=new URL(connectionString);}catch{throw Error('GrindZone database configuration is missing or invalid');}
  if(!['postgres:','postgresql:'].includes(u.protocol)||!/^ep-[a-z0-9-]+(?:\.[a-z0-9-]+)*\.neon\.tech$/.test(u.hostname)||decodeURIComponent(u.username)!=='grindzone_runtime'||u.pathname!=='/grindzone'||!u.password||u.hash||u.port&&u.port!=='5432')throw Error('Refusing a privileged or unrelated GrindZone database destination');
  const allowed=new Set(['sslmode','channel_binding']);
  if([...u.searchParams.keys()].some(k=>!allowed.has(k))||[...allowed].some(k=>u.searchParams.getAll(k).length>1)||!['require','verify-full'].includes(u.searchParams.get('sslmode'))||u.searchParams.has('channel_binding')&&!['require','prefer'].includes(u.searchParams.get('channel_binding')))throw Error('Only authenticated TLS is permitted for the GrindZone registry');
  // Explicit fields prevent connection-string SSL flags from overriding strict TLS.
  // pg enables SCRAM-SHA-256-PLUS when the server offers it; TLS is always verified.
  return {host:u.hostname,port:5432,user:'grindzone_runtime',database:'grindzone',password:decodeURIComponent(u.password),ssl:{rejectUnauthorized:true},enableChannelBinding:true,max:2,connectionTimeoutMillis:10000,idleTimeoutMillis:10000,statement_timeout:10000,idle_in_transaction_session_timeout:15000,application_name:'grindzone-account-registry'};
}
export function accountRegistryKey(value){
  if(typeof value!=='string'||!/^[A-Za-z0-9_-]{43}$/.test(value))throw Error('A dedicated GrindZone account registry key is required');
  const key=Buffer.from(value,'base64url');if(key.length!==32||key.toString('base64url')!==value)throw Error('Invalid GrindZone account registry key');return key;
}
