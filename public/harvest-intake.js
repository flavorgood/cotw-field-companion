import {makeScreenshotEvidence} from './harvest-intake-core.js';
import {prepareScreenshot, recognizeScreenshot} from './harvest-ocr.js';
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const medals = {unknown:'Not read / unknown',none:'No medal',bronze:'Bronze',silver:'Silver',gold:'Gold',diamond:'Diamond',great_one:'Great One'};
const options = (values, selected) => Object.entries(values).map(([value,label]) => `<option value="${esc(value)}" ${value === selected ? 'selected' : ''}>${esc(label)}</option>`).join('');
const localTime = value => { const d = new Date(value); return new Date(d.getTime() - d.getTimezoneOffset()*60000).toISOString().slice(0,23); };

/** Uses the same transactional journal as manual reports; no upload, account or PC API. */
export function createHarvestIntake({storage, getContext, onSaved, prepare = prepareScreenshot, recognize = recognizeScreenshot}) {
  let dialog, context, candidate, extraction, imageUrl, controller, sequence = 0, saving = false, reading = false, pending = null, method = 'manual_review';
  const find = selector => dialog?.querySelector(selector);
  const status = text => { const node = find('[data-status]'); if (node) node.textContent = text; };
  function disableSave() { const button = find('[data-save]'); if (button) button.disabled = !candidate || reading || saving; }
  function close() {
    if (saving) return false;
    ++sequence; controller?.abort(); controller = null;
    if (imageUrl) URL.revokeObjectURL(imageUrl); imageUrl = null;
    dialog?.close(); dialog?.remove(); dialog = null; candidate = null; pending = null; return true;
  }
  function changed() {
    if (!dialog) return;
    status('Saved progress changed in another tab. Your review is retained; refresh progress before saving.');
    find('[data-refresh]').hidden = false;
  }
  function fields() {
    return `<div class="intake-grid"><label>Species<input name="species" list="intake-species" required maxlength="100" autocomplete="off"></label><label>Trophy score<input name="score" type="number" min="0" max="1000000" step="any" inputmode="decimal"></label><label>Awarded medal<select name="medal">${options(medals,'unknown')}</select></label><label>Sex<select name="sex">${options({unknown:'Not read / unknown',male:'Male',female:'Female'},'unknown')}</select></label></div><label>When was this animal harvested? (your local time)<input name="occurredAt" type="datetime-local" step="0.001" required></label><button type="button" data-now>Use the current time</button><p class="intake-help">Screenshot dates are not treated as harvest dates. The time must fall within this grind’s tracking periods.</p><details><summary>Notes and known coordinates</summary><label>Notes<textarea name="notes" maxlength="500"></textarea></label>${['shot','death','harvest'].map(k=>`<fieldset><legend>${{shot:'Shot point',death:'Found-dead point',harvest:'Pickup point'}[k]} (optional)</legend><div class="intake-grid"><label>X<input name="${k}X" type="number" min="-100000" max="100000" step="any"></label><label>Z<input name="${k}Z" type="number" min="-100000" max="100000" step="any"></label></div></fieldset>`).join('')}</details><label class="intake-check"><input name="reviewed" type="checkbox" required><span>I checked these fields against the screenshot. Unknown information stays blank or unknown.</span></label>`;
  }
  function open() {
    if (dialog) { dialog.focus(); return; }
    const value = getContext();
    if (!value.journal || !value.grind) throw Error('Start or select a grind before importing a screenshot.');
    context = structuredClone(value); candidate = null; extraction = null; pending = null; saving = false; reading = false;
    if (!document.querySelector('link[data-intake-style]')) {
      const link = document.createElement('link'); link.rel = 'stylesheet'; link.href = new URL('harvest-intake.css',import.meta.url).href; link.dataset.intakeStyle = ''; document.head.append(link);
    }
    dialog = document.createElement('dialog'); dialog.className = 'harvest-intake'; dialog.setAttribute('aria-labelledby','intake-title');
    dialog.innerHTML = `<form><header><h2 id="intake-title">Import a harvest screenshot</h2><button type="button" data-cancel aria-label="Close screenshot import">Close</button></header><p><strong>${esc(context.grind.name)}</strong> · ${esc(context.reserveName)} · ${esc(context.journal.platform)}</p><p>Choose a PNG or JPEG saved from your console or PC. English text is read on this device. Review and confirm before a harvest is counted.</p><label class="intake-file">Choose screenshot<input type="file" name="image" accept="image/png,image/jpeg,.png,.jpg,.jpeg"></label><p class="intake-help">No image upload or Xbox account link. The original image is not stored in the journal. Keep it in your photos. An unsaved review is lost when this page closes.</p><img data-preview alt="Selected harvest screenshot" hidden><p data-status role="status" aria-live="polite"></p><button type="button" data-stop hidden>Stop reading; review manually</button><button type="button" data-retry hidden>Retry text reading</button><button type="button" data-refresh hidden>Refresh progress and keep this review</button><fieldset data-review disabled>${fields()}</fieldset><datalist id="intake-species">${context.speciesNames.map(name=>`<option value="${esc(name)}"></option>`).join('')}</datalist><footer><button type="submit" data-save disabled>Add reviewed harvest</button></footer></form>`;
    document.body.append(dialog); dialog.showModal();
    dialog.addEventListener('cancel',event=>{event.preventDefault();if(!saving)close();});
    find('[data-cancel]').addEventListener('click',close);
    find('[data-stop]').addEventListener('click',()=>controller?.abort());
    find('[data-now]').addEventListener('click',()=>{find('[name=occurredAt]').value=localTime(new Date());find('[name=reviewed]').checked=false;});
    find('[data-retry]').addEventListener('click',()=>{if(candidate&&!reading&&!saving)void readCandidate();});
    find('[name=image]').addEventListener('change',event=>{void select(event.target.files[0]);});
    find('[data-refresh]').addEventListener('click',async()=>{
      if(saving||reading)return;
      try {
        const journal=await storage.read();
        if(!journal||journal.id!==context.journal.id)throw Error('This journal was replaced or removed. Close this review and select the intended journal.');
        const grind=journal.grinds.find(g=>g.id===context.grind.id);if(!grind)throw Error('The selected grind is no longer available.');
        context.journal=journal;context.grind=grind;pending=null;find('[name=reviewed]').checked=false;find('[data-refresh]').hidden=true;
        status('Current progress loaded. Review the retained fields and confirm again.');
      }catch(e){status(e.message);}
    });
    find('form').addEventListener('submit',save);
    find('[data-review]').addEventListener('input',event=>{if(event.target.name!=='reviewed')find('[name=reviewed]').checked=false;});
  }
  async function select(file) {
    if(!file||saving)return;
    ++sequence;const expected=sequence;controller?.abort();candidate=null;pending=null;reading=true;disableSave();
    find('[data-review]').disabled=true;find('[data-retry]').hidden=true;find('[data-stop]').hidden=true;status('Checking screenshot…');
    if(imageUrl)URL.revokeObjectURL(imageUrl);imageUrl=null;find('[data-preview]').hidden=true;
    try {
      const prepared=await prepare(file);if(expected!==sequence||!dialog)return;
      if(context.journal.reports.some(r=>r.screenshot?.imageSha256===prepared.imageSha256))throw Error('This exact screenshot is already recorded. No additional harvest was counted.');
      candidate={...prepared,file};imageUrl=URL.createObjectURL(file);find('[data-preview]').src=imageUrl;find('[data-preview]').hidden=false;
      // A replacement image must not retain another animal's values or consent.
      for(const name of ['species','score','occurredAt','notes','shotX','shotZ','deathX','deathZ','harvestX','harvestZ'])find(`[name=${name}]`).value='';
      find('[name=medal]').value='unknown';find('[name=sex]').value='unknown';find('[name=reviewed]').checked=false;
      await readCandidate();
    }catch(e){if(expected===sequence&&dialog){status(e.message);reading=false;disableSave();}}
  }
  async function readCandidate() {
    const expected=++sequence;controller?.abort();controller=new AbortController();reading=true;method='manual_review';extraction=null;
    find('[data-review]').disabled=true;find('[data-retry]').hidden=true;find('[data-stop]').hidden=false;disableSave();status('Reading English text on this device…');
    try {
      const result=await recognize(candidate.file,context.speciesNames,{signal:controller.signal,onProgress:stage=>{if(expected===sequence&&dialog)status('Reading screenshot: '+stage);}});
      if(expected!==sequence||!dialog)return;
      extraction=result;method='local_ocr';
      for(const name of ['species','score','medal','sex'])find(`[name=${name}]`).value=result.fields[name]??'';
      status(result.warnings.length?result.warnings.join(' '):'Text read. Verify every field and choose the harvest time. Nothing has been counted.');
    }catch(e){if(expected===sequence&&dialog){status(e.message+' You may review the image manually; it will not be labeled as extracted text.');find('[data-retry]').hidden=false;}}
    finally {if(expected===sequence&&dialog){reading=false;find('[data-review]').disabled=false;find('[data-stop]').hidden=true;find('[name=reviewed]').checked=false;disableSave();}}
  }
  async function save(event) {
    event.preventDefault();if(saving||reading||!candidate)return;
    const f=new FormData(find('form'));if(!f.get('reviewed')){status('Review and confirm the screenshot fields first.');return;}
    const saveSequence=sequence,saveDialog=dialog,saveContext=context;
    saving=true;disableSave();find('[name=image]').disabled=true;find('[data-cancel]').disabled=true;find('[data-review]').disabled=true;
    try {
      const key=JSON.stringify([...f].filter(([name])=>name!=='image'));
      if(!pending||pending.key!==key){
        const points={};for(const kind of ['shot','death','harvest']){const x=f.get(kind+'X'),z=f.get(kind+'Z');if(x!==''||z!==''){if(x===''||z==='')throw Error('Enter both X and Z for each known point.');points[kind]={x:Number(x),z:Number(z)};}}
        const occurred=new Date(f.get('occurredAt'));if(!Number.isFinite(occurred.getTime()))throw Error('Choose the actual harvest time.');
        const reviewedAt=new Date().toISOString(),screenshot=makeScreenshotEvidence({...candidate,extraction,method,reviewedAt});
        pending={key,command:{id:crypto.randomUUID(),op:'report.add',expectedRevision:context.journal.revision,data:{reportId:crypto.randomUUID(),grindId:context.grind.id,version:context.grind.version,species:f.get('species'),score:f.get('score')===''?null:Number(f.get('score')),medal:f.get('medal'),sex:f.get('sex'),occurredAt:occurred.toISOString(),notes:f.get('notes'),points,placeId:null,screenshot}}};
      }
      const command=pending.command,journal=await storage.execute(saveContext.journal.id,command),grindId=saveContext.grind.id;
      if(dialog===saveDialog&&sequence===saveSequence){saving=false;close();onSaved(journal,grindId);}
    }catch(e){if(dialog===saveDialog){status(e.message);if(e.code==='conflict')find('[data-refresh]').hidden=false;}}
    finally {if(dialog===saveDialog){saving=false;}if(dialog===saveDialog){find('[name=image]').disabled=false;find('[data-cancel]').disabled=false;find('[data-review]').disabled=false;disableSave();}}
  }
  return {open,close,changed,isOpen:()=>!!dialog,abandon:()=>{saving=false;close();}};
}
