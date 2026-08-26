(()=>{
  const NS='http://www.w3.org/2000/svg';
  const icons={
    checkin:[
      '<path d="M8.5 10c-.276 0-.5-.448-.5-1s.224-1 .5-1 .5.448.5 1-.224 1-.5 1"/>',
      '<path d="M10.828.122A.5.5 0 0 1 11 .5V1h.5A1.5 1.5 0 0 1 13 2.5V15h1.5a.5.5 0 0 1 0 1h-13a.5.5 0 0 1 0-1H3V1.5a.5.5 0 0 1 .43-.495l7-1a.5.5 0 0 1 .398.117M11.5 2H11v13h1V2.5a.5.5 0 0 0-.5-.5M4 1.934V15h6V1.077z"/>'
    ].join(''),
    checkout:[
      '<path fill-rule="evenodd" d="M10 12.5a.5.5 0 0 1-.5.5h-8a.5.5 0 0 1-.5-.5v-9a.5.5 0 0 1 .5-.5h8a.5.5 0 0 1 .5.5v2a.5.5 0 0 0 1 0v-2A1.5 1.5 0 0 0 9.5 2h-8A1.5 1.5 0 0 0 0 3.5v9A1.5 1.5 0 0 0 1.5 14h8a1.5 1.5 0 0 0 1.5-1.5v-2a.5.5 0 0 0-1 0z"/>',
      '<path fill-rule="evenodd" d="M15.854 8.354a.5.5 0 0 0 0-.708l-3-3a.5.5 0 0 0-.708.708L14.293 7.5H5.5a.5.5 0 0 0 0 1h8.793l-2.147 2.146a.5.5 0 0 0 .708.708z"/>'
    ].join('')
  };

  function bootstrapSvg(kind){
    const svg=document.createElementNS(NS,'svg');
    svg.setAttribute('viewBox','0 0 16 16');
    svg.setAttribute('fill','currentColor');
    svg.setAttribute('aria-hidden','true');
    svg.setAttribute('focusable','false');
    svg.classList.add('big-icon','v2-bootstrap-home-icon');
    svg.dataset.v2OriginalIcon=kind;
    svg.innerHTML=icons[kind];
    return svg;
  }

  function restoreHomeIcons(){
    const pairs=[['checkinChoice','checkin'],['checkoutChoice','checkout']];
    for(const [id,kind] of pairs){
      const button=document.getElementById(id);
      if(!button) continue;
      if(button.querySelector(`[data-v2-original-icon="${kind}"]`)) continue;
      const current=button.querySelector('.big-icon');
      const exact=bootstrapSvg(kind);
      if(current) current.replaceWith(exact);
      else button.prepend(exact);
    }
  }

  const app=document.getElementById('app');
  if(app){
    new MutationObserver(restoreHomeIcons).observe(app,{childList:true,subtree:true});
    restoreHomeIcons();
  }
})();
