/** Resolve the existing companion data location; do not move or rewrite player files. */
import {existsSync,readdirSync,realpathSync} from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {inside,plainPath} from './engine.mjs';
export function launchContext({env=process.env,home=os.homedir(),config={}}={}){
 const dataDir=path.resolve(env.COMPANION_DATA_DIR||config.dataDir||path.join(env.LOCALAPPDATA||path.join(home,'.local','share'),'COTW Field Companion'));
 const override=env.COTW_SAVE_DIR||config.saveDir,roots=['Documents','OneDrive/Documents'].flatMap(d=>[path.join(home,d,'Avalanche Studios','COTW','Saves'),path.join(home,d,'Avalanche Studios','Epic Games Store','COTW','Saves')]);
 let candidates=[];
 if(override){if(!existsSync(override))throw Error('The selected game-save directory is unavailable.');candidates.push(realpathSync(override));}
 else for(const r of roots)if(existsSync(r))for(const child of readdirSync(r,{withFileTypes:true}))if(child.isDirectory()&&/^\d+$/.test(child.name))candidates.push(realpathSync(path.join(r,child.name)));
 candidates=[...new Set(candidates)];if(candidates.length>1)throw Error('Multiple game profiles found. Select COTW_SAVE_DIR before launching.');
 const saveDir=candidates[0]||null,port=Number(env.COMPANION_PORT||config.port||47831);if(!Number.isInteger(port)||port<1024||port>65535)throw Error('Invalid companion port');
 plainPath(dataDir);if(saveDir&&(inside(saveDir,dataDir)||inside(dataDir,saveDir)))throw Error('Companion data must not overlap game saves');
 return {dataDir,saveDir,port};
}
