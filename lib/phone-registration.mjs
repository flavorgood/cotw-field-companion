/** Native app registration: local consent comes first; no embedded operator credential. */
import {randomBytes} from 'node:crypto';
import {phoneRelayOrigin,provisionPhoneDevice} from './phone-bridge.mjs';
export const newPhoneActivationKey=()=>randomBytes(32).toString('base64url');
export async function provisionPhoneConnection(options={}){
  if(options.enrollmentToken)return provisionPhoneDevice(options);
  const {relayUrl,activationKey,allowInsecureLoopback=false,fetchImpl=fetch,timeoutMs=20000}=options;
  const origin=phoneRelayOrigin(relayUrl,{allowInsecureLoopback});
  if(typeof activationKey!=='string'||!/^[A-Za-z0-9_-]{43}$/.test(activationKey))throw Error('A private local connection identity is required');
  let response;
  try{response=await fetchImpl(origin+'/phone/activate',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({activationKey}),redirect:'error',signal:AbortSignal.timeout(timeoutMs)});}
  catch{throw Object.assign(Error('Could not reach phone setup. Check your connection and try again.'),{status:503});}
  if(!response.ok)throw Object.assign(Error(response.status===429?'Phone setup is busy. Try again in a minute.':'Phone setup is temporarily unavailable. Try again shortly.'),{status:response.status===429?429:503});
  let value;try{value=await response.json();}catch{throw Error('Phone setup returned an unreadable response');}
  if(typeof value?.deviceToken!=='string'||value.deviceToken.length>2048||!/^[-_A-Za-z0-9]+\.[-_A-Za-z0-9]{43}$/.test(value.deviceToken)||!/^[-_A-Za-z0-9]{43}$/.test(value.deviceId))throw Error('Phone service returned an invalid connection');
  return {deviceToken:value.deviceToken,deviceId:value.deviceId};
}
