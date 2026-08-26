(()=>{
  const app=document.getElementById('app');
  const toast=document.getElementById('toast');
  const previousFetch=window.fetch.bind(window);
  const MIN_LOADING_MS=3000;
  const ERROR_VISIBLE_MS=2500;
  let overlay=null;
  let hideTimer=null;
  let activeSince=0;
  let activeKind='';
  let skipGenericUntil=0;

  const loadingEnabled=()=>window.TOTEM_LOADING_ENABLED!==false;

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

  function forceHide(){
    clearTimeout(hideTimer);
    const root=ensureOverlay();
    root.classList.add('hidden');
    root.dataset.kind='';
    activeKind='';
  }

  function show(message,{kind='loading',minimum=MIN_LOADING_MS}={}){
    if(kind==='loading'&&!loadingEnabled())return null;
    clearTimeout(hideTimer);
    const root=ensureOverlay();
    const node=messageNode();
    const sameLoading=!root.classList.contains('hidden')&&activeKind==='loading'&&kind==='loading'&&node.textContent===message;
    if(!sameLoading)activeSince=performance.now();
    activeKind=kind;
    root.dataset.kind=kind;
    root.dataset.minimum=String(kind==='loading'?Math.max(MIN_LOADING_MS,Number(minimum||0)):Number(minimum||0));
    node.textContent=message;
    root.classList.remove('hidden');
    return root;
  }

  function loadingRemaining(){
    if(activeKind!=='loading'||!loadingEnabled())return 0;
    const root=ensureOverlay();
    const required=Math.max(MIN_LOADING_MS,Number(root.dataset.minimum||MIN_LOADING_MS));
    return Math.max(0,required-(performance.now()-activeSince));
  }

  function hide({minimum=null,delay=0}={}){
    if(!loadingEnabled()){
      forceHide();
      return;
    }
    const root=ensureOverlay();
    if(root.classList.contains('hidden'))return;
    const configured=minimum===null?Number(root.dataset.minimum||MIN_LOADING_MS):Number(minimum||0);
    const required=activeKind==='loading'?Math.max(MIN_LOADING_MS,configured):configured;
    const elapsed=performance.now()-activeSince;
    const wait=Math.max(0,required-elapsed)+Math.max(0,delay);
    clearTimeout(hideTimer);
    hideTimer=setTimeout(forceHide,wait);
  }

  function clearLookupErrorState(){
    document.body.classList.remove('totem-lookup-error-active');
    if(toast){
      toast.classList.add('hidden');
      toast.textContent='';
    }
  }

  function showError(message='Reserva não encontrada'){
    const wait=loadingEnabled()?loadingRemaining():0;
    skipGenericUntil=performance.now()+wait+ERROR_VISIBLE_MS+800;
    document.body.classList.add('totem-lookup-error-active');
    if(toast){
      toast.classList.add('hidden');
      toast.textContent='';
    }

    clearTimeout(hideTimer);
    hideTimer=setTimeout(()=>{
      show(message,{kind:'error',minimum:0});
      clearTimeout(hideTimer);
      hideTimer=setTimeout(()=>{
        forceHide();
        clearLookupErrorState();
      },ERROR_VISIBLE_MS);
    },wait);
  }

  function isLookupRequest(input){
    try{
      const raw=typeof input==='string'?input:input?.url;
      if(!raw)return false;
      const url=new URL(raw,location.href);
      return url.pathname.endsWith('/api.php')&&url.searchParams.get('action')==='lookup';
    }catch(_){return false}
  }

  window.fetch=async function(input,init){
    const lookup=isLookupRequest(input);
    if(lookup){
      clearLookupErrorState();
      if(loadingEnabled()){
        skipGenericUntil=performance.now()+MIN_LOADING_MS+700;
        show('Executando busca',{kind:'loading'});
      }
    }

    try{
      const response=await previousFetch(input,init);
      if(lookup){
        if(response.ok){
          if(loadingEnabled())hide();
        }else if(response.status===404){
          showError('Reserva não encontrada');
        }else if(loadingEnabled()){
          hide();
        }
      }
      return response;
    }catch(error){
      if(lookup){
        clearLookupErrorState();
        if(loadingEnabled())hide();
      }
      throw error;
    }
  };

  function isSpecificLookupButton(button){
    return !!button?.matches?.('#reservationLookupBtn,#cpfLookupBtn,#checkoutReservationBtn,#checkoutRoomBtn,#nfcLookupBtn');
  }

  document.addEventListener('click',event=>{
    if(!loadingEnabled())return;
    const button=event.target.closest('button,a');
    if(!button)return;

    if(button.matches('#checkinChoice,#checkoutChoice')){
      skipGenericUntil=performance.now()+MIN_LOADING_MS+700;
      show('Ativando recursos',{kind:'loading'});
      hide();
      return;
    }

    if(isSpecificLookupButton(button)){
      clearLookupErrorState();
      skipGenericUntil=performance.now()+MIN_LOADING_MS+700;
      show('Executando busca',{kind:'loading'});
      return;
    }

    if(button.closest('#app')&&!button.classList.contains('payment-option')&&!button.matches('#simulateNfc,#simReturn')){
      if(activeKind!=='loading'){
        skipGenericUntil=performance.now()+MIN_LOADING_MS+700;
        show('Processando',{kind:'loading'});
        hide();
      }
    }
  },true);

  if(app){
    let firstMutation=true;
    const observer=new MutationObserver(()=>{
      if(firstMutation){firstMutation=false;return;}
      if(!loadingEnabled())return;
      if(performance.now()<skipGenericUntil)return;
      if(!ensureOverlay().classList.contains('hidden'))return;
      skipGenericUntil=performance.now()+MIN_LOADING_MS+700;
      show('Processando',{kind:'loading'});
      hide();
    });
    observer.observe(app,{childList:true,subtree:false});
  }

  window.addEventListener('totem:loading-setting-changed',event=>{
    const enabled=event.detail?.enabled!==false;
    window.TOTEM_LOADING_ENABLED=enabled;
    if(!enabled&&activeKind==='loading')forceHide();
  });

  window.addEventListener('pageshow',()=>{
    if(activeKind!=='error')clearLookupErrorState();
  });

  window.TotemTransitionLoading={show,hide,error:showError,forceHide,minimumLoadingMs:MIN_LOADING_MS,isEnabled:loadingEnabled};
})();
