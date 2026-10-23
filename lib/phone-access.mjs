import {createPhoneBridge,phoneRelayOrigin} from './phone-bridge.mjs';
import {provisionPhoneConnection,newPhoneActivationKey} from './phone-registration.mjs';

/** One explicitly enabled phone connection for the selected local save profile. */
export function createPhoneAccess({store,observer,relayUrl=null,enrollmentToken,runCommand,allowInsecureLoopback=false,provision=provisionPhoneConnection,bridgeFactory=createPhoneBridge}={}){
  const origin=relayUrl?phoneRelayOrigin(relayUrl,{allowInsecureLoopback}):null;
  const key='phone:connection:'+observer.profile,attemptKey='phone:activation:'+observer.profile;
  const saved=store.get(key,null);
  let config=saved?.relayUrl===origin&&saved?.enabled===true?saved:null;
  let bridge=null,status=config?'connecting':'disabled',busy=false,generation=0,starting=null;
  const info=()=>({available:!!origin,enabled:!!config,status,serviceHost:origin?new URL(origin).host:null,relayUrl:origin});
  const makeBridge=(connection,ticket)=>{let candidate;candidate=bridgeFactory({relayUrl:connection.relayUrl,deviceToken:connection.deviceToken,readState:(reserve,options)=>observer.state(reserve,options),readHerds:query=>observer.herdView(query),readLocations:query=>observer.locationHistory(query),runCommand,allowInsecureLoopback,onStatus:event=>{if(ticket===generation&&bridge===candidate)status=event.status;}});return candidate;};
  async function connect(connection,ticket){
    const candidate=makeBridge(connection,ticket);bridge=candidate;
    const pending=Promise.resolve(candidate.connect());starting=pending;
    try{await pending;if(ticket!==generation)throw Error('Phone connection was cancelled');}
    finally{if(starting===pending)starting=null;}
  }
  async function start(){if(!config)return;if(bridge)return starting;return connect(config,++generation);}
  return {
    status:info,
    start,
    async enable(body){
      if(body?.consent!==true)throw Object.assign(Error('Confirm phone access before connecting'),{status:400});
      if(!origin)throw Object.assign(Error('Phone access has not been set up for this installation yet'),{status:503});
      if(busy)throw Object.assign(Error('A phone connection is already being prepared'),{status:409});
      if(config){await start();return info();}
      const ticket=++generation;busy=true;status='connecting';
      try{
        let activationKey;
        if(!enrollmentToken){
          const attempt=store.get(attemptKey,null);
          activationKey=attempt?.relayUrl===origin&&typeof attempt.key==='string'&&/^[A-Za-z0-9_-]{43}$/.test(attempt.key)?attempt.key:newPhoneActivationKey();
          // Preserve uncertain setup identity across retries; this is private meta, never an export.
          store.set(attemptKey,{relayUrl:origin,key:activationKey});
        }
        const credential=await provision({relayUrl:origin,enrollmentToken,activationKey,allowInsecureLoopback});
        if(ticket!==generation)throw Error('Phone connection was cancelled');
        config={enabled:true,relayUrl:origin,deviceToken:credential.deviceToken};
        store.set(key,config);store.set(attemptKey,null);
        await connect(config,ticket);
        if(ticket!==generation)throw Error('Phone connection was cancelled');
        return info();
      }catch(error){if(ticket===generation&&!config)status='disabled';throw error;}
      finally{if(ticket===generation)busy=false;}
    },
    async pair(){if(!config||!bridge)throw Object.assign(Error('Enable phone access on this PC first'),{status:409});return bridge.pair();},
    async disable(){++generation;busy=false;config=null;store.set(key,null);store.set(attemptKey,null);const previous=bridge;bridge=null;starting=null;status='disabled';await previous?.close();return info();},
    async close(){++generation;const previous=bridge;bridge=null;starting=null;status='disabled';await previous?.close();}
  };
}
