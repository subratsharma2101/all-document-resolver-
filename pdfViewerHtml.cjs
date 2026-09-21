function scriptValue(value) {
  return JSON.stringify(value).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
}

// Chrome colors for the viewer surround. Pages themselves always render on white
// (canvas background) because that is how the PDF is authored; only the toolbar,
// stage and status bar follow the app theme. Defaults keep the original dark look
// so callers (and tests) that omit `theme` are unaffected. Values are plain hex
// strings interpolated only into the <style> block, never into script logic.
const DARK_CHROME = { bg: '#0f1115', text: '#cfd3dc', toolbar: '#191d26', toolbarBorder: '#303745', controlBorder: '#394354', controlText: '#e6e8ec', control: '#252a35', total: '#9299a8', status: '#a9bddc' };
const hex = (value, fallback) => (/^#[0-9a-fA-F]{3,8}$/.test(value || '') ? value : fallback);

function buildPdfHtml(libSrc, workerSrc, base64Pdf, initialPage = 1, theme = {}) {
  const c = {};
  for (const key of Object.keys(DARK_CHROME)) c[key] = hex(theme[key], DARK_CHROME[key]);
  return `<!DOCTYPE html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=5">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline' blob:; worker-src blob:; style-src 'unsafe-inline'; img-src data: blob:; font-src data: blob:; connect-src 'none';">
<style>
*{box-sizing:border-box}html,body{margin:0;background:${c.bg};color:${c.text};font:13px system-ui,sans-serif;height:100%}
body{display:flex;flex-direction:column}#toolbar{padding:8px;display:flex;gap:6px;align-items:center;flex-wrap:wrap;background:${c.toolbar};border-bottom:1px solid ${c.toolbarBorder}}
button,input{font:inherit;border:1px solid ${c.controlBorder};color:${c.controlText};background:${c.control};border-radius:6px;padding:9px;min-height:40px}button:disabled{opacity:.4}input{min-width:0}#page{width:52px}#query{flex:1;width:100px}#total{color:${c.total}}#status{padding:7px 12px;font-size:11px;min-height:29px;color:${c.status}}#stage{flex:1;overflow:auto;padding:8px;text-align:center;touch-action:pan-x pan-y pinch-zoom}#paper{position:relative;display:inline-block;vertical-align:top;line-height:0;text-align:left}canvas{background:white;box-shadow:0 3px 18px #0008}#marker{position:absolute;width:18px;height:18px;border:2px solid #397bff;border-radius:50%;transform:translate(-50%,-50%);pointer-events:none;display:none;background:#4f8cff55}
</style></head><body>
<div id="toolbar"><button id="prev" aria-label="Previous page">Prev</button><input id="page" aria-label="Page number" type="number" min="1" value="1"><span id="total">/ ...</span><button id="next" aria-label="Next page">Next</button><button id="zoom" aria-label="Change zoom">100%</button><input id="query" aria-label="Find text in PDF" placeholder="Find text"><button id="find">Find</button></div>
<div id="status" role="status">Loading local PDF...</div><div id="stage"><div id="paper"><span id="marker"></span></div></div>
<script type="module">
const status=document.getElementById('status');
const post=(message)=>window.ReactNativeWebView?.postMessage(JSON.stringify(message));
let pdf, pageNumber=1, zoom=1, rendering=false, searching=false, currentPage=null, renderTask=null;
const controls=[...document.querySelectorAll('button,input')];
function lock(){controls.forEach(el=>el.disabled=rendering||searching);document.getElementById('prev').disabled=rendering||searching||pageNumber<=1;document.getElementById('next').disabled=rendering||searching||pageNumber>=pdf.numPages;}
function describeError(error){return error?.name==='PasswordException'?'Password-protected PDFs are not supported in this version.':String(error?.message||error);}
async function showPage(number){
 if(rendering)return; rendering=true;lock();status.textContent='Rendering page '+number+'...';
 try{
  const page=await pdf.getPage(number), viewport=page.getViewport({scale:1});
  if(!Number.isFinite(viewport.width)||!Number.isFinite(viewport.height)||viewport.width<=0||viewport.height<=0)throw new Error('Invalid PDF page dimensions.');
  const cssScale=Math.min((window.innerWidth-16)/viewport.width,1.5)*zoom;
  const scale=Math.min(cssScale*Math.min(window.devicePixelRatio||1,1.5),Math.sqrt(4000000/(viewport.width*viewport.height)),8192/Math.max(viewport.width,viewport.height));
  const scaled=page.getViewport({scale});
  const canvas=document.createElement('canvas');canvas.width=Math.max(1,Math.floor(scaled.width));canvas.height=Math.max(1,Math.floor(scaled.height));canvas.style.width=(viewport.width*cssScale)+'px';canvas.style.height=(viewport.height*cssScale)+'px';
  renderTask=page.render({canvasContext:canvas.getContext('2d'),viewport:scaled});await renderTask.promise;renderTask=null;
  const paper=document.getElementById('paper'),old=paper.querySelector('canvas');if(old){old.width=0;old.height=0;old.remove();}paper.prepend(canvas);
  if(currentPage&&currentPage!==page)currentPage.cleanup();currentPage=page;pageNumber=number;
  document.getElementById('marker').style.display='none';document.getElementById('page').value=number;document.getElementById('total').textContent='/ '+pdf.numPages;document.getElementById('stage').scrollTo(0,0);
  status.textContent='Page '+number+' of '+pdf.numPages+' | Tap the page to position a mark.';
  post({type:'page',page:number,pageCount:pdf.numPages,width:viewport.width,height:viewport.height,rotation:viewport.rotation});
 }catch(error){status.textContent=describeError(error);post({type:'error',message:describeError(error)});}
 finally{rendering=false;lock();}
}
try{
 if(!Promise.withResolvers)Promise.withResolvers=function(){let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b});return{promise,resolve,reject}};
 const libUrl=URL.createObjectURL(new Blob([${scriptValue(libSrc)}],{type:'text/javascript'}));
 const pdfjs=await import(libUrl);URL.revokeObjectURL(libUrl);
 const workerUrl=URL.createObjectURL(new Blob([${scriptValue(workerSrc)}],{type:'text/javascript'}));pdfjs.GlobalWorkerOptions.workerSrc=workerUrl;
 const raw=atob(${scriptValue(base64Pdf)});const bytes=new Uint8Array(raw.length);for(let i=0;i<raw.length;i++)bytes[i]=raw.charCodeAt(i);
 pdf=await pdfjs.getDocument({data:bytes,isEvalSupported:false,enableXfa:false,useSystemFonts:true,maxImageSize:16000000,canvasMaxAreaInBytes:16000000}).promise;
 document.getElementById('page').max=pdf.numPages;
 await showPage(Math.max(1,Math.min(pdf.numPages,${Number.isInteger(initialPage) ? initialPage : 1})));
 document.getElementById('prev').onclick=()=>showPage(Math.max(1,pageNumber-1));
 document.getElementById('next').onclick=()=>showPage(Math.min(pdf.numPages,pageNumber+1));
 document.getElementById('page').onchange=(event)=>{const n=Number(event.target.value);if(Number.isInteger(n)&&n>=1&&n<=pdf.numPages)showPage(n);else event.target.value=pageNumber;};
 document.getElementById('zoom').onclick=(event)=>{zoom=zoom>=3?1:zoom+.5;event.target.textContent=Math.round(zoom*100)+'%';showPage(pageNumber);};
 document.getElementById('paper').onclick=(event)=>{if(rendering||searching)return;const canvas=document.querySelector('canvas');if(!canvas)return;const r=canvas.getBoundingClientRect(),x=(event.clientX-r.left)/r.width,y=(event.clientY-r.top)/r.height;if(x<0||x>1||y<0||y>1)return;const marker=document.getElementById('marker');marker.style.left=(x*100)+'%';marker.style.top=(y*100)+'%';marker.style.display='block';post({type:'tap',page:pageNumber,x,y});};
 let lastQuery='',lastMatch=0;
 document.getElementById('find').onclick=async()=>{
  const query=document.getElementById('query').value.trim().toLowerCase();if(!query)return;
  searching=true;lock();const start=query===lastQuery?lastMatch%pdf.numPages:pageNumber-1;let found=0;
  try{
   for(let offset=0;offset<pdf.numPages;offset++){const n=(start+offset)%pdf.numPages+1;status.textContent='Searching page '+n+'...';const page=await pdf.getPage(n);const content=await page.getTextContent();const text=content.items.map(item=>item.str||'').join(' ').toLowerCase();if(page!==currentPage)page.cleanup();if(text.includes(query)){found=n;break;}}
   if(found){lastQuery=query;lastMatch=found;await showPage(found);status.textContent='Text found on page '+found+'. Find again for the next page.';}else status.textContent='No matching text. Scanned PDFs need OCR, which is not included.';
  }catch(error){status.textContent=describeError(error);}finally{searching=false;lock();}
 };
 window.addEventListener('pagehide',()=>{renderTask?.cancel();pdf.destroy();URL.revokeObjectURL(workerUrl)});
}catch(error){status.textContent=describeError(error);post({type:'error',message:describeError(error)});controls.forEach(el=>el.disabled=true);}
</script></body></html>`;
}
module.exports = { buildPdfHtml, scriptValue };
