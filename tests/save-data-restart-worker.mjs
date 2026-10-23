/** Isolated-process acceptance helper. Only called with disposable directories by the test suite. */
import {Store} from '../lib/store.mjs';
import {Observer} from '../lib/observer.mjs';
import {projectPhoneState} from '../lib/phone-bridge.mjs';
import {discoveryReference,readyDiscoveryReader} from './zone-discovery-fixture.mjs';
const [save,journal]=process.argv.slice(2);
if(!save||!journal)throw Error('Disposable save and journal paths are required');
const store=new Store(journal),observer=new Observer(store,save,discoveryReference,{interval:60000,zoneReferenceReader:readyDiscoveryReader()});
try{
  await observer.start();
  observer.command({op:'settings',spoilers:true,confirmSpoilers:true});
  const state=observer.state(19),phone=projectPhoneState(state);
  console.log(JSON.stringify({saveData:phone.career.saveData,history:store.get('save-data-progress:'+observer.profile),harvests:phone.harvests.length,zones:phone.zones.length,sourceStates:store.sources(observer.profile).map(({name,status})=>({name,status}))}));
}finally{
  observer.stop();while(observer.busy)await new Promise(resolve=>setTimeout(resolve,10));store.close();
}
