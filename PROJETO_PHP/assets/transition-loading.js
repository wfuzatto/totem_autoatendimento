(()=>{
  const app=document.getElementById('app');
  const toast=document.getElementById('toast');
  const previousFetch=window.fetch.bind(window);
  let overlay=null;
  let hideTimer=null;
  let activeSince=0;
  let activeKind='';
  let skipGenericUntil=0;

  function ensureOverlay(){
    if(overlay?.isConnected)return overlay;
    overlay=document.createElement('div');
    overlay.id='transitionLoadingOverlay';
    overlay.className='totem-transition-overlay hidden';
    overlay.setAttribute('role','status');
    overlay.setAttribute('aria-live','polite');
    overlay.innerHTML=`
      <div class="totem-transition-card">
        <div class="totem-transition-spinner" aria-hidden="true"></div>
        <div class="totem-transition-error-icon" aria-hidden="true">!</div>
        <div class="totem-transition-message" id="transitionLoadingMessage"></div>
        <div class="totem-transition-dots" aria-hidden="true"><span></span><span></span><span></span></div>
      </div>`;
    document.body.appendChild(overlay);
    return overlay;
  }

  function messageNode(){return ensureOverlay().querySelector('#transitionLoadingMessage')}

  function show(message,{kind='loading',minimum=520}={}){
    clearTimeout(hideTimer);
    activeSince=performance.now();
    activeKind=kind;
    const root=ensureOverlay();
    root.dataset.kind=kind;
    root.dataset.minimum=String(minimum);
    messageNode().textContent=message;
    root.classList.remove('hidden');
    return root;
  }

  function hide({minimum=null,delay=0}={}){
    const root=ensureOverlay();
    if(root.classList.contains('hidden'))return;
    const required=minimum===null?Number(root.dataset.minimum||0):Number(minimum||0);
    const elapsed=performance.now()-activeSince;
    const wait=Math.max(0,required-elapsed)+Math.max(0,delay);
    clearTimeout(hideTimer);
    hideTimer=setTimeout(()=>{
      root.classList.add('hidden');
      root.dataset.kind='';
      activeKind='';
    },wait);
  }

  function showError(message='Reserva não encontrada'){
    skipGenericUntil=performance.now()+1800;
    show(message,{kind:'error',minimum:0});
    clearTimeout(hideTimer);
    hideTimer=setTimeout(()=>{
      ensureOverlay().classList.add('hidden');
      activeKind='';
    },2200);
  }

  function isLookupRequest(input){
    try{
      const raw=typeof input==='string'?input:input?.url;
      if(!raw)return false;
      const url=new URL(raw,location.href);
      return url.pathname.endsWith('/api.php') && url.searchParams.get('action')==='lookup';
    }catch(_){return false}
  }

  window.fetch=async function(input,init){
    const lookup=isLookupRequest(input);
    if(lookup){
      skipGenericUntil=performance.now()+1200;
      show('Executando busca',{kind:'loading',minimum:650});
    }
    try{
      const response=await previousFetch(input,init);
      if(lookup){
        if(response.ok)hide({delay:280});
        else hide({minimum:400});
      }
      return response;
    }catch(error){
      if(lookup)hide({minimum:400});
      throw error;
    }
  };

  function isSpecificLookupButton(button){
    return !!button?.matches?.('#reservationLookupBtn,#cpfLookupBtn,#checkoutReservationBtn,#checkoutRoomBtn,#nfcLookupBtn');
  }

  document.addEventListener('click',event=>{
    const button=event.target.closest('button,a');
    if(!button)return;

    if(button.matches('#checkinChoice,#checkoutChoice')){
      skipGenericUntil=performance.now()+1400;
      show('Ativando recursos',{kind:'loading',minimum:900});
      hide({delay:300});
      return;
    }

    if(isSpecificLookupButton(button)){
      skipGenericUntil=performance.now()+1200;
      show('Executando busca',{kind:'loading',minimum:650});
      return;
    }

    if(button.closest('#app') && !button.classList.contains('payment-option') && !button.matches('#simulateNfc,#simReturn')){
      if(activeKind!=='loading'){
        skipGenericUntil=performance.now()+700;
        show('Processando',{kind:'loading',minimum:420});
        hide({delay:180});
      }
    }
  },true);

  if(app){
    let firstMutation=true;
    const observer=new MutationObserver(()=>{
      if(firstMutation){firstMutation=false;return;}
      if(performance.now()<skipGenericUntil)return;
      if(!ensureOverlay().classList.contains('hidden'))return;
      show('Processando',{kind:'loading',minimum:360});
      hide({delay:160});
    });
    observer.observe(app,{childList:true,subtree:false});
  }

  if(toast){
    const suppressReservationNotFound=()=>{
      const text=(toast.textContent||'').trim();
      if(!/reserva não encontrada/i.test(text))return;
      toast.classList.add('hidden');
      showError('Reserva não encontrada');
    };
    new MutationObserver(suppressReservationNotFound).observe(toast,{childList:true,subtree:true,characterData:true,attributes:true,attributeFilter:['class']});
  }

  window.TotemTransitionLoading={show,hide,error:showError};
})();
