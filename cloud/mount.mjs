/** Relocate only known root URLs; never alter parser/data strings or relative imports. */
export function mountClientSource(source,mount=''){
  if(!mount)return source;
  if(mount!=='/grindzone')throw Error('Unsupported phone mount');
  return source.replace(/(["'`])\/(?=(?:api|phone)\/|#)/g,'$1'+mount+'/')
    .replace(/((?:src|href)=["'])\/(?!\/|grindzone\/)/g,'$1'+mount+'/');
}
export function isPhonePath(url){return typeof url==='string'&&(url==='/grindzone'||url.startsWith('/grindzone/')||url.startsWith('/grindzone?'));}
export function phoneProxyHeaders(headers){
  const allowed=new Set(['host','origin','content-type','content-length','accept','user-agent','sec-fetch-site','sec-fetch-mode','sec-fetch-dest','x-companion-token','authorization','upgrade','connection','sec-websocket-key','sec-websocket-version','sec-websocket-protocol','sec-websocket-extensions']);
  const result=Object.fromEntries(Object.entries(headers).filter(([key])=>allowed.has(key.toLowerCase())));
  const cookies=String(headers.cookie||'').split(';').map(x=>x.trim()).filter(x=>x.startsWith('__Secure-grindzone-phone='));
  if(cookies.length)result.cookie=cookies.join('; ');
  return result;
}
