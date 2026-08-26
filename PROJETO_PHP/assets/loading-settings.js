(()=>{
  const B=window.TOTEM_BASE||'';
  const endpoint=`${B}/loading-settings.php`;
  let injecting=false;

  function flash(message,danger=false){
    const toast=document.getElementById('toast');
    if(!toast)return;
    toast.textContent=message;
    toast.style.background=danger?'#9d2430':'#1f3429';
    toast.classList.remove('hidden');
    clearTimeout(toast._loadingSettingsTimer);
    toast._loadingSettingsTimer=setTimeout(()=>toast.classList.add('hidden'),2800);
  }

  async function loadSetting(){
    const r=await fetch(endpoint,{cache:'no-store'});
    const data=await r.json().catch(()=>({}));
    if(!r.ok)throw new Error(data.error||`Erro ${r.status}`);
    const enabled=data.show_transition_loading!==false;
    window.TOTEM_LOADING_ENABLED=enabled;
    window.dispatchEvent(new CustomEvent('totem:loading-setting-changed',{detail:{enabled}}));
    return enabled;
  }

  async function saveSetting(enabled){
    const r=await fetch(endpoint,{
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify({show_transition_loading:!!enabled})
    });
    const data=await r.json().catch(()=>({}));
    if(!r.ok)throw new Error(data.error||`Erro ${r.status}`);
    const saved=data.show_transition_loading!==false;
    window.TOTEM_LOADING_ENABLED=saved;
    window.dispatchEvent(new CustomEvent('totem:loading-setting-changed',{detail:{enabled:saved}}));
    return saved;
  }

  async function inject(){
    if(injecting||document.getElementById('showTransitionLoading'))return;
    const modal=document.querySelector('#modalRoot .modal-card');
    if(!modal||!/Dashboard de configuração/i.test(modal.textContent||''))return;
    const rules=[...modal.querySelectorAll('.section-card')].find(card=>/Regras do fluxo/i.test(card.textContent||''));
    if(!rules)return;

    injecting=true;
    try{
      const enabled=await loadSetting();
      if(document.getElementById('showTransitionLoading'))return;

      const row=document.createElement('label');
      row.className='switch-line';
      row.style.marginTop='14px';
      row.innerHTML=`
        <span>
          <strong>Exibir telas de loading</strong>
          <small style="display:block;color:var(--muted);font-weight:400;margin-top:3px">Quando ativado, cada transição permanece visível por no mínimo 3 segundos. Desative para usar o tempo real das operações.</small>
        </span>
        <input type="checkbox" id="showTransitionLoading" aria-label="Exibir telas de loading" ${enabled?'checked':''}>
      `;
      rules.appendChild(row);

      const input=row.querySelector('#showTransitionLoading');
      input.addEventListener('change',async()=>{
        const requested=input.checked;
        input.disabled=true;
        try{
          const saved=await saveSetting(requested);
          input.checked=saved;
          flash(saved?'Telas de loading ativadas.':'Telas de loading desativadas. Operações em tempo real.');
        }catch(error){
          input.checked=!requested;
          flash(error.message,true);
        }finally{
          input.disabled=false;
        }
      });
    }catch(error){
      console.error('[TOTEM] Falha ao carregar configuração de loading:',error);
    }finally{
      injecting=false;
    }
  }

  const root=document.getElementById('modalRoot');
  if(root)new MutationObserver(()=>queueMicrotask(inject)).observe(root,{childList:true,subtree:true});
})();
