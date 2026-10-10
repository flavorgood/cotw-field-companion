/** Read only the capture folder selected by this player. Never upload images. */
const DATABASE = 'grindzone-capture-folder-v1', STORE = 'folder';
export const CAPTURE_ENTRY_LIMIT = 500, RECENT_CAPTURE_LIMIT = 12;

export function createCaptureFolderStorage(indexedDB = globalThis.indexedDB) {
  async function use(mode, operation) {
    if (!indexedDB) throw Error('Folder memory is unavailable.');
    const db = await new Promise((resolve, reject) => {
      const request = indexedDB.open(DATABASE, 1);
      request.onupgradeneeded = () => request.result.createObjectStore(STORE);
      request.onsuccess = () => resolve(request.result);
      request.onerror = request.onblocked = () => reject(Error('Folder memory is unavailable.'));
    });
    try {
      return await new Promise((resolve, reject) => {
        const transaction = db.transaction(STORE, mode), request = operation(transaction.objectStore(STORE));
        transaction.oncomplete = () => resolve(request.result);
        transaction.onerror = transaction.onabort = () => reject(Error('Folder memory is unavailable.'));
      });
    } finally { db.close(); }
  }
  return {read:() => use('readonly', s => s.get('selected')), write:handle => use('readwrite', s => s.put(handle,'selected')), clear:() => use('readwrite', s => s.delete('selected'))};
}

export async function recentCaptures(directory, {extensions = ['.png','.jpg','.jpeg','.webp','.bmp'], maxBytes = 32*1024*1024} = {}) {
  const accepted = new Set(extensions), files = []; let entries = 0, truncated = false;
  for await (const handle of directory.values()) {
    if (++entries > CAPTURE_ENTRY_LIMIT) { truncated = true; break; }
    if (handle.kind !== 'file' || !accepted.has(handle.name.slice(handle.name.lastIndexOf('.')).toLowerCase())) continue;
    try {
      const file = await handle.getFile();
      if (file.size > 0 && file.size <= maxBytes) files.push({handle,name:file.name,size:file.size,lastModified:file.lastModified});
    } catch { /* Removed or unreadable entries do not hide the remaining images. */ }
  }
  files.sort((a,b) => b.lastModified-a.lastModified || a.name.localeCompare(b.name));
  return {files:files.slice(0,RECENT_CAPTURE_LIMIT),truncated};
}

export function mountCaptureSource(host, {onSelect, extensions, maxBytes, storage = createCaptureFolderStorage(), picker = globalThis.grindZoneCaptureFolderPicker?.bind(globalThis) ?? globalThis.showDirectoryPicker?.bind(globalThis)} = {}) {
  let directory = null, files = [], disposed = false, busy = false, forgetPending = false, generation = 0;
  const events = new AbortController(), active = () => !disposed && host.isConnected;
  if (!document.querySelector('link[data-capture-source-style]')) {
    const link = document.createElement('link'); link.rel='stylesheet'; link.href=new URL('capture-source.css',import.meta.url).href; link.dataset.captureSourceStyle=''; document.head.append(link);
  }
  host.classList.add('capture-source');
  host.innerHTML='<h3>Recent game captures</h3><p>Connect your Steam screenshots or Windows Captures folder once. Choose an image below to use it.</p><div class="capture-actions"><button type="button" data-capture-connect>Choose capture folder</button><button type="button" data-capture-refresh hidden>Refresh captures</button><button type="button" data-capture-forget hidden>Forget folder</button></div><p data-capture-status role="status" aria-live="polite"></p><ul data-capture-files></ul>';
  const find = selector => host.querySelector(selector), status = text => { if(active())find('[data-capture-status]').textContent=text; };
  function controls() {
    if(!active())return;
    find('[data-capture-connect]').disabled=busy||!picker;
    find('[data-capture-connect]').textContent=directory?'Change capture folder':'Choose capture folder';
    find('[data-capture-refresh]').hidden=!directory;find('[data-capture-refresh]').disabled=busy;
    find('[data-capture-forget]').hidden=!directory&&!forgetPending;find('[data-capture-forget]').disabled=busy;
    for(const button of find('[data-capture-files]').querySelectorAll('button'))button.disabled=busy;
  }
  function renderFiles() {
    const list=find('[data-capture-files]');list.replaceChildren();
    files.forEach((file,index) => {
      const item=document.createElement('li'),button=document.createElement('button'),time=document.createElement('span');
      button.type='button';button.dataset.captureIndex=index;button.textContent=file.name;
      time.textContent=new Date(file.lastModified).toLocaleString();item.append(button,time);list.append(item);
    });
  }
  async function refresh({requestPermission=false} = {}) {
    if(busy||!directory||!active())return;
    const expected=++generation;busy=true;controls();
    try {
      // Only a player's Refresh click requests permission; startup merely queries it.
      const permission=await (requestPermission?directory.requestPermission({mode:'read'}):directory.queryPermission({mode:'read'}));
      if(expected!==generation||!active())return;
      if(permission!=='granted'){files=[];renderFiles();status('Click Refresh captures to reconnect this folder, or browse for a file below.');return;}
      status('Looking for recent captures in '+directory.name+'…');
      const result=await recentCaptures(directory,{extensions,maxBytes});
      if(expected!==generation||!active())return;
      files=result.files;renderFiles();
      status((files.length?'Recent captures from ':'No supported screenshots in ')+directory.name+'. '+(result.truncated?'Showing newest images among the first 500 entries; choose a smaller capture folder for a complete list. ':'')+'Only this folder is read. Images stay on this device.');
    } catch { if(expected===generation&&active()){files=[];renderFiles();status('This capture folder is unavailable. Reconnect it or browse for a file below.');} }
    finally { if(expected===generation&&active()){busy=false;controls();} }
  }
  find('[data-capture-connect]').addEventListener('click',async () => {
    if(busy||!picker||!active())return;
    const expected=++generation;busy=true;controls();
    try {
      // Preserve the click gesture: open the picker before awaiting storage.
      const selected=await picker({id:'grindzone-captures',mode:'read',startIn:directory||'pictures'});
      if(expected!==generation||!active())return;
      directory=selected;files=[];renderFiles();
      let remembered=true;try{await storage.write(selected);}catch{remembered=false;}
      if(expected!==generation||!active())return;
      forgetPending=false;busy=false;await refresh();
      if(!remembered)status('Folder connected for this session. Folder memory is unavailable; browsing for files still works.');
    } catch(error) { if(expected===generation&&active()&&error?.name!=='AbortError')status('Folder connection is unavailable here. Browse for a screenshot below.'); }
    finally { if(active()){busy=false;controls();} }
  },{signal:events.signal});
  find('[data-capture-refresh]').addEventListener('click',() => void refresh({requestPermission:true}),{signal:events.signal});
  find('[data-capture-forget]').addEventListener('click',async () => {
    if(busy||!active())return;
    ++generation;busy=true;directory=null;files=[];renderFiles();controls();
    try{await storage.clear();forgetPending=false;status('Capture folder forgotten. Your images and saved progress are unchanged.');}
    catch{forgetPending=true;status('Folder disconnected for this session, but its remembered source could not be cleared. Retry Forget folder.');}
    finally{if(active()){busy=false;controls();}}
  },{signal:events.signal});
  find('[data-capture-files]').addEventListener('click',async event => {
    const button=event.target.closest('[data-capture-index]');if(!button||busy||!active())return;
    const entry=files[Number(button.dataset.captureIndex)];if(!entry)return;
    const expected=++generation;busy=true;controls();
    try {
      const file=await entry.handle.getFile();if(expected!==generation||!active())return;
      if(file.size<=0||file.size>(maxBytes??32*1024*1024))throw Error('Capture size changed.');
      await onSelect(file);
    } catch { if(expected===generation&&active())status('That capture could not be opened. Refresh the folder or browse for a file below.'); }
    finally { if(expected===generation&&active()){busy=false;controls();} }
  },{signal:events.signal});
  controls();
  const ready=(async () => {
    if(!picker){status('Folder connection is unavailable in this browser. Use the file chooser below, or drop or paste a screenshot.');return;}
    const expected=generation;
    try{const remembered=await storage.read();if(expected!==generation||!active())return;if(remembered?.kind==='directory'){directory=remembered;controls();await refresh();}else status('Choose your game capture folder, or browse for a file below.');}
    catch{if(expected===generation)status('Folder memory is unavailable. Choose a folder for this session, or browse for a file below.');}
  })();
  return {ready,dispose(){disposed=true;++generation;events.abort();}};
}
